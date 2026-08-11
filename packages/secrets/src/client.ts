import { AsyncSecretAdapterError, MissingSecretError, SecretAccessError } from "./errors.js";
import type { MaybePromise, SecretKey, SecretsAdapter, SecretsClient } from "./types.js";

function isPromiseLike<T>(value: MaybePromise<T>): value is PromiseLike<T> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    "then" in value
  );
}

function consumePromiseLike<T>(value: PromiseLike<T>): void {
  void Promise.resolve(value).catch(() => undefined);
}

function normalize(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.length === 0 ? null : value;
}

function read(adapter: SecretsAdapter, key: SecretKey): MaybePromise<string | null | undefined> {
  try {
    return adapter.get(key);
  } catch {
    throw new SecretAccessError(key);
  }
}

async function readAsync(adapter: SecretsAdapter, key: SecretKey): Promise<string | null> {
  try {
    return normalize(await adapter.get(key));
  } catch (error) {
    if (error instanceof SecretAccessError) throw error;
    throw new SecretAccessError(key);
  }
}

export function createSecretsClient(adapter: SecretsAdapter): SecretsClient {
  return Object.freeze({
    async get(key: SecretKey): Promise<string | null> {
      return readAsync(adapter, key);
    },

    async require(key: SecretKey): Promise<string> {
      const value = await readAsync(adapter, key);
      if (value === null) throw new MissingSecretError(key);
      return value;
    },

    getSync(key: SecretKey): string | null {
      const value = read(adapter, key);
      if (isPromiseLike(value)) {
        consumePromiseLike(value);
        throw new AsyncSecretAdapterError(key);
      }
      return normalize(value);
    },

    requireSync(key: SecretKey): string {
      const value = read(adapter, key);
      if (isPromiseLike(value)) {
        consumePromiseLike(value);
        throw new AsyncSecretAdapterError(key);
      }
      const normalized = normalize(value);
      if (normalized === null) throw new MissingSecretError(key);
      return normalized;
    },
  });
}
