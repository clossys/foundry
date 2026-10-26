import { OBSERVATIONS_UNAVAILABLE } from "../catalog-core/check-components.js";

/**
 * Component check codes the checker raises for a fill whose source and runtime observations
 * were never supplied: statically eligible, not yet runtime-qualified. The checker
 * (check-components.ts) stays the sole authority; this list only classifies its output for display.
 */
export const RUNTIME_PENDING_CODES = ["K2", "K4", "K5", "K6", "K7", "K10", "K12"] as const;

const PENDING = new Set<string>(RUNTIME_PENDING_CODES);

/** Minimal finding shape shared by component, value and composite checks. */
export interface ClassifiedFinding { code: string; severity: string; message: string }

/**
 * A pending code on an unqualified fill: the checker's own "observations unavailable" finding.
 * The same code with any other message comes from supplied observations (a fill claimed
 * qualified) and stays a real error.
 */
export function isRuntimePending(finding: ClassifiedFinding): boolean {
  return finding.severity === "error" && PENDING.has(finding.code)
    && (finding.message === OBSERVATIONS_UNAVAILABLE || finding.message.endsWith(`: ${OBSERVATIONS_UNAVAILABLE}`));
}

/** Errors, notices and runtime-pending counts; a pending finding never counts as an error. */
export function checkCounts(findings: readonly ClassifiedFinding[]): { errors: number; notices: number; pending: number } {
  let errors = 0, notices = 0, pending = 0;
  for (const finding of findings) {
    if (isRuntimePending(finding)) pending++;
    else if (finding.severity === "error") errors++;
    else if (finding.severity === "notice") notices++;
  }
  return { errors, notices, pending };
}
