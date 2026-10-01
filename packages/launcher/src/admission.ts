// Decide a repository change set's ApprovalBinding from the hub alone (issue
// #1178; the apply RFC's check V3 and decisions D22 and D26, in the public
// repository, not shipped in this package). A change set is bound in exactly two ways: **approved**, when its
// digest is a member of the bundle the hub's latest committed decision
// approved, or **admitted**, when it is the apply set that follows an approved
// setup set and changes nothing the founder did not already approve (D26's
// three conditions). Anything else waits for a new approval.
//
// This is a security decision, so every ambiguity refuses:
//
// - The plan is read as a git object at the hub's HEAD, never from the
//   worktree, and only when HEAD is attached to a branch: an uncommitted edit
//   approves nothing, and a detached HEAD at an old commit cannot revive an
//   approval a later commit revoked (decisions are append-only and outside the
//   plan digest).
// - That HEAD must also be its branch's upstream (H1, local refs, no fetch): a
//   local commit nobody pushed, or a clone that fell behind, is not the hub's
//   word. HEAD is resolved to one commit id, and every later read of the hub
//   (the plan, the assessment) is made at that id, never at `HEAD` again.
// - Bundles and setup sets are read only from the hub's own stores, by digest,
//   through the store readers that recompute each digest. Nothing the caller
//   holds in memory stands in for them.
// - Membership uses only (exact id, change-set digest): the rest of a bundle
//   entry lies outside the bundle's digest and is never believed.
// - What the base holds is read as git objects at the set's own base commit:
//   raw blob bytes, the tree's own mode, exact-case paths. Never the worktree,
//   never ancestry, so a squash or rebase merge is admitted and a repository
//   whose history was rewritten is judged by content alone.
// - The last word is RENDER: the ledger the admitted set would write must be
//   exactly one admitted generation over the base ledger, by the ledger
//   contract's own succession rules.
//
// A refusal carries an exit code, a reason and a fixed token, never a path, a
// digest or an id. Exit 1 means "violated"; exit 2 means "indeterminate".
// The caller maps a refusal to an ApplyStepResult.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENTS_GUIDE_PATH, AGENTS_GUIDE_TEXT } from "./agents-guide.js";
import { approvedSubject } from "./apply-plan.js";
import { readStoredApplyBundle, readStoredChangeSet } from "./apply-store.js";
import { LEDGER_PATH, dependencyPointer, lockfilePath, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ApplyBundle, ApprovalBinding, ChangeSetItem, DependencyPlacement, FileChange, RepositoryChangeSet, WholeFileChange } from "./change-set-contract.js";
import { changeSetDigest } from "./change-set-digest.js";
import { readContractDocument } from "./generated/contract-schema.generated.js";
import { valueAtJsonPointer } from "./key-editor.js";
import { ledgerSuccession, readInstalledLedger, renderInstalledLedger, serializeInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger, LedgerPackageIdentity } from "./ledger-contract.js";
import { isUnreadable, readLockfile } from "./lockfile-readers.js";
import { validateAdvisorPlan } from "./plan-contract.js";
import type { AdvisorPlan } from "./plan-contract.js";
import { canonicalJson, planDigest } from "./plan-digest.js";

/** A refusal: exit 1 is violated, exit 2 is indeterminate. `detail` is a fixed token, never a value. */
export interface AdmissionRefusal {
  readonly state: "refused";
  readonly exitCode: 1 | 2;
  readonly reason: string;
  readonly detail?: string;
}

/** What the hub's committed plan says: the plan itself, its digest, the bundle digest its latest decision approves, and the commit id it was read from. */
export interface HubAuthority {
  readonly plan: AdvisorPlan;
  readonly planDigest: string;
  readonly subject: string;
  /** The commit id HEAD resolved to, which equalled its branch's upstream, and which the plan was read from. */
  readonly head: string;
}

export type AdmissionDecision = { readonly state: "bound"; readonly binding: ApprovalBinding } | AdmissionRefusal;

/** One package act, as RENDER and the trust check take it. */
export type PlanPackageIdentity = LedgerPackageIdentity & { readonly act: "install" | "pin-starter" };

/** What the base tree holds at one path: git's own mode, and the raw bytes (empty for a directory or a gitlink). */
export interface BaseTreeEntry {
  readonly mode: string;
  readonly bytes: Uint8Array;
}

/** Everything the pure core reads from outside itself. A reader that throws is read as unreadable. */
export interface AdmissionReaders {
  /** The apply bundle the hub stored for a digest, verified, or null. */
  readonly bundle: (digest: string) => ApplyBundle | null;
  /** The change set the hub stored for a digest, verified, or null. */
  readonly setupSet: (digest: string) => RepositoryChangeSet | null;
  /** The entry at a path in the base tree: null when there is none. */
  readonly baseEntry: (path: string) => BaseTreeEntry | null | "unreadable";
  /** The names directly under a directory of the base tree (`""` is the root): null when there is no such directory. */
  readonly baseDirectory: (dir: string) => readonly string[] | null | "unreadable";
}

