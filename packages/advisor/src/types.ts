/** Exact three-state vocabulary used by every evidence-derived Advisor result. */
export type AdvisorState = "satisfied" | "violated" | "indeterminate";
export type FindingSeverity = "error" | "warning";
export interface AdvisorCharter { primaryMode: "reconcile"; secondaryMode: "interact"; assurance: "justified-evidence-only"; primaryMetric: "engagement-decision-currency-rate"; metricDirection: "increase"; }
export interface AdvisorFinding { rule: string; severity: FindingSeverity; message: string; path?: string; }
/** A value-free pointer to evidence held by the consumer. */
export interface EvidenceReference { id: string; description: string; }
export interface CriterionDefinition { id: string; prompt: string; }

export type RequiredFitCriterionId = "sponsor-mandate" | "material-need" | "offering-operating-compatibility" | "expected-value-burden" | "adoption-capacity" | "legal-ethical-safety";
export type RequiredReadinessCriterionId = "scope-repository-inventory" | "read-access" | "authority-approval" | "initiative-mutation-dependency-inventory" | "immutable-artifact-access" | "baseline" | "independent-outcome-owner" | "rollback-review-window";
export type SignalState = "supported" | "contradicted" | "unknown";
export interface FitSignal { id: RequiredFitCriterionId; state: SignalState; evidence: readonly EvidenceReference[]; }
export type ReadinessState = "satisfied" | "violated" | "unknown";
/** Evidence from which readiness is derived; callers cannot set readiness directly. */
export interface ReadinessCriterion { id: RequiredReadinessCriterionId; state: ReadinessState; evidence: readonly EvidenceReference[]; }

export type InitiativeStatus = "candidate" | "active" | "completed";
/** Every conflict surface is explicit so the engine can reconcile, not guess. */
export interface Initiative {
  id: string;
  status: InitiativeStatus;
  targetRepositoryIds: readonly string[];
  workstreamConflictKeys: readonly string[];
  dependencyConflictKeys: readonly string[];
  mutationConflictKeys: readonly string[];
  authorityConflictKeys: readonly string[];
  scheduleConflictKeys: readonly string[];
  dataOutcomeMetricConflictKeys: readonly string[];
}

export type PreWorkKind = "baseline" | "conflict" | "prerequisite" | "authority" | "artifact-access" | "mutation-conflict" | "independent-outcome";
export type PreWorkStatus = "satisfied" | "unresolved" | "indeterminate";
export interface EngagementNextAction { kind: string; ownerRef: string; dueAt: string; escalationRef: string; }
export interface AuthorityClearance { authorityOwnerRef: string; evidence: readonly EvidenceReference[]; }
/** A first-class prerequisite or conflict record, including the route to clear it. */
export interface PreWorkItem {
  id: string;
  kind: PreWorkKind;
  status: PreWorkStatus;
  addressesReadinessCriteria: readonly RequiredReadinessCriterionId[];
  targetRepositoryIds: readonly string[];
  ownerRef: string;
  impact: string;
  evidence: readonly EvidenceReference[];
  nextAction: EngagementNextAction;
  dependencySurfaces: readonly string[];
  mutationSurfaces: readonly string[];
  /** Exact initiative pair when this item owns a derived overlap. */
  initiativeOverlapIds?: readonly string[];
  clearance?: AuthorityClearance;
}

/** Opaque, content-addressed references used to bind a decision to exact material. */
export interface AssessmentBasis { snapshotDigest: string; grantDigest: string; catalogDigest: string; planDigest: string; blockerDigest: string; clearanceDigest: string; conflictDigest: string; baselineDigest: string; completionDefinitionDigest: string; assessedAt: string; freshUntil: string; }
export type EngagementStatus = "active" | "closed";
interface EngagementRecordBase { id: string; assessmentBasis: AssessmentBasis; executionAuthorization?: ExecutionAuthorization; }
export type EngagementRecord = (EngagementRecordBase & { status: "active"; nextAction: EngagementNextAction }) | (EngagementRecordBase & { status: "closed"; nextAction?: never });
export type EngagementActionDisposition = "current" | "reassess-required" | "closed";

export type ReassessmentTrigger = "scope-change" | "evidence-change" | "initiative-change" | "readiness-change" | "sponsor-request";
export interface ReassessmentPolicy { cadenceDays: number; triggers: readonly ReassessmentTrigger[]; }
export interface ImmutablePackageRef { name: string; version: string; integrity: string; }
export interface CompletionDefinition { definition: string; independentOutcomeOwnerRef: string; evidenceSource: string; direction: "increase" | "decrease"; setpoint: number; windowDays: number; }
export interface RollbackDefinition { procedure: string; evidenceSource: string; }
export interface BaselineDefinition { metricRef: string; value: number; observedAt: string; evidence: EvidenceReference; }
/** Exact execution material for one repo/initiative pair in the first wave. */
export interface FirstWaveWorkItem { id: string; initiativeId: string; targetRepositoryId: string; deliveryOwnerRef: string; package: ImmutablePackageRef; bin: string; invocation: string; placement: string; baseline: BaselineDefinition; completion: CompletionDefinition; rollback: RollbackDefinition; mutationSurfaces: readonly string[]; }
export interface FirstWaveDefinition { initiativeIds: readonly string[]; objectives: readonly string[]; workItems: readonly FirstWaveWorkItem[]; }

