import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changeSetDigest } from "./change-set-digest.js";
import { contentDigest, discoveryLinkRole, discoveryLinkTarget } from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import type { LedgerPackageIdentity } from "./ledger-contract.js";

const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");

type Loose = Record<string, any>;

const gitEnv = {
  ...process.env,
  PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Example Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Example Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: gitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function reseal(set: Loose): RepositoryChangeSet {
  const digest = changeSetDigest(set as RepositoryChangeSet);
  set.changeSetDigest = digest;
  set.branch = `clossys/apply-${digest.slice(7, 19)}`;
  set.pullRequest = { title: `Clossys: apply plan ${digest.slice(7, 19)}` };
  return set as RepositoryChangeSet;
}

/**
 * A setup change set whose whole-file bytes are known, with the pin already
 * satisfied and no lockfile to regenerate, checked out from a local clone.
 */
export function buildMaterializedFixture(roots: string[]) {
  const parent = mkdtempSync(join(tmpdir(), "launcher-apply-step-"));
  roots.push(parent);
  const origin = join(parent, "origin.git");
  const clone = join(parent, "site");
  const hub = join(parent, "hub");
  mkdirSync(hub);
  mkdirSync(clone, { recursive: true });
  git(clone, "init", "-b", "main");
  git(clone, "config", "core.autocrlf", "false");
  writeFileSync(join(clone, "README.md"), "# Site\n");
  git(clone, "add", "README.md");
  git(clone, "commit", "-m", "init");
  execFileSync("git", ["init", "--bare", origin], { env: gitEnv, stdio: "ignore" });
  git(clone, "remote", "add", "origin", origin);
  git(clone, "push", "-u", "origin", "HEAD");
  const baseCommit = git(clone, "rev-parse", "HEAD").trim();

  const corpus = JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as {
    changeSets: { name: string; changeSet: RepositoryChangeSet }[];
  };
  const set = structuredClone(corpus.changeSets.find((entry) => entry.name === "setup-site")!.changeSet) as unknown as Loose;
  set.repository.baseCommit = baseCommit;
  set.keys = [];
  set.deferred = [];
  set.files = (set.files as Loose[]).filter((file) => file.path !== "package-lock.json");
  for (const item of set.items as Loose[]) {
    if (item.act === "pin-starter" || item.act === "install") item.satisfiedInBase = true;
  }
  const texts: Record<string, string> = {};
  for (const file of set.files as Loose[]) {
    if (file.derived === true) continue;
    if (file.mode === "120000") {
      const role = discoveryLinkRole(file.path as string);
      const target = discoveryLinkTarget(role!);
      texts[file.path as string] = target;
      file.before = null;
      file.after = contentDigest(target);
    } else {
      const text = `fixture ${file.path}\n`;
      texts[file.path as string] = text;
      file.before = null;
      file.after = contentDigest(text);
    }
  }
  const sealed = reseal(set);
  const binding = { kind: "approved" as const, subjectDigest: sealed.planDigest };
  const planPackages: (LedgerPackageIdentity & { act: "install" | "pin-starter" })[] = sealed.items.flatMap((item) =>
    item.act === "install" || item.act === "pin-starter"
      ? [{ planItem: item.planItem, act: item.act, name: item.package.name, version: item.package.version, integrity: item.package.integrity, placement: item.placement }]
      : [],
  );
  return { clone: realpathSync(clone), hub: realpathSync(hub), set: sealed, texts, binding, planPackages };
}
