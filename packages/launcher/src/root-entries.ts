// Whether adding paths would break a repository's Controller root
// vocabulary (issue #1178). A consumer repository may declare a Controller
// repository profile whose schema version 3 `rootEntries` is a closed list of
// its direct children; Controller's repository-profile check then fails on a
// direct child the list does not declare, or declares as prohibited. The
// shapes read here are Controller's (its README, "Profile schema v3" and
// "Pure exact-root evaluation"); this package has no runtime dependency on
// Controller, so this module reads only `schemaVersion` and `rootEntries`,
// with the same rules, and judges nothing else in the profile. It performs no
// I/O.

import { compareCodeUnits, isSafeRelativePath } from "./change-set-contract.js";

/** What adding some paths would do to a repository profile's root vocabulary. */
export type RootEntriesVerdict =
  /** No root name is refused: `vocabulary` is none when the profile has no root vocabulary Controller checks. */
  | { readonly verdict: "satisfied"; readonly vocabulary: "none" | "checked" }
  /** Some root names would fail the check: sorted by UTF-16 code units, with no name repeated. */
  | { readonly verdict: "violated"; readonly undeclared: readonly string[]; readonly prohibited: readonly string[] }
  /** The profile cannot be read as a profile with a well-formed root vocabulary. */
  | { readonly verdict: "indeterminate"; readonly reason: "root-vocabulary-unknown" };

const CLASSIFICATIONS = new Set(["canonical", "extension", "exception", "compatibility-alias", "legacy-artifact"]);
const DISPOSITIONS = new Set(["required", "allowed", "prohibited"]);
const ENTRY_KEYS = new Set(["name", "classification", "disposition"]);
const UNKNOWN: RootEntriesVerdict = { verdict: "indeterminate", reason: "root-vocabulary-unknown" };
/** Controller refuses a profile collection of more entries than this. */
const MAX_ROOT_ENTRIES = 10_000;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/** Controller's rule for one direct-child name: 1 to 255 characters, trimmed, not . or .., no / or \, no control character. */
export function isRootEntryName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && value === value.trim() && value !== "." && value !== ".." && !/[\\/\u0000-\u001f\u007f]/u.test(value);
}

/**
 * Judges the root names `paths` introduce -- each path's first segment --
 * against a parsed repository profile. A profile of schema version 1 or 2,
 * or of version 3 with an empty `rootEntries`, has no root vocabulary
 * Controller checks, so nothing is refused. A version 3 profile with entries
 * refuses a name it does not declare, or declares as prohibited. Anything
 * that is not a profile Controller could read this way -- not an object,
 * another schema version, a `rootEntries` on version 1 or 2, more than
 * 10,000 entries, or a malformed or repeated entry -- is indeterminate,
 * never read as permissive. It judges the root vocabulary only: a profile
 * whose other fields Controller refuses fails Controller's check whatever
 * this returns. Throws
 * when a path is not a safe relative path, which is a caller defect.
 */
export function wouldViolateRootEntries(profile: unknown, paths: readonly string[]): RootEntriesVerdict {
  paths.forEach((path, index) => {
    if (!isSafeRelativePath(path)) throw new TypeError(`paths[${index}] is not a safe relative path`);
  });
  if (!isPlainRecord(profile)) return UNKNOWN;
  const version = profile.schemaVersion;
  const hasRoots = Object.hasOwn(profile, "rootEntries");
  if (version === 1 || version === 2) return hasRoots ? UNKNOWN : { verdict: "satisfied", vocabulary: "none" };
  if (version !== 3 || !hasRoots) return UNKNOWN;
  const entries = profile.rootEntries;
  if (!Array.isArray(entries) || entries.length > MAX_ROOT_ENTRIES || Object.keys(entries).length !== entries.length) return UNKNOWN;
  const dispositions = new Map<string, string>();
  for (const entry of entries as unknown[]) {
    if (!isPlainRecord(entry) || !Object.keys(entry).every((key) => ENTRY_KEYS.has(key))) return UNKNOWN;
    const { name, classification, disposition } = entry;
    if (!isRootEntryName(name) || dispositions.has(name)) return UNKNOWN;
    if (typeof classification !== "string" || !CLASSIFICATIONS.has(classification)) return UNKNOWN;
    if (typeof disposition !== "string" || !DISPOSITIONS.has(disposition)) return UNKNOWN;
    dispositions.set(name, disposition);
  }
  if (dispositions.size === 0) return { verdict: "satisfied", vocabulary: "none" };
  const roots = [...new Set(paths.map((path) => path.split("/")[0]!))].sort(compareCodeUnits);
  const undeclared = roots.filter((root) => !dispositions.has(root));
  const prohibited = roots.filter((root) => dispositions.get(root) === "prohibited");
  if (undeclared.length === 0 && prohibited.length === 0) return { verdict: "satisfied", vocabulary: "checked" };
  return { verdict: "violated", undeclared, prohibited };
}
