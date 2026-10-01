// Test support for the admission tests (#1178): builders for an approved plan, a
// setup/apply pair from the shared corpus, apply bundles, a temporary git hub
// and clone, and a stub readiness executable. Nothing here is imported by the
// shipped code, and every name, id and digest is an example value.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AdmissionReaders, BaseTreeEntry, HubAuthority } from "./admission.js";
import { storeApplyBundle, storeChangeSet } from "./apply-store.js";
import { LEDGER_PATH, contentDigest, discoveryLinkRole, discoveryLinkTarget, lockfilePath } from "./change-set-contract.js";
import type { ApplyBundle, RepositoryChangeSet } from "./change-set-contract.js";
import { bundleDigest, changeSetDigest } from "./change-set-digest.js";
import { readInstalledLedger, renderInstalledLedger, serializeInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger } from "./ledger-contract.js";
import { approvedSubject } from "./apply-plan.js";
import type { AdvisorPlan } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";

export type Loose = Record<string, any>;

export const SITE_ID = "example-owner/site";
export const SITE_NODE_ID = "R_exampleSite1";
export const DOCS_ID = "example-owner/docs";
export const STARTER = "example-owner/site:@example/starter";
export const STRATEGIST = "example-owner/site:@example/strategist";
export const WRITER = "example-owner/site:@example/writer";
export const PLAN_FILE = "clossys/advisor/plan.json";
export const ASSESSMENT_FILE = "clossys/advisor/assessment-input.json";
export const READINESS_BIN = "node_modules/.bin/advisor-execution-readiness";
export const FAR_FUTURE = "2999-01-01T00:00:00Z";

const REPO = new URL("../../../", import.meta.url);
const readRepo = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
export const clone = <T>(value: T): T => structuredClone(value);

/** Recomputes a set's own digest, and the branch and title that follow from it. */
export function reseal(set: Loose): RepositoryChangeSet {
  const digest = changeSetDigest(set as RepositoryChangeSet);
  set.changeSetDigest = digest;
  set.branch = `clossys/apply-${digest.slice(7, 19)}`;
  set.pullRequest = { title: `Clossys: apply plan ${digest.slice(7, 19)}` };
  return set as RepositoryChangeSet;
}

const CORPUS = JSON.parse(readRepo("docs/contracts/apply-change-set-digest.fixture.json")) as { changeSets: { name: string; changeSet: RepositoryChangeSet }[] };
const PLAN_CORPUS = JSON.parse(readRepo("docs/contracts/advisor-plan-digest.fixture.json")) as { plans: { name: string; plan: AdvisorPlan }[] };
export const corpusSet = (name: string): Loose => clone(CORPUS.changeSets.find((entry) => entry.name === name)!.changeSet) as unknown as Loose;

// ---------------------------------------------------------------------------
// git

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

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: gitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// ---------------------------------------------------------------------------
// the plan

export interface DecisionInput {
  readonly at: string;
  readonly chosen: string;
  readonly subjectDigest?: string;
}

export function decision(at: string, chosen: string, subjectDigest?: string): Loose {
  return { at, recommended: "the Launch kit", chosen, by: "sponsor", ...(subjectDigest === undefined ? {} : { subjectDigest }) };
}

/** The corpus plan with staffing and exact packages, with its decisions replaced. */
export function withDecisions(plan: AdvisorPlan, decisions: readonly Loose[]): AdvisorPlan {
  return { ...clone(plan), decisions: decisions.map((entry) => clone(entry)) } as unknown as AdvisorPlan;
}

/** The corpus plan before any decision: its digest does not depend on decisions. */
export function basePlan(): Loose {
  return { ...clone(PLAN_CORPUS.plans.find((entry) => entry.name === "staffed-with-packages")!.plan), decisions: [] } as unknown as Loose;
}

export const FIRST_AT = "2026-09-24T10:00:00Z";
export const LATER_AT = "2026-09-25T10:00:00Z";

