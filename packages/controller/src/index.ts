/** Read-only lifecycle governance and package-process orchestration. */

export { PACKAGE_LIFECYCLE_VERSION } from "./types.js";

// One lifecycle vocabulary for every capability and pack item (issue #1228).
// Re-exported from the root entry point for the same reason onboarding is,
// below: the frozen public-npm aggregate canary plan pins an immutable
// optional-peer matrix keyed by export SPECIFIER, and a new subpath has
// nowhere to be recorded against it. Named exports added to the existing
// root specifier do not touch that matrix.
export {
  LIFECYCLE_CONDITIONS,
  LIFECYCLE_STATES,
  PACK_STATUSES,
  packStatusToLifecycle,
} from "./loop/lifecycle.js";
export type {
  LifecycleCondition,
  LifecycleState,
  PackStatus,
  PackStatusLifecyclePosition,
} from "./loop/lifecycle.js";

// The loop engine (issue #1195): the one sense -> judge -> act -> verify ->
// learn loop every role runs, and the per-role clossys/<role>/loop.json
// state it is re-entrant over. Root-exported for the same canary-matrix
// reason as the lifecycle vocabulary directly above -- see that comment.
export { LOOP_STAGES, TRIGGER_KINDS, TRIGGER_SCOPES, BLOCKER_KINDS, BLOCKER_OWNERS } from "./loop/types.js";
export type {
  LoopStage,
  TriggerKind,
  TriggerScope,
  BlockerKind,
  NextAction,
  Blocker,
  Decision,
  Fingerprint,
  LoopCapabilityState,
  LoopState,
} from "./loop/types.js";
export { reentryStageForTrigger, reentryScopeForTrigger, isTriggerKind } from "./loop/triggers.js";
export { blockerFor, isBlockerOverdue, overdueBlockers } from "./loop/blockers.js";
export { fingerprintInputs, isStale, changedInputs, affectedCapabilities } from "./loop/staleness.js";
export type { FingerprintInput } from "./loop/staleness.js";
export {
  isOwnedByRole,
  planCreateOrUpdate,
  planMove,
  planSupersede,
  planRetire,
} from "./loop/artifacts.js";
export type {
  CreateOrUpdatePlan,
  RefusedPlan,
  MovePlan,
  SupersedePlan,
  RetirePlan,
  BlockedRetirePlan,
} from "./loop/artifacts.js";
export { validateLoopState, isValidLoopState, resumeStage } from "./loop/state.js";
export type { LoopStateFinding } from "./loop/state.js";
export { renderStatusDocument, renderLoopStatus } from "./loop/status.js";
export type { StatusSections } from "./loop/status.js";
export { bindPlan, decidePlanExecution, PLAN_EXECUTION_OUTCOMES } from "./loop/plan-binding.js";
export type { PlanBinding, PlanExecutionDecision, PlanExecutionOutcome } from "./loop/plan-binding.js";
export type {
  DeclaredRule,
  GovernedPreflightOptions,
  GovernedPreflightReport,
  GovernanceReport,
  LifecycleFinding,
  LifecycleFindingRule,
  NewPackagePlan,
  NewPackagePlanInput,
  NewPackagePlanProfile,
  NewPackagePlanReadiness,
  PackageLifecycleDocument,
  PackageLifecycleEntry,
  PackageLifecyclePromotionEvidence,
  PackageLifecycleStatus,
  PackageScaffoldFile,
  RuleConformanceAssessment,
  RuleConformanceEvidence,
  RuleConformanceFinding,
  RuleConformanceInput,
  RuleConformanceObservation,
  RuleConformanceState,
} from "./types.js";

export { validatePackageLifecycle, evaluateDependencyInstallability,
  evaluateLifecycleCoverage } from "./lifecycle.js";
