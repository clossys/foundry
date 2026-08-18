/**
 * Types for @vespeneventures/gates. See the package README for the three
 * capabilities these shapes support — one call each, no logic lives here.
 */

import type { Catalog, CatalogFinding } from "../catalog/index.js";
import type { Finding, PolicyBinding } from "../policy/index.js";

/**
 * The result of `runFoundationCheck`: an already-built `Catalog` plus the
 * findings `evaluateCatalog` produced for it, under one name so a caller
 * that just wants "is this workspace's foundation sound" has exactly one
 * thing to call and one thing to inspect.
 */
export interface FoundationReport {
  /** The catalog `buildCatalog` produced for the scanned root. */
  catalog: Catalog;
  /** Everything `evaluateCatalog` found wrong with it. Empty means clean. */
  findings: CatalogFinding[];
  /**
   * `true` exactly when `catalog.skipped` is empty — i.e. `buildCatalog`
   * turned every path it looked at into a `CatalogEntry`, and this report
   * can vouch for having seen the whole tree. `false` means at least one
   * path was unreadable or unusable and is therefore NOT represented in
   * `catalog.entries`: the report is real and not wrong about what it DID
   * see, but it cannot promise there is nothing else to see.
   *
   * Exists so a caller can ask "is this report complete" with one boolean
   * read, rather than reaching into `catalog.skipped` and computing its
   * length themselves every time — the exact thing a caller has to do
   * without this field, and exactly the kind of easy-to-forget check that
   * let unreadable/unusable paths go unnoticed before `catalog.skipped`
   * existed at all. Equivalent to `catalog.skipped.length === 0`; the raw
   * array is still there, unchanged, for a caller that wants the detail.
   */
  complete: boolean;
}

/**
 * What `computeBuildOrder` returns. `ok: true` carries a build order that is
 * safe to execute left to right — every entry appears strictly after
 * everything it internally depends on, and every entry in `catalog.entries`
 * appears exactly once (see `computeBuildOrder`'s own doc comment for why
 * that invariant is asserted, not just assumed).
 *
 * `ok: false` carries whichever of `evaluateCatalog`'s own findings make a
 * valid build order impossible to compute, unchanged: `dependency-cycle`
 * (a graph that contains a cycle has no valid topological order — there is
 * nothing to attempt a sort on) and `duplicate-name` (two or more entries
 * claiming the same name make "the" entry named X ambiguous — a build order
 * naming X once cannot say which of them it means). Both are gated on
 * before any sorting is attempted, for the same reason: computing an order
 * over data already known to be unsound would either have to silently drop
 * something or fabricate an answer, and `computeBuildOrder` does neither.
 */
export type BuildOrderResult = { ok: true; order: string[] } | { ok: false; findings: CatalogFinding[] };

/**
 * One policy binding to verify, with the content it should be checked
 * against already in hand. This package does zero I/O of its own — the
 * caller has already read whatever file, secret, or generated artifact
 * `content` came from, the same discipline `catalog` and `policy` hold to.
 */
export interface PolicyCheck {
  /** Identifies this check in the aggregated result. Opaque to this package — never interpreted, only carried through. */
  policyId: string;
  /** The binding to verify `content` against. */
  binding: PolicyBinding;
  /** The materialized content to check, exactly as `verifyBinding` expects it. */
  content: string | Uint8Array;
}

/** One `PolicyCheck`'s outcome, clearly attributed to the `policyId` that produced it. */
export interface PolicyCheckResult {
  /** Echoes the `policyId` of the `PolicyCheck` this result came from. */
  policyId: string;
  /** `verifyBinding`'s findings for this check. Empty means the binding verified cleanly. */
  findings: Finding[];
}