/** A plan whose latest decision approves `subject`. */
export function approvedPlan(subject: string, base: AdvisorPlan = basePlan() as unknown as AdvisorPlan): AdvisorPlan {
  return withDecisions(base, [decision(FIRST_AT, "approved", subject)]);
}

/** `decide(plan, chosen, at, subject?)`: the plan with one more decision. */
export function decide(plan: AdvisorPlan, chosen: string, at: string, subject?: string): AdvisorPlan {
  return withDecisions(plan, [...plan.decisions, decision(at, chosen, subject)]);
}

/** The head commit of each hub hubRepo built, by the hub's path, so two hubs for one plan keep their own heads. */
const HUB_HEADS = new Map<string, string>();
/** The head of the hub most recently built for a plan digest, for a test that names the plan and no hub. */
const LAST_HEADS = new Map<string, string>();

/** What readHubAuthority returns for the plan: the head is that of `hub`, else of the hub last built for this plan, or a placeholder commit id when none was. */
export function authorityOf(plan: AdvisorPlan, hub?: string): HubAuthority {
  const subject = approvedSubject(plan);
  if (subject === null) throw new Error("the fixture plan is not approved");
  const digest = planDigest(plan);
  return { plan, planDigest: digest, subject, head: (hub === undefined ? LAST_HEADS.get(digest) : HUB_HEADS.get(hub)) ?? "0".repeat(40) };
}

/** The plan's identity for each package act of one repository. */
export function committedPlanPackages(plan: AdvisorPlan, repositoryId: string) {
  return (plan.packages ?? [])
    .filter((act) => act.repository === repositoryId)
    .map(({ planItem, act, name, version, integrity, placement }) => ({ planItem, act, name, version, integrity, placement }));
}

// ---------------------------------------------------------------------------
// bundles

export interface BundleEntryInput {
  readonly id: string;
  readonly set?: RepositoryChangeSet;
  readonly changeSet?: string;
  readonly phase?: "setup" | "apply";
}

/** A valid report bundle for `plan`, holding the given change sets, with its digest computed. */
export function bundleOf(plan: AdvisorPlan, entries: readonly BundleEntryInput[], extra: { planDigest?: string; computedAt?: string } = {}): ApplyBundle {
  const digestOfPlan = extra.planDigest ?? planDigest(plan);
  const held = entries.map((entry) => ({ id: entry.id, changeSet: entry.set?.changeSetDigest ?? entry.changeSet!, phase: entry.phase ?? entry.set?.phase ?? "apply" }));
  return {
    schemaVersion: 1,
    kind: "clossys.apply-bundle",
    mode: "report",
    plan: { path: "clossys/advisor/plan.json", digest: digestOfPlan, committed: true },
    snapshot: { path: "clossys/.state/apply/registry-snapshot.json", digest: plan.resolution!.snapshotDigest },
    engine: { name: "@example/advisor", version: "0.8.0", integrity: plan.packages![0]!.integrity },
    authorization: { planDigest: digestOfPlan, expiresAt: FAR_FUTURE },
    computedAt: extra.computedAt ?? "2026-09-24T12:00:00Z",
    repositories: held.map((entry) => ({ id: entry.id, verdict: "satisfied", phase: entry.phase, changeSet: entry.changeSet, checks: [] })),
    bundleDigest: bundleDigest(digestOfPlan, held.map((entry) => ({ id: entry.id, changeSetDigest: entry.changeSet }))),
  } as ApplyBundle;
}

// ---------------------------------------------------------------------------
// the base tree

export type BaseTree = Map<string, BaseTreeEntry>;

const utf8 = (text: string): Buffer => Buffer.from(text, "utf8");
export const MANIFEST = `${JSON.stringify({ name: "site", private: true, devDependencies: { "@example/starter": "0.9.2" } }, null, 2)}\n`;

