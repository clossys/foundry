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
