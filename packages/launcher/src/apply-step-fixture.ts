import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  SITE_ID,
  approvedPlan,
  basePlan,
  buildWorld,
  bundleOf,
  committedPlanPackages,
  hubRepo,
  lockfileText,
  reseal,
  siteRepo,
} from "./admission-fixture.js";
import type { HubOptions, World, WorldOptions } from "./admission-fixture.js";
import { contentDigest, discoveryLinkRole, discoveryLinkTarget } from "./change-set-contract.js";
import type { ApplyBundle, RepositoryChangeSet } from "./change-set-contract.js";
import type { LockfileSpawn } from "./lockfile-regen.js";
import type { AdvisorPlan } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";

export { reseal };

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

export interface MaterializedFixtureOptions {
  /** Overrides for the hub: options, or a function of what the fixture built (its plan, its approved bundle and its set). */
  readonly hub?: Partial<HubOptions> | ((built: { plan: AdvisorPlan; bundle: ApplyBundle; set: RepositoryChangeSet }) => Partial<HubOptions>);
  /** Store the set, with its whole-file texts, in the hub's change-set store, where the command line finds it. Default false. */
  readonly storeSet?: boolean;
}

/**
 * A setup change set whose whole-file bytes are known, with the pin already
 * satisfied and no lockfile to regenerate, checked out from a local clone, and
 * a hub that approved it: a git repository whose HEAD holds a plan (its latest
 * decision approves the bundle that holds the set) and an execution
 * authorization, with the bundle stored and the hub's readiness executable
 * installed. `binding` is the binding admission is expected to compute; it is
 * never an input to materialize or verify.
 */
export function buildMaterializedFixture(roots: string[], options: MaterializedFixtureOptions = {}) {
  const parent = mkdtempSync(join(tmpdir(), "launcher-apply-step-"));
  roots.push(parent);
  const origin = join(parent, "origin.git");
  const clone = join(parent, "site");
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
  const plan0 = basePlan() as unknown as AdvisorPlan;
  set.planDigest = planDigest(plan0);
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
  const bundle = bundleOf(plan0, [{ id: SITE_ID, set: sealed }]);
  const built = { ...sealed, bundle: bundle.bundleDigest } as RepositoryChangeSet;
  const plan = approvedPlan(bundle.bundleDigest, plan0);
  const override = typeof options.hub === "function" ? options.hub({ plan, bundle, set: built }) : (options.hub ?? {});
  // What the planner stores carries the whole-file texts, so the command line can write from the store alone.
  const stored = { ...built, texts: Object.entries(texts).map(([path, text]) => ({ path, text })).sort((left, right) => left.path.localeCompare(right.path)) };
  const hub = hubRepo(roots, { plans: [plan], sets: options.storeSet === true ? [stored] : [], bundles: [bundle], ...override });
  const binding = { kind: "approved" as const, subjectDigest: bundle.bundleDigest };
  return { clone: realpathSync(clone), hub: hub.hub, set: built, texts, binding, planPackages: committedPlanPackages(plan, SITE_ID), plan, bundle, origin };
}

export interface AdmittedFixtureOptions {
  readonly world?: WorldOptions;
  readonly hub?: Partial<HubOptions> | ((world: World) => Partial<HubOptions>);
  /** How the setup set reached the default branch. Default `squash`: no ancestor of the setup branch. */
  readonly mergeStyle?: "direct" | "squash";
  /** Edits the base tree before it is committed. */
  readonly tree?: (tree: World["tree"]) => void;
  /** Store the apply set in the hub too. Default false. */
  readonly storeApplySet?: boolean;
}

/**
 * The two phases of one plan. The setup set was approved (the plan's latest
 * decision approves the bundle that holds it), materialized and merged into
 * the clone's default branch (by squash by default), and the apply set was
 * then computed against the merged base and is held by a later run's bundle,
 * which the hub stores. `spawn` stands in for the package manager: it
 * regenerates the lockfile the apply set's installs write.
 */
export function buildAdmittedFixture(roots: string[], options: AdmittedFixtureOptions = {}) {
  let site: ReturnType<typeof siteRepo> | undefined;
  const world = buildWorld({
    ...options.world,
    commitBase: (tree) => {
      options.tree?.(tree);
      site = siteRepo(roots, tree, { mergeStyle: options.mergeStyle ?? "squash" });
      const origin = join(dirname(site.clone), "origin.git");
      execFileSync("git", ["init", "--bare", origin], { env: gitEnv, stdio: "ignore" });
      git(site.clone, "remote", "add", "origin", origin);
      git(site.clone, "push", "-u", "origin", "main");
      return site.baseCommit;
    },
  });
  const override = typeof options.hub === "function" ? options.hub(world) : (options.hub ?? {});
  const hub = hubRepo(roots, {
    plans: [world.plan],
    sets: options.storeApplySet === true ? [world.setup, world.apply] : [world.setup],
    bundles: [world.approvedBundle, world.applyBundle],
    ...override,
  });
  const packages = committedPlanPackages(world.plan, SITE_ID);
  const spawn: LockfileSpawn = async (request) => {
    if (request.args.includes("--version")) return { status: 0, stdout: "10.9.0\n", stderr: "" };
    writeFileSync(join(request.cwd, "package-lock.json"), lockfileText(packages));
    return { status: 0, stdout: "", stderr: "" };
  };
  return {
    world,
    hub: hub.hub,
    clone: site!.clone,
    baseCommit: site!.baseCommit,
    sideTip: site!.sideTip,
    set: world.apply,
    setup: world.setup,
    texts: world.texts,
    spawn,
  };
}

function walk(root: string, skip: (relative: string) => boolean, into: string[], relative = ""): void {
  let names: string[];
  try {
    names = readdirSync(join(root, relative)).sort();
  } catch {
    return;
  }
  for (const name of names) {
    const path = relative === "" ? name : `${relative}/${name}`;
    if (skip(path)) continue;
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) walk(root, skip, into, path);
    else if (stat.isSymbolicLink()) into.push(`${path} -> ${readlinkSync(join(root, path))}`);
    else into.push(`${path} ${createHash("sha256").update(readFileSync(join(root, path))).digest("hex")} ${stat.mode & 0o777}`);
  }
}

/**
 * Everything a refused materialize must leave alone: the clone's refs, HEAD,
 * index, status and every file outside .git, and every file the hub keeps
 * under clossys/.state. Two snapshots are equal only when nothing moved.
 */
export function writeSnapshot(clone: string, hub: string): string {
  const files: string[] = [];
  walk(clone, (path) => path === ".git", files);
  const hubFiles: string[] = [];
  walk(join(hub, "clossys", ".state"), () => false, hubFiles);
  return JSON.stringify({
    refs: git(clone, "for-each-ref").trim(),
    head: git(clone, "rev-parse", "HEAD").trim(),
    branch: git(clone, "rev-parse", "--abbrev-ref", "HEAD").trim(),
    index: git(clone, "ls-files", "-s").trim(),
    status: git(clone, "status", "--porcelain", "--untracked-files=all").trim(),
    files,
    hub: hubFiles,
  });
}

/** Whether the clone holds a local branch of this name. */
export function branchExists(clone: string, branch: string): boolean {
  try {
    git(clone, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

/** The ledger a clone holds at clossys/.state/installed.json, parsed, or null when it holds none. */
export function readCloneLedger(clone: string): Loose | null {
  const path = join(clone, "clossys/.state/installed.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Loose) : null;
}