export function lockfileText(packages: readonly { name: string; version: string; integrity: string }[], placement: "devDependencies" | "dependencies" = "devDependencies"): string {
  const root: Loose = { name: "site", version: "1.0.0", [placement]: Object.fromEntries(packages.map((pkg) => [pkg.name, pkg.version])) };
  const entries = Object.fromEntries(
    packages.map((pkg) => [
      `node_modules/${pkg.name}`,
      { version: pkg.version, resolved: `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.split("/")[1]}-${pkg.version}.tgz`, integrity: pkg.integrity, dev: true },
    ]),
  );
  return `${JSON.stringify({ name: "site", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": root, ...entries } }, null, 2)}\n`;
}

/** The in-memory readers the pure core takes over a base tree, and the hub's stored bundles and sets. */
export function memoryReaders(state: { bundles: readonly ApplyBundle[]; sets: readonly RepositoryChangeSet[]; tree: BaseTree }): AdmissionReaders {
  return {
    bundle: (digest) => state.bundles.find((bundle) => bundle.bundleDigest === digest) ?? null,
    setupSet: (digest) => state.sets.find((set) => set.changeSetDigest === digest) ?? null,
    baseEntry: (path) => {
      const entry = state.tree.get(path);
      if (entry !== undefined) return entry;
      const isDirectory = [...state.tree.keys()].some((key) => key.startsWith(`${path}/`));
      return isDirectory ? { mode: "040000", bytes: new Uint8Array(0) } : null;
    },
    baseDirectory: (dir) => {
      const prefix = dir === "" ? "" : `${dir}/`;
      const names = new Set<string>();
      for (const key of state.tree.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]!);
      return names.size === 0 ? null : [...names];
    },
  };
}

// ---------------------------------------------------------------------------
// the pair

export interface WorldOptions {
  /** Edits the plan before its digest is taken: everything the digest covers. */
  readonly editPlan?: (plan: Loose) => void;
  /** Edits the setup set (and its texts) before it is sealed. */
  readonly editSetup?: (set: Loose, texts: Record<string, string>) => void;
  /** Edits the apply set before it is sealed. */
  readonly editApply?: (set: Loose, texts: Record<string, string>) => void;
  /** Called with the base tree once it exists, returning the commit it lives at. */
  readonly commitBase?: (tree: BaseTree) => string;
}

export interface World {
  readonly plan: AdvisorPlan;
  readonly planDigest: string;
  readonly authority: HubAuthority;
  readonly setup: RepositoryChangeSet;
  readonly apply: RepositoryChangeSet;
  readonly texts: Record<string, string>;
  /** The approved bundle: it holds the setup set. */
  readonly approvedBundle: ApplyBundle;
  /** The later run's bundle: it holds the apply set, and is what the apply set's `bundle` names. */
  readonly applyBundle: ApplyBundle;
  readonly ledgerBytes: Buffer;
  readonly ledger: InstalledLedger;
  readonly tree: BaseTree;
  readonly baseCommit: string;
}

export const DEFAULT_BASE_COMMIT = "c".repeat(40);

/** Whole-file bytes for every whole file of a set: a discovery link's target, or a line of text. */
export function textsFor(set: Loose): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const file of set.files as Loose[]) {
    if (file.derived === true) continue;
    if (file.mode === "120000") texts[file.path] = discoveryLinkTarget(discoveryLinkRole(file.path)!);
    else texts[file.path] = `fixture ${file.path}\n`;
  }
  return texts;
}

function applyTexts(set: Loose, texts: Record<string, string>, keep: boolean): void {
  for (const file of set.files as Loose[]) {
    if (file.derived === true) continue;
    const text = texts[file.path]!;
    file.after = contentDigest(text);
    file.before = keep ? file.after : null;
  }
}

