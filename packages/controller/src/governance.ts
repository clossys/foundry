// Deliberately NOT `from "./gates/index.js"` — that barrel also re-exports
// secret-gates.ts, whose own top-level `import ts from "typescript"` would
// then load with it. This file is reachable from the package ROOT (via
// index.ts's `runGovernanceCheck`), so importing the barrel here would
// mean plain `import "@vespeneventures/controller"` transitively loads the
// full TypeScript compiler for every consumer, regardless of whether they
// ever call a secret-gate function. Importing these two functions from
// their own files instead keeps the root import graph free of `typescript`
// — the public `./gates` subpath itself is unaffected; a consumer who
// deliberately imports THAT still gets everything, secret-gates included.
// `typescript` is a REQUIRED peer for that reason (#411): `peerDependencies`
// is package-level, not per-subpath, so there is no way to keep it optional
// for `./gates` while this file keeps it out of the root — see
// `secret-gates.ts`'s own header for the full reasoning.
import { computeBuildOrder } from "./gates/build-order.js";
import { runFoundationCheck } from "./gates/foundation.js";
import type { RunFoundationCheckOptions } from "./gates/foundation.js";
import { evaluateLifecycleCoverage } from "./lifecycle.js";
import type { GovernanceReport } from "./types.js";

/**
 * Composes the existing foundation check and build-order computation with a
 * complete lifecycle registry. It does not discover packages independently,
 * execute commands, write files, or contact a registry.
 */
export function runGovernanceCheck(
  root: string,
  lifecycle: unknown,
  options?: RunFoundationCheckOptions,
): GovernanceReport {
  const foundation = runFoundationCheck(root, options);
  const buildOrder = computeBuildOrder(foundation.catalog, { scope: options?.scope });
  const lifecycleFindings = evaluateLifecycleCoverage(lifecycle, foundation.catalog.entries.map((entry) => entry.name));
  const foundationHasError = foundation.findings.some((finding) => finding.severity === "error");
  return {
    foundation,
    buildOrder,
    lifecycleFindings,
    ok: foundation.complete && !foundationHasError && lifecycleFindings.length === 0 && buildOrder.ok,
  };
}
