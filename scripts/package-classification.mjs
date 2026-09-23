// package-classification — shared classification for every package under
// packages/, used by check-package-conformance.mjs and check-loop-matrix.mjs
// (issue #1187 comment 5800189482, Decision 1). Before this module existed,
// both gates silently dropped any packages/<pkg> whose manifest name was
// missing from docs/contracts/role-loop-archetypes.json's own `roles` map --
// a new package that was never added to that map simply disappeared from
// every Stage B gate with no finding at all. That is the defect this module
// closes: every packages/* manifest name must land in EXACTLY one of two
// sets, and landing in neither (or in both) is itself a finding, not an
// absence.
//
//   - "role": the name is one of role-loop-archetypes.json's own `roles`.
//     Evaluated in full by the Stage B gates, unchanged.
//   - "tooling": the name carries docs/contracts/package-evidence.json's own
//     `category: "executable-tooling"` (its $comment: "a non-role
//     executable package must explicitly use `executable-tooling`, which
//     keeps it out of the role-loop charter while still requiring its
//     installed bin"). This module reuses that existing field as the single
//     source of tooling classification rather than inventing a second list.
//   - "unclassified": neither -- a package the role contract and the
//     evidence ledger both forgot.
//   - "both": in role-loop-archetypes.json's `roles` AND carries
//     `category: "executable-tooling"` -- a contradiction, not a role with
//     extra paperwork.
//   - "invalid-name": the manifest itself has no usable name (missing,
//     empty, or not a string), so it cannot even be looked up in either
//     set. Before this case existed, a gate hit `!isText(manifest.name)`
//     and silently `continue`d past the package -- the exact "disappeared
//     from every Stage B gate with no finding at all" defect this module
//     closes, just triggered by an unreadable name instead of an
//     unregistered one. A caller that finds one does not call
//     classifyPackage at all (there is no name to classify); it reports
//     this classification directly, using the package's directory name as
//     the only identity it has.
//   - "missing-manifest": the package directory under packages/ has no
//     package.json at all. Same defect class, one layer earlier -- a
//     caller that only ever `readdirSync`s and then reads each manifest
//     can silently skip a directory that never had one. Reported directly,
//     using the directory name as identity.
//   - "invalid-manifest": the package directory has a package.json, but it
//     is not usable as a manifest -- either it is not valid JSON, or it
//     parses successfully to something that isn't a plain object (`null`,
//     an array, a string, a number: `JSON.parse` happily returns all of
//     these without throwing, but `manifest.name` on `null` throws, and on
//     an array or a primitive is merely `undefined`). A caller must not let
//     one broken manifest abort the whole gate run (that fails closed but
//     reports nothing attributable, or -- for the `null` case specifically
//     -- crashes with an uncaught TypeError instead of failing closed at
//     all) -- readManifest (below) is the ONE place that turns a
//     package.json into a manifest object, and it returns `{ ok: false }`
//     for every one of these shapes uniformly. A caller catches that once
//     and reports this classification, keyed by directory name; nothing
//     downstream ever reads a manifest field without having gone through
//     readManifest first.
//   - "symlinked-package": the packages/<dir> entry itself is a symlink,
//     not a real directory. `Dirent.isDirectory()` is false for a symlink
//     even when it points at a real directory with a valid package.json
//     (it reflects the entry's own type, not its target's) -- a caller
//     that only checks `isDirectory()` silently drops it, the same
//     "disappeared with no finding at all" defect this module exists to
//     close, via a third trigger. A caller must check `isSymbolicLink()`
//     explicitly and report this classification -- it must NOT follow the
//     symlink to see what it points at, because a git-stored symlink under
//     packages/ is itself the defect being reported here, independent of
//     wherever it happens to point.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const EXECUTABLE_TOOLING_CATEGORY = "executable-tooling";

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isText(value) { return typeof value === "string" && value.trim() !== ""; }

/**
 * Reads docs/contracts/package-evidence.json and returns the Set of package
 * names declared `category: "executable-tooling"`. This is the ONE source
 * for tooling classification -- a gate must not keep a second, divergent
 * list of tooling package names.
 */
export function loadToolingPackageNames(root) {
  const path = join(root, "docs/contracts/package-evidence.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const names = new Set();
  for (const pkg of doc.packages ?? []) {
    if (isRecord(pkg) && isText(pkg.name) && pkg.category === EXECUTABLE_TOOLING_CATEGORY) names.add(pkg.name);
  }
  return names;
}

/**
 * The ONE place that turns a package.json path into a usable manifest
 * object. Returns `{ ok: true, manifest }` when the file parses as JSON AND
 * the result is a plain object (non-null, not an array) -- the only shape
 * `manifest.name` (or any other field access) is safe to read from without
 * a caller re-deriving its own validity check. Returns `{ ok: false }` for
 * every other outcome: the file can't be read at all, `JSON.parse` throws,
 * or it parses successfully to `null`, an array, or a primitive. Callers
 * must route every package.json read through this rather than a bare
 * `JSON.parse(readFileSync(...))` -- that is exactly the gap that let a
 * `package.json` containing the single token `null` crash an entire gate
 * run (`JSON.parse("null")` does not throw; `null.name` does).
 */
export function readManifest(manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return { ok: false };
  }
  if (!isRecord(parsed)) return { ok: false };
  return { ok: true, manifest: parsed };
}

