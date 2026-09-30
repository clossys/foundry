// Write an approved repository change set into a clean local clone and verify
// the result (RFC apply-approved-plan §7 V4 and V8, migration step 3).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { decideSetBinding, planPackagesFor, readHubAuthority } from "./admission.js";
import type { AdmissionRefusal, PlanPackageIdentity, ReadinessRunner } from "./admission.js";
import { storeChangeSet } from "./apply-store.js";
import {
  CANONICAL_KEYS,
  LEDGER_PATH,
  canonicalOrder,
  contentDigest,
  discoveryLinkRole,
  discoveryLinkTarget,
  lockfilePath,
  matchesPathPattern,
  validateRepositoryChangeSet,
} from "./change-set-contract.js";
import type { ApprovalBinding, FileChange, PackageInvariant, RepositoryChangeSet, WholeFileChange } from "./change-set-contract.js";
import { JsonEditUnstableError, editJsonPointer, valueAtJsonPointer } from "./key-editor.js";
import { renderInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger } from "./ledger-contract.js";
import { trustInstalledLedger } from "./ledger-trust.js";
import { checkLockfileInvariants } from "./lockfile-invariants.js";
import type { LockfileInvariantPackage } from "./lockfile-invariants.js";
import { regenerateLockfile } from "./lockfile-regen.js";
import type { LockfileSpawn } from "./lockfile-regen.js";
import { verifyReleaseAgeExemption } from "./release-age-edit.js";

// The approval binding a set's ledger records is never an input: admission
// (admission.ts) computes it from the hub's committed plan and stored bundles,
// and materialize and verify both use exactly that binding (#1178).
export interface MaterializeInput {
  readonly clone: string;
  readonly hub: string;
  readonly set: RepositoryChangeSet;
  readonly texts: Readonly<Record<string, string>>;
  readonly heldChangeSets?: readonly RepositoryChangeSet[];
  readonly spawn?: LockfileSpawn;
  /** The instant the execution authorization is judged at; the wall clock by default. */
  readonly now?: () => Date;
  readonly toolVersion?: string | null;
  /** Runs the hub's advisor-execution-readiness; the hub's own installed executable by default. */
  readonly runReadiness?: ReadinessRunner;
}

export interface VerifyInput {
  readonly clone: string;
  readonly hub: string;
  readonly set: RepositoryChangeSet;
  readonly heldChangeSets?: readonly RepositoryChangeSet[];
  readonly now?: () => Date;
  readonly runReadiness?: ReadinessRunner;
}

export interface ApplyStepResult {
  readonly exitCode: 0 | 1 | 2;
  readonly verdict: "materialized" | "violated" | "indeterminate";
  readonly reason?: string;
  readonly detail?: string;
}

const BRANCH_SHAPE = /^clossys\/apply-[0-9a-f]{12}$/u;
const DEFAULT_BRANCH_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const COMMIT_SHAPE = /^[0-9a-f]{40}$/u;
const TOOL_VERSION_SHAPE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;
const LEFTOVER_SKILL = /^\.agents\/skills\/clossys-[^/]+(?:\/.*)?$/u;
const RESERVED_ROOTS = new Set(["clossys", ".github", ".starter"]);

const isWhole = (file: FileChange): file is WholeFileChange => !("derived" in file);

function result(exitCode: 0 | 1 | 2, verdict: ApplyStepResult["verdict"], reason?: string, detail?: string): ApplyStepResult {
  return detail === undefined ? { exitCode, verdict, reason } : { exitCode, verdict, reason, detail };
}

function git(root: string, args: readonly string[]): { status: number; stdout: string } {
  const run = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return { status: run.status ?? 1, stdout: run.stdout ?? "" };
}

function safeDefaultBranch(branch: string): boolean {
  if (branch.includes(":") || branch.includes("+") || branch.includes("*")) return false;
  return DEFAULT_BRANCH_SHAPE.test(branch);
}

function refusalResult(refusal: AdmissionRefusal): ApplyStepResult {
  return result(refusal.exitCode, refusal.exitCode === 1 ? "violated" : "indeterminate", refusal.reason, refusal.detail);
}

