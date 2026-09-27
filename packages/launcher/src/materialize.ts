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
import type { ApprovalBinding, ChangeSetItem, FileChange, PackageInvariant, RepositoryChangeSet, WholeFileChange } from "./change-set-contract.js";
import { editJsonPointer, valueAtJsonPointer } from "./key-editor.js";
import { renderInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger, LedgerPackageIdentity } from "./ledger-contract.js";
import { trustInstalledLedger } from "./ledger-trust.js";
import type { PlanPackageActs } from "./ledger-trust.js";
import { checkLockfileInvariants } from "./lockfile-invariants.js";
import type { LockfileInvariantPackage } from "./lockfile-invariants.js";
import { regenerateLockfile } from "./lockfile-regen.js";
import type { LockfileSpawn } from "./lockfile-regen.js";

export interface MaterializeInput {
  readonly clone: string;
  readonly hub: string;
  readonly set: RepositoryChangeSet;
  readonly texts: Readonly<Record<string, string>>;
  readonly binding: ApprovalBinding;
  readonly heldChangeSets?: readonly RepositoryChangeSet[];
  readonly spawn?: LockfileSpawn;
  readonly now?: () => Date;
  readonly toolVersion?: string | null;
}

export interface VerifyInput {
  readonly clone: string;
  readonly set: RepositoryChangeSet;
  readonly binding: ApprovalBinding;
  readonly heldChangeSets?: readonly RepositoryChangeSet[];
}

export interface ApplyStepResult {
  readonly exitCode: 0 | 1 | 2;
  readonly verdict: "materialized" | "violated" | "indeterminate";
  readonly reason?: string;
  readonly detail?: string;
}

const BRANCH_SHAPE = /^clossys\/apply-[0-9a-f]{12}$/u;
const COMMIT_SHAPE = /^[0-9a-f]{40}$/u;
const TOOL_VERSION_SHAPE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;
const LEFTOVER_SKILL = /^\.agents\/skills\/clossys-[^/]+(?:\/.*)?$/u;
const RESERVED_ROOTS = new Set(["clossys", ".github", ".starter"]);

type PackageItem = Extract<ChangeSetItem, { act: "install" | "pin-starter" }>;

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
  return branch.length > 0 && !branch.startsWith("-") && !branch.includes("..") && !branch.includes(" ");
}

function planPackagesFromSet(set: RepositoryChangeSet): (LedgerPackageIdentity & { readonly act: "install" | "pin-starter" })[] {
  return set.items
    .filter((item): item is PackageItem => item.act === "install" || item.act === "pin-starter")
    .map(({ planItem, act, package: pkg, placement }) => ({
      planItem,
      act,
      name: pkg.name,
      version: pkg.version,
      integrity: pkg.integrity,
      placement,
    }));
}

