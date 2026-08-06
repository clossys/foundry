/**
 * Types for @vespeneventures/release. See the package README for the three
 * capabilities these shapes support — this file is deliberately just shapes,
 * no logic.
 */

import type { CatalogFinding, Finding } from "@vespeneventures/gates";

/**
 * The outcome of trying to `import` one subpath of a package's own `exports`
 * field, resolved from inside a genuinely isolated installed copy — not from
 * this package's own `node_modules`.
 */
export interface ImportCheck {
  /** An `exports` key from the packed package's own `package.json`, e.g. `"."` or `"./types"`. */
  subpath: string;
  /** `true` if `import(...)` of this subpath resolved and evaluated without throwing. */
  ok: boolean;
  /** Present only when `ok` is `false` — a trimmed, readable summary of what failed. */
  error?: string;
}

/**
 * What `packRoundTrip` returns: the real, observed outcome of packing a
 * package, installing the resulting tarball into an isolated directory with
 * no workspace, and attempting to import every subpath it declares.
 */
export interface RoundTripResult {
  /**
   * `true` only when the install succeeded AND at least one export subpath
   * was actually declared AND every declared export subpath imported
   * cleanly. `false` the moment any of those fail — either way, `findings`
   * says exactly what went wrong. A package that declares no importable
   * `exports` surface at all checks zero imports and is therefore `false`
   * too: checking nothing is not proof of anything, so it can never be
   * reported as a pass.
   */
  ok: boolean;
  /**
   * The `name` field from the packed package's own `package.json` —
   * `undefined` if the manifest has none. npm itself refuses to pack a
   * manifest with no `name` (see `findings` in that case), so `undefined`
   * only ever appears together with a `"round-trip-install-failed"`
   * finding, never on an `ok: true` result.
   */
  packageName: string | undefined;
  /**
   * Absolute path to the packed tarball, inside a temporary directory that
   * is removed once `packRoundTrip` returns (unless `keepTempDir` was
   * passed). Empty string if packing itself never produced a tarball.
   */
  tarballPath: string;
  /** One entry per declared `exports` subpath. Empty if the install itself failed, or if the package declared no importable subpath at all — either way, there was nothing to import. */
  imports: ImportCheck[];
  /**
   * `"round-trip-install-failed"`, `"round-trip-import-failed"`, or
   * `"round-trip-no-exports"` findings. Empty if and only if `ok` is
   * `true` — a round trip is only reported clean when it actually checked
   * at least one import and every one of them succeeded. An empty array
   * here is never produced by a round trip that checked zero subpaths;
   * that case always carries a `"round-trip-no-exports"` finding instead.
   */
  findings: Finding[];
}

/** What `preflightPackage` returns: this package's own catalog findings plus a real round-trip proof, aggregated. */
export interface PreflightReport {
  /** The `name` field read from `packageDir`'s own `package.json`. */
  packageName: string;
  /**
   * This package's own entries from `runFoundationCheck(root, { scope })`'s
   * findings — filtered to `finding.package === packageName`. Everything
   * `catalog` found wrong with this package's real dependency graph, and
   * nothing about any other package in the workspace.
   */
  catalogFindings: CatalogFinding[];
  /** The real `packRoundTrip` result for `packageDir`. */
  roundTrip: RoundTripResult;
  /** `true` only if `catalogFindings` has no `"error"`-severity entry AND `roundTrip.ok` is `true`. */
  ok: boolean;
}
