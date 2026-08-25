import type { AdvisorAssessment, AdvisorFinding, AdvisorSession, AdvisorSessionEvent, AdvisorSessionState, AssessmentBasis, EngagementNextAction, ExecutionAuthorization, FirstWaveWorkItem, ImmutablePackageRef } from "./types.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BASIS_FIELDS = ["snapshotDigest", "grantDigest", "catalogDigest", "planDigest", "blockerDigest", "clearanceDigest", "conflictDigest", "baselineDigest", "completionDefinitionDigest", "assessedAt", "freshUntil"] as const;
function finding(rule: string, message: string): AdvisorFinding { return { rule, severity: "error", message }; }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function validAction(value: EngagementNextAction): boolean { return nonEmpty(value.kind) && nonEmpty(value.ownerRef) && nonEmpty(value.escalationRef) && nonEmpty(value.dueAt) && !Number.isNaN(Date.parse(value.dueAt)); }
function sameBasis(left: AssessmentBasis, right: AssessmentBasis): boolean { return BASIS_FIELDS.every((field) => left[field] === right[field]); }
function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]); }
function packageKey(item: ImmutablePackageRef): string { return `${item.name}@${item.version}#${item.integrity}`; }
function authorizationFindings(authorization: ExecutionAuthorization, assessment: AdvisorAssessment, asOf: string): AdvisorFinding[] {
  const findings: AdvisorFinding[] = []; const plan = assessment.firstWavePlan; const basis = plan.basis;
  if (basis === null || authorization.planDigest !== basis.planDigest || !sameBasis(authorization.assessmentBasis, basis)) findings.push(finding("execution-authorization-basis", "Authorization must bind the exact current plan digest and assessment basis."));
  if (!nonEmpty(authorization.sponsorRef) || ["advisor", "@vespeneventures/advisor"].includes(authorization.sponsorRef.toLowerCase())) findings.push(finding("execution-authorization-sponsor", "Authorization must name an accountable sponsor other than Advisor."));
  const grantedAt = Date.parse(authorization.grantedAt); const expiresAt = Date.parse(authorization.expiresAt); const current = Date.parse(asOf); const assessedAt = basis === null ? Number.NaN : Date.parse(basis.assessedAt); const freshUntil = basis === null ? Number.NaN : Date.parse(basis.freshUntil);
  if ([grantedAt, expiresAt, current, assessedAt, freshUntil].some(Number.isNaN) || grantedAt < assessedAt || current < grantedAt || current >= expiresAt || expiresAt > freshUntil || current >= freshUntil) findings.push(finding("execution-authorization-expiry", "Authorization must be granted within, current during, and expire no later than the assessment basis freshness window."));
  const expectedRepos = [...new Set(plan.workItems.map((item) => item.targetRepositoryId))]; const expectedPackages = [...new Set(plan.workItems.map((item) => packageKey(item.package)))]; const expectedMutations = [...new Set(plan.workItems.flatMap((item) => item.mutationSurfaces))];
  if (!Array.isArray(authorization.permittedRepositoryIds) || !sameStrings(authorization.permittedRepositoryIds, expectedRepos)) findings.push(finding("execution-authorization-repositories", "Authorization repositories must exactly equal the approved work-item repositories."));
  if (!Array.isArray(authorization.permittedPackages) || !sameStrings(authorization.permittedPackages.map(packageKey), expectedPackages)) findings.push(finding("execution-authorization-packages", "Authorization packages must exactly equal immutable approved package references."));
  if (!Array.isArray(authorization.permittedMutationSurfaces) || !sameStrings(authorization.permittedMutationSurfaces, expectedMutations)) findings.push(finding("execution-authorization-mutations", "Authorization mutation surfaces must exactly equal approved work-item mutation surfaces."));
  return findings;
}
function stateForAssessment(assessment: AdvisorAssessment): Exclude<AdvisorSessionState, "closed"> { switch (assessment.firstWavePlan.state) { case "not-recommended": return "not-recommended"; case "stabilize-first": return "stabilize-first"; case "ready-for-sponsor-approval": return "ready-for-sponsor-approval"; case "indeterminate": return "indeterminate"; } }

/** Starts an action-bearing detached session; it does not persist data or contact a provider. */
export function createAdvisorSession(id: string, nextAction: EngagementNextAction): AdvisorSession { if (!nonEmpty(id)) throw new Error("Advisor session id must be a non-empty string."); if (!validAction(nextAction)) throw new Error("A nonterminal Advisor session requires one valid accountable nextAction."); return { id, state: "assessing", nextAction, lastAssessment: null }; }
/** Returns a new session and findings; invalid transitions never silently advance authority. */
export function advanceAdvisorSession(session: AdvisorSession, event: AdvisorSessionEvent): { session: AdvisorSession; findings: readonly AdvisorFinding[] } {
  if (session.state !== "closed" && !validAction(session.nextAction)) return { session, findings: [finding("session-next-action", "Every nonterminal session must retain one valid accountable nextAction.")] };
  if (event.type === "close") { if (!nonEmpty(event.reason) || !Array.isArray(event.evidence) || event.evidence.length === 0 || event.evidence.some((item) => !nonEmpty(item.id) || !nonEmpty(item.description))) return { session, findings: [finding("session-closure", "Closure requires an explicit reason and evidence.")] }; return { session: { id: session.id, state: "closed", lastAssessment: session.lastAssessment, closure: { reason: event.reason, evidence: event.evidence } }, findings: [] }; }
  if (session.state === "closed") return { session, findings: [finding("session-closed", "A closed session cannot be advanced; start a new assessment session.")] };
  if (!validAction(event.nextAction)) return { session, findings: [finding("session-next-action", "Every nonterminal transition requires one valid accountable nextAction.")] };
  if (event.type === "assessment-recorded") return { session: { ...session, state: stateForAssessment(event.assessment), lastAssessment: event.assessment, nextAction: event.nextAction }, findings: [] };
  if (event.type === "reassess") return { session: { ...session, state: "assessing", nextAction: event.nextAction }, findings: [] };
  const assessment = session.lastAssessment;
  if (session.state !== "ready-for-sponsor-approval" || assessment === null || assessment.preWork.state !== "satisfied" || assessment.firstWavePlan.state !== "ready-for-sponsor-approval") return { session, findings: [finding("execution-not-ready", "Sponsor approval cannot create execution readiness until current pre-work is satisfied.")] };
  const findings = authorizationFindings(event.authorization, assessment, event.asOf);
  if (findings.length > 0) return { session, findings };
  return { session: { ...session, state: "ready-for-execution", nextAction: event.nextAction }, findings: [] };
}
