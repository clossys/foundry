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

/**
 * The always-on finding for a package that classified as "unclassified",
 * "both", or "invalid-name" -- a defect the gates report in every mode,
 * never only under --enforce, because a classification gap is not an
 * adoption gap. Returns null for "role" and "tooling", which are not
 * findings. For "invalid-name", `role` is the package's directory name
 * (there is no manifest name to use), passed by the caller as the only
 * identity available.
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
  return null;
}
