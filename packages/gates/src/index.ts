/**
 * @vespeneventures/gates — the orchestration layer of a small foundation: it
 * depends on @vespeneventures/catalog and @vespeneventures/policy.
 *
 * `gates` orchestrates the two packages below it into single, useful
 * operations. It is NOT a rewrite of, or a wrapper around,
 * `scripts/check-public-safety.mjs` or this repository's other content-safety
 * gate scripts — those do secrets/forbidden-files/private-identity scanning
 * and belong to separate, concurrent work on this same repository. See the
 * README's "Non-goal" section; this package never touches `scripts/` and
 * never reimplements what those scripts already do.
 *
 * Three capabilities, each a thin orchestration over calls this package does
 * not own:
 *
 *   - `runFoundationCheck` — builds a catalog and evaluates it, under one
 *     name. Nothing new beyond calling `@vespeneventures/catalog`'s own
 *     `buildCatalog`/`evaluateCatalog` in sequence.
 *   - `computeBuildOrder` — a deterministic topological build order over the
 *     real internal-dependency graph, computed with Kahn's algorithm. Reuses
 *     `evaluateCatalog`'s own `dependency-cycle` detection rather than
 *     reimplementing it: a cyclic graph is reported as a failure, never sorted.
 *   - `verifyPolicyBindings` — verifies a batch of policy bindings against
 *     already-read content, using `@vespeneventures/policy`'s own
 *     `verifyBinding`, and aggregates the results by `policyId`.
 *
 * This package does zero I/O of its own: `runFoundationCheck` delegates all
 * filesystem access to `buildCatalog`; `computeBuildOrder` and
 * `verifyPolicyBindings` take already-gathered data and never touch disk.
 */

export type { FoundationReport, BuildOrderResult, PolicyCheck, PolicyCheckResult } from "./types.js";

export { runFoundationCheck } from "./foundation.js";
export { computeBuildOrder } from "./build-order.js";
export { verifyPolicyBindings } from "./policy-checks.js";

// Re-exported so a consumer of this package never needs a direct dependency
// on @vespeneventures/catalog or @vespeneventures/policy just to read the
// types these functions return.
export type { Catalog, CatalogEntry, CatalogFinding } from "@vespeneventures/catalog";
export type { Finding, PolicyBinding } from "@vespeneventures/policy";
