/** Foundation orchestration and pure, consumer-supplied governance gates. */

export type { FoundationReport, BuildOrderResult, PolicyCheck, PolicyCheckResult } from "./types.js";
export type { RunFoundationCheckOptions } from "./foundation.js";

export { runFoundationCheck } from "./foundation.js";
export { computeBuildOrder } from "./build-order.js";
export { verifyPolicyBindings } from "./policy-checks.js";
export { main, run, severityCounts } from "./cli.js";
export { evaluateRatchet } from "./ratchet.js";
export type { RatchetFinding, RatchetResult } from "./ratchet.js";
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

// Re-exported so a consumer of this package never needs a direct dependency
// on @vespeneventures/catalog or @vespeneventures/policy just to read the
// types these functions return.
export type { Catalog, CatalogEntry, CatalogFinding } from "../catalog/index.js";
export type { Finding, PolicyBinding } from "@vespeneventures/policy";
