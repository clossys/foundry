/**
 * `preflightPackage` — one call that combines what this whole foundation
 * already knows about a package's declared shape with the real,
 * newly-proven fact of whether it actually installs and imports from
 * outside the workspace.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// Not `../gates/index.js` — see governance.ts's own import comment: that
// barrel also re-exports secret-gates.ts, whose top-level `import ts from
// "typescript"` would then ride along. This file is reachable from the
// package ROOT too (index.ts's `preflightGovernedPackage` → this file), so
// the same root-stays-typescript-free requirement applies here.
import { runFoundationCheck } from "../gates/foundation.js";
import { packRoundTrip, type PackRoundTripOptions } from "./pack-round-trip.js";
import type { PreflightReport } from "./types.js";

/** Options for `preflightPackage`. */
export interface PreflightPackageOptions {
  /** Passed straight through to `runFoundationCheck`'s own `options.scope`. */
  scope?: string;
  /** Passed straight through to the isolated packed-install proof. Use this
   * for its registry or timeout controls without weakening its environment
   * isolation. */
  roundTrip?: PackRoundTripOptions;
}

/**
 * The exact combination rule for `PreflightReport.ok`. Exported (but
 * deliberately not re-exported from `index.ts`, so it stays outside this
 * package's public surface) purely so this one boolean expression has a
 * direct, exhaustive unit test.
 *
 * That matters because at the one input this package's existing test
 * exercised end-to-end -- `hasCatalogError: false, roundTripOk: true` --
 * `!hasCatalogError && roundTripOk` collapses to `true && true`, which is
 * indistinguishable from `true || true` (a flipped `&&`/`||`) and from
 * several other single-operator mutations that also happen to land on
 * `true` for that one input. Only inputs where the two operands actually
 * disagree, or where dropping the `!` would change the answer, can catch
 * those.
 */
export function combinePreflightOk(hasCatalogError: boolean, roundTripOk: boolean): boolean {
  return !hasCatalogError && roundTripOk;
}

/**
 * Runs `runFoundationCheck(root, { scope })` (from `@vespeneventures/gates`),
 * filters its findings down to the ones attributed to the package at
 * `packageDir` (by matching `finding.package` against the `name` read from
 * `packageDir`'s own `package.json`), and calls `packRoundTrip(packageDir,
 * options.roundTrip)`.
 *
 * `ok` is `true` only when this package's own catalog findings contain no
 * `"error"`-severity entry AND the round trip itself reports `ok: true` — a
 * package can look perfectly declared and still fail this, and a package
 * that installs and imports cleanly can still fail this because its real
 * dependency graph has a problem (e.g. a dependency that doesn't resolve
 * anywhere in the workspace). Both halves have to be clean.
 */
export async function preflightPackage(
  root: string,
  packageDir: string,
  options?: PreflightPackageOptions,
): Promise<PreflightReport> {
  const absPackageDir = resolve(packageDir);
  const manifest = JSON.parse(readFileSync(join(absPackageDir, "package.json"), "utf8")) as { name: string };
  const packageName = manifest.name;

  const report = runFoundationCheck(root, { scope: options?.scope });
  const catalogFindings = report.findings.filter((finding) => finding.package === packageName);

  const roundTrip = await packRoundTrip(absPackageDir, options?.roundTrip);

  const hasCatalogError = catalogFindings.some((finding) => finding.severity === "error");
  const ok = combinePreflightOk(hasCatalogError, roundTrip.ok);

  return { packageName, catalogFindings, roundTrip, ok };
}
