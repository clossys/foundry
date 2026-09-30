// The hub's two apply stores (issue #1178): every repository change set (kept
// append-only) and every apply bundle (the newest computation replacing the
// last under one digest) this hub has computed, kept by digest under
// clossys/.state/apply/ so a later step (the ledger, an approval, a resumed
// apply) can read back the exact document a digest names instead of trusting
// whatever is passed to it in memory.
//
// Both stores are content-addressed: a file's name is its document's own
// digest. The change-set store is append-only: a name is only ever bound to
// the first bytes stored under it, and writing over it with different bytes
// is refused rather than silently replacing history a ledger or an approval
// may already cite. The bundle store is not, by design (RFC 12.2, 12.3 and
// 12.7, issue #1693): a bundle's digest covers the plan digest and the
// change-set digests only, not its authorization, clock, mode or verdicts, so
// a rerun of `plan` over an unchanged hub yields the same digest with newer
// bytes. Storing a bundle under a digest that already names a file replaces
// that file atomically with the newest computation; only that one name is
// touched, and superseded computations are not recorded. Admission reads a
// stored bundle for its digest, its plan digest and the change sets it holds,
// never for its authorization or verdicts, which it re-checks at apply time.
// Writing the same bytes again is a no-op in both stores. A stored file's
// recomputed digest proves its integrity, not its provenance: anyone who can
// write the hub directory can add a set that verifies, the same way anyone who
// can write a git object store can add a commit. A read never trusts a file
// merely because it parses: the document must validate against its contract,
// recompute to the digest the file name claims, and (for a change set) to
// the digest the document itself carries -- so a renamed or hand-edited file
// reads as absent rather than as something it no longer is.
//
// Every store directory segment, from the hub root down to change-sets/ or
// bundles/, is walked one lstat at a time (issue #1545 fix 5): a symbolic
// link anywhere in that chain is refused rather than followed, so a symlinked
// clossys/, .state/, apply/, change-sets/ or bundles/ can never redirect a
// write or a read outside the hub. Every filesystem error this module
// rethrows, other than ENOENT (which a read turns into null, and a write
// turns into directory creation), names only the failing operation and the
// error's code -- never a path, digest or other value a `cause` might carry.
//
// This module does I/O (mkdirSync, open/write/link/rename/read on the hub
// directory) and so must never be imported by plan-bundle.ts, which computes
// change sets and bundles without touching a filesystem.

import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { bundleDigest, changeSetDigest } from "./change-set-digest.js";
import { validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ApplyBundle, ApplyBundleRepository, RepositoryChangeSet } from "./change-set-contract.js";
import { readContractDocument } from "./generated/contract-schema.generated.js";

/** Where every repository change set this hub has computed is kept, one file per digest, relative to the hub root. */
export const CHANGE_SET_STORE_REL = "clossys/.state/apply/change-sets";

/** Where every apply bundle this hub has computed is kept, one file per digest, relative to the hub root. */
export const BUNDLE_STORE_REL = "clossys/.state/apply/bundles";

/** A digest as every store file is named for: `sha256:` and exactly 64 lowercase hex digits. */
const DIGEST_SHAPE = /^sha256:[0-9a-f]{64}$/u;

/** Throws before any path is built from `digest`, naming no value: only a caller that already holds a well-shaped digest may reach the store. */
function assertDigestShape(digest: string): void {
  if (!DIGEST_SHAPE.test(digest)) throw new TypeError("a stored digest must match sha256: followed by exactly 64 lowercase hex digits");
}

/** The file name a digest is stored under: its 64 hex digits, with no `sha256:` prefix or colon. */
function digestFileName(digest: string): string {
  return `${digest.slice("sha256:".length)}.json`;
}

