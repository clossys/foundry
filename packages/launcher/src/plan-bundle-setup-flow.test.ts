// The whole path of a setup set against real git: compute it from an
// observation, materialize it into a clone, verify it, merge it, observe the
// merged default branch, compute the apply set, and ask admission whether the
// one approval covers it. Every test drives git against temporary
// repositories, each with a bare origin, so each carries its own timeout.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approvedPlan, authorityOf, bundleOf, clone as cloneValue, committedPlanPackages, hubRepo, reseal } from "./admission-fixture.js";
import type { Loose } from "./admission-fixture.js";
import { decideSetBinding } from "./admission.js";
import { storeApplyBundle } from "./apply-store.js";
import { LEDGER_PATH, TEMPLATE_PATHS, contentDigest } from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import { serializeInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger } from "./ledger-contract.js";
import { trustInstalledLedger } from "./ledger-trust.js";
import type { LockfileSpawn } from "./lockfile-regen.js";
import { materializeRepository, verifyRepository } from "./materialize.js";
import { defaultOriginId, observeRepository } from "./observe-repository.js";
import { planApplyBundle } from "./plan-bundle.js";
import type { RepositoryObservation } from "./plan-bundle.js";
import { SITE_ID, SITE_NODE_ID, STARTER_INTEGRITY, STARTER_NAME, STARTER_VERSION, setupInputs, setupPlan } from "./plan-bundle-setup-fixture.js";
import type { AdvisorPlan } from "./plan-contract.js";
import { editReleaseAgeExemption } from "./release-age-edit.js";

type Kind = "npm" | "pnpm";
type Files = Record<string, string>;

const TEST_TIMEOUT_MS = 120_000;
const NOW = () => new Date("2026-09-25T00:00:00Z");
const READY = () => ({ status: 0 });
const PM_VERSION = "10.9.0";
const DEP_INTEGRITY = `sha512-${Buffer.alloc(64, 3).toString("base64")}`;

const gitEnv: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_AUTHOR_NAME: "Example Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Example Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// the repository

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function manifestText(kind: Kind): string {
  return json({ name: "site", private: true, packageManager: `${kind}@${PM_VERSION}`, devDependencies: { "example-dep": "1.0.0" } });
}

function npmLock(withStarter: boolean): string {
  const tarball = (name: string, file: string, version: string) => `https://registry.npmjs.org/${name}/-/${file}-${version}.tgz`;
  const packages: Record<string, unknown> = {
    "": { name: "site", version: "1.0.0", devDependencies: { "example-dep": "1.0.0", ...(withStarter ? { [STARTER_NAME]: STARTER_VERSION } : {}) } },
    "node_modules/example-dep": { version: "1.0.0", resolved: tarball("example-dep", "example-dep", "1.0.0"), integrity: DEP_INTEGRITY, dev: true },
  };
  if (withStarter) {
    packages[`node_modules/${STARTER_NAME}`] = { version: STARTER_VERSION, resolved: tarball(STARTER_NAME, "starter", STARTER_VERSION), integrity: STARTER_INTEGRITY, dev: true };
  }
  return json({ name: "site", version: "1.0.0", lockfileVersion: 3, requires: true, packages });
}

function pnpmLock(withStarter: boolean): string {
  const lines = ["lockfileVersion: '9.0'", "", "settings:", "  autoInstallPeers: true", "  excludeLinksFromLockfile: false", "", "importers:", "", "  .:", "    devDependencies:"];
  if (withStarter) lines.push(`      '${STARTER_NAME}':`, `        specifier: ${STARTER_VERSION}`, `        version: ${STARTER_VERSION}`);
  lines.push("      example-dep:", "        specifier: 1.0.0", "        version: 1.0.0", "", "packages:", "");
  const entries: [string, string, string][] = [["example-dep@1.0.0", DEP_INTEGRITY, "https://registry.npmjs.org/example-dep/-/example-dep-1.0.0.tgz"]];
  if (withStarter) entries.unshift([`${STARTER_NAME}@${STARTER_VERSION}`, STARTER_INTEGRITY, `https://registry.npmjs.org/${STARTER_NAME}/-/starter-${STARTER_VERSION}.tgz`]);
  for (const [key, integrity, tarball] of entries) lines.push(`  '${key}':`, `    resolution: {integrity: ${integrity}, tarball: ${tarball}}`, "");
  lines.push("snapshots:", "");
  for (const [key] of entries) lines.push(`  '${key}': {}`, "");
  return lines.join("\n");
}

