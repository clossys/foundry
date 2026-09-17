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
  /**
   * Structural, not `NodeJS.ProcessEnv`: this package has no runtime
   * dependency on `@types/node`, so its published types never reference the
   * ambient `NodeJS` namespace. `Record<string, string | undefined>` is
   * what `process.env` already looks like structurally, so nothing is lost
   * by consumers who do have `@types/node` installed.
   */
  env?: Record<string, string | undefined>;
}

export interface InfisicalRunResult {
  exitCode: number | null;
  /**
   * The signal name that ended the child process, or `null`. Typed as
   * `string | null` rather than `NodeJS.Signals | null` for the same
   * reason as {@link InfisicalRunOptions.env} -- this package's published
   * types must not require `@types/node` to resolve. The runtime value is
   * still whatever Node's own `child_process` reports.
   */
  signal: string | null;
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