function planPackageActsForSet(set: RepositoryChangeSet): PlanPackageActs[] {
  return [{ planDigest: set.planDigest, packages: planPackagesFromSet(set) }];
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
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
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

function writeRegularFile(root: string, relPath: string, text: string, after: string): ApplyStepResult | null {
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

function writeSymlink(root: string, relPath: string, target: string, after: string): ApplyStepResult | null {
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

function removePath(root: string, relPath: string): ApplyStepResult | null {
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

function resolveCloneRoot(clone: string): { root: string } | ApplyStepResult {
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
  git(root, ["fetch", "--no-tags", "origin", branch]);
  const local = git(root, ["rev-parse", `refs/heads/${branch}`]);
  const remote = git(root, ["rev-parse", `refs/remotes/origin/${branch}`]);
  if (local.status !== 0 || remote.status !== 0) return result(2, "indeterminate", "remote-tip-unreadable");
  if (local.stdout.trim() !== remote.stdout.trim()) return result(1, "violated", "remote-tip-mismatch");
  return null;
}

function checkChangeSetShape(set: RepositoryChangeSet): ApplyStepResult | null {
  if (!BRANCH_SHAPE.test(set.branch) || !COMMIT_SHAPE.test(set.repository.baseCommit)) return result(2, "indeterminate", "change-set-invalid");
  if (!validateRepositoryChangeSet(set).valid) return result(2, "indeterminate", "change-set-invalid");
  return null;
}

function baseLedgerTrust(
  root: string,
  set: RepositoryChangeSet,
  heldChangeSets: readonly RepositoryChangeSet[],
): { ledger: InstalledLedger | null } | ApplyStepResult {
  const bytes = gitShowBytes(root, set.repository.baseCommit, LEDGER_PATH);
  const ledgerBytes = bytes ?? new Uint8Array(0);
  const trust = trustInstalledLedger(
    ledgerBytes.length === 0 ? null : ledgerBytes,
    { id: set.repository.id, nodeId: set.repository.nodeId },
    heldChangeSets,
    { planPackageActs: planPackageActsForSet(set) },
  );
  if (trust.state === "refused") return result(2, "indeterminate", trust.rule);
  const generation = trust.ledger?.generation ?? 0;
  if (generation !== set.ledger.generation) return result(1, "violated", "ledger-mismatch");
  return { ledger: trust.ledger };
}

function refuseReservedSymlinks(root: string, paths: readonly string[]): ApplyStepResult | null {
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

function declareRootEntryText(root: string, set: RepositoryChangeSet, path: string): string | null {
  const item = set.items.find((entry) => entry.act === "declare-root-entry" && entry.path === path);
  if (item === undefined || item.act !== "declare-root-entry") return null;
  let onDisk: string;
  try {
    onDisk = readFileSync(join(root, path), "utf8");
  } catch {
    return null;
  }
  return editJsonPointer(
    onDisk,
    item.entries.map((entry) => ({ pointer: "/rootEntries/-", value: { name: entry.name, classification: entry.classification, disposition: entry.disposition } })),
  );
}

function resolveFileText(root: string, set: RepositoryChangeSet, file: WholeFileChange, texts: Readonly<Record<string, string>>): string | ApplyStepResult {
  if (texts[file.path] !== undefined) return texts[file.path]!;
  if (file.mode === "120000") {
    const role = discoveryLinkRole(file.path);
    if (role !== null) return discoveryLinkTarget(role);
  }
  const item = set.items.find((entry) => entry.id === file.item);
  if (item?.act === "declare-root-entry" && item.path === file.path) {
    const edited = declareRootEntryText(root, set, file.path);
    if (edited === null) return result(2, "indeterminate", "file-text-unavailable");
    return edited;
  }
  return result(2, "indeterminate", "file-text-unavailable");
}

function packagesForLockfile(set: RepositoryChangeSet, invariants: readonly PackageInvariant[]): LockfileInvariantPackage[] | null {
  const packages: LockfileInvariantPackage[] = [];
  for (const row of invariants) {
    const item = set.items.find((entry) => entry.id === row.item);
    if (item === undefined || (item.act !== "install" && item.act !== "pin-starter")) return null;
    if (item.package.name !== row.name || item.package.version !== row.version || item.package.integrity !== row.integrity) return null;
    packages.push({ name: row.name, version: row.version, integrity: row.integrity, placement: item.placement });
  }
  return packages;
}

function derivedLockfile(set: RepositoryChangeSet): { path: string; invariants: PackageInvariant[] } | null {
  const derived = set.files.find((file) => "derived" in file && file.path !== LEDGER_PATH);
  if (derived === undefined || !("derived" in derived)) return null;
  const invariants = derived.invariants.filter((row): row is PackageInvariant => "name" in row);
  return { path: derived.path, invariants };
}

function porcelainPaths(root: string): string[] {
  const { status, stdout } = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (status !== 0) return [];
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    let path = line.slice(3).trim();
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    if (path.length > 0) paths.push(path);
  }
  return paths;
}

function diffPaths(root: string, baseCommit: string): string[] {
  const { status, stdout } = git(root, ["diff", "--name-only", baseCommit]);
  if (status !== 0) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function expectedLedgerBytes(previous: InstalledLedger | null, set: RepositoryChangeSet, binding: ApprovalBinding): Buffer {
  return Buffer.from(renderInstalledLedger(previous, set, binding, planPackagesFromSet(set)), "utf8");
}

async function runPreconditions(
  clone: string,
  set: RepositoryChangeSet,
  heldChangeSets: readonly RepositoryChangeSet[],
): Promise<{ root: string; previousLedger: InstalledLedger | null } | ApplyStepResult> {
  const resolved = resolveCloneRoot(clone);
  if ("exitCode" in resolved) return resolved;
  const { root } = resolved;
  const shape = checkChangeSetShape(set);
  if (shape !== null) return shape;
  const symlinks = checkSymlinksSupported(root);
  if (symlinks !== null) return symlinks;
  const remote = checkRemoteTip(root, set);
  if (remote !== null) return remote;
  const trust = baseLedgerTrust(root, set, heldChangeSets);
  if ("exitCode" in trust) return trust;
  return { root, previousLedger: trust.ledger };
}

export async function verifyRepository(input: VerifyInput): Promise<ApplyStepResult> {
  const held = input.heldChangeSets ?? [];
  const pre = await runPreconditions(input.clone, input.set, held);
  if ("exitCode" in pre) return pre;
  const { root, previousLedger } = pre;
  const set = input.set;
  const allowed = (path: string) => set.pathAllowList.some((pattern) => matchesPathPattern(path, pattern));
  const declared = declaredPaths(set);

  for (const path of declared) {
    if (!allowed(path)) return result(1, "violated", "outside-allow-list");
  }

  for (const file of set.files.filter(isWhole)) {
    if (file.after !== null) {
      const path = join(root, file.path);
      try {
        const stat = lstatSync(path);
        if (file.mode === "120000") {
          if (!stat.isSymbolicLink()) return result(1, "violated", "mode-mismatch");
          if (contentDigest(readlinkSync(path)) !== file.after) return result(1, "violated", "content-mismatch");
        } else {
          if (!stat.isFile() || stat.isSymbolicLink()) return result(1, "violated", "mode-mismatch");
          const mode = stat.mode & 0o777;
          if ((mode & 0o111) !== 0) return result(1, "violated", "mode-mismatch");
          if (contentDigest(readFileSync(path, "utf8")) !== file.after) return result(1, "violated", "content-mismatch");
        }
      } catch {
        return result(1, "violated", "content-mismatch");
      }
    } else if (digestAtPath(root, file.path) !== null) return result(1, "violated", "removal-present");
  }

  if (set.keys.length > 0) {
    const manifestPath = join(root, "package.json");
    let manifest: string;
    try {
      manifest = readFileSync(manifestPath, "utf8");
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
      current = readFileSync(join(root, lock.path), "utf8");
    } catch {
      return result(1, "violated", "lockfile-invariants");
    }
    const packages = packagesForLockfile(set, lock.invariants);
    if (packages === null) return result(2, "indeterminate", "lockfile-invariants");
    const checked = checkLockfileInvariants({ format, base, regenerated: current, packages });
    if (checked.verdict === "violated") return result(1, "violated", "lockfile-invariants");
    if (checked.verdict === "indeterminate") return result(2, "indeterminate", checked.reason);
  }

  const expectedLedger = expectedLedgerBytes(previousLedger, set, input.binding);
  let ledgerOnDisk: Buffer;
  try {
    ledgerOnDisk = readFileSync(join(root, LEDGER_PATH));
  } catch {
    return result(1, "violated", "ledger-mismatch");
  }
  if (!ledgerOnDisk.equals(expectedLedger)) return result(1, "violated", "ledger-mismatch");

  for (const path of diffPaths(root, set.repository.baseCommit)) {
    if (!declared.has(path)) return result(1, "violated", "undeclared-path");
  }

  for (const path of porcelainPaths(root)) {
    if (!declared.has(path)) {
      if (LEFTOVER_SKILL.test(path)) return result(1, "violated", "dirty", `${path} left by an earlier run`);
      return result(1, "violated", "dirty");
    }
  }

  return result(0, "materialized");
}

export async function materializeRepository(input: MaterializeInput): Promise<ApplyStepResult> {
  const held = input.heldChangeSets ?? [];
  const pre = await runPreconditions(input.clone, input.set, held);
  if ("exitCode" in pre) return pre;
  const { root, previousLedger } = pre;
  const set = input.set;

  if (git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${set.branch}`]).status === 0) {
    const verified = await verifyRepository({ clone: root, set, binding: input.binding, heldChangeSets: held });
    if (verified.exitCode === 0) return verified;
    if (verified.verdict === "indeterminate") return verified;
    return { exitCode: 1, verdict: "violated", reason: "diverged", detail: verified.detail };
  }

  for (const file of set.files.filter(isWhole)) {
    const onDisk = digestAtPath(root, file.path);
    if (onDisk !== file.before) return result(1, "violated", "base-mismatch");
  }

  const porcelain = porcelainPaths(root);
  if (porcelain.length > 0) return result(1, "violated", "dirty");

  const toWrite = set.files.filter(isWhole).filter((file) => file.before !== file.after);
  const resolvedTexts = new Map<string, string>();
  for (const file of toWrite) {
    const resolved = resolveFileText(root, set, file, input.texts);
    if (typeof resolved !== "string") return resolved;
    if (file.after !== null && contentDigest(resolved) !== file.after) return result(1, "violated", "content-mismatch");
    resolvedTexts.set(file.path, resolved);
  }

  let packageText: string | undefined;
  if (set.keys.length > 0) {
    const existing = gitShowUtf8(root, set.repository.baseCommit, "package.json");
    if (existing === null) return result(2, "indeterminate", "manifest-absent");
    packageText = editJsonPointer(
      existing,
      set.keys.map((key) => (key.after === null ? { pointer: key.pointer, remove: true } : { pointer: key.pointer, value: key.after })),
    );
  }

  const pathsToTouch = writePaths(set);
  const symlinkCheck = refuseReservedSymlinks(root, pathsToTouch);
  if (symlinkCheck !== null) return symlinkCheck;

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

  const ledgerBytes = expectedLedgerBytes(previousLedger, set, input.binding);
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

  let hubReal: string;
  try {
    hubReal = realpathSync(input.hub);
  } catch {
    return result(2, "indeterminate", "change-set-not-stored");
  }
  try {
    storeChangeSet(hubReal, toStore);
  } catch {
    return result(2, "indeterminate", "change-set-not-stored");
  }

  return result(0, "materialized");
}