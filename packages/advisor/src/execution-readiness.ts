import { assessAdvisorEngagement } from "./assessment.js";
import { validateExecutionAuthorization, validateExecutionAuthorizationShape } from "./authorization.js";
import type { AdvisorAssessment, AdvisorFinding, AdvisorState } from "./types.js";

type UnknownRecord = Record<string, unknown>;

/** The execution decision derived from evidence at a runner-supplied instant. */
export interface AdvisorExecutionReadiness {
  state: AdvisorState;
  assessment: AdvisorAssessment | null;
  findings: readonly AdvisorFinding[];
}

function finding(rule: string, message: string): AdvisorFinding { return { rule, severity: "error", message }; }
function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function timestamp(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function result(state: AdvisorState, assessment: AdvisorAssessment | null, findings: readonly AdvisorFinding[]): AdvisorExecutionReadiness { return { state, assessment, findings }; }
function malformedAuthorizationWindow(value: unknown): boolean {
  if (!record(value)) return false;
  const grantedAt = Date.parse(value.grantedAt as string); const expiresAt = Date.parse(value.expiresAt as string);
  return Number.isNaN(grantedAt) || Number.isNaN(expiresAt) || expiresAt <= grantedAt;
}

/**
 * Re-derives the execution decision at `currentAsOf`. The evidence owner's
 * `asOf` is deliberately replaced: it is assessment metadata, not a clock the
 * execution runner may trust.
 */
export function assessAdvisorExecutionReadiness(value: unknown, currentAsOf: string): AdvisorExecutionReadiness {
  if (!timestamp(currentAsOf)) return result("indeterminate", null, [finding("execution-readiness-as-of", "Runner-supplied currentAsOf must be an interpretable timestamp.")]);
  if (!record(value) || !record(value.engagement)) return result("indeterminate", null, [finding("assessment-shape", "Assessment evidence must contain an engagement object.")]);

  const authorization = value.engagement.executionAuthorization;
  const { executionAuthorization: _ignored, ...engagement } = value.engagement;
  const assessment = assessAdvisorEngagement({ ...value, asOf: currentAsOf, engagement });

  if (assessment.state === "indeterminate") {
    const staleBasisOnly = assessment.findings.length > 0 && assessment.findings.every((entry) => entry.rule === "assessment-basis-stale");
    return result(staleBasisOnly ? "violated" : "indeterminate", assessment, assessment.findings);
  }
  if (assessment.state === "violated") return result("violated", assessment, [...assessment.findings, finding("execution-authorization-readiness", "Execution requires a derived plan whose pre-work is satisfied and ready for sponsor approval.")]);
  if (authorization === undefined) return result("violated", assessment, [finding("execution-authorization-required", "Execution requires a current executionAuthorization.")]);

  const shapeFindings = validateExecutionAuthorizationShape(authorization, currentAsOf);
  const timeFindings = new Set(["execution-authorization-basis-stale", "execution-authorization-expiry"]);
  if (malformedAuthorizationWindow(authorization) || shapeFindings.some((entry) => !timeFindings.has(entry.rule))) return result("indeterminate", assessment, shapeFindings);
  if (shapeFindings.length > 0) return result("violated", assessment, shapeFindings);

  const authorizationFindings = validateExecutionAuthorization(authorization, assessment, currentAsOf);
  return result(authorizationFindings.length === 0 ? "satisfied" : "violated", assessment, authorizationFindings);
}
