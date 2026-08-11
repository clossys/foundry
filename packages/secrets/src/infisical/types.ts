import type { SecretCatalog, SecretKey, SecretsAdapter } from "../types.js";

export interface InfisicalAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface InfisicalClientConfig {
  baseUrl: string;
  projectId: string;
  environment: string;
  secretPath?: string;
  accessTokenProvider: InfisicalAccessTokenProvider;
  fetch?: typeof fetch;
}

export interface OidcTokenProviderOptions {
  baseUrl: string;
  identityId: string;
  getIdentityToken(): Promise<string>;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface SecretReadinessEntry {
  key: SecretKey;
  required: boolean;
  present: boolean;
}

export interface SecretReadinessReport {
  ok: boolean;
  entries: readonly SecretReadinessEntry[];
}

export interface InfisicalRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface InfisicalRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface InfisicalClient extends SecretsAdapter {
  get(key: SecretKey): Promise<string | null>;
  listSecretNames(): Promise<readonly SecretKey[]>;
  checkCatalog(catalog: SecretCatalog): Promise<SecretReadinessReport>;
  run(command: readonly string[], options?: InfisicalRunOptions): Promise<InfisicalRunResult>;
}

export interface InfisicalMutationRequest {
  operation: "replace";
  key: SecretKey;
  projectId: string;
  environment: string;
  secretPath: string;
}

export type InfisicalMutationPolicy = (request: InfisicalMutationRequest) => boolean | Promise<boolean>;

export interface ReplaceSecretOptions {
  verify?: (client: InfisicalClient) => void | Promise<void>;
}

export interface ReplaceSecretResult {
  key: SecretKey;
  replaced: true;
  verified: boolean;
}

export interface InfisicalMaintenanceClient {
  replaceSecret(
    key: SecretKey,
    replacement: string,
    options?: ReplaceSecretOptions,
  ): Promise<ReplaceSecretResult>;
}
