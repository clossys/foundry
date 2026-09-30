// Dry materialization for `launcher-apply-plan plan` (issue #1178, RFC apply-approved-plan section 7, V6 and V9).
//
// The planner is pure and cannot regenerate a lockfile, so it reports every set that changes one as V6 indeterminate
// (`lockfile-not-run`). This module runs the part it cannot: it writes the base commit's tree and the set's changes into a
// temporary directory, regenerates the lockfile there with the same runner materialize uses, and, only when that passes,
// runs the hub's provenance check (V9) on that same tree. It reads the clone through git plumbing at the base commit
// (`ls-tree` and `cat-file`, see readCommittedFiles) and never writes it: no checkout, worktree, index or ref.
//
// Every ambiguity refuses. A rule is one of a fixed set of tokens and never carries tool output, a path, an id or a file
// name. The temporary tree is a directory of its own under the real operating-system temporary directory, removed before
// this returns, whatever happened. Nothing here changes a set, its digest or the bundle's digest: only the checks move.

import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { canonicalOrder, contentDigest, lockfilePath, validateApplyBundle, validateRepositoryChangeSet, worstVerdict } from "./change-set-contract.js";
import type { ApplyBundle, ApplyBundleRepository, ApplyCheck, RepositoryChangeSet, WholeFileChange } from "./change-set-contract.js";
import { JsonEditUnstableError, editJsonPointer } from "./key-editor.js";
import { regenerateLockfile } from "./lockfile-regen.js";
import type { LockfileSpawn } from "./lockfile-regen.js";
import { derivedLockfile, packagesForLockfile, provesReleaseAgeEditWith, refuseReservedSymlinks, removePath, resolveFileText, textsFromChangeSet, writeRegularFile, writeSymlink } from "./materialize.js";
import type { ApplyStepResult } from "./materialize.js";
import { fold, readCommittedFiles } from "./observe-repository.js";
import type { CommittedFile } from "./observe-repository.js";
import type { PlanApplyBundleResult } from "./plan-bundle.js";
import { checkSetProvenance } from "./provenance-gate.js";

/** The rule the planner gives a set that changes a lockfile, and this module replaces. */
export const LOCKFILE_NOT_RUN = "lockfile-not-run";
/** The V9 rule of a set whose lockfile step did not pass: the provenance check is not run on a tree that is not the result. */
export const LOCKFILE_NOT_REGENERATED = "lockfile-not-regenerated";
/** The V6 rule of a repository whose dry tree could not be built or run, for any reason that is not one of the named ones. */
export const DRY_TREE_FAILED = "dry-tree-failed";
/** The V6 rule of a committed tree that is not safe to write: a path segment or a link that could reach outside the tree. */
export const DRY_TREE_UNSAFE = "tree-unsafe";

/** Ports. Neither is reachable from a CLI; `tempRoot` is a test-only stand-in for the operating-system temporary directory. */
export interface DryMaterializePorts {
  /** Launches the package manager; the real runner by default. */
  readonly lockfileSpawn?: LockfileSpawn;
  /** Launches the hub's provenance check; the real runner by default. */
  readonly provenanceSpawn?: LockfileSpawn;
  readonly tempRoot?: string;
}

export interface DryMaterializeInput {
  /** The repository's local clone: read at the set's base commit, never written. */
  readonly clone: string;
  /** The hub's real path, whose node_modules holds the pinned Integrator. */
  readonly hubRoot: string;
  readonly set: RepositoryChangeSet;
  readonly now: () => Date;
}

const TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TEMP_PREFIX = "launcher-dry-materialize-";

const v6 = (verdict: "violated" | "indeterminate", rule: string): ApplyCheck => ({ check: "V6", verdict, rule: TOKEN.test(rule) ? rule : DRY_TREE_FAILED });
const V6_SATISFIED: ApplyCheck = { check: "V6", verdict: "satisfied" };
const isWhole = (file: RepositoryChangeSet["files"][number]): file is WholeFileChange => !("derived" in file);

/** The V6 check a materialize step's result is: its exit code 1 is violated, anything else indeterminate; its reason is a fixed id. */
const fromStep = (step: ApplyStepResult): ApplyCheck => v6(step.exitCode === 1 ? "violated" : "indeterminate", step.reason ?? DRY_TREE_FAILED);

// ---------------------------------------------------------------------------
// the committed tree, before anything is written

/** A path segment as a filesystem that folds case, normalization and format characters would read it. */
const folded = (segment: string): string => segment.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
const CONTROL = /\p{Cc}/u;

