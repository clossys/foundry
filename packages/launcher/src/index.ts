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
export { applyEngagementBrief, isPlanApproved, validateAdvisorPlan, validateEngagementBrief } from "./apply-plan.js";
export type {
  AdvisorPlan, ApplyBriefResult, BlockerKind, EngagementBrief, EngagementBriefRole, EngagementContext, EngagementContextField, EngagementContextFieldId, GoalDirection, PlanBlocker,
  PlanDecision, ValidationResult,
} from "./apply-plan.js";
export { PLAN_DIGEST_EXCLUDED_FIELDS, canonicalJson, planDigest } from "./plan-digest.js";
export type { DoctorCheckHost, DoctorReport, DoctorStepId, DoctorStepResult } from "./doctor.js";
export { checkCloudSessionBootstrap } from "./product-repository.js";
export type { CloudBootstrapCheck, CloudBootstrapReport } from "./product-repository.js";
export { reportInventoryDrift } from "./inventory-adoption.js";
export type { ExternalInventoryDeclaration, InventoryDriftReport } from "./inventory-adoption.js";
export { detectLinkedHosts, parseHostRecord, serializeHostRecord, HOSTS_REL } from "./hosts.js";
export type { DiscoveredHost, HostRecord } from "./hosts.js";
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