export { planNewPackage } from "./scaffold.js";
export { runGovernanceCheck } from "./governance.js";
export { preflightGovernedPackage } from "./preflight.js";
export { assessRuleConformanceRate } from "./rule-conformance.js";
export {
  POSITION_FIELDS,
  POSITION_RECOMMENDATIONS,
  WORKER_COMPONENT_KINDS,
  COMPLETION_EVIDENCE_FIELDS,
  COMPLETION_EVIDENCE_INDETERMINATE_REASONS,
  COMPLETION_VERDICTS,
  DUPLICATE_STATES,
  INVOCATION_KINDS,
  PLACEMENT_MODES,
  validateCompletionEvidence,
  validateCompletionEvidenceContract,
  validateInstalledPositionContract,
  validateInstalledPositionLedger,
} from "./positions/index.js";
export type { CompletionEvidenceFinding, CompletionEvidenceIndeterminateReason, CompletionEvidenceReport, InstalledPositionAdvisory, InstalledPositionFinding, InstalledPositionLedgerReport } from "./positions/index.js";

// First-day onboarding. Re-exported from the root entry point rather than
// given its own `./onboarding` subpath: the frozen public-npm aggregate
// canary plan pins an immutable optional-peer matrix covering every declared
// export specifier of every package with an optional peer, and that plan may
// not be rewritten — so a NEW subpath on this package cannot be recorded
// against it. The root specifier is already in that matrix, its recorded
// `imports` outcome stays truthful (this module needs no `typescript`), and
// nothing here evades a check that would otherwise have something to say.
// `foundry-onboarding-run` is the executable form and is unaffected.
export {
  ARCHITECTURE_SUBJECTS,
  ASSESSMENT_DECLARATION_PATH,
  ASSESSMENT_INVOCATION_FAILURES,
  ASSESSMENT_INVOCATION_KINDS,
  ASSESSMENT_OUTCOMES,
  ASSESSMENT_SURFACE_ABSENCES,
  DEFAULT_ASSESSMENT_TIMEOUT_MS,
  DIRECTION_ROLE,
  DIRECTION_SUBJECTS,
  ENGAGEMENT_BASELINE_ROLE,
  EXCLUSION_REASON,
  FEEDS_DECLARATION_ABSENCES,
  FEEDS_DECLARATION_PATH,
  FIT_DECLARATION_PATH,
  FIT_SURFACE_ABSENCES,
  INDEPENDENT_OUTCOME_ROLE,
  INTAKE_SURFACE_ABSENCES,
  INTAKE_DECLARATION_PATH,
  NEEDS_DECLARATION_ABSENCES,
  NEEDS_DECLARATION_PATH,
  NO_RULE_OPENED,
  OPERATING_SYSTEM_ROLE,
  OUTPUTS_DECLARATION_ABSENCES,
  OUTPUTS_DECLARATION_PATH,
  PROPOSED_POSITIONS_KEY,
  SELECTION_RULES,
  SOLVES_DECLARATION_ABSENCES,
  SOLVES_DECLARATION_PATH,
  SOLVES_EVIDENCE_LEVELS,
  STATUS_DECLARATION_PATH,
  STATUS_SURFACE_ABSENCES,
  activeRolesFromContract,
  assertPassThroughAssessments,
  assertRoleAuthoredPositions,
  assessmentInputPath,
  authorizeMutation,
  discoverRoleAssessmentSurface,
  discoverRoleAssessmentSurfaces,
  discoverRoleFeedsDeclaration,
  discoverRoleFeedsDeclarations,
  discoverRoleFitSurface,
  discoverRoleFitSurfaces,
  discoverRoleIntakeSurface,
  discoverRoleIntakeSurfaces,
  discoverRoleNeedsDeclaration,
  discoverRoleNeedsDeclarations,
  discoverRoleOutputsDeclaration,
  discoverRoleOutputsDeclarations,
  discoverRoleSolvesDeclaration,
  discoverRoleSolvesDeclarations,
  discoverRoleStatusSurface,
  discoverRoleStatusSurfaces,
  joinFirstDayOnboarding,
  nodeAssessmentInvoker,
  observeRoleAssessment,
  onboardingExitCode,
  onboardingRunDigest,
  proposeInstalledPositionLedger,
  runFirstDayOnboarding,
  selectRoles,
  validateOnboardingRequest,
} from "./onboarding/index.js";
export type {
  ArchitectureSubject,
  AssessmentInvocationFailure,
  AssessmentInvocationKind,
  AssessmentInvoker,
  AssessmentOutcome,
  AssessmentProcessResult,
  AssessmentSurface,
  AssessmentSurfaceAbsence,
  AssessmentSurfaceDiscovery,
  DirectionSubject,
  FeedsDeclaration,
  FeedsDeclarationAbsence,
  FeedsDeclarationDiscovery,
  FeedsEntry,
  FirstDayOnboardingOptions,
  FitSurface,
  FitSurfaceAbsence,
  FitSurfaceDiscovery,
  IntakeSurface,
  IntakeSurfaceAbsence,
  IntakeSurfaceDiscovery,
  LedgerProposal,
  MutationApproval,
  MutationAuthorization,
  NeedsDeclaration,
  NeedsDeclarationAbsence,
  NeedsDeclarationDiscovery,
  NeedsEntry,
  OnboardingEngagement,
  OnboardingFinding,
  OnboardingGap,
  OnboardingRequest,
  OnboardingRun,
  OnboardingState,
  OutputsDeclaration,
  OutputsDeclarationAbsence,
  OutputsDeclarationDiscovery,
  RoleAssessmentObservation,
  RoleAssessmentRecord,
  RoleSelection,
  RoleSelectionOutcome,
  SelectionRule,
  SolvesDeclaration,
  SolvesDeclarationAbsence,
  SolvesDeclarationDiscovery,
  SolvesEntry,
  SolvesEvidenceLevel,
  StatusSurface,
  StatusSurfaceAbsence,
  StatusSurfaceDiscovery,
} from "./onboarding/index.js";

