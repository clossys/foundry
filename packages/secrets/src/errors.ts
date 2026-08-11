import type { SecretKey } from "./types.js";

export type SecretErrorCode = "SECRET_MISSING" | "SECRET_ACCESS_FAILED" | "SECRET_ASYNC_ADAPTER";

export class SecretError extends Error {
  readonly code: SecretErrorCode;
  readonly key: SecretKey;

  constructor(code: SecretErrorCode, key: SecretKey, message: string) {
    super(message);
    this.name = "SecretError";
    this.code = code;
    this.key = key;
  }
}

export class MissingSecretError extends SecretError {
  constructor(key: SecretKey) {
    super("SECRET_MISSING", key, `Required secret ${JSON.stringify(key)} is unavailable.`);
    this.name = "MissingSecretError";
  }
}

export class SecretAccessError extends SecretError {
  constructor(key: SecretKey) {
    super("SECRET_ACCESS_FAILED", key, `Secret ${JSON.stringify(key)} could not be resolved.`);
    this.name = "SecretAccessError";
  }
}

export class AsyncSecretAdapterError extends SecretError {
  constructor(key: SecretKey) {
    super(
      "SECRET_ASYNC_ADAPTER",
      key,
      `Secret ${JSON.stringify(key)} requires asynchronous resolution; use get() or require().`,
    );
    this.name = "AsyncSecretAdapterError";
  }
}