function segmentsSafe(path: string): boolean {
  if (path.length === 0 || CONTROL.test(path)) return false;
  return path.split("/").every((segment) => {
    const key = folded(segment);
    return segment.length > 0 && key !== "" && key !== "." && key !== ".." && key !== ".git";
  });
}

/**
 * Whether a link's target stays inside the tree however the links along it resolve: relative, no empty segment, no `..` after a
 * name, no more leading `..` than the directories above the link, and no `.git` segment.
 */
function linkStaysInside(path: string, target: string): boolean {
  if (target.length === 0 || CONTROL.test(target) || target.startsWith("/") || target.includes("\\")) return false;
  const parts = target.split("/");
  let up = 0;
  while (up < parts.length && parts[up] === "..") up += 1;
  if (up > path.split("/").length - 1) return false;
  return parts.slice(up).every((segment) => {
    const key = folded(segment);
    return segment.length > 0 && key !== ".." && key !== ".git";
  });
}

/**
 * Whether every path, and every link, of the committed tree is one the dry tree may hold. A filesystem that folds case or
 * normalization reads two spellings as one name, so a link and a directory kept apart only by spelling would be the same entry
 * there and a later write would go through the link. Every entry (link or file) is therefore folded as observeRepository folds
 * it, and the tree is refused when that fold repeats, or is a proper prefix of another entry's fold.
 */
export function treeIsSafe(files: readonly CommittedFile[]): boolean {
  const seen = [new Set<string>(), new Set<string>()];
  const entries: string[] = [];
  for (const file of files) {
    if (!segmentsSafe(file.path)) return false;
    // A tree that keeps two paths apart only by case or normalization would be one path on a filesystem that folds them.
    const keys = [file.path.normalize("NFC").toLowerCase(), fold(file.path)];
    for (const [index, key] of keys.entries()) {
      if (seen[index]!.has(key)) return false;
      seen[index]!.add(key);
    }
    entries.push(fold(file.path));
    if (file.mode === "120000" && !linkStaysInside(file.path, file.bytes.toString("utf8"))) return false;
  }
  const named = new Set(entries);
  for (const entry of entries) {
    const segments = entry.split("/");
    for (let length = 1; length < segments.length; length += 1) if (named.has(segments.slice(0, length).join("/"))) return false;
  }
  return true;
}

/** Whether `directory`'s real path is `root` or inside it. */
function insideRoot(root: string, directory: string): boolean {
  const real = realpathSync(directory);
  return real === root || real.startsWith(`${root}${sep}`);
}

/**
 * Makes each directory of `relative` (a path inside `root`) one segment at a time, and throws when a segment already exists as
 * anything but a real directory: nothing is created through a link, and nothing is created before the segment is looked at.
 */
