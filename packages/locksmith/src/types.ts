export type SecretKey = string;

export type MaybePromise<T> = T | PromiseLike<T>;

export interface SecretsAdapter {
  get(key: SecretKey): MaybePromise<string | null | undefined>;
}

export interface SyncSecretsAdapter {
  get(key: SecretKey): string | null | undefined;
}

export interface SecretsClient {
  get(key: SecretKey): Promise<string | null>;
  require(key: SecretKey): Promise<string>;
  getSync(key: SecretKey): string | null;
  requireSync(key: SecretKey): string;
}

export interface SecretCatalogEntry {
  key: SecretKey;
  required: boolean;
  description?: string;
  group?: string;
}

export interface SecretCatalog {
  version: 1;
  entries: readonly SecretCatalogEntry[];
}

export interface TestSecretsAdapter extends SyncSecretsAdapter {
  set(key: SecretKey, value: string): void;
  delete(key: SecretKey): boolean;
  clear(): void;
  keys(): readonly SecretKey[];
}