/** A document's bytes as every store file holds them: two-space JSON with a final newline. */
function serializeStoredDocument(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Wraps a filesystem error, other than ENOENT (handled by each caller), so its message names only the failing operation and the
 * error's code -- never a path, digest or other value; the original error is never attached as `cause`. */
function wrapFsError(operation: string, cause: unknown): Error {
  const code = typeof cause === "object" && cause !== null && "code" in cause ? String((cause as NodeJS.ErrnoException).code) : "unknown";
  return new Error(`${operation} failed (${code})`);
}

/**
 * `hubDirectory` must be an absolute path and its own real path: no symbolic
 * link anywhere in it. Every store operation checks this first, before
 * building any path under it.
 */
function assertHubDirectory(hubDirectory: string): void {
  if (!isAbsolute(hubDirectory)) throw new TypeError("hubDirectory must be an absolute path");
  let real: string;
  try {
    real = realpathSync(hubDirectory);
  } catch (cause) {
    throw wrapFsError("hub directory resolve", cause);
  }
  if (real !== hubDirectory) throw new TypeError("hubDirectory must be its own real path, with no symbolic link in it");
}

/**
 * Walks every path segment from `hubDirectory` down to `directory`
 * (hubDirectory joined with a store's relative path), lstat-ing each one so a
 * symbolic link anywhere in the chain is refused rather than followed. On a
 * write (`mode: "write"`), a missing segment is created with a non-recursive
 * `mkdirSync` and lstat-ed again; on a read (`mode: "read"`), a missing
 * segment means the file being read is absent, and this returns `false`. A
 * segment that is a symbolic link, or exists but is not a directory, throws a
 * TypeError naming no path. Any other filesystem error is rethrown wrapped,
 * naming only the operation and its code.
 */
function ensureRealDirectory(hubDirectory: string, directory: string, mode: "read" | "write"): boolean {
  const relativePath = relative(hubDirectory, directory);
  const segments = relativePath === "" ? [] : relativePath.split(sep);
  let current = hubDirectory;
  for (const segment of segments) {
    current = join(current, segment);
    let info;
    try {
      info = lstatSync(current);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw wrapFsError("hub store directory stat", cause);
      if (mode === "read") return false;
      try {
        mkdirSync(current);
      } catch (createCause) {
        if ((createCause as NodeJS.ErrnoException).code !== "EEXIST") throw wrapFsError("hub store directory create", createCause);
      }
      try {
        info = lstatSync(current);
      } catch (recheckCause) {
        throw wrapFsError("hub store directory create", recheckCause);
      }
    }
    if (!info.isDirectory()) throw new TypeError("a hub store directory segment is a symbolic link or not a directory");
  }
  return true;
}

/**
 * Writes `bytes` under `fileName` in `hubDirectory`/`storeRel` without ever
 * replacing an existing file: the bytes go to a temporary file in the same
 * directory (created exclusively, flushed to disk), which is then
 * hard-linked to the final name, so a name already taken fails the link with
 * EEXIST rather than overwriting it. On EEXIST the existing file is
 * lstat-ed -- a symbolic link there is refused -- then re-read: identical
 * bytes is a no-op; when `equivalent` says the existing and incoming
 * documents validate to the same digest the name claims, that is a no-op
 * too; and any other different bytes is refused. The temporary file is
 * always removed. Every store directory segment is a real directory, never a
 * symbolic link (see `ensureRealDirectory()`). Returns the final path.
 */
/** When both buffers are valid stored change sets for `digest`, true; when existing bytes do not validate to that digest, false. */
function storedChangeSetsShareDigest(existing: Buffer, incoming: Buffer, digest: string): boolean {
  const digestOf = (buf: Buffer): string | null => {
    try {
      const document = readContractDocument(buf);
      if (!validateRepositoryChangeSet(document).valid) return null;
      const set = document as RepositoryChangeSet;
      const recomputed = changeSetDigest(set);
      if (recomputed !== set.changeSetDigest || recomputed !== digest) return null;
      return recomputed;
    } catch {
      return null;
    }
  };
  const left = digestOf(existing);
  const right = digestOf(incoming);
  return left !== null && right !== null && left === right;
}

function writeAppendOnly(hubDirectory: string, storeRel: string, fileName: string, bytes: Buffer, equivalent?: (existing: Buffer, incoming: Buffer) => boolean): string {
  assertHubDirectory(hubDirectory);
  const directory = join(hubDirectory, storeRel);
  ensureRealDirectory(hubDirectory, directory, "write");
  const finalPath = join(directory, fileName);
  const temporaryPath = join(directory, `.${fileName}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    try {
      descriptor = openSync(temporaryPath, "wx", 0o644);
    } catch (cause) {
      throw wrapFsError("hub store write", cause);
    }
    let written = 0;
    try {
      while (written < bytes.length) written += writeSync(descriptor, bytes, written, bytes.length - written);
      fsyncSync(descriptor);
      closeSync(descriptor);
    } catch (cause) {
      throw wrapFsError("hub store write", cause);
    }
    descriptor = undefined;
    try {
      linkSync(temporaryPath, finalPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw wrapFsError("hub store write", cause);
      let info;
      try {
        info = lstatSync(finalPath);
      } catch (statCause) {
        throw wrapFsError("hub store write", statCause);
      }
      if (!info.isFile()) throw new TypeError("a hub store file name is occupied by a symbolic link or a non-regular file");
      let existing: Buffer;
      try {
        existing = readFileSync(finalPath);
      } catch (readCause) {
        throw wrapFsError("hub store write", readCause);
      }
      if (!existing.equals(bytes) && !equivalent?.(existing, bytes)) {
        throw new TypeError("this digest already names a stored document with different bytes; the store is append-only");
      }
    }
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Already failing; the original error is the one reported.
      }
    }
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Best-effort cleanup; the original error (or success) is what is reported.
    }
  }
  return finalPath;
}

/**
 * Stores `bytes` under `fileName` in `hubDirectory`/`storeRel`, replacing
 * whatever regular file already holds that one name: the bytes go to a
 * temporary file in the same real directory (created exclusively, flushed to
 * disk), which is then renamed over the final name, so a reader sees the old
 * file or the new one and never a partial file, and an interrupted write
 * leaves at most a temporary file under another name. Identical existing
 * bytes are a no-op and write nothing. A name held by a symbolic link or any
 * other non-regular file is refused before anything is written. Every store
 * directory segment is a real directory, never a symbolic link (see
 * `ensureRealDirectory()`). The temporary file is always removed. Returns the
 * final path.
 */
function writeReplacing(hubDirectory: string, storeRel: string, fileName: string, bytes: Buffer): string {
  assertHubDirectory(hubDirectory);
  const directory = join(hubDirectory, storeRel);
  ensureRealDirectory(hubDirectory, directory, "write");
  const finalPath = join(directory, fileName);
  let occupied = true;
  try {
    const info = lstatSync(finalPath);
    if (!info.isFile()) throw new TypeError("a hub store file name is occupied by a symbolic link or a non-regular file");
  } catch (cause) {
    if (cause instanceof TypeError) throw cause;
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw wrapFsError("hub store write", cause);
    occupied = false;
  }
  if (occupied) {
    let existing: Buffer;
    try {
      existing = readFileSync(finalPath);
    } catch (cause) {
      throw wrapFsError("hub store write", cause);
    }
    if (existing.equals(bytes)) return finalPath;
  }
  const temporaryPath = join(directory, `.${fileName}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    try {
      descriptor = openSync(temporaryPath, "wx", 0o644);
    } catch (cause) {
      throw wrapFsError("hub store write", cause);
    }
    let written = 0;
    try {
      while (written < bytes.length) written += writeSync(descriptor, bytes, written, bytes.length - written);
      fsyncSync(descriptor);
      closeSync(descriptor);
    } catch (cause) {
      throw wrapFsError("hub store write", cause);
    }
    descriptor = undefined;
    try {
      renameSync(temporaryPath, finalPath);
    } catch (cause) {
      throw wrapFsError("hub store write", cause);
    }
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Already failing; the original error is the one reported.
      }
    }
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Best-effort cleanup; the original error (or success) is what is reported.
    }
  }
  return finalPath;
}

