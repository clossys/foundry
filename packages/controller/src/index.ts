/** Read-only lifecycle governance and package-process orchestration. */

export { PACKAGE_LIFECYCLE_VERSION } from "./types.js";
export type {
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
} from "./types.js";

export { validatePackageLifecycle, evaluateDependencyInstallability,
  evaluateLifecycleCoverage } from "./lifecycle.js";
export { planNewPackage } from "./scaffold.js";
export { runGovernanceCheck } from "./governance.js";
export { preflightGovernedPackage } from "./preflight.js";
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
export type { CompletionEvidenceFinding, CompletionEvidenceIndeterminateReason, CompletionEvidenceReport, InstalledPositionFinding, InstalledPositionLedgerReport } from "./positions/index.js";

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
  INDEPENDENT_OUTCOME_ROLE,
  NO_RULE_OPENED,
  OPERATING_SYSTEM_ROLE,
  PROPOSED_POSITIONS_KEY,
  SELECTION_RULES,
  activeRolesFromContract,
  assertPassThroughAssessments,
  assertRoleAuthoredPositions,
  assessmentInputPath,
  authorizeMutation,
  discoverRoleAssessmentSurface,
  discoverRoleAssessmentSurfaces,
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
  FirstDayOnboardingOptions,
  LedgerProposal,
  MutationApproval,
  MutationAuthorization,
  OnboardingEngagement,
  OnboardingFinding,
  OnboardingGap,
  OnboardingRequest,
  OnboardingRun,
  OnboardingState,
  RoleAssessmentObservation,
  RoleAssessmentRecord,
  RoleSelection,
  RoleSelectionOutcome,
  SelectionRule,
} from "./onboarding/index.js";
