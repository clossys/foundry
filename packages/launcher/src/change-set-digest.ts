// The change-set and bundle digests (issue #1178), implemented from their
// one definition, docs/contracts/apply-change-set-digest.md, and tested
// against its corpus, apply-change-set-digest.fixture.json beside it. Both
// files are in the public repository, not shipped in this package. Both
// digests reuse the plan digest's canonical step, canonicalDigest(); nothing
// here serializes JSON a second way.

import { canonicalDigest } from "./plan-digest.js";

/** The top-level change-set members the digest leaves out, each because it is computed from the digest or from what the digest covers. */
export const CHANGE_SET_DIGEST_EXCLUDED_FIELDS: readonly string[] = ["changeSetDigest", "branch", "bundle", "pullRequest", "inverse"];

/** The members a derived file keeps in the digest's subject; its `before` and `after` are left out. */
export const DERIVED_FILE_DIGEST_FIELDS: readonly string[] = ["path", "mode", "derived", "item", "invariants"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The value the change-set digest is computed over: the set without its
 * excluded members, with every file whose `derived` is `true` reduced to
 * DERIVED_FILE_DIGEST_FIELDS. Everything else is kept as it is, arrays in
 * order. Throws when `changeSet` is not an object or its `files` is not an
 * array of objects, because then there is nothing well defined to digest.
 */
export function changeSetDigestSubject(changeSet: unknown): Record<string, unknown> {
  if (!isRecord(changeSet)) throw new TypeError("a change set must be an object to have a digest");
  const files = changeSet.files;
  if (!Array.isArray(files) || !files.every(isRecord)) throw new TypeError("a change set's files must be an array of objects to have a digest");
  const subject: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(changeSet)) if (!CHANGE_SET_DIGEST_EXCLUDED_FIELDS.includes(key)) subject[key] = member;
  subject.files = files.map((file) => {
    if (file.derived !== true) return file;
    const reduced: Record<string, unknown> = {};
    for (const key of DERIVED_FILE_DIGEST_FIELDS) if (Object.hasOwn(file, key)) reduced[key] = file[key];
    return reduced;
  });
  return subject;
}

/** `canonicalDigest(changeSetDigestSubject(changeSet))`: the same digest for the same change, whatever the excluded members hold. */
export function changeSetDigest(changeSet: unknown): string {
  return canonicalDigest(changeSetDigestSubject(changeSet));
}

/** One repository's part in the bundle digest. */
export interface BundleDigestEntry {
  readonly id: string;
  readonly changeSetDigest: string;
}

/** Orders two strings by their UTF-16 code units, as the digest page requires for repository ids. */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The bundle digest an approval binds: `canonicalDigest({ planDigest,
 * repositories })`, with `repositories` holding the id and change-set digest
 * of every repository that has a change set, sorted by id. Nothing else is
 * covered -- no authorization, time, check or verdict -- so it can be
 * recomputed from digests alone.
 */
export function bundleDigest(planDigest: string, repositories: readonly BundleDigestEntry[]): string {
  const entries = repositories.map(({ id, changeSetDigest: digest }) => ({ id, changeSetDigest: digest }));
  entries.sort((left, right) => compareCodeUnits(left.id, right.id));
  return canonicalDigest({ planDigest, repositories: entries });
}