/**
 * Reads and re-reads bytes stored at `hubDirectory`/`storeRel`/`fileName`,
 * strictly: a missing store directory or a missing file reads as `null`, and
 * bytes that are not exactly one strict-JSON value also read as `null`
 * (never thrown), because a store read never trusts a file merely because
 * something is there. Every store directory segment down to `storeRel` is
 * checked to be a real directory, never a symbolic link (see
 * `ensureRealDirectory()`); a symbolic link found there throws rather than
 * being followed.
 */
function readStoredBytes(hubDirectory: string, storeRel: string, fileName: string): unknown | null {
  assertHubDirectory(hubDirectory);
  const directory = join(hubDirectory, storeRel);
  if (!ensureRealDirectory(hubDirectory, directory, "read")) return null;
  const path = join(directory, fileName);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw wrapFsError("hub store read", cause);
  }
  try {
    return readContractDocument(bytes);
  } catch {
    return null;
  }
}

/**
 * Stores `set` under `hubDirectory`/CHANGE_SET_STORE_REL, named for its own
 * `changeSetDigest`. Throws a TypeError, naming no path, id or value, when
 * the set does not validate against the change-set contract, when its
 * `changeSetDigest` is not `changeSetDigest(set)`, or when that name is
 * already taken by different bytes (the store is append-only). Storing the
 * same set again, byte for byte, is a no-op; so is storing another document
 * that validates to the same changeSetDigest. Returns the file's path.
 */
export function storeChangeSet(hubDirectory: string, set: RepositoryChangeSet): string {
  const validation = validateRepositoryChangeSet(set);
  if (!validation.valid) throw new TypeError(`a change set must validate against its contract before it can be stored: ${validation.reason}`);
  if (set.changeSetDigest !== changeSetDigest(set)) throw new TypeError("a change set's changeSetDigest must equal changeSetDigest(set) before it can be stored");
  assertDigestShape(set.changeSetDigest);
  const digest = set.changeSetDigest;
  return writeAppendOnly(
    hubDirectory,
    CHANGE_SET_STORE_REL,
    digestFileName(digest),
    serializeStoredDocument(set),
    (existing, incoming) => storedChangeSetsShareDigest(existing, incoming, digest),
  );
}

