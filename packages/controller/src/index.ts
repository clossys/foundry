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
  validateInstalledPositionContract,
  validateInstalledPositionLedger,
} from "./positions/index.js";
export type { InstalledPositionFinding, InstalledPositionLedgerReport } from "./positions/index.js";