/** The ledger a setup set writes from nothing: `renderInstalledLedger(null, ...)` with the plan's identities. */
export function setupLedgerBytes(set: RepositoryChangeSet, subject: string, plan: AdvisorPlan): Buffer {
  return Buffer.from(renderInstalledLedger(null, set, { kind: "approved", subjectDigest: subject }, committedPlanPackages(plan, set.repository.id)), "utf8");
}

/** Re-serializes a ledger after `edit`, canonically: for rows that must still pass L1 to L10. */
export function editLedger(bytes: Uint8Array, edit: (ledger: Loose) => void): Buffer {
  const ledger = clone(readInstalledLedger(bytes)) as unknown as Loose;
  edit(ledger);
  return Buffer.from(serializeInstalledLedger(ledger as InstalledLedger), "utf8");
}

/**
 * The corpus pair `setup-site` / `apply-after-setup`, retargeted to a plan and
 * resealed, with the approved bundle, the later run's bundle, the ledger the
 * merged setup leaves, and the tree of the base it lives in.
 */
export function buildWorld(options: WorldOptions = {}): World {
  const plan0 = basePlan();
  options.editPlan?.(plan0);
  const digestOfPlan = planDigest(plan0 as unknown as AdvisorPlan);

  const setup = corpusSet("setup-site");
  setup.planDigest = digestOfPlan;
  const texts = textsFor(setup);
  options.editSetup?.(setup, texts);
  applyTexts(setup, texts, false);
  reseal(setup);
  const sealedSetup = setup as unknown as RepositoryChangeSet;

  const approvedBundle = bundleOf(plan0 as unknown as AdvisorPlan, [{ id: SITE_ID, set: sealedSetup }]);
  const setupWithBundle = { ...sealedSetup, bundle: approvedBundle.bundleDigest } as RepositoryChangeSet;
  const plan = approvedPlan(approvedBundle.bundleDigest, plan0 as unknown as AdvisorPlan);
  const authority = authorityOf(plan);

  const ledgerBytes = setupLedgerBytes(setupWithBundle, approvedBundle.bundleDigest, plan);
  const ledger = readInstalledLedger(ledgerBytes)!;

  const tree: BaseTree = new Map();
  tree.set("README.md", { mode: "100644", bytes: utf8("# Site\n") });
  for (const file of setup.files as Loose[]) {
    if (file.derived === true) continue;
    tree.set(file.path, { mode: file.mode, bytes: utf8(texts[file.path]!) });
  }
  tree.set("package.json", { mode: "100644", bytes: utf8(MANIFEST) });
  const starter = (setup.items as Loose[]).find((item) => item.act === "pin-starter")!;
  tree.set(lockfilePath(setup.observed)!, { mode: "100644", bytes: utf8(lockfileText([{ name: starter.package.name, version: starter.package.version, integrity: starter.package.integrity }])) });
  tree.set(LEDGER_PATH, { mode: "100644", bytes: ledgerBytes });
  const baseCommit = options.commitBase?.(tree) ?? DEFAULT_BASE_COMMIT;

  const apply = corpusSet("apply-after-setup");
  apply.planDigest = digestOfPlan;
  apply.repository.baseCommit = baseCommit;
  const applyTextsMap = { ...texts };
  applyTexts(apply, applyTextsMap, true);
  options.editApply?.(apply, applyTextsMap);
  reseal(apply);
  const sealedApply = apply as unknown as RepositoryChangeSet;
  const applyBundle = bundleOf(plan0 as unknown as AdvisorPlan, [{ id: SITE_ID, set: sealedApply }], { computedAt: "2026-09-26T12:00:00Z" });
  const applyWithBundle = { ...sealedApply, bundle: applyBundle.bundleDigest } as RepositoryChangeSet;

  return { plan, planDigest: digestOfPlan, authority, setup: setupWithBundle, apply: applyWithBundle, texts, approvedBundle, applyBundle, ledgerBytes, ledger, tree, baseCommit };
}

