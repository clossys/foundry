// dependency-range-sections — the one place that names which package.json
// sections carry a first-party dependency RANGE that must stay satisfiable
// by a sibling workspace package's real, on-disk version (issue #1340).
//
// WHY THIS IS SHARED
// -------------------
// apply-release-changesets.mjs's sibling-range rewriter and
// check-workspace-links.mjs's range-satisfaction gate both need to agree,
// byte for byte, on which sections count. Before this module existed each
// wrote its own list by hand: the rewriter scanned three sections
// (dependencies, peerDependencies, optionalDependencies) while the gate
// scanned only one (dependencies) — see issue #1340. A stale peer or
// optional range introduced by any OTHER path (a hand-edited manifest, or a
// future script that only bumps one sibling) had nothing checking it, and
// `npm run check` stayed green over it. Importing from one file instead of
// restating the list in two is what keeps that from happening again.
//
// devDependencies is deliberately NOT in this list — see
// DEV_DEPENDENCY_RANGE_SECTIONS below and apply-release-changesets.mjs's own
// header ("devDependencies IS SCANNED AND REWRITTEN TOO...") for the fuller
// argument. In short: a dev-only range is scanned by the identical rule but
// kept in a separate list, because it never affects what an external
// consumer (or a sibling workspace package) resolves — it is not part of
// "every first-party dependency range" either module's own success message
// promises.
export const DEPENDENCY_RANGE_SECTIONS = Object.freeze(["dependencies", "peerDependencies", "optionalDependencies"]);

// devDependencies ALONE — scanned and rewritten by the identical rule as
// DEPENDENCY_RANGE_SECTIONS in apply-release-changesets.mjs, but never by
// itself the reason a package gets a dependent-only version bump there, and
// deliberately out of scope for check-workspace-links.mjs's own
// range-satisfaction gate (see issue #1340's suggested fix, which asks for
// exactly the three DEPENDENCY_RANGE_SECTIONS above, not this one).
export const DEV_DEPENDENCY_RANGE_SECTIONS = Object.freeze(["devDependencies"]);