function digestAtPath(root: string, relPath: string): string | null {
  const path = join(root, relPath);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return contentDigest(readlinkSync(path));
    if (stat.isFile()) return contentDigest(readFileSync(path, "utf8"));
    return null;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

function gitShowUtf8(root: string, ref: string, path: string): string | null {
  const { status, stdout } = git(root, ["show", `${ref}:${path}`]);
  if (status !== 0) return null;
  return stdout;
}

function gitShowBytes(root: string, ref: string, path: string): Uint8Array | null {
  const run = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "show", `${ref}:${path}`], {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if ((run.status ?? 1) !== 0) return null;
  return run.stdout ?? null;
}

function declaredPaths(set: RepositoryChangeSet): Set<string> {
  const paths = new Set(set.files.map((file) => file.path));
  if (set.keys.length > 0) paths.add("package.json");
  return paths;
}

function writePaths(set: RepositoryChangeSet): string[] {
  const paths = set.files.filter(isWhole).filter((file) => file.before !== file.after).map((file) => file.path);
  if (set.keys.length > 0) paths.push("package.json");
  paths.push(LEDGER_PATH);
  return paths;
}

function hasSymlinkAncestor(root: string, relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.length <= 1) return false;
  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = join(current, parts[index]!);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function ensureParentDir(root: string, relPath: string): ApplyStepResult | null {
  const parent = dirname(relPath);
  if (parent === ".") return null;
  const segments = parent.split("/");
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) return result(2, "indeterminate", "symlink-ancestor");
      if (!stat.isDirectory()) return result(2, "indeterminate", "symlink-ancestor");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      mkdirSync(current);
    }
  }
  return null;
}

