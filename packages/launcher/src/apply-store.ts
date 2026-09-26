// The hub's two apply stores (issue #1178): every repository change set and
// every apply bundle this hub has ever computed, kept by digest under
// clossys/.state/apply/ so a later step (the ledger, an approval, a resumed
// apply) can read back the exact document a digest names instead of trusting
// whatever is passed to it in memory.
//
// Both stores are append-only and content-addressed: a file's name is its
// document's own digest, so the same digest can only ever name the same
// bytes. Writing over an existing name with different bytes is refused
// rather than silently replacing history a ledger or an approval may already
// cite; writing the same bytes again is a no-op. A read never trusts a file
// merely because it parses: the document must validate against its contract,
// recompute to the digest the file name claims, and (for a change set) to
// the digest the document itself carries -- so a renamed or hand-edited file
// reads as absent rather than as something it no longer is.
//
// This module does I/O (mkdirSync, open/write/link/read on the hub
// directory) and so must never be imported by plan-bundle.ts, which computes
// change sets and bundles without touching a filesystem.

import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Writes `bytes` under `fileName` in `directory` without ever replacing an
 * existing file: the bytes go to a temporary file in the same directory
 * (created exclusively, flushed to disk), which is then hard-linked to the
 * final name, so a name already taken fails the link with EEXIST rather than
 * overwriting it. On EEXIST the existing file is re-read: identical bytes is
 * a no-op, and different bytes is refused. The temporary file is always
 * removed. Returns the final path.
 */
function writeAppendOnly(directory: string, fileName: string, bytes: Buffer): string {
  mkdirSync(directory, { recursive: true });
  const finalPath = join(directory, fileName);
  const temporaryPath = join(directory, `.${fileName}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o644);
    let written = 0;
    while (written < bytes.length) written += writeSync(descriptor, bytes, written, bytes.length - written);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      linkSync(temporaryPath, finalPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      const existing = readFileSync(finalPath);
      if (!existing.equals(bytes)) throw new TypeError("this digest already names a stored document with different bytes; the store is append-only");
    }
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Already failing; the original error is the one reported.
      }
    }
    rmSync(temporaryPath, { force: true });
  }
  return finalPath;
}

/**
 * Reads and re-reads bytes stored at `path`, strictly: a missing file reads
 * as `null`, and bytes that are not exactly one strict-JSON value also read
 * as `null` (never thrown), because a store read never trusts a file merely
 * because something is there.
 */
function readStoredBytes(path: string): unknown | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
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
 * same set again, byte for byte, is a no-op. Returns the file's path.
 */
export function storeChangeSet(hubDirectory: string, set: RepositoryChangeSet): string {
  const validation = validateRepositoryChangeSet(set);
  if (!validation.valid) throw new TypeError(`a change set must validate against its contract before it can be stored: ${validation.reason}`);
  if (set.changeSetDigest !== changeSetDigest(set)) throw new TypeError("a change set's changeSetDigest must equal changeSetDigest(set) before it can be stored");
  assertDigestShape(set.changeSetDigest);
  return writeAppendOnly(join(hubDirectory, CHANGE_SET_STORE_REL), digestFileName(set.changeSetDigest), serializeStoredDocument(set));
}

/**
 * Stores `bundle` under `hubDirectory`/BUNDLE_STORE_REL, named for its own
 * `bundleDigest`. Throws a TypeError, naming no path, id or value, when the
 * bundle does not validate against the apply-bundle contract, or when that
 * name is already taken by different bytes (the store is append-only).
 * Storing the same bundle again, byte for byte, is a no-op. Returns the
 * file's path.
 */
export function storeApplyBundle(hubDirectory: string, bundle: ApplyBundle): string {
  const validation = validateApplyBundle(bundle);
  if (!validation.valid) throw new TypeError(`an apply bundle must validate against its contract before it can be stored: ${validation.reason}`);
  assertDigestShape(bundle.bundleDigest);
  return writeAppendOnly(join(hubDirectory, BUNDLE_STORE_REL), digestFileName(bundle.bundleDigest), serializeStoredDocument(bundle));
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
export function readStoredChangeSet(hubDirectory: string, digest: string): RepositoryChangeSet | null {
  assertDigestShape(digest);
  const path = join(hubDirectory, CHANGE_SET_STORE_REL, digestFileName(digest));
  const document = readStoredBytes(path);
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
  const path = join(hubDirectory, BUNDLE_STORE_REL, digestFileName(digest));
  const document = readStoredBytes(path);
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