/**
 * Classifies one package manifest name against the active roles
 * (role-loop-archetypes.json's own `roles` map, already resolved to an
 * array of names by the caller) and the tooling names (this module's own
 * loadToolingPackageNames). Pure: takes already-loaded data, no I/O.
 */
export function classifyPackage(name, activeRoles, toolingNames) {
  const isRole = activeRoles.includes(name);
  const isTooling = toolingNames.has(name);
  if (isRole && isTooling) return "both";
  if (isRole) return "role";
  if (isTooling) return "tooling";
  return "unclassified";
}

// Every classification value that is itself a defect, never a normal
// outcome -- a gate always reports these, in report mode and --enforce
// alike, unlike a "role" absence gap which report mode only counts. Shared
// so a gate's evaluator, printTable, and summary line filter identically
// rather than three separately-maintained OR chains that can drift apart.
const INVALID_CLASSIFICATIONS = new Set(["unclassified", "both", "invalid-name", "missing-manifest", "invalid-manifest", "symlinked-package"]);

/**
 * True for any classification that is itself a defect (see
 * INVALID_CLASSIFICATIONS above), false for "role" and "tooling".
 */
export function isInvalidClassification(classification) {
  return INVALID_CLASSIFICATIONS.has(classification);
}

/**
 * The always-on finding for a package that classified as "unclassified",
 * "both", "invalid-name", "missing-manifest", "invalid-manifest", or
 * "symlinked-package" -- a defect the gates report in every mode, never
 * only under --enforce, because a classification gap is not an adoption
 * gap. Returns null for "role" and "tooling", which are not findings. For
 * every invalid classification except "unclassified"/"both", `role` is the
 * package's directory name (there is no manifest name to use, or -- for
 * "symlinked-package" -- no manifest is ever read at all), passed by the
 * caller as the only identity available.
 */
export function classificationFinding(role, classification) {
  if (classification === "both") {
    return {
      rule: "package-double-classified",
      role,
      message: `${role} is declared both a role (docs/contracts/role-loop-archetypes.json's own "roles" map) and executable tooling (docs/contracts/package-evidence.json's own category: "${EXECUTABLE_TOOLING_CATEGORY}") — every packages/* manifest name must be classified as exactly one.`,
    };
  }
  if (classification === "unclassified") {
    return {
      rule: "package-not-classified",
      role,
      message: `${role} is declared neither a role (docs/contracts/role-loop-archetypes.json's own "roles" map) nor executable tooling (docs/contracts/package-evidence.json's own category: "${EXECUTABLE_TOOLING_CATEGORY}") — every packages/* manifest name must be classified as one or the other.`,
    };
  }
  if (classification === "invalid-name") {
    return {
      rule: "invalid-manifest-name",
      role,
      message: `packages/${role}/package.json has no valid "name" (missing, empty, or not a string) — every packages/* manifest must declare a usable name so it can be classified as a role (docs/contracts/role-loop-archetypes.json's own "roles" map) or executable tooling (docs/contracts/package-evidence.json's own category: "${EXECUTABLE_TOOLING_CATEGORY}").`,
    };
  }
  if (classification === "missing-manifest") {
    return {
      rule: "missing-manifest",
      role,
      message: `packages/${role}/package.json does not exist — every directory under packages/ must ship a package.json so it can be classified as a role (docs/contracts/role-loop-archetypes.json's own "roles" map) or executable tooling (docs/contracts/package-evidence.json's own category: "${EXECUTABLE_TOOLING_CATEGORY}").`,
    };
  }
  if (classification === "invalid-manifest") {
    return {
      rule: "invalid-manifest",
      role,
      message: `packages/${role}/package.json is not usable as a manifest — either it could not be read/parsed as JSON, or it parsed to something other than a plain object (null, an array, or a primitive) — every packages/* manifest must be a JSON object so it can be classified as a role (docs/contracts/role-loop-archetypes.json's own "roles" map) or executable tooling (docs/contracts/package-evidence.json's own category: "${EXECUTABLE_TOOLING_CATEGORY}").`,
    };
  }
  if (classification === "symlinked-package") {
    return {
      rule: "symlinked-package",
      role,
      message: `packages/${role} is a symlink, not a real package directory — a git-stored symlink under packages/ is itself a defect here and is never followed to see what it points at; replace it with a real directory (or remove it) so it can be classified as a role (docs/contracts/role-loop-archetypes.json's own "roles" map) or executable tooling (docs/contracts/package-evidence.json's own category: "${EXECUTABLE_TOOLING_CATEGORY}").`,
    };
  }
  return null;
}
