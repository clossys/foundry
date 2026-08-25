import { assessAdvisorEngagement } from "./assessment.js";
import { validateExecutionAuthorization } from "./authorization.js";
import type { AdvisorAssessment, AdvisorFinding, AdvisorSession, AdvisorSessionEvent, AdvisorSessionState, EngagementNextAction } from "./types.js";

function finding(rule: string, message: string): AdvisorFinding { return { rule, severity: "error", message }; }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function validAction(value: EngagementNextAction): boolean { return nonEmpty(value.kind) && nonEmpty(value.ownerRef) && nonEmpty(value.escalationRef) && nonEmpty(value.dueAt) && !Number.isNaN(Date.parse(value.dueAt)); }
function snapshotAssessmentInput(value: unknown): unknown { try { return structuredClone(value); } catch { return null; } }
function stateForAssessment(assessment: AdvisorAssessment): Exclude<AdvisorSessionState, "closed"> { switch (assessment.firstWavePlan.state) { case "not-recommended": return "not-recommended"; case "stabilize-first": return "stabilize-first"; case "ready-for-sponsor-approval": return "ready-for-sponsor-approval"; case "indeterminate": return "indeterminate"; } }

/** Starts an action-bearing detached session; it does not persist data or contact a provider. */
export function createAdvisorSession(id: string, nextAction: EngagementNextAction): AdvisorSession { if (!nonEmpty(id)) throw new Error("Advisor session id must be a non-empty string."); if (!validAction(nextAction)) throw new Error("A nonterminal Advisor session requires one valid accountable nextAction."); return { id, state: "assessing", nextAction, lastAssessmentInput: null, lastAssessment: null }; }
/** Returns a new session and findings; invalid transitions never silently advance authority. */
export function advanceAdvisorSession(session: AdvisorSession, event: AdvisorSessionEvent): { session: AdvisorSession; findings: readonly AdvisorFinding[] } {
  if (session.state !== "closed" && !validAction(session.nextAction)) return { session, findings: [finding("session-next-action", "Every nonterminal session must retain one valid accountable nextAction.")] };
  if (session.state === "closed") return { session, findings: [finding("session-closed", "A closed session cannot be advanced; start a new assessment session.")] };
  if (event.type === "close") { if (!nonEmpty(event.reason) || !Array.isArray(event.evidence) || event.evidence.length === 0 || event.evidence.some((item) => !nonEmpty(item.id) || !nonEmpty(item.description))) return { session, findings: [finding("session-closure", "Closure requires an explicit reason and evidence.")] }; return { session: { id: session.id, state: "closed", lastAssessmentInput: session.lastAssessmentInput, lastAssessment: session.lastAssessment, closure: { reason: event.reason, evidence: event.evidence } }, findings: [] }; }
  if (!validAction(event.nextAction)) return { session, findings: [finding("session-next-action", "Every nonterminal transition requires one valid accountable nextAction.")] };
  if (event.type === "assessment-recorded") { const assessmentInput = snapshotAssessmentInput(event.assessmentInput); const assessment = assessAdvisorEngagement(assessmentInput); return { session: { ...session, state: stateForAssessment(assessment), lastAssessmentInput: assessmentInput, lastAssessment: assessment, nextAction: event.nextAction }, findings: assessment.findings }; }
  if (event.type === "reassess") return { session: { ...session, state: "assessing", lastAssessmentInput: null, lastAssessment: null, nextAction: event.nextAction }, findings: [] };
  const assessmentInput = snapshotAssessmentInput(session.lastAssessmentInput); const assessment = assessAdvisorEngagement(assessmentInput);
  if (session.state !== "ready-for-sponsor-approval" || assessment.preWork.state !== "satisfied" || assessment.firstWavePlan.state !== "ready-for-sponsor-approval") return { session, findings: [finding("execution-not-ready", "Sponsor approval cannot create execution readiness until current evidence derives satisfied pre-work and a ready first-wave plan.")] };
  const findings = validateExecutionAuthorization(event.authorization, assessment, event.asOf);
  if (findings.length > 0) return { session, findings };
  return { session: { ...session, state: "ready-for-execution", lastAssessmentInput: assessmentInput, lastAssessment: assessment, nextAction: event.nextAction }, findings: [] };
}
