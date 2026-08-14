/**
 * @vespeneventures/conventions
 *
 * The account-neutral agent conventions two parties can share without either
 * owning the other, plus deterministic grammar checks and workspace-cleanup
 * classification.
 *
 * The split is the design. This package enforces the *grammar* -- branch
 * provenance, skill naming, routine declarations, neutrality -- and ships the
 * *prose* as a default. It never gates on byte-identity with that prose: a
 * consumer that adopts the documents verbatim and one that rewrites them
 * entirely are both conforming, so long as what they declare satisfies the
 * grammar. A standard that required its own wording back would be a seeder
 * wearing a standard's clothes.
 */

export type {
  ConventionAdapter,
  ConventionDocument,
  Finding,
  RoutineDeclaration,
  RoutineRegistry,
  Severity,
} from "./types.js";

export {
  ADAPTERS_ROOT,
  CONVENTION_ADAPTERS,
  CONVENTION_DOCUMENTS,
  DOCUMENTS_ROOT,
  adapterPath,
  documentPath,
  templatedFilenames,
} from "./documents.js";

export { TAXONOMY_PREFIXES, validateBranchName } from "./branch.js";
export type { BranchOptions } from "./branch.js";

export { SKILL_VERBS, validateSkillName, validateSkillSet } from "./skills.js";
export type { SkillOptions } from "./skills.js";

export {
  reconciliationFindingKinds,
  validateRoutineDeclaration,
  validateRoutineSet,
  validateScheduledSkillDescription,
} from "./routines.js";
export type { RoutineExclusion, RoutineSetOptions } from "./routines.js";

export { scanNeutrality } from "./neutrality.js";
export type { NeutralityOptions } from "./neutrality.js";

export {
  SKILL_REGISTRY_SCHEMA_VERSION,
  computeCapabilityCoverage,
  validateRoutineCoverage,
  validateSkillRegistry,
} from "./skill-registry.js";
export type {
  AcceptedGap,
  Capability,
  CapabilityCoverage,
  RegisteredSkill,
  RoutineCoverageQuery,
  SkillCapabilityImplementation,
  SkillRegistry,
  SkillScope,
} from "./skill-registry.js";

export { renderProductLoader } from "./loader.js";
export type { ProductLoaderOptions } from "./loader.js";

export {
  WORKSPACE_CLEANUP_REASON_CODES,
  classifyWorkspaceCleanup,
  classifyWorkspaceCleanupSet,
} from "./workspace-cleanup.js";
export type {
  BranchCleanupObservation,
  BranchDispositionObservation,
  BranchTrackingState,
  BranchWorktreeState,
  CanonicalCheckoutState,
  PruneDryRunState,
  PullRequestState,
  TargetOwnershipState,
  WorkspaceCleanupAction,
  WorkspaceCleanupCommonObservation,
  WorkspaceCleanupObservation,
  WorkspaceCleanupProposal,
  WorkspaceCleanupReasonCode,
  WorkspaceCleanupStatus,
  WorktreeCleanupObservation,
  WorktreeMetadataCleanupObservation,
  WorktreeState,
} from "./workspace-cleanup.js";