// The shared check-output-envelope (issue #1174, docs/contracts/
// check-output-envelope.json): one JSON report shape for every check
// command. Root-exported for the same frozen-canary-matrix reason as the
// loop engine above -- see that comment -- rather than a new `./envelope`
// subpath.
export { buildCheckOutputEnvelope, envelopeToExitCode } from "./envelope.js";
export type { CheckOutputEnvelope, CheckFinding, CheckMetric, BuildEnvelopeOptions } from "./envelope.js";

// Schema versions and migrations for every clossys/ record (issue #1224).
// Root-exported for the same reason as the loop engine and the envelope
// above.
export { classifyRecordVersion, migrateRecord } from "./migrate/runner.js";
export type { RecordVersionClassification } from "./migrate/runner.js";
export { createRecordKindRegistry, defaultRecordKindRegistry, LOOP_STATE_KIND, COVERAGE_DECLARATION_KIND } from "./migrate/registry.js";
export type { RecordKindRegistry } from "./migrate/registry.js";
export { discoverRecords, runMigrations, DEFAULT_RECORD_LOCATIONS } from "./migrate/fs.js";
export type { RecordLocation, DiscoveredRecord, RecordMigrationReport, RunMigrationsOptions } from "./migrate/fs.js";
export type { MigrationStep, MigrationTable, MigrationOutcome, AlreadyCurrentOutcome, MigratedOutcome, IndeterminateOutcome } from "./migrate/types.js";

// Operating cadence: the zero-token heartbeat (issue #1221). Root-exported
// for the same reason as the modules above.
export { HEARTBEAT_FINDING_KINDS } from "./heartbeat/types.js";
export type { HeartbeatFindingKind, DigestEntry, HeartbeatDigest } from "./heartbeat/types.js";
export { computeHeartbeat, renderDigest } from "./heartbeat/digest.js";
export { loadLoopStates, computeHeartbeatForRepo, writeHeartbeatDigest, DIGEST_PATH as HEARTBEAT_DIGEST_PATH } from "./heartbeat/fs.js";
export type { LoadedLoopStates, UnreadableLoopState, HeartbeatRunResult } from "./heartbeat/fs.js";
export { controllerHeartbeatSchedule, validateHeartbeatSchedule } from "./heartbeat/schedule.js";
