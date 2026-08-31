export { createSecretsClient } from "./client.js";
export { createEnvSecretsAdapter, createTestSecretsAdapter } from "./adapters.js";
export { defineSecretCatalog } from "./catalog.js";
export { AsyncSecretAdapterError, MissingSecretError, SecretAccessError, SecretError } from "./errors.js";
export type { SecretErrorCode } from "./errors.js";
export type {
  MaybePromise,
  SecretCatalog,
  SecretCatalogEntry,
  SecretKey,
  SecretsAdapter,
  SecretsClient,
  SyncSecretsAdapter,
  TestSecretsAdapter,
} from "./types.js";

export { custodyOf, defineKeyCustody, unownedKeys } from "./custody.js";
export type { CustodyStore, KeyCustodyManifest, KeyCustodyRecord } from "./custody.js";

export { evaluateRotation, rotationQueue, sameDigest, summarizeRotationMetric } from "./rotation.js";
export type { RotationEvaluation, RotationMetric, RotationPolicy, RotationRecord, RotationState } from "./rotation.js";

export { defineCredentialEvidence, evaluateCredential } from "./credential.js";
export type {
  CredentialClass,
  CredentialEvidence,
  CredentialEvaluation,
  CredentialExitCode,
  CredentialReason,
  CredentialProvider,
  CredentialVerdict,
  EphemeralJobCredentialEvidence,
  ManuallyRotatableCredentialEvidence,
} from "./credential.js";

export { defineRevocationPath, isRevoked, latestRevocation, recordRevocation } from "./revocation.js";
export type { RevocationPath, RevocationRecord } from "./revocation.js";

export { defineDistributionManifest, keysFor, mayResolve, principalsFor } from "./distribution.js";
export type { DistributionEntry, DistributionManifest, Principal } from "./distribution.js";