/** The same world's apply set as a fresh copy that changed `edit` and was resealed (its `bundle` kept). */
export function mutateSet(set: RepositoryChangeSet, edit: (set: Loose) => void): RepositoryChangeSet {
  const copy = clone(set) as unknown as Loose;
  edit(copy);
  const bundle = copy.bundle;
  reseal(copy);
  copy.bundle = bundle;
  return copy as unknown as RepositoryChangeSet;
}

// ---------------------------------------------------------------------------
// a temporary hub and a temporary clone

export function makeRoot(roots: string[], prefix = "launcher-admission-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writeTreeEntry(root: string, path: string, entry: BaseTreeEntry): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  if (entry.mode === "120000") {
    symlinkSync(Buffer.from(entry.bytes).toString("utf8"), target);
    return;
  }
  writeFileSync(target, entry.bytes);
  if (entry.mode === "100755") chmodSync(target, 0o755);
}

export interface SiteRepoOptions {
  readonly mergeStyle?: "direct" | "squash";
}

/**
 * A local clone whose default branch holds exactly `tree`. With `squash`, the
 * files arrive on a side branch and land as one new commit with no ancestor on
 * that branch, the way a squash merge leaves them.
 */
export function siteRepo(roots: string[], tree: BaseTree, options: SiteRepoOptions = {}): { clone: string; baseCommit: string; sideTip: string | null } {
  const root = makeRoot(roots, "launcher-admission-site-");
  const clonePath = join(root, "site");
  mkdirSync(clonePath);
  git(clonePath, "init", "-b", "main");
  git(clonePath, "config", "core.autocrlf", "false");
  writeFileSync(join(clonePath, "README.md"), "# Site\n");
  git(clonePath, "add", "README.md");
  git(clonePath, "commit", "-m", "init");
  const writeAll = () => {
    for (const [path, entry] of tree) if (path !== "README.md") writeTreeEntry(clonePath, path, entry);
    git(clonePath, "add", "-A");
  };
  if (options.mergeStyle === "squash") {
    git(clonePath, "checkout", "-b", "setup");
    writeAll();
    git(clonePath, "commit", "-m", "setup");
    const sideTip = git(clonePath, "rev-parse", "HEAD").trim();
    git(clonePath, "checkout", "main");
    // An unrelated commit first, so the squashed commit is not a fast-forward of the side branch.
    writeFileSync(join(clonePath, "NOTES.md"), "notes\n");
    git(clonePath, "add", "NOTES.md");
    git(clonePath, "commit", "-m", "notes");
    git(clonePath, "merge", "--squash", "setup");
    git(clonePath, "commit", "-m", "setup (squashed)");
    return { clone: realpathSync(clonePath), baseCommit: git(clonePath, "rev-parse", "HEAD").trim(), sideTip };
  }
  writeAll();
  git(clonePath, "commit", "-m", "setup");
  return { clone: realpathSync(clonePath), baseCommit: git(clonePath, "rev-parse", "HEAD").trim(), sideTip: null };
}

/** A stub for advisor-execution-readiness: exit 0 when expiresAt is later than argv[3], 1 when not, 2 when unreadable. */
export const READINESS_STUB = `#!/usr/bin/env node
const fs = require("node:fs");
let document;
try {
  document = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
} catch {
  process.exit(2);
}
const engagement = document && document.engagement;
if (engagement && engagement.hang === true) setTimeout(() => process.exit(0), 60000);
else {
  const authorization = engagement && engagement.executionAuthorization;
  const expires = authorization ? Date.parse(authorization.expiresAt) : NaN;
  const asOf = Date.parse(process.argv[3]);
  if (Number.isNaN(expires) || Number.isNaN(asOf)) process.exit(2);
  process.exit(expires > asOf ? 0 : 1);
}
`;

