/** Provider-neutral sponsor assessment, first-wave pre-work gates, and connector-safe session contracts. */
import type { AdvisorCharter } from "./types.js";

/** The role's stable, provider-neutral operating charter. */
export const ADVISOR_CHARTER: AdvisorCharter = {
  primaryMode: "reconcile",
  secondaryMode: "interact",
  assurance: "justified-evidence-only",
  primaryMetric: "engagement-decision-currency-rate",
  metricDirection: "increase",
};

/** Plain-language entry text for a sponsor after a compatible connector is enabled. */
export const SPONSOR_ENTRY_PROMPT = "Start Foundry Advisor for <GitHub organization or repository URL>. If I have an active engagement, resume it; otherwise onboard me. Assess fit and readiness read-only, explain every question in plain language, and make no changes until I approve an evidence-bound first-wave plan.";

export { assessAdvisorEngagement, shouldReassess, validateAdvisorAssessmentInput, REQUIRED_FIT_CRITERIA, REQUIRED_READINESS_CRITERIA } from "./assessment.js";
export { assessEngagementDecisionCurrency, resolveEngagementActionDisposition } from "./currency.js";
export { createAdvisorSession, advanceAdvisorSession } from "./session.js";
export { ADVISOR_TOOL_CONTRACTS, handleAdvisorTool } from "./tools.js";
export type {
  AdvisorAssessment, AdvisorAssessmentInput, AdvisorCharter, AdvisorComponentAssessment, AdvisorFinding, AdvisorSession, AdvisorSessionEvent, AdvisorSessionState,
  AdvisorState, AdvisorToolContract, AdvisorToolRequest, AdvisorToolResponse, AssessmentBasis, AuthorityClearance, BaselineDefinition, CompletionDefinition, CriterionDefinition,
  EngagementActionDisposition, EngagementDecisionCurrencyAssessment, EngagementDecisionCurrencyInput, EngagementNextAction, EngagementRecord, EngagementStatus,
  ExecutionAuthorization, EvidenceReference, FirstWaveDefinition, FirstWavePlan, FirstWavePlanState, FirstWavePlanStep, FirstWaveWorkItem, FitSignal,
  ImmutablePackageRef, Initiative, InitiativeOverlap, InitiativeStatus, PreWorkItem, PreWorkKind, PreWorkStatus, ReadinessCriterion, ReadinessState,
  ReassessmentPolicy, ReassessmentTrigger, RequiredFitCriterionId, RequiredReadinessCriterionId, RollbackDefinition, SessionClosure, SignalState,
} from "./types.js";
