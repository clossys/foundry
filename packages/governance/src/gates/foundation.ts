/**
 * `runFoundationCheck` — orchestrated validation. Nothing new beyond calling
 * `@vespeneventures/catalog`'s own `buildCatalog` and `evaluateCatalog` in
 * sequence and returning the result under one name, but it is the thing a
 * consumer of this whole foundation actually wants to call: one function,
 * one root path in, one report out.
 */

import { isAbsolute } from "node:path";
import { buildCatalog, evaluateCatalog } from "../catalog/index.js";
import type { CatalogOptions } from "../catalog/index.js";
import type { FoundationReport } from "./types.js";

/**
 * Options for `runFoundationCheck`. Extends `CatalogOptions` (from
 * `@vespeneventures/catalog`) rather than redeclaring `packagesDir` and
 * `maxDepth` by hand — this repository's convention is to export a
 * definition once and reuse it, not restate it. `packagesDir` and
 * `maxDepth` are passed straight through to `buildCatalog`.
 */
export interface RunFoundationCheckOptions extends CatalogOptions {
  /**
   * Passed straight through to `evaluateCatalog` as `options.scope`, which
   * uses it to decide which of an entry's real `dependencies`/
   * `peerDependencies` count as internal to this catalog — see
   * `@vespeneventures/catalog`'s `internal-dep-missing` and
   * `dependency-cycle` rules.
   */
  scope?: string;
}

/**
 * Builds the catalog rooted at `root` and evaluates it, in one call.
 * `root` is passed straight to `buildCatalog` — this function does no
 * filesystem work of its own beyond what `buildCatalog` already does.
 * `options.packagesDir` and `options.maxDepth` are passed straight through
 * to `buildCatalog`; `options.scope` is passed straight through to
 * `evaluateCatalog`.
 *
 * `options.packagesDir` must be relative to `root`. `buildCatalog` resolves
 * it via `path.resolve(root, packagesDir)`, which — like `path.resolve`
 * anywhere — discards `root` entirely when `packagesDir` is itself absolute,
 * silently scanning (and reporting on) whatever tree the absolute path
 * points at instead. This function rejects that case up front, before ever
 * calling `buildCatalog`, rather than letting a caller's typo turn into a
 * report about the wrong directory with nothing in the output revealing it.
 * Throws a plain `Error`, not a `CatalogSkip` or a finding: this is a
 * caller-input problem, not something the catalog gathered or judged, the
 * same category `foundry-check`'s own CLI-argument validation already
 * treats as a hard, upfront rejection rather than a soft finding.
 */
export function runFoundationCheck(root: string, options?: RunFoundationCheckOptions): FoundationReport {
  if (options?.packagesDir !== undefined && isAbsolute(options.packagesDir)) {
    throw new Error(
      `runFoundationCheck: options.packagesDir must be relative to root, got an absolute path "${options.packagesDir}"`,
    );
  }

  const catalog = buildCatalog(root, options);
  const findings = evaluateCatalog(catalog, { scope: options?.scope });
  return { catalog, findings, complete: (catalog.skipped ?? []).length === 0 };
}