function ensureDirectory(root: string, relative: string): string {
  let current = root;
  if (relative === "") return current;
  for (const segment of relative.split("/")) {
    current = join(current, segment);
    let stat: ReturnType<typeof lstatSync> | null = null;
    try {
      stat = lstatSync(current);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    if (stat === null) mkdirSync(current);
    else if (!stat.isDirectory()) throw new Error("a directory of the base tree is not a directory");
  }
  return current;
}

/**
 * Writes the committed tree under `root` (a real path of its own): directories and regular files first and links last, so no
 * write of a file goes through a link, and before each write the real path of its parent must be inside `root`.
 */
export function writeBaseTree(root: string, files: readonly CommittedFile[]): void {
  const ordered = [...files.filter((file) => file.mode !== "120000"), ...files.filter((file) => file.mode === "120000")];
  for (const file of ordered) {
    const path = join(root, file.path);
    ensureDirectory(root, dirname(file.path) === "." ? "" : dirname(file.path));
    if (!insideRoot(root, dirname(path))) throw new Error("a path of the base tree resolves outside the temporary directory");
    if (file.mode === "120000") {
      symlinkSync(file.bytes.toString("utf8"), path);
      continue;
    }
    writeFileSync(path, file.bytes, { flag: "wx" });
    chmodSync(path, file.mode === "100755" ? 0o755 : 0o644);
  }
}

// ---------------------------------------------------------------------------
// one repository

const digestOfBytes = (bytes: Buffer): string => contentDigest(bytes.toString("utf8"));
const sha256Hex = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * V6 and V9 for a set that changes a lockfile, or null when it changes none. V6 is the result of writing the set into a
 * temporary copy of the base tree and regenerating the lockfile there; V9 is run on that same copy, and only when V6 is
 * satisfied. The ledger is not written: it is bound by an approval that does not exist yet, and nothing here reads it.
 */
export async function dryMaterialize(input: DryMaterializeInput, ports: DryMaterializePorts = {}): Promise<readonly ApplyCheck[] | null> {
  const { set } = input;
  const lock = derivedLockfile(set);
  if (lock === null) return null;
  const held: { root: string | null } = { root: null };
  try {
    const outcome = await runDry(input, ports, lock, held);
    if ("checks" in outcome) return outcome.checks;
    return [outcome.v6, { check: "V9", verdict: "indeterminate", rule: LOCKFILE_NOT_REGENERATED }];
  } catch {
    return [v6("indeterminate", DRY_TREE_FAILED), { check: "V9", verdict: "indeterminate", rule: LOCKFILE_NOT_REGENERATED }];
  } finally {
    if (held.root !== null) {
      try {
        rmSync(held.root, { recursive: true, force: true });
      } catch {
        // The verdict does not depend on the removal, and the tree is under the operating-system temporary directory.
      }
    }
  }
}

async function runDry(
  input: DryMaterializeInput,
  ports: DryMaterializePorts,
  lock: NonNullable<ReturnType<typeof derivedLockfile>>,
  held: { root: string | null },
): Promise<{ readonly v6: ApplyCheck } | { readonly checks: readonly ApplyCheck[] }> {
  const { set } = input;
  if (!validateRepositoryChangeSet(set).valid) return { v6: v6("indeterminate", "change-set-invalid") };
  const lockpath = lockfilePath({ packageManager: set.observed.packageManager, lockfile: set.observed.lockfile });
  if (lockpath === null || lockpath !== lock.path) return { v6: v6("indeterminate", "lockfile-format-unsupported") };
  const packages = packagesForLockfile(set, lock.invariants);
  if (packages === null) return { v6: v6("indeterminate", "lockfile-invariants") };

  const committed = readCommittedFiles(input.clone, set.repository.baseCommit);
  if (!committed.ok) return { v6: v6("indeterminate", committed.reason) };
  if (!treeIsSafe(committed.files)) return { v6: v6("indeterminate", DRY_TREE_UNSAFE) };
  const base = new Map(committed.files.map((file) => [file.path, file] as const));
  const baseText = (path: string): string | null => base.get(path)?.bytes.toString("utf8") ?? null;

  // The set's own claim about the base: every file it replaces is, at the base commit, the bytes it names as `before`.
  const whole = set.files.filter(isWhole);
  for (const file of whole) {
    const at = base.get(file.path);
    if ((at === undefined ? null : digestOfBytes(at.bytes)) !== file.before) return { v6: v6("violated", "base-mismatch") };
  }

  const parent = ports.tempRoot === undefined ? realpathSync(tmpdir()) : realpathSync(ports.tempRoot);
  const root = mkdtempSync(join(parent, TEMP_PREFIX));
  held.root = root;
  // The runner and the provenance check both need a directory that is its own real path.
  if (realpathSync(root) !== root) return { v6: v6("indeterminate", DRY_TREE_FAILED) };
  writeBaseTree(root, committed.files);

  // What every change writes is resolved and proved before the first write, from the tree as the base has it.
  const texts = textsFromChangeSet(set);
  const toWrite = whole.filter((file) => file.before !== file.after);
  const resolved = new Map<string, string>();
  for (const file of toWrite) {
    const text = resolveFileText(root, set, file, texts);
    if (typeof text !== "string") return { v6: fromStep(text) };
    if (file.after !== null && contentDigest(text) !== file.after) return { v6: v6("violated", "content-mismatch") };
    if (!provesReleaseAgeEditWith(baseText, set, file, text)) return { v6: v6("violated", "content-mismatch") };
    resolved.set(file.path, text);
  }
  let packageText: string | undefined;
  if (set.keys.length > 0) {
    const existing = baseText("package.json");
    if (existing === null) return { v6: v6("indeterminate", "manifest-absent") };
    try {
      packageText = editJsonPointer(existing, set.keys.map((key) => (key.after === null ? { pointer: key.pointer, remove: true } : { pointer: key.pointer, value: key.after })));
    } catch (cause) {
      if (cause instanceof JsonEditUnstableError) return { v6: v6("indeterminate", "json-edit-unstable") };
      throw cause;
    }
  }
  const touched = [...toWrite.map((file) => file.path), ...(packageText === undefined ? [] : ["package.json"])];
  const symlinked = refuseReservedSymlinks(root, touched);
  if (symlinked !== null) return { v6: fromStep(symlinked) };

  for (const file of toWrite) {
    if (file.after === null) {
      const removed = removePath(root, file.path);
      if (removed !== null) return { v6: fromStep(removed) };
    } else if (file.mode === "120000") {
      const linked = writeSymlink(root, file.path, resolved.get(file.path)!, file.after);
      if (linked !== null) return { v6: fromStep(linked) };
    } else {
      const written = writeRegularFile(root, file.path, resolved.get(file.path)!, file.after);
      if (written !== null) return { v6: fromStep(written) };
    }
  }
  if (packageText !== undefined) {
    const written = writeRegularFile(root, "package.json", packageText, contentDigest(packageText));
    if (written !== null) return { v6: fromStep(written) };
  }

  // The lockfile step, as materialize runs it: the tool version is not supplied here, so pnpm and Yarn are refused by the runner.
  const regen = await regenerateLockfile(
    {
      root,
      packageManager: set.observed.packageManager,
      lockfile: set.observed.lockfile,
      toolVersion: null,
      baseLockfile: baseText(lock.path) ?? "",
      packages,
      now: input.now,
    },
    { spawn: ports.lockfileSpawn },
  );
  // Only the runner's fixed rule or reason is kept, never its tool output or paths.
  if (regen.verdict === "violated") return { v6: v6("violated", regen.rule) };
  if (regen.verdict === "indeterminate") return { v6: v6("indeterminate", regen.reason) };
  let onDisk: Buffer;
  try {
    onDisk = readFileSync(join(root, regen.path));
  } catch {
    return { v6: v6("violated", "lockfile-invariants") };
  }
  if (sha256Hex(onDisk) !== regen.after) return { v6: v6("violated", "lockfile-invariants") };

  const provenance = await checkSetProvenance({ tree: root, hubRoot: input.hubRoot, items: set.items }, { spawn: ports.provenanceSpawn });
  return { checks: [V6_SATISFIED, ...provenance] };
}

// ---------------------------------------------------------------------------
// the bundle

export interface DryMaterializeBundleOptions {
  /** The hub's real path. */
  readonly hub: string;
  /** The local clone of a repository id. */
  readonly cloneFor: (id: string) => string;
  readonly now: () => Date;
  readonly ports?: DryMaterializePorts;
}

const sortChecks = (checks: readonly ApplyCheck[]): ApplyCheck[] => canonicalOrder(checks, (check) => [check.check, check.rule ?? ""]);

/**
 * The planner's result with each dry-materializable repository's `lockfile-not-run` replaced by V6 and V9 as this module
 * computes them. A repository is dry-materialized only when its set changes a lockfile, has no refused path or key, and every
 * other check is already satisfied: a repository that cannot be applied anyway launches nothing. The sets, their digests and
 * the bundle digest are unchanged (the digest does not cover checks); each repository's verdict is recomputed as the worst of
 * its checks, and the bundle is validated again. Throws when it does not validate.
 */
export async function dryMaterializeBundle(result: PlanApplyBundleResult, options: DryMaterializeBundleOptions): Promise<PlanApplyBundleResult> {
  const repositories: ApplyBundleRepository[] = [];
  for (const entry of result.bundle.repositories) {
    if (!("changeSet" in entry)) {
      repositories.push(entry);
      continue;
    }
    const others = entry.checks.filter((check) => !(check.check === "V6" && check.rule === LOCKFILE_NOT_RUN));
    const set = result.changeSets.find((candidate) => candidate.changeSetDigest === entry.changeSet);
    if (others.length === entry.checks.length || set === undefined || set.refused.length > 0 || others.some((check) => check.verdict !== "satisfied")) {
      repositories.push(entry);
      continue;
    }
    const replaced = await dryMaterialize({ clone: options.cloneFor(set.repository.id), hubRoot: options.hub, set, now: options.now }, options.ports);
    if (replaced === null) {
      repositories.push(entry);
      continue;
    }
    const checks = sortChecks([...others, ...replaced]);
    repositories.push({ ...entry, verdict: worstVerdict(checks.map((check) => check.verdict)), checks });
  }
  const bundle: ApplyBundle = { ...result.bundle, repositories };
  if (!validateApplyBundle(bundle).valid) throw new Error("the bundle with its dry-materialization checks does not validate");
  return { bundle, changeSets: result.changeSets };
}
