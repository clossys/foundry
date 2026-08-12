/**
 * Types for @vespeneventures/release. See the package README for the three
 * capabilities these shapes support — this file is deliberately just shapes,
 * no logic.
 */

import type { CatalogFinding, Finding } from "@vespeneventures/gates";

/**
 * The outcome of checking one subpath of a package's own `exports` field,
 * resolved from inside a genuinely isolated installed copy — not from this
 * package's own `node_modules`. Executable ESM targets are imported;
 * explicitly advertised CommonJS targets are required; static assets such as
 * CSS and JSONC are checked for presence without importing.
 */
export interface ImportCheck {
  /** An `exports` key from the packed package's own `package.json`, e.g. `"."` or `"./types"`. */
  subpath: string;
  /** The verification performed for this export: an ESM import, an explicitly
   * advertised CommonJS require branch, a framework-aware Next compilation,
   * or a static-file presence check. */
  mode: "import" | "require" | "next-build" | "static";
  /** `true` if this export's executable target imported, or its static target was present in the packed install. */
  ok: boolean;
  /** Present only when `ok` is `false` — a trimmed, readable summary of what failed. */
  error?: string;
}

/** The outcome of checking one declared TypeScript target. Declaration files
 * are not executable, but must still ship for the package's typed API to work. */
export interface DeclarationCheck {
  /** The export subpath whose conditions declared this target, or `"."` for a legacy top-level `types`/`typings` field. */
  subpath: string;
  /** The package-relative declaration target exactly as declared. */
  target: string;
  /** `true` when the declaration target exists inside the isolated installed tarball. */
  ok: boolean;
  /** Present only when `ok` is `false` — a trimmed, readable failure summary. */
  error?: string;
}

/**
 * What `packRoundTrip` returns: the real, observed outcome of packing a
 * package, installing the resulting tarball into an isolated directory with
 * no workspace, and checking every subpath it declares.
 */
export interface RoundTripResult {
  /**
   * `true` only when the install succeeded AND at least one export subpath
   * was actually declared AND every declared export subpath checked cleanly.
   * Executable ESM targets import, explicit CommonJS branches require,
   * configured Next exports compile in an isolated Next fixture, and
   * static/declaration targets must exist in the installed tarball. `false`
   * the moment any of those fail — either way, `findings`
   * says exactly what went wrong. A package that declares no `exports`
   * surface at all checks zero subpaths and is therefore `false`
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
  /** One entry per declared `exports` subpath. Empty if installation failed, or if no export subpath was declared at all. */
  imports: ImportCheck[];
  /** One entry per declared TypeScript target. Empty if no `types`/`typings`
   * target was declared, or if installation failed before the tarball could be inspected. */
  declarations: DeclarationCheck[];
  /**
   * `"round-trip-install-failed"`, `"round-trip-peer-install-failed"`,
   * `"round-trip-import-failed"`, `"round-trip-require-failed"`,
   * `"round-trip-asset-missing"`, `"round-trip-declaration-missing"`, or
   * `"round-trip-no-exports"` findings. Empty if and only if `ok` is
   * `true` — a round trip is only reported clean when it actually checked
   * at least one export and every one of them succeeded. An empty array
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