const lockName = (kind: Kind) => (kind === "npm" ? "package-lock.json" : "pnpm-lock.yaml");
const lockText = (kind: Kind, withStarter: boolean) => (kind === "npm" ? npmLock(withStarter) : pnpmLock(withStarter));

interface Site {
  readonly root: string;
  readonly clone: string;
  readonly kind: Kind;
}

function originIdFor(root: string): (url: string) => string | null {
  const prefix = `${join(root, "origin")}${sep}`;
  return (url) => {
    if (!url.startsWith(prefix) || !url.endsWith(".git")) return defaultOriginId(url);
    const parts = url.slice(prefix.length, -".git".length).split("/");
    return parts.length === 2 && parts.every((part) => part.length > 0) ? parts.join("/") : null;
  };
}

function writeTree(dir: string, files: Files): void {
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

function makeSite(kind: Kind, extra: Files = {}): Site {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plan-bundle-setup-")));
  roots.push(root);
  const origin = join(root, "origin", `${SITE_ID}.git`);
  const clonePath = join(root, "clone");
  mkdirSync(dirname(origin), { recursive: true });
  mkdirSync(clonePath);
  git(root, "init", "--bare", "-b", "main", origin);
  git(clonePath, "init", "-b", "main");
  git(clonePath, "remote", "add", "origin", origin);
  writeTree(clonePath, { "README.md": "# Site\n", "package.json": manifestText(kind), [lockName(kind)]: lockText(kind, false), ...extra });
  git(clonePath, "add", "-A");
  git(clonePath, "commit", "-m", "initial");
  git(clonePath, "push", "-u", "origin", "main");
  return { root, clone: clonePath, kind };
}

async function observe(site: Site): Promise<RepositoryObservation> {
  const result = await observeRepository({ id: SITE_ID, clone: site.clone, ports: { nodeId: () => SITE_NODE_ID, visibility: () => "private", originId: originIdFor(site.root) } });
  if ("skipped" in result) throw new Error(`the clone was skipped: ${result.skipped}`);
  return result;
}

/** Stands in for the package manager: it regenerates the lockfile with the Starter pin added, and nothing else. */
function spawnFor(kind: Kind): LockfileSpawn {
  return async (request) => {
    if (request.args.includes("--version")) return { status: 0, stdout: "10.9.0\n", stderr: "" };
    writeFileSync(join(request.cwd, lockName(kind)), lockText(kind, true));
    return { status: 0, stdout: "", stderr: "" };
  };
}

const toolVersionFor = (kind: Kind) => (kind === "pnpm" ? "10.9.0" : null);

// ---------------------------------------------------------------------------
// the setup half

interface SetupRun {
  readonly site: Site;
  readonly plan: AdvisorPlan;
  readonly approved: AdvisorPlan;
  readonly hub: string;
  readonly setup: RepositoryChangeSet;
  readonly approvedBundle: string;
  readonly observation: RepositoryObservation;
}

async function computeSetup(kind: Kind, extra: Files = {}): Promise<SetupRun> {
  const site = makeSite(kind, extra);
  const observation = await observe(site);
  expect(observation.phase).toBe("setup");
  const plan = setupPlan();
  const { bundle, changeSets } = planApplyBundle(setupInputs(observation, plan));
  const setup = changeSets[0];
  if (setup === undefined) throw new Error(`no setup set was computed: ${JSON.stringify(bundle.repositories)}`);
  const approved = approvedPlan(bundle.bundleDigest, plan);
  const hub = hubRepo(roots, { plans: [approved], sets: [setup], bundles: [bundle] }).hub;
  return { site, plan, approved, hub, setup, approvedBundle: bundle.bundleDigest, observation };
}

async function materializeSetup(run: SetupRun) {
  return materializeRepository({
    clone: run.site.clone,
    hub: run.hub,
    set: run.setup,
    texts: {},
    spawn: spawnFor(run.site.kind),
    toolVersion: toolVersionFor(run.site.kind),
    now: NOW,
    runReadiness: READY,
  });
}

/** Commits the materialized branch and lands it on the default branch as one squashed commit, the way a squash merge leaves it. */
function merge(run: SetupRun): void {
  const { clone } = run.site;
  git(clone, "add", "-A");
  git(clone, "commit", "-m", "setup");
  git(clone, "checkout", "main");
  git(clone, "merge", "--squash", run.setup.branch);
  git(clone, "commit", "-m", "setup (squashed)");
  git(clone, "push", "origin", "main");
}

async function applyDecision(run: SetupRun) {
  const observation = await observe(run.site);
  expect(observation.phase).toBe("apply");
  const { bundle, changeSets } = planApplyBundle(setupInputs(observation, run.plan, { heldChangeSets: [run.setup] }));
  const apply = changeSets[0];
  if (apply === undefined) throw new Error(`no apply set was computed: ${JSON.stringify(bundle.repositories)}`);
  storeApplyBundle(run.hub, bundle);
  const authority = authorityOf(run.approved);
  const trust = trustInstalledLedger(observation.ledger, { id: SITE_ID, nodeId: SITE_NODE_ID }, [run.setup], {
    planPackageActs: [{ planDigest: authority.planDigest, packages: committedPlanPackages(run.approved, SITE_ID) }],
  });
  if (trust.state !== "trusted") throw new Error(`the merged ledger was not trusted: ${trust.rule}`);
  const decided = await decideSetBinding({
    hub: run.hub,
    clone: run.site.clone,
    set: apply,
    authority,
    baseLedger: trust.ledger,
    baseLedgerBytes: observation.ledger,
    now: NOW,
    runReadiness: READY,
  });
  return { observation, apply, decided };
}

const read = (site: Site, path: string): string => readFileSync(join(site.clone, path), "utf8");

// ---------------------------------------------------------------------------

describe("a setup set, from computation to the admitted apply set", () => {
  it(
    "npm: compute, materialize, verify, merge, observe, compute again, and the apply set is admitted",
    async () => {
      const run = await computeSetup("npm");
      expect(run.setup.phase).toBe("setup");

      const materialized = await materializeSetup(run);
      expect(materialized).toMatchObject({ exitCode: 0, verdict: "materialized" });
      expect(await verifyRepository({ clone: run.site.clone, hub: run.hub, set: run.setup, now: NOW, runReadiness: READY })).toMatchObject({ exitCode: 0, verdict: "materialized" });
      // The bytes on disk are the renderer's, and the manifest holds the pin and nothing deferred.
      expect(read(run.site, ".starter/request.json")).toBe(run.setup.texts!.find((row) => row.path === ".starter/request.json")!.text);
      expect(JSON.parse(read(run.site, "package.json")).devDependencies).toEqual({ "example-dep": "1.0.0", [STARTER_NAME]: STARTER_VERSION });

      merge(run);
      const { observation, apply, decided } = await applyDecision(run);
      expect(observation.ledger).not.toBeNull();
      expect(apply.phase).toBe("apply");
      expect(apply.items.some((item) => item.act === "exempt-release-age")).toBe(false);
      expect(decided).toEqual({ state: "bound", binding: { kind: "admitted", subjectDigest: run.approvedBundle, setupChangeSet: run.setup.changeSetDigest } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "pnpm with no workspace file: the file is created, and the apply set carries the item and no file and is admitted",
    async () => {
      const run = await computeSetup("pnpm");
      expect(run.setup.files.find((file) => file.path === "pnpm-workspace.yaml")).toMatchObject({ before: null });

      expect(await materializeSetup(run)).toMatchObject({ exitCode: 0, verdict: "materialized" });
      expect(await verifyRepository({ clone: run.site.clone, hub: run.hub, set: run.setup, now: NOW, runReadiness: READY })).toMatchObject({ exitCode: 0, verdict: "materialized" });
      const edited = editReleaseAgeExemption({ surface: "pnpm-workspace", text: null });
      expect(read(run.site, "pnpm-workspace.yaml")).toBe(edited.kind === "edited" ? edited.text : "");

      merge(run);
      const { apply, decided } = await applyDecision(run);
      expect(apply.items.filter((item) => item.act === "exempt-release-age")).toEqual(run.setup.items.filter((item) => item.act === "exempt-release-age"));
      expect(apply.files.some((file) => file.path === "pnpm-workspace.yaml")).toBe(false);
      expect(decided).toMatchObject({ state: "bound", binding: { kind: "admitted", setupChangeSet: run.setup.changeSetDigest } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "pnpm with a workspace file: the one entry is added after what is there, and the apply set is admitted",
    async () => {
      const surface = "packages:\n  - 'apps/*'\n";
      const run = await computeSetup("pnpm", { "pnpm-workspace.yaml": surface });
      expect(run.observation.pnpmWorkspaceText).toBe(surface);
      expect(await materializeSetup(run)).toMatchObject({ exitCode: 0, verdict: "materialized" });
      expect(read(run.site, "pnpm-workspace.yaml")).toBe(`${surface}minimumReleaseAgeExclude:\n  - '@clossys/*'\n`);

      merge(run);
      const { decided } = await applyDecision(run);
      expect(decided).toMatchObject({ state: "bound", binding: { kind: "admitted" } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "pnpm with the entry already listed: the item is there, no file is written, and the apply set is admitted",
    async () => {
      const surface = "minimumReleaseAgeExclude:\n  - '@clossys/*'\n";
      const run = await computeSetup("pnpm", { "pnpm-workspace.yaml": surface });
      expect(run.setup.files.some((file) => file.path === "pnpm-workspace.yaml")).toBe(false);
      expect(await materializeSetup(run)).toMatchObject({ exitCode: 0, verdict: "materialized" });
      expect(read(run.site, "pnpm-workspace.yaml")).toBe(surface);

      merge(run);
      const { decided } = await applyDecision(run);
      expect(decided).toMatchObject({ state: "bound", binding: { kind: "admitted" } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a setup set that needed root entries is not admitted for its apply set: the items differ",
    async () => {
      const profilePath = "governance/repository-profile.json";
      const profile = json({ schemaVersion: 3, rootEntries: ["README.md", "package.json", "package-lock.json", "governance"].map((name) => ({ name, classification: "canonical", disposition: "allowed" })) });
      const run = await computeSetup("npm", { [profilePath]: profile });
      expect(run.setup.items.some((item) => item.act === "declare-root-entry")).toBe(true);

      expect(await materializeSetup(run)).toMatchObject({ exitCode: 0, verdict: "materialized" });
      merge(run);
      const { apply, decided } = await applyDecision(run);
      // The merged profile declares every root now, so the apply set has no declare-root-entry item to match the setup set's.
      expect(apply.items.some((item) => item.act === "declare-root-entry")).toBe(false);
      expect(decided).toEqual({ state: "refused", exitCode: 2, reason: "awaiting-approval", detail: "items-differ" });
    },
    TEST_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// materialize and verify prove the one-entry edit

/** The set with pnpm-workspace.yaml's text replaced (and its digest, resealed), and a hub that approved exactly that set. */
function tamperedRun(run: SetupRun, text: string): { set: RepositoryChangeSet; hub: string } {
  const set = cloneValue(run.setup) as unknown as Loose;
  set.files.find((file: Loose) => file.path === "pnpm-workspace.yaml").after = contentDigest(text);
  set.texts.find((row: Loose) => row.path === "pnpm-workspace.yaml").text = text;
  const sealed = reseal(set);
  const bundle = bundleOf(run.plan, [{ id: SITE_ID, set: sealed }]);
  const withBundle = { ...sealed, bundle: bundle.bundleDigest } as RepositoryChangeSet;
  const hub = hubRepo(roots, { plans: [approvedPlan(bundle.bundleDigest, run.plan)], sets: [withBundle], bundles: [bundle] }).hub;
  return { set: withBundle, hub };
}

/** The set with pnpm-workspace.yaml's `before` digest replaced (and the set resealed), and a hub that approved exactly that set. */
function tamperedBefore(run: SetupRun, before: string | null): { set: RepositoryChangeSet; hub: string } {
  const set = cloneValue(run.setup) as unknown as Loose;
  set.files.find((file: Loose) => file.path === "pnpm-workspace.yaml").before = before;
  const sealed = reseal(set);
  const bundle = bundleOf(run.plan, [{ id: SITE_ID, set: sealed }]);
  const withBundle = { ...sealed, bundle: bundle.bundleDigest } as RepositoryChangeSet;
  const hub = hubRepo(roots, { plans: [approvedPlan(bundle.bundleDigest, run.plan)], sets: [withBundle], bundles: [bundle] }).hub;
  return { set: withBundle, hub };
}

describe("materialize and verify prove that the release-age file gains exactly one entry", () => {
  const TWO_ENTRIES = "packages:\n  - 'apps/*'\nminimumReleaseAgeExclude:\n  - '@clossys/*'\n  - 'extra-scope/*'\n";

  it(
    "materialize refuses a surface text that adds more than one entry, and writes nothing",
    async () => {
      const run = await computeSetup("pnpm", { "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n" });
      const { set, hub } = tamperedRun(run, TWO_ENTRIES);
      const before = git(run.site.clone, "status", "--porcelain", "--untracked-files=all");
      const result = await materializeRepository({ clone: run.site.clone, hub, set, texts: {}, spawn: spawnFor("pnpm"), toolVersion: "10.9.0", now: NOW, runReadiness: READY });
      expect(result).toMatchObject({ exitCode: 1, verdict: "violated", reason: "content-mismatch" });
      expect(() => git(run.site.clone, "show-ref", "--verify", "--quiet", `refs/heads/${set.branch}`)).toThrow();
      expect(git(run.site.clone, "status", "--porcelain", "--untracked-files=all")).toBe(before);
      expect(existsSync(join(run.site.clone, LEDGER_PATH))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "materialize refuses a surface text that drops a line the base had",
    async () => {
      const run = await computeSetup("pnpm", { "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n" });
      const { set, hub } = tamperedRun(run, "minimumReleaseAgeExclude:\n  - '@clossys/*'\n");
      const result = await materializeRepository({ clone: run.site.clone, hub, set, texts: {}, spawn: spawnFor("pnpm"), toolVersion: "10.9.0", now: NOW, runReadiness: READY });
      expect(result).toMatchObject({ exitCode: 1, verdict: "violated", reason: "content-mismatch" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "verify refuses a file whose bytes the set names but which adds more than one entry",
    async () => {
      const run = await computeSetup("pnpm", { "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n" });
      expect(await materializeSetup(run)).toMatchObject({ exitCode: 0 });
      const { set, hub } = tamperedRun(run, TWO_ENTRIES);
      // The same tree under the branch the tampered set names, with the tampered bytes on disk.
      git(run.site.clone, "checkout", "-b", set.branch);
      writeFileSync(join(run.site.clone, "pnpm-workspace.yaml"), TWO_ENTRIES);
      const result = await verifyRepository({ clone: run.site.clone, hub, set, now: NOW, runReadiness: READY });
      expect(result).toMatchObject({ exitCode: 1, verdict: "violated", reason: "content-mismatch" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "verify refuses a file item whose before digest is not the base commit's bytes, though the after text is the one-entry edit",
    async () => {
      const run = await computeSetup("pnpm", { "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n" });
      expect(await materializeSetup(run)).toMatchObject({ exitCode: 0 });
      // Only `before` is wrong: the bytes on disk and the `after` digest are exactly what a correct set names.
      const { set, hub } = tamperedBefore(run, contentDigest("packages:\n  - 'other/*'\n"));
      git(run.site.clone, "checkout", "-b", set.branch);
      const result = await verifyRepository({ clone: run.site.clone, hub, set, now: NOW, runReadiness: READY });
      expect(result).toMatchObject({ exitCode: 1, verdict: "violated", reason: "content-mismatch" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "materialize refuses a before digest the working tree matches but the base commit does not, and writes nothing",
    async () => {
      const run = await computeSetup("pnpm");
      expect(run.setup.files.find((file) => file.path === "pnpm-workspace.yaml")).toMatchObject({ before: null });
      // An ignored, untracked file: the working-tree digest check and the porcelain check both pass over it, while the base commit has no such file.
      const stray = "packages:\n  - 'other/*'\n";
      writeFileSync(join(run.site.clone, "pnpm-workspace.yaml"), stray);
      writeFileSync(join(run.site.clone, ".git", "info", "exclude"), "pnpm-workspace.yaml\n", { flag: "a" });
      const { set, hub } = tamperedBefore(run, contentDigest(stray));
      const result = await materializeRepository({ clone: run.site.clone, hub, set, texts: {}, spawn: spawnFor("pnpm"), toolVersion: "10.9.0", now: NOW, runReadiness: READY });
      expect(result).toMatchObject({ exitCode: 1, verdict: "violated", reason: "content-mismatch" });
      expect(() => git(run.site.clone, "show-ref", "--verify", "--quiet", `refs/heads/${set.branch}`)).toThrow();
    },
    TEST_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// observing the Starter pin, the phase, and the surface texts

function ledgerText(): string {
  const digest = (fill: string) => `sha256:${fill.repeat(64)}`;
  const ledger: InstalledLedger = {
    schemaVersion: 1,
    kind: "clossys.installed-ledger",
    repository: { id: SITE_ID, nodeId: SITE_NODE_ID },
    generation: 1,
    history: [
      {
        generation: 1,
        changeSet: digest("a"),
        phase: "setup",
        planDigest: digest("b"),
        bundle: digest("c"),
        baseCommit: "d".repeat(40),
        binding: { kind: "approved", subjectDigest: digest("c") },
      },
    ],
    files: [],
    keys: [],
    entries: [],
    packages: [],
    deferred: [],
  };
  return serializeInstalledLedger(ledger);
}

/** A repository that carries everything `apply` needs, with the Starter pinned and locked at `version`. */
function pinnedFiles(version: string): Files {
  const files: Files = {
    "package.json": json({ name: "site", private: true, packageManager: `npm@${PM_VERSION}`, devDependencies: { [STARTER_NAME]: version } }),
    "package-lock.json": json({
      name: "site",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "site", version: "1.0.0", devDependencies: { [STARTER_NAME]: version } },
        [`node_modules/${STARTER_NAME}`]: { version, resolved: `https://registry.npmjs.org/${STARTER_NAME}/-/starter-${version}.tgz`, integrity: STARTER_INTEGRITY, dev: true },
      },
    }),
    [LEDGER_PATH]: ledgerText(),
  };
  for (const path of Object.values(TEMPLATE_PATHS).flat()) files[path] = `# template ${path}\n`;
  return files;
}

describe("observeRepository reads the phase from a Starter pin the templates support", () => {
  it.each([["0.2.0"], ["0.2.7"]])("reads Starter %s, exact and locked, with a ledger and every template, as apply", async (version) => {
    const site = makeSite("npm", pinnedFiles(version));
    expect((await observe(site)).phase).toBe("apply");
  }, TEST_TIMEOUT_MS);

  it.each([["0.1.9"], ["0.3.0"]])("reads Starter %s, though exact and locked, as setup", async (version) => {
    const site = makeSite("npm", pinnedFiles(version));
    expect((await observe(site)).phase).toBe("setup");
  }, TEST_TIMEOUT_MS);

  it("carries the exact text of pnpm-workspace.yaml and .npmrc, and digests both", async () => {
    const surface = "packages:\n  - 'apps/*'\n";
    const npmrc = "registry=https://registry.npmjs.org/\n";
    const site = makeSite("pnpm", { "pnpm-workspace.yaml": surface, ".npmrc": npmrc });
    const observation = await observe(site);
    expect(observation.pnpmWorkspaceText).toBe(surface);
    expect(observation.npmrcText).toBe(npmrc);
    expect(observation.files).toContainEqual({ path: "pnpm-workspace.yaml", sha256: contentDigest(surface) });
    expect(observation.files).toContainEqual({ path: ".npmrc", sha256: contentDigest(npmrc) });
    expect(observation.releaseAgeSurfaces).toEqual([
      { surface: "npmrc", path: ".npmrc" },
      { surface: "pnpm-workspace", path: "pnpm-workspace.yaml" },
    ]);
  }, TEST_TIMEOUT_MS);

  it("carries no text for a surface the repository does not have", async () => {
    const observation = await observe(makeSite("npm"));
    expect(observation.pnpmWorkspaceText ?? null).toBeNull();
    expect(observation.npmrcText ?? null).toBeNull();
    expect(observation.files.some((file) => file.path === ".npmrc")).toBe(false);
  }, TEST_TIMEOUT_MS);

  it("introduces the roots a setup set creates when a checked profile is there: the two template roots, and the workspace file for pnpm", async () => {
    const profile = (names: readonly string[]) => json({ schemaVersion: 3, rootEntries: names.map((name) => ({ name, classification: "canonical", disposition: "allowed" })) });
    const declared = ["README.md", "package.json", "governance", "clossys", ".agents", ".claude", ".cursor"];
    const npm = await observe(makeSite("npm", { "governance/repository-profile.json": profile([...declared, "package-lock.json"]) }));
    expect(npm.repositoryProfile?.undeclaredRoots).toEqual([".github", ".starter"]);
    const pnpm = await observe(makeSite("pnpm", { "governance/repository-profile.json": profile([...declared, "pnpm-lock.yaml"]) }));
    expect(pnpm.repositoryProfile?.undeclaredRoots).toEqual([".github", ".starter", "pnpm-workspace.yaml"]);
    // A conflicting .npmrc refuses the edit, so nothing creates the workspace file and it is not introduced.
    const conflicting = await observe(
      makeSite("pnpm", { "governance/repository-profile.json": profile([...declared, "pnpm-lock.yaml", ".npmrc"]), ".npmrc": "minimum-release-age-exclude=example\n" }),
    );
    expect(conflicting.repositoryProfile?.undeclaredRoots).toEqual([".github", ".starter"]);
  }, TEST_TIMEOUT_MS);

  it("introduces no template root for a repository already past its setup", async () => {
    const files = { ...pinnedFiles("0.2.0"), "governance/repository-profile.json": json({ schemaVersion: 3, rootEntries: ["README.md", "package.json", "package-lock.json", "governance", ".github", ".starter", "clossys", ".agents", ".claude", ".cursor"].map((name) => ({ name, classification: "canonical", disposition: "allowed" })) }) };
    const observation = await observe(makeSite("npm", files));
    expect(observation.phase).toBe("apply");
    expect(observation.repositoryProfile).toMatchObject({ rootVocabulary: "checked", undeclaredRoots: [] });
  }, TEST_TIMEOUT_MS);
});
