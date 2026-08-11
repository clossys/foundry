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
  PackageScaffoldFile,
} from "./types.js";

export { validatePackageLifecycle, evaluateLifecycleCoverage } from "./lifecycle.js";
export { planNewPackage } from "./scaffold.js";
export { runGovernanceCheck } from "./governance.js";
export { preflightGovernedPackage } from "./preflight.js";
