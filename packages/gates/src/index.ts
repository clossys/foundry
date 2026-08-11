/** Foundation orchestration and pure, consumer-supplied governance gates. */

export type { FoundationReport, BuildOrderResult, PolicyCheck, PolicyCheckResult } from "./types.js";

export { runFoundationCheck } from "./foundation.js";
export { computeBuildOrder } from "./build-order.js";
export { verifyPolicyBindings } from "./policy-checks.js";
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
export type { Catalog, CatalogEntry, CatalogFinding } from "@vespeneventures/catalog";
export type { Finding, PolicyBinding } from "@vespeneventures/policy";