/**
 * Stores `bundle` under `hubDirectory`/BUNDLE_STORE_REL, named for its own
 * `bundleDigest`. Throws a TypeError, naming no path, id or value, when the
 * bundle does not validate against the apply-bundle contract, when the
 * digest is malformed, or when a store directory segment or the file name is
 * a symbolic link; nothing is written or replaced in those cases. The digest
 * excludes the authorization, the clock, the mode and the verdicts (RFC
 * 12.3), so a bundle whose digest already names a stored file replaces that
 * one file atomically with these bytes, the newest computation; the same
 * bytes again are a no-op. A bundle with any other digest never touches
 * another file. Superseded computations are not recorded. Returns the file's
 * path.
 */
export function storeApplyBundle(hubDirectory: string, bundle: ApplyBundle): string {
  const validation = validateApplyBundle(bundle);
  if (!validation.valid) throw new TypeError(`an apply bundle must validate against its contract before it can be stored: ${validation.reason}`);
  assertDigestShape(bundle.bundleDigest);
  return writeReplacing(hubDirectory, BUNDLE_STORE_REL, digestFileName(bundle.bundleDigest), serializeStoredDocument(bundle));
}

/**
 * Reads the change set stored for `digest` under `hubDirectory`/CHANGE_SET_STORE_REL.
 * `digest` must match `sha256:` and 64 lowercase hex digits before any path
 * is built from it; a malformed digest throws a TypeError naming no value,
 * before touching the filesystem. Otherwise: a missing file, bytes that are
 * not strict JSON, a document that does not validate against the change-set
 * contract, or one whose `changeSetDigest` -- recomputed and read from the
 * document -- does not equal both `digest` and the document's own
 * `changeSetDigest`, all read as `null`. A file can therefore never be read
 * back under a name, or with content, other than its own digest.
 */
/**
 * Every change set stored under `hubDirectory`/CHANGE_SET_STORE_REL whose file
 * name is 64 lowercase hex digits and `.json`, in directory listing order.
 * Entries that do not read back as a valid stored set are omitted.
 */
export function listStoredChangeSets(hubDirectory: string): RepositoryChangeSet[] {
  assertHubDirectory(hubDirectory);
  const directory = join(hubDirectory, CHANGE_SET_STORE_REL);
  if (!ensureRealDirectory(hubDirectory, directory, "read")) return [];
  const sets: RepositoryChangeSet[] = [];
  for (const name of readdirSync(directory)) {
    if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
    const set = readStoredChangeSet(hubDirectory, `sha256:${name.slice(0, 64)}`);
    if (set !== null) sets.push(set);
  }
  return sets;
}

export function readStoredChangeSet(hubDirectory: string, digest: string): RepositoryChangeSet | null {
  assertDigestShape(digest);
  const document = readStoredBytes(hubDirectory, CHANGE_SET_STORE_REL, digestFileName(digest));
  if (document === null) return null;
  if (!validateRepositoryChangeSet(document).valid) return null;
  const set = document as RepositoryChangeSet;
  const recomputed = changeSetDigest(set);
  if (recomputed !== set.changeSetDigest || recomputed !== digest) return null;
  return set;
}

/**
 * Reads the apply bundle stored for `digest` under `hubDirectory`/BUNDLE_STORE_REL.
 * `digest` must match `sha256:` and 64 lowercase hex digits before any path
 * is built from it; a malformed digest throws a TypeError naming no value,
 * before touching the filesystem. Otherwise: a missing file, bytes that are
 * not strict JSON, a document that does not validate against the
 * apply-bundle contract, or one whose bundle digest -- recomputed from its
 * `plan.digest` and each repository that carries a change set, in the same
 * order applyBundleRuleViolations' A2 rule computes it -- does not equal
 * both `digest` and the document's own `bundleDigest`, all read as `null`.
 */
export function readStoredApplyBundle(hubDirectory: string, digest: string): ApplyBundle | null {
  assertDigestShape(digest);
  const document = readStoredBytes(hubDirectory, BUNDLE_STORE_REL, digestFileName(digest));
  if (document === null) return null;
  if (!validateApplyBundle(document).valid) return null;
  const bundle = document as ApplyBundle;
  const computed: { readonly id: string; readonly changeSetDigest: string }[] = bundle.repositories.flatMap((entry: ApplyBundleRepository) =>
    "changeSet" in entry ? [{ id: entry.id, changeSetDigest: entry.changeSet }] : [],
  );
  const recomputed = bundleDigest(bundle.plan.digest, computed);
  if (recomputed !== bundle.bundleDigest || recomputed !== digest) return null;
  return bundle;
}
