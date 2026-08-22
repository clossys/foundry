// Deliberately NOT `from "./gates/index.js"`. Historically that barrel
// also re-exported secret-gates.ts, whose own top-level `import ts from
// "typescript"` would then load with it — this file is reachable from the
// package ROOT (via index.ts's `runGovernanceCheck`), so importing the
// barrel here would have meant plain `import "@vespeneventures/controller"`
// transitively loading the full TypeScript compiler for every consumer,
// regardless of whether they ever call a secret-gate function. As of this
// PR (CI failure on #419, closing the consequence of #411) the barrel no
// longer carries secret-gates.ts at all — it moved to its own subpath,
// `./gates/secrets` (see `gates/secrets.ts`) — so `./gates/index.js` is
// itself typescript-free now, and importing it here would no longer
// reintroduce the hazard this comment used to warn about. This file still
// imports the two specific functions it needs directly rather than
// widening back to the barrel: no functional reason requires it, but doing
// so keeps this entry point's import graph the minimum the root actually
// uses, and `root-entry-boundary.test.ts` asserts the root never resolves
// EITHER the barrel or `secret-gates.ts`, so this stays true either way.
// `typescript` is an OPTIONAL peer again for that reason: with the barrel
// clean, there is no longer a package-level conflict between "root stays
// free of the compiler" and "`./gates` requires it" — see
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
  const lifecycleFindings = evaluateLifecycleCoverage(
    lifecycle,
    foundation.catalog.entries.map((entry) => entry.name),
    new Map(foundation.catalog.entries.map((entry) => [entry.name, entry.version])),
  );
  const foundationHasError = foundation.findings.some((finding) => finding.severity === "error");
  return {
    foundation,
    buildOrder,
    lifecycleFindings,
    ok: foundation.complete && !foundationHasError && lifecycleFindings.length === 0 && buildOrder.ok,
  };
}