export function writeRegularFile(root: string, relPath: string, text: string, after: string): ApplyStepResult | null {
  const parent = ensureParentDir(root, relPath);
  if (parent !== null) return parent;
  const path = join(root, relPath);
  try {
    if (lstatSync(path).isSymbolicLink()) return result(2, "indeterminate", "symlink-ancestor");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  writeFileSync(path, text, "utf8");
  try {
    const mode = lstatSync(path).mode & 0o777;
    if ((mode & 0o111) !== 0) chmodSync(path, 0o644);
  } catch {
    // Best effort.
  }
  const readBack = readFileSync(path, "utf8");
  if (readBack !== text) return result(1, "violated", "content-mismatch");
  if (contentDigest(readBack) !== after) return result(1, "violated", "content-mismatch");
  return null;
}

export function writeSymlink(root: string, relPath: string, target: string, after: string): ApplyStepResult | null {
  const parent = ensureParentDir(root, relPath);
  if (parent !== null) return parent;
  const path = join(root, relPath);
  try {
    if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
    else if (existsSync(path)) unlinkSync(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  symlinkSync(target, path);
  if (contentDigest(readlinkSync(path)) !== after) return result(1, "violated", "content-mismatch");
  return null;
}

export function removePath(root: string, relPath: string): ApplyStepResult | null {
  if (hasSymlinkAncestor(root, relPath)) return result(2, "indeterminate", "symlink-ancestor");
  const path = join(root, relPath);
  try {
    unlinkSync(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  if (existsSync(path)) return result(1, "violated", "removal-present");
  return null;
}

export function resolveCloneRoot(clone: string): { root: string } | ApplyStepResult {
  try {
    const stat = lstatSync(clone);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return result(2, "indeterminate", "missing-clone");
  } catch {
    return result(2, "indeterminate", "missing-clone");
  }
  let root: string;
  try {
    root = realpathSync(clone);
  } catch {
    return result(2, "indeterminate", "missing-clone");
  }
  if (root !== clone) return result(2, "indeterminate", "missing-clone");
  return { root };
}

function checkSymlinksSupported(root: string): ApplyStepResult | null {
  const { status, stdout } = git(root, ["config", "--get", "core.symlinks"]);
  if (status !== 0) return null;
  if (stdout.trim() === "false") return result(2, "indeterminate", "symlinks-unsupported");
  return null;
}

function checkRemoteTip(root: string, set: RepositoryChangeSet): ApplyStepResult | null {
  const branch = set.repository.defaultBranch;
  if (!safeDefaultBranch(branch)) return result(2, "indeterminate", "change-set-invalid");
  const fetched = git(root, ["fetch", "--no-tags", "--refmap=", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  if (fetched.status !== 0) return result(2, "indeterminate", "remote-tip-unreadable");
  const local = git(root, ["rev-parse", `refs/heads/${branch}`]);
  const remote = git(root, ["rev-parse", `refs/remotes/origin/${branch}`]);
  if (local.status !== 0 || remote.status !== 0) return result(2, "indeterminate", "remote-tip-unreadable");
  if (local.stdout.trim() !== remote.stdout.trim()) return result(1, "violated", "remote-tip-mismatch");
  return null;
}

function digestAtRef(root: string, ref: string, relPath: string, mode: WholeFileChange["mode"]): string | null {
  if (mode === "120000") {
    const target = gitShowUtf8(root, ref, relPath);
    if (target === null) return null;
    return contentDigest(target);
  }
  const text = gitShowUtf8(root, ref, relPath);
  if (text === null) return null;
  return contentDigest(text);
}

/**
 * Whether the bytes an exempt-release-age item writes at `path` are the base's bytes plus exactly the one scope entry, judged by
 * verifyReleaseAgeExemption() over the base commit's own bytes (never the working tree) and its .npmrc. True for a file no such
 * item names. The set carries the file's digest only, so this is the one place the "one entry, nothing else" rule is proved.
 */
function provesReleaseAgeEdit(root: string, set: RepositoryChangeSet, file: WholeFileChange, after: string): boolean {
  return provesReleaseAgeEditWith((path) => gitShowUtf8(root, set.repository.baseCommit, path), set, file, after);
}

/**
 * provesReleaseAgeEdit() over any reader of the base commit's own bytes: `readBase` returns the text of a path at the base
 * commit, or null when there is none. The plan command's dry tree reads them from the clone's object database and never runs
 * `git show`.
 */
export function provesReleaseAgeEditWith(readBase: (path: string) => string | null, set: RepositoryChangeSet, file: WholeFileChange, after: string): boolean {
  const item = set.items.find((entry) => entry.id === file.item);
  if (item === undefined || item.act !== "exempt-release-age") return true;
  if (item.path !== file.path) return false;
  const before = readBase(file.path);
  // The digest the set names as `before` must be these very bytes, or the proof would be over another file.
  if ((before === null ? null : contentDigest(before)) !== file.before) return false;
  const npmrc = readBase(".npmrc");
  return verifyReleaseAgeExemption({ surface: item.surface, before, after, npmrc }).verified;
}

function checkBaseCommitMovement(root: string, set: RepositoryChangeSet): ApplyStepResult | null {
  const branch = set.repository.defaultBranch;
  const tip = git(root, ["rev-parse", `refs/heads/${branch}`]);
  if (tip.status !== 0) return result(2, "indeterminate", "remote-tip-unreadable");
  const tipCommit = tip.stdout.trim();
  if (tipCommit === set.repository.baseCommit) return null;
  for (const file of set.files.filter(isWhole)) {
    if (digestAtRef(root, tipCommit, file.path, file.mode) !== file.before) return result(2, "indeterminate", "base-conflict");
  }
  return result(1, "violated", "superseded");
}

function persistChangeSet(hub: string, set: RepositoryChangeSet): ApplyStepResult | null {
  let hubReal: string;
  try {
    hubReal = realpathSync(hub);
  } catch {
    return result(2, "indeterminate", "change-set-not-stored");
  }
  try {
    storeChangeSet(hubReal, set);
  } catch {
    return result(2, "indeterminate", "change-set-not-stored");
  }
  return null;
}

export function checkChangeSetShape(set: RepositoryChangeSet): ApplyStepResult | null {
  if (!BRANCH_SHAPE.test(set.branch) || !COMMIT_SHAPE.test(set.repository.baseCommit)) return result(2, "indeterminate", "change-set-invalid");
  if (!validateRepositoryChangeSet(set).valid) return result(2, "indeterminate", "change-set-invalid");
  return null;
}

/**
 * The base ledger, trusted against the acts of the plan committed at the hub
 * (never the acts of the set being judged: a set cannot vouch for itself), with
 * the exact bytes it was read from (null when the base has none).
 */
function baseLedgerTrust(
  root: string,
  set: RepositoryChangeSet,
  heldChangeSets: readonly RepositoryChangeSet[],
  planDigest: string,
  planPackages: readonly PlanPackageIdentity[],
): { ledger: InstalledLedger | null; bytes: Uint8Array | null } | ApplyStepResult {
  const bytes = gitShowBytes(root, set.repository.baseCommit, LEDGER_PATH);
  const ledgerBytes = bytes ?? new Uint8Array(0);
  const trust = trustInstalledLedger(
    ledgerBytes.length === 0 ? null : ledgerBytes,
    { id: set.repository.id, nodeId: set.repository.nodeId },
    heldChangeSets,
    { planPackageActs: [{ planDigest, packages: planPackages }] },
  );
  if (trust.state === "refused") return result(2, "indeterminate", trust.rule);
  const generation = trust.ledger?.generation ?? 0;
  if (generation !== set.ledger.generation) return result(1, "violated", "ledger-mismatch");
  return { ledger: trust.ledger, bytes: ledgerBytes.length === 0 ? null : ledgerBytes };
}

export function refuseReservedSymlinks(root: string, paths: readonly string[]): ApplyStepResult | null {
  for (const reserved of RESERVED_ROOTS) {
    try {
      if (lstatSync(join(root, reserved)).isSymbolicLink()) return result(2, "indeterminate", "symlink-ancestor");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
  for (const rel of paths) {
    const segments = rel.split("/");
    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
      current = join(current, segments[index]!);
      try {
        if (lstatSync(current).isSymbolicLink()) return result(2, "indeterminate", "symlink-ancestor");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") break;
        throw cause;
      }
    }
  }
  return null;
}

function declareRootEntryText(root: string, set: RepositoryChangeSet, path: string): string | ApplyStepResult | null {
  const item = set.items.find((entry) => entry.act === "declare-root-entry" && entry.path === path);
  if (item === undefined || item.act !== "declare-root-entry") return null;
  let onDisk: string;
  try {
    onDisk = readFileSync(join(root, path), "utf8");
  } catch {
    return null;
  }
  try {
    return editJsonPointer(
      onDisk,
      item.entries.map((entry) => ({ pointer: "/rootEntries/-", value: { name: entry.name, classification: entry.classification, disposition: entry.disposition } })),
    );
  } catch (cause) {
    if (cause instanceof JsonEditUnstableError) return result(2, "indeterminate", "json-edit-unstable");
    throw cause;
  }
}

export function resolveFileText(root: string, set: RepositoryChangeSet, file: WholeFileChange, texts: Readonly<Record<string, string>>): string | ApplyStepResult {
  if (texts[file.path] !== undefined) return texts[file.path]!;
  if (file.mode === "120000") {
    const role = discoveryLinkRole(file.path);
    if (role !== null) return discoveryLinkTarget(role);
  }
  const item = set.items.find((entry) => entry.id === file.item);
  if (item?.act === "declare-root-entry" && item.path === file.path) {
    const edited = declareRootEntryText(root, set, file.path);
    if (edited === null) return result(2, "indeterminate", "file-text-unavailable");
    if (typeof edited !== "string") return edited;
    return edited;
  }
  return result(2, "indeterminate", "file-text-unavailable");
}

export function packagesForLockfile(set: RepositoryChangeSet, invariants: readonly PackageInvariant[]): LockfileInvariantPackage[] | null {
  const packages: LockfileInvariantPackage[] = [];
  for (const row of invariants) {
    const item = set.items.find((entry) => entry.id === row.item);
    if (item === undefined || (item.act !== "install" && item.act !== "pin-starter")) return null;
    if (item.package.name !== row.name || item.package.version !== row.version || item.package.integrity !== row.integrity) return null;
    packages.push({ name: row.name, version: row.version, integrity: row.integrity, placement: item.placement });
  }
  return packages;
}

export function derivedLockfile(set: RepositoryChangeSet): { path: string; invariants: PackageInvariant[] } | null {
  const derived = set.files.find((file) => "derived" in file && file.path !== LEDGER_PATH);
  if (derived === undefined || !("derived" in derived)) return null;
  const invariants = derived.invariants.filter((row): row is PackageInvariant => "name" in row);
  return { path: derived.path, invariants };
}

type GitPathList = { readonly ok: true; readonly paths: readonly string[] } | { readonly ok: false };

function porcelainPaths(root: string): GitPathList {
  const { status, stdout } = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (status !== 0) return { ok: false };
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    let path = line.slice(3).trim();
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    if (path.length > 0) paths.push(path);
  }
  return { ok: true, paths };
}

function diffPaths(root: string, baseCommit: string): GitPathList {
  const { status, stdout } = git(root, ["diff", "--name-only", baseCommit]);
  if (status !== 0) return { ok: false };
  return {
    ok: true,
    paths: stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  };
}

/** What one path is in a tree: a link and where it points, a regular file (and whether it is executable), or anything else. */
export type TreeEntry =
  | { readonly kind: "symlink"; readonly target: string }
  | { readonly kind: "file"; readonly executable: boolean }
  | { readonly kind: "other" };

/**
 * Everything verifyPrepared reads about the tree it judges, so the same checks run over the working tree (verify) or over one
 * commit's tree with no checkout (status). Nothing here writes.
 */
export interface TreeReader {
  /** Whether the tree is on `branch`: a working tree checks its HEAD; a commit reader is told its ref by its caller and answers true. */
  onBranch(branch: string): boolean;
  /** The paths that differ from `baseCommit`. */
  changedPaths(baseCommit: string): GitPathList;
  /** The paths git reports as modified or untracked; a commit has none. */
  dirtyPaths(): GitPathList;
  /** Whether a directory above `relPath` is a link. */
  hasSymlinkAncestor(relPath: string): boolean;
  /** What `relPath` is, or null when there is nothing there; throws when it cannot be told. */
  entry(relPath: string): TreeEntry | null;
  /** The bytes at `relPath`; throws when it cannot be read. */
  bytes(relPath: string): Buffer;
}

export type { GitPathList };

/** The reader verify uses: the clone's working tree and its git status. */
function workingTreeReader(root: string): TreeReader {
  return {
    onBranch(branch) {
      const head = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
      return head.status === 0 && head.stdout.trim() === branch;
    },
    changedPaths: (baseCommit) => diffPaths(root, baseCommit),
    dirtyPaths: () => porcelainPaths(root),
    hasSymlinkAncestor: (relPath) => hasSymlinkAncestor(root, relPath),
    entry(relPath) {
      const path = join(root, relPath);
      let stat;
      try {
        stat = lstatSync(path);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw cause;
      }
      if (stat.isSymbolicLink()) return { kind: "symlink", target: readlinkSync(path) };
      if (stat.isFile()) return { kind: "file", executable: (stat.mode & 0o111) !== 0 };
      return { kind: "other" };
    },
    bytes: (relPath) => readFileSync(join(root, relPath)),
  };
}

function symlinkBeforeRead(reader: TreeReader, relPaths: readonly string[]): ApplyStepResult | null {
  for (const relPath of relPaths) {
    if (reader.hasSymlinkAncestor(relPath)) return result(2, "indeterminate", "symlink-ancestor");
  }
  return null;
}

function expectedLedgerBytes(
  previous: InstalledLedger | null,
  set: RepositoryChangeSet,
  binding: ApprovalBinding,
  planPackages: readonly PlanPackageIdentity[],
): Buffer {
  return Buffer.from(renderInstalledLedger(previous, set, binding, planPackages), "utf8");
}

export interface Preconditions {
  readonly root: string;
  readonly previousLedger: InstalledLedger | null;
  /** The binding admission computed from the hub: the only one a ledger may record. */
  readonly binding: ApprovalBinding;
  /** The committed plan's package acts for the set's repository: what RENDER writes ledger rows from. */
  readonly planPackages: readonly PlanPackageIdentity[];
}

export async function runPreconditions(
  clone: string,
  hub: string,
  set: RepositoryChangeSet,
  heldChangeSets: readonly RepositoryChangeSet[],
  admission: { readonly now?: () => Date; readonly runReadiness?: ReadinessRunner },
): Promise<Preconditions | ApplyStepResult> {
  const resolved = resolveCloneRoot(clone);
  if ("exitCode" in resolved) return resolved;
  const { root } = resolved;
  const shape = checkChangeSetShape(set);
  if (shape !== null) return shape;
  const symlinks = checkSymlinksSupported(root);
  if (symlinks !== null) return symlinks;
  const remote = checkRemoteTip(root, set);
  if (remote !== null) return remote;

  let hubRoot = hub;
  try {
    hubRoot = realpathSync(hub);
  } catch {
    // readHubAuthority refuses a hub it cannot read.
  }
  const authority = readHubAuthority(hubRoot);
  if ("state" in authority) return refusalResult(authority);
  const planPackages = planPackagesFor(authority, set.repository.id);
  const trust = baseLedgerTrust(root, set, heldChangeSets, authority.planDigest, planPackages);
  if ("exitCode" in trust) return trust;
  const decided = await decideSetBinding({
    hub: hubRoot,
    clone: root,
    set,
    authority,
    baseLedger: trust.ledger,
    baseLedgerBytes: trust.bytes,
    now: admission.now,
    runReadiness: admission.runReadiness,
  });
  if (decided.state !== "bound") return refusalResult(decided);
  return { root, previousLedger: trust.ledger, binding: decided.binding, planPackages };
}

export async function verifyRepository(input: VerifyInput): Promise<ApplyStepResult> {
  const pre = await runPreconditions(input.clone, input.hub, input.set, input.heldChangeSets ?? [], input);
  if ("exitCode" in pre) return pre;
  return verifyPrepared(input.set, pre);
}

/**
 * The body of verify, over preconditions (and so an admission) that were already computed, and over a reader of the tree it
 * judges: the clone's working tree by default (verify), or one commit's tree (status).
 */
export function verifyPrepared(set: RepositoryChangeSet, pre: Preconditions, reader: TreeReader = workingTreeReader(pre.root)): ApplyStepResult {
  const { root, previousLedger, binding, planPackages } = pre;
  const allowed = (path: string) => set.pathAllowList.some((pattern) => matchesPathPattern(path, pattern));
  const declared = declaredPaths(set);

  if (!reader.onBranch(set.branch)) return result(1, "violated", "diverged");

  const porcelainEarly = reader.dirtyPaths();
  if (!porcelainEarly.ok) return result(2, "indeterminate", "status-unreadable");
  const diffEarly = reader.changedPaths(set.repository.baseCommit);
  if (!diffEarly.ok) return result(2, "indeterminate", "status-unreadable");

  const lockEarly = derivedLockfile(set);
  const readPaths = [...declared, ...(lockEarly !== null ? [lockEarly.path] : [])];
  const symlink = symlinkBeforeRead(reader, readPaths);
  if (symlink !== null) return symlink;

  for (const path of declared) {
    if (!allowed(path)) return result(1, "violated", "outside-allow-list");
  }

  for (const file of set.files.filter(isWhole)) {
    if (file.after !== null) {
      try {
        const entry = reader.entry(file.path);
        if (entry === null) return result(1, "violated", "content-mismatch");
        if (file.mode === "120000") {
          if (entry.kind !== "symlink") return result(1, "violated", "mode-mismatch");
          if (contentDigest(entry.target) !== file.after) return result(1, "violated", "content-mismatch");
        } else {
          if (entry.kind !== "file") return result(1, "violated", "mode-mismatch");
          if (entry.executable) return result(1, "violated", "mode-mismatch");
          const onDisk = reader.bytes(file.path).toString("utf8");
          if (contentDigest(onDisk) !== file.after) return result(1, "violated", "content-mismatch");
          if (!provesReleaseAgeEdit(root, set, file, onDisk)) return result(1, "violated", "content-mismatch");
        }
      } catch {
        return result(1, "violated", "content-mismatch");
      }
    } else {
      const present = reader.entry(file.path);
      if (present !== null && present.kind !== "other") return result(1, "violated", "removal-present");
    }
  }

  if (set.keys.length > 0) {
    let manifest: string;
    try {
      manifest = reader.bytes("package.json").toString("utf8");
    } catch {
      return result(1, "violated", "content-mismatch");
    }
    for (const key of set.keys) {
      const at = valueAtJsonPointer(manifest, key.pointer);
      if (key.after === null) {
        if (at.found) return result(1, "violated", "content-mismatch");
      } else if (!at.found || at.value !== key.after) return result(1, "violated", "content-mismatch");
    }
  }

  const lock = derivedLockfile(set);
  if (lock !== null) {
    const format =
      lock.path === "package-lock.json" ? "npm" : lock.path === "pnpm-lock.yaml" ? "pnpm" : lock.path === "yarn.lock" ? null : null;
    if (format === null) return result(2, "indeterminate", "lockfile-format-unsupported");
    const base = gitShowUtf8(root, set.repository.baseCommit, lock.path) ?? "";
    let current: string;
    try {
      current = reader.bytes(lock.path).toString("utf8");
    } catch {
      return result(1, "violated", "lockfile-invariants");
    }
    const packages = packagesForLockfile(set, lock.invariants);
    if (packages === null) return result(2, "indeterminate", "lockfile-invariants");
    const checked = checkLockfileInvariants({ format, base, regenerated: current, packages });
    if (checked.verdict === "violated") return result(1, "violated", "lockfile-invariants");
    if (checked.verdict === "indeterminate") return result(2, "indeterminate", checked.reason);
  }

  const expectedLedger = expectedLedgerBytes(previousLedger, set, binding, planPackages);
  let ledgerOnDisk: Buffer;
  try {
    ledgerOnDisk = reader.bytes(LEDGER_PATH);
  } catch {
    return result(1, "violated", "ledger-mismatch");
  }
  if (!ledgerOnDisk.equals(expectedLedger)) return result(1, "violated", "ledger-mismatch");

  for (const path of diffEarly.paths) {
    if (!declared.has(path)) return result(1, "violated", "undeclared-path");
  }

  for (const path of porcelainEarly.paths) {
    if (!declared.has(path)) {
      if (LEFTOVER_SKILL.test(path)) return result(1, "violated", "dirty", `${path} left by an earlier run`);
      return result(1, "violated", "dirty");
    }
  }

  return result(0, "materialized");
}

export function textsFromChangeSet(set: RepositoryChangeSet): Readonly<Record<string, string>> {
  if (set.texts === undefined) return {};
  return Object.fromEntries(set.texts.map((row) => [row.path, row.text] as const));
}

export async function materializeRepository(input: MaterializeInput): Promise<ApplyStepResult> {
  const pre = await runPreconditions(input.clone, input.hub, input.set, input.heldChangeSets ?? [], input);
  if ("exitCode" in pre) return pre;
  const { root, previousLedger, binding, planPackages } = pre;
  const set = input.set;
  const texts = { ...textsFromChangeSet(set), ...input.texts };

  const baseMovement = checkBaseCommitMovement(root, set);
  if (baseMovement !== null) return baseMovement;

  if (git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${set.branch}`]).status === 0) {
    const verified = verifyPrepared(set, pre);
    if (verified.exitCode === 0) {
      const stored = persistChangeSet(input.hub, set);
      if (stored !== null) return stored;
      return verified;
    }
    if (verified.verdict === "indeterminate") return verified;
    return { exitCode: 1, verdict: "violated", reason: "diverged", detail: verified.detail };
  }

  for (const file of set.files.filter(isWhole)) {
    const onDisk = digestAtPath(root, file.path);
    if (onDisk !== file.before) return result(1, "violated", "base-mismatch");
  }

  const porcelain = porcelainPaths(root);
  if (!porcelain.ok) return result(2, "indeterminate", "status-unreadable");
  if (porcelain.paths.length > 0) return result(1, "violated", "dirty");

  const toWrite = set.files.filter(isWhole).filter((file) => file.before !== file.after);
  const resolvedTexts = new Map<string, string>();
  for (const file of toWrite) {
    const resolved = resolveFileText(root, set, file, texts);
    if (typeof resolved !== "string") return resolved;
    if (file.after !== null && contentDigest(resolved) !== file.after) return result(1, "violated", "content-mismatch");
    if (!provesReleaseAgeEdit(root, set, file, resolved)) return result(1, "violated", "content-mismatch");
    resolvedTexts.set(file.path, resolved);
  }

  let packageText: string | undefined;
  if (set.keys.length > 0) {
    const existing = gitShowUtf8(root, set.repository.baseCommit, "package.json");
    if (existing === null) return result(2, "indeterminate", "manifest-absent");
    try {
      packageText = editJsonPointer(
        existing,
        set.keys.map((key) => (key.after === null ? { pointer: key.pointer, remove: true } : { pointer: key.pointer, value: key.after })),
      );
    } catch (cause) {
      if (cause instanceof JsonEditUnstableError) return result(2, "indeterminate", "json-edit-unstable");
      throw cause;
    }
  }

  const pathsToTouch = writePaths(set);
  const symlinkCheck = refuseReservedSymlinks(root, pathsToTouch);
  if (symlinkCheck !== null) return symlinkCheck;

  let ledgerBytes: Buffer;
  try {
    ledgerBytes = expectedLedgerBytes(previousLedger, set, binding, planPackages);
  } catch (cause) {
    if (cause instanceof TypeError) return result(2, "indeterminate", "change-set-invalid");
    throw cause;
  }

  if (git(root, ["checkout", "-b", set.branch, set.repository.baseCommit]).status !== 0) {
    return result(2, "indeterminate", "branch-not-created");
  }

  for (const file of toWrite) {
    if (file.after === null) {
      const removed = removePath(root, file.path);
      if (removed !== null) return removed;
      continue;
    }
    const text = resolvedTexts.get(file.path)!;
    if (file.mode === "120000") {
      const linked = writeSymlink(root, file.path, text, file.after);
      if (linked !== null) return linked;
    } else {
      const written = writeRegularFile(root, file.path, text, file.after);
      if (written !== null) return written;
    }
  }

  if (packageText !== undefined) {
    const written = writeRegularFile(root, "package.json", packageText, contentDigest(packageText));
    if (written !== null) return written;
  }

  const lock = derivedLockfile(set);
  let toolingVersion: string | null = null;
  let toolingTool: "npm" | "pnpm" | "yarn" | null = null;
  if (lock !== null) {
    const lockpath = lockfilePath({ packageManager: set.observed.packageManager, lockfile: set.observed.lockfile });
    if (lockpath === null || lockpath !== lock.path) return result(2, "indeterminate", "lockfile-format-unsupported");
    const packages = packagesForLockfile(set, lock.invariants);
    if (packages === null) return result(2, "indeterminate", "lockfile-invariants");
    const baseLock = gitShowUtf8(root, set.repository.baseCommit, lock.path) ?? "";
    const regen = await regenerateLockfile(
      {
        root,
        packageManager: set.observed.packageManager,
        lockfile: set.observed.lockfile,
        toolVersion: input.toolVersion ?? null,
        baseLockfile: baseLock,
        packages,
        now: input.now ?? (() => new Date()),
      },
      { spawn: input.spawn },
    );
    if (regen.verdict !== "satisfied") {
      if (regen.verdict === "violated") return result(1, "violated", regen.rule);
      return result(2, "indeterminate", regen.reason);
    }
    // The runner already wrote the lockfile. `after` is the hex digest of those bytes.
    let onDisk: Buffer;
    try {
      onDisk = readFileSync(join(root, regen.path));
    } catch {
      return result(1, "violated", "lockfile-invariants");
    }
    if (createHash("sha256").update(onDisk).digest("hex") !== regen.after) return result(1, "violated", "lockfile-invariants");
    toolingTool = regen.tooling.tool;
    toolingVersion = regen.tooling.version;
  }

  const ledgerWritten = writeRegularFile(root, LEDGER_PATH, ledgerBytes.toString("utf8"), contentDigest(ledgerBytes.toString("utf8")));
  if (ledgerWritten !== null) return ledgerWritten;
  const ledgerRead = readFileSync(join(root, LEDGER_PATH));
  if (!ledgerRead.equals(ledgerBytes)) return result(1, "violated", "ledger-mismatch");

  let toStore: RepositoryChangeSet = set;
  if (toolingVersion !== null && toolingTool !== null && TOOL_VERSION_SHAPE.test(toolingVersion)) {
    const tooling = canonicalOrder(
      [...(set.tooling ?? []).filter((row) => row.tool !== toolingTool), { tool: toolingTool, version: toolingVersion }],
      CANONICAL_KEYS.tool,
    );
    toStore = { ...set, tooling };
  }

  const stored = persistChangeSet(input.hub, toStore);
  if (stored !== null) return stored;

  return result(0, "materialized");
}