export interface DecideBindingInput {
  readonly set: RepositoryChangeSet;
  readonly authority: HubAuthority;
  /** The base ledger, already trusted by the caller (trustInstalledLedger), or null when the base has none. */
  readonly baseLedger: InstalledLedger | null;
  /** The base ledger's exact bytes, or null when the base has none. */
  readonly baseLedgerBytes: Uint8Array | null;
  readonly readers: AdmissionReaders;
}

/** Runs advisor-execution-readiness; `status` is its exit code, or null when it did not exit on its own. */
export type ReadinessRunner = (request: { bin: string; assessmentPath: string; asOf: string; cwd: string }) => { status: number | null };

export interface DecideSetBindingInput {
  readonly hub: string;
  /** The real path of the local clone, for git object reads. */
  readonly clone: string;
  readonly set: RepositoryChangeSet;
  readonly authority: HubAuthority;
  readonly baseLedger: InstalledLedger | null;
  readonly baseLedgerBytes: Uint8Array | null;
  readonly now?: () => Date;
  readonly runReadiness?: ReadinessRunner;
  /** How long the default readiness runner waits; default 120000. */
  readonly readinessTimeoutMs?: number;
}

const PLAN_PATH = "clossys/advisor/plan.json";
const ASSESSMENT_PATH = "clossys/advisor/assessment-input.json";
const READINESS_BIN = "node_modules/.bin/advisor-execution-readiness";
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

function refuse(detail: string): AdmissionRefusal {
  return { state: "refused", exitCode: 2, reason: "awaiting-approval", detail };
}

// ---------------------------------------------------------------------------
// git

const DROPPED_GIT_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_GRAFT_FILE",
];

/** Runs git with no repository named by the environment, no replace refs, and every pathspec literal. Never throws. */
function runGit(cwd: string, args: readonly string[]): { status: number | null; stdout: Buffer } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of DROPPED_GIT_ENV) delete env[name];
  env.GIT_LITERAL_PATHSPECS = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  const run = spawnSync("git", ["--no-replace-objects", ...args], { cwd, env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  if (run.error !== undefined || run.stdout === null || run.stdout === undefined) return { status: null, stdout: Buffer.alloc(0) };
  return { status: run.status, stdout: run.stdout };
}

interface TreeRow {
  readonly mode: string;
  readonly type: string;
  readonly oid: string;
  readonly name: string;
}

function parseTreeRows(stdout: Buffer): TreeRow[] | null {
  const rows: TreeRow[] = [];
  for (const record of stdout.toString("utf8").split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab === -1) return null;
    const [mode, type, oid, ...rest] = record.slice(0, tab).split(" ");
    if (mode === undefined || type === undefined || oid === undefined || rest.length > 0 || !OBJECT_ID.test(oid)) return null;
    rows.push({ mode, type, oid, name: record.slice(tab + 1) });
  }
  return rows;
}

/** The hub's head: an attached HEAD's commit id that equals its branch's upstream, an attached one that does not, or no usable attached HEAD. */
type HubHead = { readonly state: "upstream"; readonly commit: string } | { readonly state: "not-upstream" } | { readonly state: "unreadable" };

/**
 * H1. Resolves the hub's HEAD to one commit id, and requires the branch's
 * configured upstream to resolve to that same commit. Local refs only: nothing
 * here fetches, so a hub whose upstream is stale is judged by what it holds.
 * HEAD must be attached to a branch (a detached HEAD may sit on an old commit
 * that still carries a since-revoked approval). No upstream, ahead and behind
 * are all `not-upstream`.
 */
