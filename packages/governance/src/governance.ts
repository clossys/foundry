import { computeBuildOrder, runFoundationCheck } from "@vespeneventures/gates";
import type { RunFoundationCheckOptions } from "@vespeneventures/gates";
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
