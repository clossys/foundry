/** Foundation orchestration and pure, consumer-supplied governance gates. */

export type { FoundationReport, BuildOrderResult, PolicyCheck, PolicyCheckResult } from "./types.js";
export type { RunFoundationCheckOptions } from "./foundation.js";

export { runFoundationCheck } from "./foundation.js";
export { computeBuildOrder } from "./build-order.js";
export { verifyPolicyBindings } from "./policy-checks.js";
export { FOUNDRY_CHECK_REASONS, foundationGateResult, main, run, severityCounts } from "./cli.js";
export type { FoundryCheckIndeterminateReason } from "./cli.js";
export { evaluateRatchet } from "./ratchet.js";
export type { RatchetFinding, RatchetIndeterminateReason, RatchetResult } from "./ratchet.js";
export { checkOverrideTargetRanges } from "./override-target-range.js";
export type { OverrideRangeFinding } from "./override-target-range.js";
export { checkDependencyScope } from "./dependency-scope.js";
export type {
  DependencyScopeAllowlistDocument,
  DependencyScopeAllowlistEntry,
  DependencyScopeFinding,
  DependencyScopeOptions,
} from "./dependency-scope.js";
export {
  COMMON_INDETERMINATE_REASONS,
  assertNeverVacuouslySatisfied,
  createGateReasons,
  foldGateResults,
  gateIndeterminate,
  gateResultFromRatchet,
  gateResultToExitCode,
  gateSatisfied,
  gateViolated,
  isIndeterminate,
  isSatisfied,
  isViolated,
} from "./result.js";
export type {
  CommonIndeterminateReason,
  GateReasonVocabulary,
  GateResult,
  GateVerdict,
  IndeterminateGateResult,
  SatisfiedGateResult,
  ViolatedGateResult,
} from "./result.js";
export {
  checkCredentialInventory,
  checkCredentialSurfaceDrift,
  checkLocalSecretFiles,
  checkProviderResourceNames,
  checkSecretName,
  checkSecretReadiness,
  checkValueFreeSecretCatalog,
  detectRawSecretReads,
} from "./secret-gates.js";
export type {
  CredentialInventory,
  CredentialInventoryEntry,
  CredentialSurfaceObservation,
  LocalFileObservation,
  LocalSecretFileOptions,
  ProviderResourceNamingRule,
  ProviderResourceObservation,
  RawSecretReadOptions,
  SecretCatalogGateDocument,
  SecretCatalogGateEntry,
  SecretGateFinding,
  SecretReadinessObservation,
} from "./secret-types.js";

// Re-exported so a consumer of this package never needs a separate import
// from ../catalog/index.js or ../policy/index.js just to read the types
// these functions return.
export type { Catalog, CatalogEntry, CatalogFinding } from "../catalog/index.js";
export type { Finding, PolicyBinding } from "../policy/index.js";