function resolveHubHead(hub: string): HubHead {
  const symbolic = runGit(hub, ["symbolic-ref", "-q", "HEAD"]);
  if (symbolic.status !== 0 || !symbolic.stdout.toString("utf8").trim().startsWith("refs/heads/")) return { state: "unreadable" };
  const head = runGit(hub, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
  const commit = head.stdout.toString("utf8").trim();
  if (head.status !== 0 || !OBJECT_ID.test(commit)) return { state: "unreadable" };
  const upstream = runGit(hub, ["rev-parse", "--verify", "-q", "@{upstream}^{commit}"]);
  if (upstream.status !== 0 || upstream.stdout.toString("utf8").trim() !== commit) return { state: "not-upstream" };
  return { state: "upstream", commit };
}

/**
 * The bytes of a regular file at `relPath` in the tree of one commit of the
 * hub, or null. The commit is the id resolveHubHead returned, never `HEAD`, so
 * two reads cannot straddle a moved head. The path must be one regular,
 * non-executable blob (mode 100644: a symbolic link is refused), and the read
 * goes through the blob's object id, so it never sees the worktree. The path
 * is relative to the hub, so a hub inside a larger repository works.
 */
function readCommittedBlob(hub: string, commit: string, relPath: string): Buffer | null {
  if (!OBJECT_ID.test(commit)) return null;
  const listed = runGit(hub, ["ls-tree", "-z", commit, "--", relPath]);
  if (listed.status !== 0) return null;
  const rows = parseTreeRows(listed.stdout);
  if (rows === null || rows.length !== 1) return null;
  const [row] = rows;
  if (row === undefined || row.name !== relPath || row.type !== "blob" || row.mode !== "100644") return null;
  const blob = runGit(hub, ["cat-file", "blob", row.oid]);
  return blob.status === 0 ? blob.stdout : null;
}

// ---------------------------------------------------------------------------
// K1: the plan

/**
 * K1. The plan committed at the hub's HEAD, and the bundle digest its latest
 * decision approves. Exit 2, `awaiting-approval`, with `hub-not-upstream` when
 * the attached HEAD is not its branch's upstream (H1: no upstream, ahead or
 * behind), `plan-unreadable` when the plan cannot be read as one strict-JSON
 * regular blob at an attached HEAD, and `plan-not-approved` when it does not
 * validate, or nothing in it is approved with a subject (see approvedSubject).
 * HEAD is resolved once (H2): `head` is that commit id, and the plan is read
 * from it.
 */
export function readHubAuthority(hub: string): HubAuthority | AdmissionRefusal {
  const hubHead = resolveHubHead(hub);
  if (hubHead.state === "unreadable") return refuse("plan-unreadable");
  if (hubHead.state === "not-upstream") return refuse("hub-not-upstream");
  const { commit } = hubHead;
  const bytes = readCommittedBlob(hub, commit, PLAN_PATH);
  if (bytes === null) return refuse("plan-unreadable");
  let document: unknown;
  try {
    document = readContractDocument(bytes);
  } catch {
    return refuse("plan-unreadable");
  }
  if (!validateAdvisorPlan(document).valid) return refuse("plan-not-approved");
  const plan = document as AdvisorPlan;
  const subject = approvedSubject(plan);
  if (subject === null) return refuse("plan-not-approved");
  let digest: string;
  try {
    digest = planDigest(plan);
  } catch {
    return refuse("plan-not-approved");
  }
  return { plan, planDigest: digest, subject, head: commit };
}

/**
 * The plan's identity for each package act of one repository (exact id), in
 * the shape renderInstalledLedger and trustInstalledLedger take. Trust and
 * render use the committed plan's acts, never the acts of the set being
 * admitted: a set cannot vouch for itself.
 */
export function planPackagesFor(authority: HubAuthority, repositoryId: string): PlanPackageIdentity[] {
  return (authority.plan.packages ?? [])
    .filter((act) => act.repository === repositoryId)
    .map(({ planItem, act, name, version, integrity, placement }) => ({ planItem, act, name, version, integrity, placement }));
}

// ---------------------------------------------------------------------------
// helpers

type PackageItem = Extract<ChangeSetItem, { act: "install" | "pin-starter" }>;
const isPackageItem = (item: ChangeSetItem): item is PackageItem => item.act === "install" || item.act === "pin-starter";
const isWhole = (file: FileChange): file is WholeFileChange => !("derived" in file);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function same(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

const sha256Of = (bytes: Uint8Array): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Runs a reader, reading a throw as its own failure value. */
function guarded<T, F>(read: () => T, failure: F): T | F {
  try {
    return read();
  } catch {
    return failure;
  }
}

/** Whether a bundle lists a change set under exactly this id. */
function holds(bundle: ApplyBundle, id: string, changeSet: string): boolean {
  return bundle.repositories.some((entry) => "changeSet" in entry && entry.id === id && entry.changeSet === changeSet);
}

const identityOf = (item: PackageItem): PlanPackageIdentity => ({
  planItem: item.planItem,
  act: item.act,
  name: item.package.name,
  version: item.package.version,
  integrity: item.package.integrity,
  placement: item.placement,
});

/** A deferred install of the setup set, by planItem. */
function deferredInstall(item: ChangeSetItem | undefined, setup: RepositoryChangeSet): boolean {
  return item !== undefined && item.act === "install" && setup.deferred.some((deferral) => deferral.planItem === item.planItem);
}

// ---------------------------------------------------------------------------
// K10: succession

/** K10's last word on a pair of ledgers: exactly one admitted next generation, with no violation. Null when it holds. */
export function checkSuccession(baseBytes: Uint8Array | null, headBytes: Uint8Array): AdmissionRefusal | null {
  let succession: ReturnType<typeof ledgerSuccession>;
  try {
    succession = ledgerSuccession(baseBytes, headBytes);
  } catch {
    return refuse("succession-refused");
  }
  if (succession.change !== "next-generation" || succession.admission !== "admitted" || succession.violations.length > 0) return refuse("succession-refused");
  return null;
}

/**
 * K10. Renders the ledger the admitted set would write over the base ledger,
 * with the committed plan's package identities, and requires it to be exactly
 * one admitted generation over the base's bytes. A render that throws is
 * `render-refused`; a pair the succession rules refuse is `succession-refused`.
 */
export function verifyAdmittedSuccession(input: {
  readonly baseLedger: InstalledLedger | null;
  readonly baseLedgerBytes: Uint8Array | null;
  readonly set: RepositoryChangeSet;
  readonly authority: HubAuthority;
  readonly setupChangeSet: string;
}): AdmissionDecision {
  const binding: ApprovalBinding = { kind: "admitted", subjectDigest: input.authority.subject, setupChangeSet: input.setupChangeSet };
  let rendered: string;
  try {
    rendered = renderInstalledLedger(input.baseLedger, input.set, binding, planPackagesFor(input.authority, input.set.repository.id));
  } catch {
    return refuse("render-refused");
  }
  const refused = checkSuccession(input.baseLedgerBytes, Buffer.from(rendered, "utf8"));
  return refused ?? { state: "bound", binding };
}

// ---------------------------------------------------------------------------
// K8: condition 2

/** D26 condition 2: the apply set's acts are the setup set's and nothing else changes. Null when it holds. */
function checkCondition2(set: RepositoryChangeSet, setup: RepositoryChangeSet, authority: HubAuthority, readers: AdmissionReaders): AdmissionRefusal | null {
  // U11: a refusal in either set means a set that could never have been materialized.
  if (setup.refused.length > 0 || set.refused.length > 0) return refuse("refusal-present");
  if (set.deferred.length > 0) return refuse("deferred-present");
  if (!same(set.producer, setup.producer)) return refuse("producer-differs");
  if (!same(set.engine, setup.engine) || !same(set.integrator, setup.integrator)) return refuse("engine-differs");
  const repository = (value: RepositoryChangeSet["repository"]) => ({ id: value.id, nodeId: value.nodeId, visibility: value.visibility, defaultBranch: value.defaultBranch });
  if (!same(repository(set.repository), repository(setup.repository))) return refuse("repository-differs");
  const observed = (value: RepositoryChangeSet["observed"]) => ({ packageManager: value.packageManager, lockfile: lockfilePath(value) });
  if (!same(observed(set.observed), observed(setup.observed))) return refuse("observed-differs");

  // The acts: the setup's own package items, and its deferred installs with the committed plan's identity.
  const planned = planPackagesFor(authority, set.repository.id);
  const expected = new Map<string, PlanPackageIdentity>();
  for (const item of setup.items) if (isPackageItem(item)) expected.set(item.planItem, identityOf(item));
  for (const deferral of setup.deferred) {
    const act = planned.find((candidate) => candidate.planItem === deferral.planItem);
    if (act === undefined || expected.has(deferral.planItem)) return refuse("package-acts-differ");
    if (act.act !== "install") return refuse("deferred-act-not-install");
    expected.set(deferral.planItem, act);
  }
  const actual = new Map<string, PlanPackageIdentity>();
  for (const item of set.items) if (isPackageItem(item)) actual.set(item.planItem, identityOf(item));
  if (actual.size !== expected.size) return refuse("package-acts-differ");
  for (const [planItem, identity] of expected) {
    const found = actual.get(planItem);
    if (found === undefined || !same(found, identity)) return refuse("package-acts-differ");
  }
  // satisfiedInBase describes the base, not the act, so it is never compared; a deferred install claimed satisfied is refused outright,
  // because nothing here verifies that claim by content.
  for (const item of set.items) {
    if (isPackageItem(item) && setup.deferred.some((deferral) => deferral.planItem === item.planItem) && item.satisfiedInBase) return refuse("satisfied-unverified");
  }
  // The one addition: an install set up before the Launcher guide existed has a setup set that wrote none, so the apply set may add it.
  const wrote = new Map(setup.files.filter(isWhole).flatMap((file) => (file.after === null ? [] : [[file.path, file] as const])));
  const mayAddGuide = !setup.items.some((item) => item.id === GUIDE_ITEM_ID) && !wrote.has(AGENTS_GUIDE_PATH);
  const others = (value: RepositoryChangeSet) => value.items.filter((item) => !isPackageItem(item) && !(mayAddGuide && value === set && item.id === GUIDE_ITEM_ID));
  if (!same(others(set), others(setup))) return refuse("items-differ");

  // Every whole file is a no-op over bytes the setup wrote, except the guide add: absent before, the constant text after.
  for (const file of set.files) {
    if (!isWhole(file)) continue;
    if (mayAddGuide && file.path === AGENTS_GUIDE_PATH) {
      if (file.before !== null || file.mode !== "100644" || file.after !== sha256Of(Buffer.from(AGENTS_GUIDE_TEXT, "utf8")) || file.item !== GUIDE_ITEM_ID) return refuse("file-not-setup");
      continue;
    }
    if (file.after === null || file.before !== file.after) return refuse("file-not-noop");
    const original = wrote.get(file.path);
    if (original === undefined || original.after !== file.after || original.mode !== file.mode) return refuse("file-not-setup");
  }

  const byId = new Map(set.items.map((item) => [item.id, item] as const));
  for (const key of set.keys) {
    const item = byId.get(key.item);
    if (!deferredInstall(item, setup) || key.before !== null) return refuse("key-not-deferred");
  }
  for (const file of set.files) {
    if (isWhole(file) || file.path === LEDGER_PATH) continue;
    for (const invariant of file.invariants) {
      if ("name" in invariant && !deferredInstall(byId.get(invariant.item), setup)) return refuse("lockfile-not-deferred");
    }
  }
  // The setup's own packages are satisfied in the base, or they would be written here.
  for (const item of set.items) {
    if (isPackageItem(item) && !deferredInstall(item, setup) && !item.satisfiedInBase) return refuse("key-not-deferred");
  }

  // U14: the bundle the set names is published in the ledger, so it must be a stored bundle that holds this set, and never the approved one.
  const named = guarded(() => readers.bundle(set.bundle), null);
  if (named === null || set.bundle === authority.subject || !holds(named, set.repository.id, set.changeSetDigest)) return refuse("apply-bundle-unrecorded");
  return null;
}

const GUIDE_ITEM_ID = "agents-guide";

// ---------------------------------------------------------------------------
// K9: condition 3, the base tree

const normalizeName = (name: string): string => name.normalize("NFC").toLowerCase();

/**
 * The guide an apply set adds is added only where the base has nothing there: no file, no directory, and no sibling in `clossys/` that
 * differs from it only in case. Null when the set adds no guide, or the path is clear.
 */
function checkGuideAbsent(set: RepositoryChangeSet, readers: AdmissionReaders): AdmissionRefusal | null {
  if (!set.files.some((file) => isWhole(file) && file.path === AGENTS_GUIDE_PATH && file.before === null)) return null;
  const entry = guarded(() => readers.baseEntry(AGENTS_GUIDE_PATH), "unreadable" as const);
  if (entry === "unreadable") return refuse("base-unreadable");
  if (entry !== null) return refuse("guide-not-absent");
  const directory = AGENTS_GUIDE_PATH.slice(0, AGENTS_GUIDE_PATH.lastIndexOf("/"));
  const names = guarded(() => readers.baseDirectory(directory), "unreadable" as const);
  if (names === "unreadable") return refuse("base-unreadable");
  const wanted = normalizeName(AGENTS_GUIDE_PATH.slice(directory.length + 1));
  if (names !== null && names.some((name) => normalizeName(name) === wanted)) return refuse("guide-not-absent");
  return null;
}

/** Every byte the setup wrote is in the base tree, by content: whole files, package.json keys, and its lockfile invariants. Null when it holds. */
function checkBaseTree(setup: RepositoryChangeSet, readers: AdmissionReaders): AdmissionRefusal | null {
  const listings = new Map<string, readonly string[] | "unreadable">();
  const listing = (dir: string): readonly string[] | "unreadable" => {
    let known = listings.get(dir);
    if (known === undefined) {
      const names = guarded(() => readers.baseDirectory(dir), "unreadable" as const);
      known = names === null || names === "unreadable" ? "unreadable" : names;
      listings.set(dir, known);
    }
    return known;
  };
  const entryAt = (path: string) => guarded(() => readers.baseEntry(path), "unreadable" as const);

  for (const file of setup.files) {
    if (!isWhole(file) || file.after === null) continue;
    const entry = entryAt(file.path);
    if (entry === "unreadable") return refuse("base-unreadable");
    if (entry === null) return refuse("base-content-missing");
    if (entry.mode !== file.mode) return refuse("base-mode-mismatch");
    if (sha256Of(entry.bytes) !== file.after) return refuse("base-content-mismatch");
    // The entry is there, so every directory above it is too: none may have a sibling that differs only in case.
    const segments = file.path.split("/");
    for (let index = 0; index < segments.length; index += 1) {
      const names = listing(segments.slice(0, index).join("/"));
      if (names === "unreadable") return refuse("base-unreadable");
      const wanted = normalizeName(segments[index]!);
      if (names.some((name) => name !== segments[index] && normalizeName(name) === wanted)) return refuse("base-case-variant");
    }
  }

  const packages = setup.items.filter(isPackageItem);
  if (packages.length === 0) return null;

  const manifest = entryAt("package.json");
  if (manifest === "unreadable" || manifest === null || manifest.mode !== "100644") return refuse("base-unreadable");
  let manifestText: string;
  try {
    readContractDocument(manifest.bytes);
    manifestText = new TextDecoder("utf-8", { fatal: true }).decode(manifest.bytes);
  } catch {
    return refuse("base-unreadable");
  }
  const placements: readonly DependencyPlacement[] = ["dependencies", "devDependencies"];
  for (const item of packages) {
    const found: { placement: DependencyPlacement; value: unknown }[] = [];
    for (const placement of placements) {
      let at: ReturnType<typeof valueAtJsonPointer>;
      try {
        at = valueAtJsonPointer(manifestText, dependencyPointer(placement, item.package.name));
      } catch {
        return refuse("base-unreadable");
      }
      if (at.found) found.push({ placement, value: at.value });
    }
    if (found.length > 1) return refuse("base-key-ambiguous");
    const only = found[0];
    if (only === undefined || only.placement !== item.placement) return refuse("base-key-missing");
    if (only.value !== item.package.version) return refuse("base-key-mismatch");
  }

  const lockPath = lockfilePath(setup.observed);
  const format = lockPath === "package-lock.json" ? "npm" : lockPath === "pnpm-lock.yaml" ? "pnpm" : null;
  if (lockPath === null || format === null) return refuse("base-unreadable");
  const lock = entryAt(lockPath);
  if (lock === "unreadable" || lock === null || lock.mode !== "100644") return refuse("base-unreadable");
  let lockText: string;
  try {
    lockText = new TextDecoder("utf-8", { fatal: true }).decode(lock.bytes);
  } catch {
    return refuse("base-unreadable");
  }
  const view = readLockfile(format, lockText);
  if (isUnreadable(view)) return refuse("base-unreadable");
  for (const item of packages) {
    const resolved = view.root.find((row) => row.name === item.package.name && row.placement === item.placement);
    if (resolved === undefined || resolved.link || resolved.version !== item.package.version || resolved.integrity !== item.package.integrity) return refuse("base-lockfile-mismatch");
  }
  return null;
}

// ---------------------------------------------------------------------------
// K2 to K10

/**
 * The pure core. `set` is bound approved when the hub's approved bundle holds
 * it, admitted when it is the apply set that follows the approved, merged
 * setup set (D26), and refused otherwise. Every read goes through `readers`;
 * nothing here touches a filesystem or runs git. Never throws: a failure it
 * did not foresee is `admission-failed`.
 */
export function decideBinding(input: DecideBindingInput): AdmissionDecision {
  try {
    return decide(input);
  } catch {
    return refuse("admission-failed");
  }
}

function decide(input: DecideBindingInput): AdmissionDecision {
  const { set, authority, readers, baseLedger, baseLedgerBytes } = input;
  const invalid: AdmissionRefusal = { state: "refused", exitCode: 2, reason: "change-set-invalid" };
  if (!validateRepositoryChangeSet(set).valid || changeSetDigest(set) !== set.changeSetDigest) return invalid;

  // K2: the approved bundle, read from the hub's store.
  const bundle = guarded(() => readers.bundle(authority.subject), null);
  if (bundle === null || bundle.bundleDigest !== authority.subject) return refuse("bundle-unreadable");
  if (bundle.plan.digest !== authority.planDigest) return refuse("bundle-plan-mismatch");
  // K3: the set is computed from the approved plan.
  if (set.planDigest !== authority.planDigest) return refuse("plan-digest-mismatch");
  // K4: membership, by (exact id, digest) only.
  if (holds(bundle, set.repository.id, set.changeSetDigest)) return { state: "bound", binding: { kind: "approved", subjectDigest: authority.subject } };
  // K5: only an apply set can be admitted.
  if (set.phase !== "apply") return refuse("not-member");

  // K6: the base ledger ends with the approved setup set, exactly as RENDER writes it.
  if ((baseLedger === null) !== (baseLedgerBytes === null)) return refuse("base-ledger-inconsistent");
  if (baseLedger === null || baseLedgerBytes === null) return refuse("ledger-absent");
  let reserialized: string;
  try {
    reserialized = serializeInstalledLedger(baseLedger);
  } catch {
    return refuse("base-ledger-inconsistent");
  }
  if (!Buffer.from(reserialized, "utf8").equals(Buffer.from(baseLedgerBytes))) return refuse("base-ledger-inconsistent");
  const last = baseLedger.history.at(-1);
  if (last === undefined || last.phase !== "setup") return refuse("ledger-not-setup");
  const setup = guarded(() => readers.setupSet(last.changeSet), null);
  if (setup === null || setup.changeSetDigest !== last.changeSet) return refuse("setup-unstored");
  if (last.binding.kind !== "approved" || last.binding.subjectDigest !== authority.subject) return refuse("setup-subject-mismatch");
  if (setup.planDigest !== authority.planDigest || last.planDigest !== authority.planDigest) return refuse("setup-plan-mismatch");
  if (setup.phase !== "setup" || setup.repository.id !== set.repository.id || setup.repository.nodeId !== set.repository.nodeId) return refuse("setup-unstored");
  if (setup.ledger.generation !== 0 || baseLedger.generation !== 1) return refuse("setup-not-first");
  let expectedBytes: Buffer;
  try {
    // `bundle` lies outside the set's digest: the ledger names the run that computed the set, which a first-stored copy may not.
    expectedBytes = Buffer.from(
      renderInstalledLedger(null, { ...setup, bundle: last.bundle }, { kind: "approved", subjectDigest: authority.subject }, planPackagesFor(authority, setup.repository.id)),
      "utf8",
    );
  } catch {
    return refuse("setup-ledger-not-rendered");
  }
  if (!expectedBytes.equals(Buffer.from(baseLedgerBytes))) return refuse("setup-ledger-not-rendered");

  // K7: the setup set is itself a member of the approved bundle.
  if (!holds(bundle, setup.repository.id, setup.changeSetDigest)) return refuse("setup-not-member");

  // K8: nothing but the authorized package acts differs from the setup.
  const differs = checkCondition2(set, setup, authority, readers);
  if (differs !== null) return differs;

  // K9: every byte the setup wrote is in the base, by content.
  const missing = checkBaseTree(setup, readers);
  if (missing !== null) return missing;
  const occupied = checkGuideAbsent(set, readers);
  if (occupied !== null) return occupied;

  // K10: the ledger the admitted set writes is exactly one admitted generation over the base's.
  return verifyAdmittedSuccession({ baseLedger, baseLedgerBytes, set, authority, setupChangeSet: setup.changeSetDigest });
}

// ---------------------------------------------------------------------------
// the hub and the clone

function gitBaseReaders(clone: string, commit: string): Pick<AdmissionReaders, "baseEntry" | "baseDirectory"> {
  const valid = OBJECT_ID.test(commit);
  return {
    baseEntry: (path) => {
      if (!valid) return "unreadable";
      const listed = runGit(clone, ["ls-tree", "-z", commit, "--", path]);
      if (listed.status !== 0) return "unreadable";
      const rows = parseTreeRows(listed.stdout);
      if (rows === null || rows.length > 1) return "unreadable";
      const [row] = rows;
      if (row === undefined) return null;
      if (row.name !== path) return "unreadable";
      if (row.type !== "blob") return { mode: row.mode, bytes: new Uint8Array(0) };
      const blob = runGit(clone, ["cat-file", "blob", row.oid]);
      if (blob.status !== 0) return "unreadable";
      return { mode: row.mode, bytes: new Uint8Array(blob.stdout) };
    },
    baseDirectory: (dir) => {
      if (!valid) return "unreadable";
      const listed = runGit(clone, ["ls-tree", "-z", "--name-only", dir === "" ? commit : `${commit}:${dir}`]);
      if (listed.status !== 0) return "unreadable";
      return listed.stdout
        .toString("utf8")
        .split("\0")
        .filter((name) => name !== "");
    },
  };
}

function hubReaders(hub: string): Pick<AdmissionReaders, "bundle" | "setupSet"> {
  return {
    bundle: (digest) => readStoredApplyBundle(hub, digest),
    setupSet: (digest) => readStoredChangeSet(hub, digest),
  };
}

function packageActsOf(set: RepositoryChangeSet, authority: HubAuthority): { name: string; version: string; integrity: string }[] | null {
  const acts: { name: string; version: string; integrity: string }[] = [];
  for (const item of set.items) if (isPackageItem(item)) acts.push({ name: item.package.name, version: item.package.version, integrity: item.package.integrity });
  const planned = planPackagesFor(authority, set.repository.id);
  for (const deferral of set.deferred) {
    const act = planned.find((candidate) => candidate.planItem === deferral.planItem);
    if (act === undefined) return null;
    acts.push({ name: act.name, version: act.version, integrity: act.integrity });
  }
  return acts;
}

const packageKey = (entry: { readonly name: string; readonly version: string; readonly integrity: string }): string => `${entry.name}@${entry.version}#${entry.integrity}`;

/** Whether two lists hold the same strings, the same number of times each, in any order. */
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

const notCurrent = (detail: string): AdmissionRefusal => ({ state: "refused", exitCode: 1, reason: "authorization-not-current", detail });
const unverified = (detail: string): AdmissionRefusal => ({ state: "refused", exitCode: 2, reason: "authorization-unverified", detail });

function defaultRunner(timeoutMs: number): ReadinessRunner {
  return (request) => {
    const run = spawnSync(request.bin, [request.assessmentPath, request.asOf], {
      cwd: request.cwd,
      env: { PATH: process.env.PATH ?? "" },
      stdio: "ignore",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    return { status: run.error === undefined ? run.status : null };
  };
}

/**
 * K11. A set with package acts is bound only while the hub's execution
 * authorization is current: clossys/advisor/assessment-input.json, read as a
 * git object at the commit the plan was read from (H3: HEAD must still be
 * attached, still equal `authority.head` and still match its upstream, else
 * `authorization-unverified` `hub-head-moved`), must carry an authorization
 * for this plan digest that permits this repository and every package act of
 * the set (and of what it defers), and the hub's own
 * advisor-execution-readiness, run on those exact committed bytes at the
 * current instant, must exit 0. The permitted packages must also equal the
 * plan's packages exactly (H4): the distinct `name@version#integrity` keys of
 * every act in the plan, no more, no fewer and none repeated, else
 * `authorization-not-current` `packages-not-exact`; repositories stay a subset
 * check. Exit 1 is `authorization-not-current`; exit 2 and anything else is
 * `authorization-unverified`. A set with no package act skips this step.
 */
function checkAuthorization(input: DecideSetBindingInput): AdmissionRefusal | null {
  const { hub, set, authority } = input;
  const acts = packageActsOf(set, authority);
  if (acts === null) return unverified("deferred-unplanned");
  if (acts.length === 0) return null;

  const hubHead = resolveHubHead(hub);
  if (hubHead.state !== "upstream" || hubHead.commit !== authority.head) return unverified("hub-head-moved");
  const bytes = readCommittedBlob(hub, authority.head, ASSESSMENT_PATH);
  if (bytes === null) return unverified("assessment-unreadable");
  let document: unknown;
  try {
    document = readContractDocument(bytes);
  } catch {
    return unverified("assessment-unreadable");
  }
  if (!isRecord(document) || !isRecord(document.engagement)) return unverified("assessment-unreadable");
  const authorization = document.engagement.executionAuthorization;
  if (authorization === undefined) return notCurrent("authorization-absent");
  if (!isRecord(authorization)) return unverified("assessment-unreadable");
  const { permittedRepositoryIds, permittedPackages } = authorization;
  if (typeof authorization.planDigest !== "string" || !SHA256.test(authorization.planDigest)) return unverified("assessment-unreadable");
  if (!Array.isArray(permittedRepositoryIds) || !permittedRepositoryIds.every((id) => typeof id === "string")) return unverified("assessment-unreadable");
  if (!Array.isArray(permittedPackages) || !permittedPackages.every((entry) => isRecord(entry) && typeof entry.name === "string" && typeof entry.version === "string" && typeof entry.integrity === "string")) {
    return unverified("assessment-unreadable");
  }
  if (authorization.planDigest !== authority.planDigest) return notCurrent("plan-mismatch");
  if (!permittedRepositoryIds.includes(set.repository.id)) return notCurrent("repository-not-permitted");
  const permitted = permittedPackages as { name: string; version: string; integrity: string }[];
  for (const act of acts) {
    if (!permitted.some((entry) => entry.name === act.name && entry.version === act.version && entry.integrity === act.integrity)) return notCurrent("package-not-permitted");
  }
  // H4: the authorization is for the plan's packages, all of them and only them; a repeated entry is not the same list.
  const planned = new Set((authority.plan.packages ?? []).map(packageKey));
  if (!sameStrings(permitted.map(packageKey), [...planned])) return notCurrent("packages-not-exact");

  const bin = join(hub, READINESS_BIN);
  try {
    if (!statSync(bin).isFile()) return unverified("readiness-bin-missing");
  } catch {
    return unverified("readiness-bin-missing");
  }
  const runner = input.runReadiness ?? defaultRunner(input.readinessTimeoutMs ?? 120_000);
  const asOf = (input.now ?? (() => new Date()))().toISOString();
  let directory: string | undefined;
  try {
    directory = mkdtempSync(join(tmpdir(), "launcher-readiness-"));
    const assessmentPath = join(directory, "assessment.json");
    writeFileSync(assessmentPath, bytes, { mode: 0o600 });
    const { status } = runner({ bin, assessmentPath, asOf, cwd: hub });
    if (status === 0) return null;
    if (status === 1) return notCurrent("readiness-violated");
    if (status === 2) return unverified("readiness-indeterminate");
    return unverified("readiness-failed");
  } catch {
    return unverified("readiness-failed");
  } finally {
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * The binding of one change set, from the hub alone: the pure core wired to
 * the hub's stores (never a caller-supplied list) and to git objects at the
 * set's base commit in the clone, then the execution authorization for any set
 * that has package acts. `authority` is what readHubAuthority returned, and
 * `baseLedger` and `baseLedgerBytes` the base ledger the caller already
 * trusted (trustInstalledLedger, over the committed plan's acts).
 */
export async function decideSetBinding(input: DecideSetBindingInput): Promise<AdmissionDecision> {
  const readers: AdmissionReaders = { ...hubReaders(input.hub), ...gitBaseReaders(input.clone, input.set.repository.baseCommit) };
  const decided = decideBinding({ set: input.set, authority: input.authority, baseLedger: input.baseLedger, baseLedgerBytes: input.baseLedgerBytes, readers });
  if (decided.state !== "bound") return decided;
  let authorization: AdmissionRefusal | null;
  try {
    authorization = checkAuthorization(input);
  } catch {
    authorization = unverified("readiness-failed");
  }
  return authorization ?? decided;
}
