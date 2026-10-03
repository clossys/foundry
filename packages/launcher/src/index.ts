/** Consumer-owned workspace hub scaffolder: create, resume, or appoint a GitHub repository. */
export {
  applyWorkspacePlan,
  checkInventoryEntries,
  cloneMissingInventoryRepositories,
  formatHubHealth,
  hasAdvisorPin,
  inspectInventory,
  isHubDocument,
  launcherPackageRootFromModule,
  observeWorkspace,
  parseGitHubRemote,
  planWorkspace,
  readInventoryRepositories,
  readLiveLauncherVersion,
  reportHubHealth,
  validateInventoryDocument,
  CLOSSYS_DIR_REL,
  CLOSSYS_README_REL,
  DEFAULT_REPOSITORY_NAME,
  LEGACY_STATE_DIR_REL,
  LEGACY_WORKSPACE_INVENTORY_REL,
  LEGACY_WORKSPACE_MARKER_REL,
  STATE_DIR_REL,
  WORKSPACE_INVENTORY_REL,
  WORKSPACE_MARKER_REL,
} from "./core.js";
export type { CloneMissingOutcome, InventoryValidation, PlanWorkspaceOptions } from "./core.js";
export type { InventoryReadOptions } from "./inventory-contract.js";
export { runDoctorChecks, renderDoctorReport } from "./doctor.js";
export { applyEngagementBrief, approvedSubject, isPlanApproved, validateAdvisorPlan, validateEngagementBrief } from "./apply-plan.js";
export type {
  AdvisorPlan, ApplyBriefResult, BlockerKind, EngagementBrief, EngagementBriefRole, EngagementContext, EngagementContextField, EngagementContextFieldId, GoalDirection, PlanBlocker,
  PlanDecision, PlanKit, PlanPackageAct, PlanStaffing, ValidationResult,
} from "./apply-plan.js";
export { PLAN_DIGEST_EXCLUDED_FIELDS, canonicalDigest, canonicalJson, planDigest } from "./plan-digest.js";
export { CHANGE_SET_DIGEST_EXCLUDED_FIELDS, DERIVED_FILE_DIGEST_FIELDS, bundleDigest, changeSetDigest, changeSetDigestSubject } from "./change-set-digest.js";
export type { BundleDigestEntry } from "./change-set-digest.js";
export { AGENTS_GUIDE_PATH, AGENTS_GUIDE_TEXT, CLOSSYS_SKILL_PATTERNS, verifyAgentsGuide } from "./agents-guide.js";
export { validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
export type {
  ApplyBundle, ApplyBundleRepository, ApplyCheck, ApplyCheckId, ApprovalBinding, ChangeSetDeferral, ChangeSetItem, ChangeSetPhase, ChangeSetRefusal, CheckVerdict, ContentDigest,
  DependencyPlacement, DerivedFileChange, DiscoveryRoot, ExemptionSurfaceKind, FileChange, KeyChange, LedgerInvariant, LockfileName, PackageInvariant, PackageManagerKind,
  PinnedPackage, RefusalReason, ReleaseAgeSurfaceKind, RepositoryChangeSet, RepositoryProfileObservation, RepositoryVisibility, RootEntryDeclaration, WholeFileChange,
  WriteRecordSource,
} from "./change-set-contract.js";
export { ledgerSuccession, readInstalledLedger, renderInstalledLedger, serializeInstalledLedger, validateInstalledLedger } from "./ledger-contract.js";
export { reconcileWholeFile, trustInstalledLedger } from "./ledger-trust.js";
export type { LedgerTrust, LedgerTrustRule, PlanPackageActs, TrustInstalledLedgerOptions, WholeFileOutcome, WholeFileState } from "./ledger-trust.js";
export { BUNDLE_STORE_REL, CHANGE_SET_STORE_REL, readStoredApplyBundle, readStoredChangeSet, storeApplyBundle, storeChangeSet } from "./apply-store.js";
export { isRootEntryName, wouldViolateRootEntries } from "./root-entries.js";
export type { RootEntriesVerdict } from "./root-entries.js";
export { editReleaseAgeExemption, verifyReleaseAgeExemption } from "./release-age-edit.js";
export type { ReleaseAgeEdit, ReleaseAgeEditInput, ReleaseAgeEditRefusalReason, ReleaseAgeVerdict, ReleaseAgeVerifyInput } from "./release-age-edit.js";
export type { InstalledLedger, LedgerPackageIdentity, LedgerSuccession, LedgerViolation } from "./ledger-contract.js";
export { PUBLIC_PROBLEM_PLACEHOLDER, createExistingDeclarationAdoptions, planApplyBundle, projectEngagementBrief, serializeEngagementBrief } from "./plan-bundle.js";
export type { PlanApplyBundleInputs, PlanApplyBundleResult, RepositoryObservation, SkippedRepositoryObservation } from "./plan-bundle.js";
export { observeRepository } from "./observe-repository.js";
export type { ObserveRepositoryInput, RepositoryObservationPorts } from "./observe-repository.js";
export type { DoctorCheckHost, DoctorReport, DoctorStepId, DoctorStepResult } from "./doctor.js";
export { checkCloudSessionBootstrap } from "./product-repository.js";
export type { CloudBootstrapCheck, CloudBootstrapReport } from "./product-repository.js";
// Setup templates: pure renderers for the files a setup change writes.
export {
  renderSetupTemplate,
  renderStarterRequest,
  renderAdoptionDecisionWorkflow,
  renderProductCiWorkflow,
  STARTER_PIN_RANGE,
} from "./setup-templates.js";
export type {
  SetupPackageManager,
  StarterPinInput,
  StarterRequestInput,
  TemplateFile,
  TemplateRefusal,
  TemplateResult,
} from "./setup-templates.js";
export {
  renderSnapshotCollector,
  renderAdoptionEvidenceWorkflow,
  renderPathScopeScript,
  renderPathScopeWorkflow,
  OWNED_PATH_PATTERNS,
} from "./setup-template-scripts.js";
export { reportInventoryDrift } from "./inventory-adoption.js";
export type { ExternalInventoryDeclaration, InventoryDriftReport } from "./inventory-adoption.js";
export { detectLinkedHosts, parseHostRecord, serializeHostRecord, HOSTS_REL } from "./hosts.js";
export type { DiscoveredHost, HostRecord } from "./hosts.js";
export { readChangeSetMarker, renderPullRequest } from "./pull-request-body.js";
export type { PullRequestRefusal, PullRequestRefusalReason, PullRequestText, RenderPullRequestInput } from "./pull-request-body.js";
export { parsePreferences, readHostModelProfile, resolveModelForTier } from "./model-profile.js";
export type {
  BudgetPreference,
  HostModelProfile,
  HostTierMapping,
  ModelResolution,
  PreferencesDocument,
  ReasoningTier,
  SupportedHost,
} from "./model-profile.js";
export type {
  ApplyWorkspaceOptions,
  ChosenInventory,
  CommandResult,
  CwdObservation,
  DependencyBucket,
  EngineInstallFinding,
  EnginePinChange,
  HubDocument,
  HubEnginePin,
  HubHealthReport,
  HubMigrationState,
  InventoryObservation,
  InventoryValidationEntry,
  InventoryValidationReport,
  PinFinding,
  PinGrade,
  SkillManifestDocument,
  SkillManifestEntry,
  SkillsManifestSummary,
  WorkspaceApplyResult,
  WorkspaceDecision,
  WorkspaceHost,
  WorkspaceObservation,
  WorkspacePlan,
  WorkspaceRefusal,
  WorkspaceState,
} from "./types.js";
export {
  PROVENANCE_CHECK_BIN,
  PROVENANCE_CHECK_MAX_BUFFER,
  PROVENANCE_CHECK_TIMEOUT_MS,
  checkSetProvenance,
  registrySnapshotDigest,
} from "./provenance-gate.js";
export type { ProvenanceGateInput, ProvenanceGatePorts } from "./provenance-gate.js";

export { decideSetBinding, planPackagesFor, readHubAuthority } from "./admission.js";
export type { AdmissionDecision, AdmissionRefusal, HubAuthority, ReadinessRunner } from "./admission.js";

export type {ExistingDeclarationAdoption} from "./change-set-contract.js";