/** All material entered by a connector or other caller; it is not provider-specific. */
export interface AdvisorAssessmentInput { id: string; asOf: string; engagement: EngagementRecord; fitSignals: readonly FitSignal[]; prerequisiteObservations: readonly ReadinessCriterion[]; initiatives: readonly Initiative[]; firstWave: FirstWaveDefinition; preWorkItems: readonly PreWorkItem[]; reassessment: ReassessmentPolicy; }
export interface AdvisorComponentAssessment { state: AdvisorState; findings: readonly AdvisorFinding[]; }
export interface InitiativeOverlap { first: string; second: string; workstreamConflictKeys: readonly string[]; dependencyConflictKeys: readonly string[]; mutationConflictKeys: readonly string[]; authorityConflictKeys: readonly string[]; scheduleConflictKeys: readonly string[]; dataOutcomeMetricConflictKeys: readonly string[]; }
export type FirstWavePlanState = "not-recommended" | "stabilize-first" | "indeterminate" | "ready-for-sponsor-approval";
export interface FirstWavePlanStep { id: string; kind: "stabilize" | "authorize-initiative" | "authorize-execution"; initiativeId?: string; prerequisiteIds: readonly string[]; blockedBy: readonly string[]; nextAction?: EngagementNextAction; }
export interface FirstWavePlan { state: FirstWavePlanState; basis: AssessmentBasis | null; prerequisiteIds: readonly string[]; workItems: readonly FirstWaveWorkItem[]; steps: readonly FirstWavePlanStep[]; }
export interface AdvisorAssessment { state: AdvisorState; fit: AdvisorComponentAssessment; readiness: AdvisorComponentAssessment; initiativeOverlap: AdvisorComponentAssessment & { overlaps: readonly InitiativeOverlap[] }; preWork: AdvisorComponentAssessment; blockers: readonly PreWorkItem[]; firstWavePlan: FirstWavePlan; reassessment: ReassessmentPolicy | null; findings: readonly AdvisorFinding[]; }

export type AdvisorSessionState = "assessing" | "stabilize-first" | "ready-for-sponsor-approval" | "ready-for-execution" | "closed" | "not-recommended" | "indeterminate";
export interface SessionClosure { reason: string; evidence: readonly EvidenceReference[]; }
export type AdvisorSession = | { id: string; state: Exclude<AdvisorSessionState, "closed">; nextAction: EngagementNextAction; lastAssessmentInput: unknown | null; lastAssessment: AdvisorAssessment | null; closure?: never } | { id: string; state: "closed"; lastAssessmentInput: unknown | null; lastAssessment: AdvisorAssessment | null; closure: SessionClosure; nextAction?: never };
/** A caller-owned authorization bound to the exact plan, basis, sponsor, and permitted mutation scope. */
export interface ExecutionAuthorization { planDigest: string; assessmentBasis: AssessmentBasis; sponsorRef: string; permittedRepositoryIds: readonly string[]; permittedPackages: readonly ImmutablePackageRef[]; permittedMutationSurfaces: readonly string[]; grantedAt: string; expiresAt: string; }
export type AdvisorSessionEvent = | { type: "assessment-recorded"; assessmentInput: unknown; nextAction: EngagementNextAction } | { type: "sponsor-approved"; authorization: ExecutionAuthorization; asOf: string; nextAction: EngagementNextAction } | { type: "reassess"; nextAction: EngagementNextAction } | { type: "close"; reason: string; evidence: readonly EvidenceReference[] };

export interface EngagementDecisionCurrencyInput { asOf: string; engagements: readonly EngagementRecord[]; assessmentInputs: readonly unknown[]; elapsedDaysByEngagement: Readonly<Record<string, number>>; }
export interface EngagementDecisionCurrencyAssessment { state: AdvisorState; activeEngagements: number; currentEngagements: number; rate: number | null; findings: readonly AdvisorFinding[]; }
export interface AdvisorToolContract { name: "start_advisor_session" | "assess_advisor_engagement" | "advance_advisor_session"; description: string; }
export type AdvisorToolRequest = | { name: "start_advisor_session"; input: { id: string; nextAction: EngagementNextAction } } | { name: "assess_advisor_engagement"; input: unknown } | { name: "advance_advisor_session"; input: { session: AdvisorSession; event: AdvisorSessionEvent } };
export interface AdvisorToolResponse { state: AdvisorState; output: AdvisorSession | AdvisorAssessment | null; findings: readonly AdvisorFinding[]; }