export function writeReadinessStub(hub: string): string {
  const bin = join(hub, READINESS_BIN);
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(bin, READINESS_STUB, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return bin;
}

/** An assessment-input document carrying an execution authorization for a plan. */
export function assessmentFor(plan: AdvisorPlan, patch: Loose = {}, permitted: readonly string[] = [SITE_ID]): Loose {
  // Every distinct package of the plan is permitted, whatever the repository: admission requires the list to equal the plan's packages exactly.
  const packages = [...new Map((plan.packages ?? []).map(({ name, version, integrity }) => [`${name}@${version}#${integrity}`, { name, version, integrity }] as const)).values()];
  return {
    engagement: {
      executionAuthorization: {
        planDigest: planDigest(plan),
        permittedRepositoryIds: [...permitted],
        permittedPackages: packages,
        grantedAt: "2026-09-24T12:00:00Z",
        expiresAt: FAR_FUTURE,
        ...patch,
      },
    },
  };
}

export interface HubOptions {
  /** The plans committed in order; the last one is the head. */
  readonly plans: readonly AdvisorPlan[];
  /** An uncommitted edit of plan.json in the worktree. */
  readonly worktreePlan?: AdvisorPlan;
  /** Commits plan.json as this instead of the JSON of a plan. */
  readonly planBytes?: string;
  readonly planMode?: "regular" | "symlink" | "executable" | "absent";
  /** Detach HEAD at the commit with this index (0 is the first). */
  readonly detachAt?: number;
  /** The committed assessment-input.json: a document, or null to commit none. Default: a current authorization for the last plan. */
  readonly assessment?: Loose | null;
  /** Write the stub readiness executable into the hub's node_modules/.bin. Default true. */
  readonly readiness?: boolean;
  readonly sets?: readonly RepositoryChangeSet[];
  readonly bundles?: readonly ApplyBundle[];
  /** Put the hub in a subdirectory of the repository that holds it. */
  readonly nested?: boolean;
  /** Give the hub's branch an upstream: a bare origin the commits are pushed to. Default true; false leaves the branch with none. */
  readonly upstream?: boolean;
}

export interface HubFixture {
  readonly hub: string;
  readonly repository: string;
  readonly commits: readonly string[];
  /** The bare origin the hub's branch tracks, or null when it has none. */
  readonly origin: string | null;
}

/** A current authorization for the plan; none when the plan has no digest (it is invalid). */
function defaultAssessment(plan: AdvisorPlan): Loose | null {
  try {
    return assessmentFor(plan);
  } catch {
    return null;
  }
}

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** A temporary git hub with plan.json (and assessment-input.json) committed, and sets and bundles stored in it. */
export function hubRepo(roots: string[], options: HubOptions): HubFixture {
  const repository = realpathSync(makeRoot(roots, "launcher-admission-hub-"));
  git(repository, "init", "-b", "main");
  git(repository, "config", "core.autocrlf", "false");
  const hub = options.nested === true ? join(repository, "nested", "hub") : repository;
  mkdirSync(join(hub, "clossys", "advisor"), { recursive: true });
  const commits: string[] = [];
  const mode = options.planMode ?? "regular";
  const last = options.plans[options.plans.length - 1]!;
  const relative = (path: string) => (options.nested === true ? join("nested", "hub", path) : path);
  for (const [index, plan] of options.plans.entries()) {
    const target = join(hub, PLAN_FILE);
    const text = options.planBytes ?? jsonText(plan);
    const paths: string[] = [];
    if (mode === "absent") {
      writeFileSync(join(hub, "clossys", "advisor", "placeholder.txt"), `${index}\n`);
      paths.push(relative("clossys/advisor/placeholder.txt"));
    } else if (mode === "symlink") {
      writeFileSync(join(hub, "clossys", "advisor", "plan-real.json"), text);
      rmSync(target, { force: true });
      symlinkSync("plan-real.json", target);
      paths.push(relative(PLAN_FILE), relative("clossys/advisor/plan-real.json"));
    } else {
      writeFileSync(target, text);
      if (mode === "executable") chmodSync(target, 0o755);
      paths.push(relative(PLAN_FILE));
    }
    if (index === options.plans.length - 1) {
      const document = options.assessment === undefined ? defaultAssessment(last) : options.assessment;
      if (document !== null) {
        writeFileSync(join(hub, ASSESSMENT_FILE), jsonText(document));
        paths.push(relative(ASSESSMENT_FILE));
      }
    }
    git(repository, "add", "-f", ...paths);
    git(repository, "commit", "-m", `plan ${index}`);
    commits.push(git(repository, "rev-parse", "HEAD").trim());
  }
  let origin: string | null = null;
  if (options.upstream !== false) {
    origin = join(makeRoot(roots, "launcher-admission-origin-"), "hub.git");
    execFileSync("git", ["init", "--bare", "-b", "main", origin], { env: gitEnv, stdio: "ignore" });
    git(repository, "remote", "add", "origin", origin);
    git(repository, "push", "-q", "-u", "origin", "main");
  }
  if (options.detachAt !== undefined) git(repository, "checkout", "-q", "--detach", commits[options.detachAt]!);
  if (options.worktreePlan !== undefined) {
    rmSync(join(hub, PLAN_FILE), { force: true });
    writeFileSync(join(hub, PLAN_FILE), jsonText(options.worktreePlan));
  }
  if (mode === "absent") writeFileSync(join(hub, PLAN_FILE), jsonText(last));
  if (options.readiness !== false) writeReadinessStub(hub);
  const realHub = realpathSync(hub);
  HUB_HEADS.set(realHub, commits[commits.length - 1]!);
  try {
    LAST_HEADS.set(planDigest(last), commits[commits.length - 1]!);
  } catch {
    // An invalid plan has no digest, and no authority is built for it.
  }
  for (const set of options.sets ?? []) storeChangeSet(realHub, set);
  for (const bundle of options.bundles ?? []) storeApplyBundle(realHub, bundle);
  return { hub: realHub, repository, commits, origin };
}

/** Whether the hub's current branch has an upstream. */
function hasUpstream(hub: string): boolean {
  try {
    git(hub, "rev-parse", "--verify", "-q", "@{upstream}");
    return true;
  } catch {
    return false;
  }
}

/** Commits `plan` as clossys/advisor/plan.json at the hub's current branch, and pushes it when the branch has an upstream: one more decision, or a whole other plan. */
export function commitHubPlan(hub: string, plan: AdvisorPlan, message = "plan decision"): string {
  writeFileSync(join(hub, PLAN_FILE), jsonText(plan));
  git(hub, "add", "-f", PLAN_FILE);
  git(hub, "commit", "-m", message);
  if (hasUpstream(hub)) git(hub, "push", "-q");
  return git(hub, "rev-parse", "HEAD").trim();
}

/** Commits a new assessment-input.json at the hub's current branch, and pushes it when the branch has an upstream. */
export function commitHubAssessment(hub: string, document: Loose, message = "assessment"): string {
  writeFileSync(join(hub, ASSESSMENT_FILE), jsonText(document));
  git(hub, "add", "-f", ASSESSMENT_FILE);
  git(hub, "commit", "-m", message);
  if (hasUpstream(hub)) git(hub, "push", "-q");
  return git(hub, "rev-parse", "HEAD").trim();
}

/** Puts one more commit on the hub's origin from a separate clone, then fetches it: the hub's branch is now behind its upstream. */
export function advanceHubUpstream(roots: string[], hub: string, origin: string): void {
  const other = join(makeRoot(roots, "launcher-admission-other-"), "hub");
  execFileSync("git", ["clone", "-q", origin, other], { env: gitEnv, stdio: "ignore" });
  git(other, "commit", "-q", "--allow-empty", "-m", "elsewhere");
  git(other, "push", "-q", "origin", "main");
  git(hub, "fetch", "-q", "origin");
}
