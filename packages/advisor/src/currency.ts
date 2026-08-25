import { assessAdvisorEngagement } from "./assessment.js";
import { validateExecutionAuthorization } from "./session.js";
import type { AdvisorFinding, AssessmentBasis, EngagementActionDisposition, EngagementDecisionCurrencyAssessment, EngagementDecisionCurrencyInput, EngagementRecord } from "./types.js";

const BASIS_FIELDS = ["snapshotDigest", "grantDigest", "catalogDigest", "planDigest", "blockerDigest", "clearanceDigest", "conflictDigest", "baselineDigest", "completionDefinitionDigest", "assessedAt", "freshUntil"] as const;
function equalBasis(left: AssessmentBasis, right: AssessmentBasis): boolean { return BASIS_FIELDS.every((field) => left[field] === right[field]); }
function finding(rule: string, message: string, path?: string): AdvisorFinding { return { rule, severity: "warning", message, path }; }

/**
 * Measures the Advisor's primary metric: active engagements whose decision
 * basis, accountable next action, freshness, and execution authorization (if
 * execution has been authorized) are all current, divided by active
 * engagements evaluated. Zero active engagements is indeterminate, never 1.
 */
export function assessEngagementDecisionCurrency(input: EngagementDecisionCurrencyInput): EngagementDecisionCurrencyAssessment {
  const active = input.engagements.filter((engagement) => engagement.status === "active");
  if (active.length === 0) return { state: "indeterminate", activeEngagements: 0, currentEngagements: 0, rate: null, findings: [finding("active-engagements-required", "No active engagements are available for the decision-currency metric.")] };
  const assessments = input.assessmentInputs.map(assessAdvisorEngagement);
  const findings: AdvisorFinding[] = [];
  const asOf = Date.parse(input.asOf);
  let current = 0;
  for (const engagement of active) {
    const assessment = assessments.find((entry) => entry.firstWavePlan.basis !== null && entry.firstWavePlan.basis.planDigest === engagement.assessmentBasis.planDigest && equalBasis(entry.firstWavePlan.basis as AssessmentBasis, engagement.assessmentBasis));
    const elapsed = input.elapsedDaysByEngagement[engagement.id];
    let valid = true;
    if (Number.isNaN(asOf)) { findings.push(finding("currency-as-of", "A valid asOf timestamp is required to measure decision currency.", engagement.id)); valid = false; }
    if (assessment === undefined) { findings.push(finding("assessment-basis-current", "No assessment is bound to this engagement's exact current basis.", engagement.id)); valid = false; }
    if (!engagement.nextAction.kind || !engagement.nextAction.ownerRef || !engagement.nextAction.dueAt || !engagement.nextAction.escalationRef) { findings.push(finding("next-action-current", "An active engagement must retain one accountable, due, and escalatable next action.", engagement.id)); valid = false; }
    else if (!Number.isNaN(asOf) && (Number.isNaN(Date.parse(engagement.nextAction.dueAt)) || asOf >= Date.parse(engagement.nextAction.dueAt))) { findings.push(finding("next-action-overdue", "The current next action is due and must be escalated or replaced.", engagement.id)); valid = false; }
    if (!Number.isNaN(asOf) && (asOf < Date.parse(engagement.assessmentBasis.assessedAt) || asOf >= Date.parse(engagement.assessmentBasis.freshUntil))) { findings.push(finding("assessment-basis-stale", "The assessment basis is outside its explicit freshness window.", engagement.id)); valid = false; }
    if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < 0) { findings.push(finding("assessment-age", "Assessment age is missing or invalid; reassessment is required.", engagement.id)); valid = false; }
    else if (assessment !== undefined && elapsed >= (assessment.reassessment?.cadenceDays ?? 0)) { findings.push(finding("assessment-stale", "Assessment has reached its reassessment cadence and must be escalated or reassessed.", engagement.id)); valid = false; }
    if (engagement.executionAuthorization !== undefined) {
      if (assessment === undefined) { findings.push(finding("execution-authorization-basis", "Execution authorization is not bound to the exact current ready plan and assessment basis.", engagement.id)); valid = false; }
      else { const authorizationFindings = validateExecutionAuthorization(engagement.executionAuthorization, assessment, input.asOf); if (authorizationFindings.length > 0) { findings.push(...authorizationFindings.map((entry) => ({ ...entry, path: engagement.id }))); valid = false; } }
    }
    if (valid) current++;
  }
  const rate = current / active.length;
  return { state: current === active.length ? "satisfied" : "violated", activeEngagements: active.length, currentEngagements: current, rate, findings };
}

/**
 * Resolves an action deadline without performing a notification. A caller must
 * turn `reassess-required` into its own escalation or reassessment workflow.
 */
export function resolveEngagementActionDisposition(engagement: EngagementRecord, now: string): EngagementActionDisposition {
  if (engagement.status === "closed") return "closed";
  const current = Date.parse(now);
  const due = Date.parse(engagement.nextAction.dueAt);
  if (Number.isNaN(current) || Number.isNaN(due) || current >= due) return "reassess-required";
  return "current";
}
