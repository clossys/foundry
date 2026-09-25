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
export { nextSponsorQuestion, applySponsorChoice } from "./sponsor-questions.js";
export { assessEngagementDecisionCurrency, resolveEngagementActionDisposition } from "./currency.js";
export { createAdvisorSession, advanceAdvisorSession } from "./session.js";
export { validateExecutionAuthorization, BASIS_FIELDS, BASIS_DIGEST_FIELDS, sameBasis, sameStrings, packageKey } from "./authorization.js";
export { assessAdvisorExecutionReadiness } from "./execution-readiness.js";
export { ADVISOR_TOOL_CONTRACTS, handleAdvisorTool } from "./tools.js";
export { CAPABILITY_CATALOGUE, kitCatalogueDigest } from "./capability-catalogue.js";
export { KIT_PRESETS } from "./kit-presets.js";
export {
  composeKit, composeKitFromProblems, validateKitProposal, judgeNeedsCycles, needIsMet, FIRST_ENGAGEMENT_ROLE_CAP, EVIDENCE_LEVELS, evidenceAtLeast, presetEvidenceFindings,
} from "./composition.js";
export { contextFromBrief, toEngagementBrief, validateEngagementBrief } from "./engagement-brief.js";
export { ENGAGEMENT_CONTEXT_FIELD_IDS, fieldById } from "./context.js";
export { nextContextQuestion, applyContextChoice } from "./context-questions.js";
export { CLIENT_PROBLEMS } from "./client-problems.js";
export { nextProblemQuestion, applyProblemChoice } from "./problem-questions.js";
export { ADVISOR_BLOCKER_KINDS, renderAdvisorStatus, validateAdvisorPlan } from "./status.js";
export { PLAN_DIGEST_EXCLUDED_FIELDS, canonicalJson, planDigest } from "./plan-digest.js";
export { recommendKit } from "./kit-verdicts.js";
export { nextStepInstruction } from "./next-step.js";
export { validateManagedEngagement, proposalReadyForClient } from "./managed-engagement.js";
export { BUDGET_PREFERENCE_CARD, applyBudgetPreferenceChoice, toPreferencesFile } from "./preferences.js";
export { REPOSITORY_CHOICE_CARD_ID, REPOSITORY_SOMETHING_ELSE_ID, applyRepositoryChoice, repositoryChoiceCard } from "./repository-choice.js";
export type {
  AdvisorAssessment, AdvisorAssessmentInput, AdvisorCharter, AdvisorComponentAssessment, AdvisorFinding, AdvisorSession, AdvisorSessionEvent, AdvisorSessionState,
  AdvisorState, AdvisorToolContract, AdvisorToolRequest, AdvisorToolResponse, AssessmentBasis, AuthorityClearance, BaselineDefinition, CompletionDefinition, CriterionDefinition,
  EngagementActionDisposition, EngagementDecisionCurrencyAssessment, EngagementDecisionCurrencyInput, EngagementNextAction, EngagementRecord, EngagementStatus,
  ExecutionAuthorization, EvidenceReference, FirstWaveAct, FirstWaveDefinition, FirstWavePlan, FirstWavePlanState, FirstWavePlanStep, FirstWaveWorkItem, FitSignal,
  HubPlacementCell, HubPlacementCellKind, HubPlacementEvidence, ImmutablePackageRef, Initiative, InitiativeOverlap, InitiativeStatus, PreWorkItem, PreWorkKind, PreWorkStatus, ReadinessCriterion, ReadinessState,
  ReassessmentPolicy, ReassessmentTrigger, RequiredFitCriterionId, RequiredReadinessCriterionId, RollbackDefinition, SessionClosure, SignalState, EngagementMode,
} from "./types.js";
export type { SponsorQuestionCard, SponsorQuestionChoice, SponsorChoiceApplyResult, SponsorQuestionInput } from "./sponsor-questions.js";
export type { AdvisorExecutionReadiness } from "./execution-readiness.js";
export type {
  CapabilityArtifactRef, CapabilityCatalogue, CapabilityEdgeSource, CapabilityEvidence, CapabilityInput, CapabilitySolves, DeclaredCapability, DeclaredFeed, MetricDirection, RoleCapability,
} from "./capability-catalogue.js";
export type { KitPreset } from "./kit-presets.js";
export type {
  ComposedFromProblemsRole, ComposedRole, ComposeKitFromProblemsInput, ComposeKitFromProblemsResult, ComposeKitInput, ComposeKitResult, ConfirmedProblem,
  KitProposal, KitProposalFinding, KitProposalRoleClaim, NeedsCycleJudgement, PresetEvidenceFinding, UnsatisfiedNeed, ValidateKitProposalResult,
} from "./composition.js";
export type { EngagementBrief, EngagementBriefRole } from "./engagement-brief.js";
export type { EngagementContext, EngagementContextField, EngagementContextFieldId } from "./context.js";
export type { ContextChoiceApplyResult, ContextQuestionCard, ContextQuestionChoice } from "./context-questions.js";
export type { ClientProblem } from "./client-problems.js";
export type { ProblemChoiceApplyResult, ProblemConfirmation, ProblemConfirmationState, ProblemQuestionCard, ProblemQuestionChoice } from "./problem-questions.js";
export type { AdvisorBlockerKind, AdvisorBlockerNextAction, AdvisorPlan, AdvisorPlanBlocker, AdvisorPlanDecision, AdvisorPlanMandate, AdvisorPlanNextAction } from "./status.js";
export type { KitVerdict, KitVerdictCitation, KitVerdictRole, KitVerdictState, RecommendKitInput } from "./kit-verdicts.js";
export type { ClientTool, NextStepHostContext } from "./next-step.js";
export type { ManagedEngagementInput, OperatorReview } from "./managed-engagement.js";
export type { AdvisorPreferences, BudgetPreference, BudgetPreferenceApplyResult, BudgetPreferenceCard, BudgetPreferenceChoice } from "./preferences.js";
export type { RepositoryChoice, RepositoryChoiceApplyResult, RepositoryChoiceCard, RepositoryChoiceCardResult, RepositoryListingEntry } from "./repository-choice.js";
