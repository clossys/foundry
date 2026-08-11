import type { SecretKey } from "../types.js";
import { InfisicalError, type InfisicalErrorCode } from "./errors.js";
import type { InfisicalClientConfig } from "./types.js";

export interface NormalizedConfig {
  baseUrl: string;
  projectId: string;
  environment: string;
  secretPath: string;
  accessTokenProvider: InfisicalClientConfig["accessTokenProvider"];
  fetch: typeof fetch;
}

export interface SecretRecord {
  key: SecretKey;
  value?: string;
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InfisicalError("INFISICAL_CONFIGURATION_INVALID", "Infisical baseUrl must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InfisicalError("INFISICAL_CONFIGURATION_INVALID", "Infisical baseUrl must be an absolute HTTP(S) URL.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeConfig(config: InfisicalClientConfig): NormalizedConfig {
  const projectId = config.projectId.trim();
  const environment = config.environment.trim();
  const secretPath = config.secretPath?.trim() || "/";
  if (projectId.length === 0 || environment.length === 0) {
    throw new InfisicalError(
      "INFISICAL_CONFIGURATION_INVALID",
      "Infisical projectId and environment must be injected explicitly.",
    );
  }
  if (!secretPath.startsWith("/") || secretPath.split("/").includes("..")) {
    throw new InfisicalError(
      "INFISICAL_CONFIGURATION_INVALID",
      "Infisical secretPath must be absolute within the project and must not contain parent traversal.",
    );
  }
  return {
    baseUrl: normalizeBaseUrl(config.baseUrl),
    projectId,
    environment,
    secretPath,
    accessTokenProvider: config.accessTokenProvider,
    fetch: config.fetch ?? globalThis.fetch,
  };
}

export async function parseJsonObject(
  response: Response,
  code: InfisicalErrorCode = "INFISICAL_RESPONSE_INVALID",
  message = "Infisical returned an invalid response.",
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid object");
    return value as Record<string, unknown>;
  } catch {
    throw new InfisicalError(code, message, { status: response.status });
  }
}

export class InfisicalTransport {
  readonly config: NormalizedConfig;

  constructor(config: InfisicalClientConfig) {
    this.config = normalizeConfig(config);
  }

  private query(includeValues: boolean, expandSecretReferences = includeValues): URLSearchParams {
    return new URLSearchParams({
      projectId: this.config.projectId,
      environment: this.config.environment,
      secretPath: this.config.secretPath,
      viewSecretValue: String(includeValues),
      expandSecretReferences: String(expandSecretReferences),
      includeImports: "true",
    });
  }

  private async request(url: string, init: RequestInit = {}, key?: SecretKey): Promise<Response> {
    let accessToken: string;
    try {
      accessToken = await this.config.accessTokenProvider.getAccessToken();
    } catch {
      throw new InfisicalError("INFISICAL_AUTH_FAILED", "Infisical access token acquisition failed.", { key });
    }
    let response: Response;
    try {
      response = await this.config.fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...init.headers,
        },
      });
    } catch {
      throw new InfisicalError("INFISICAL_REQUEST_FAILED", "Infisical request failed.", { key });
    }
    return response;
  }

  async get(key: SecretKey, options: { expandSecretReferences?: boolean } = {}): Promise<string | null> {
    const url = `${this.config.baseUrl}/api/v4/secrets/${encodeURIComponent(key)}?${this.query(
      true,
      options.expandSecretReferences ?? true,
    )}`;
    const response = await this.request(url, {}, key);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new InfisicalError("INFISICAL_REQUEST_FAILED", "Infisical secret lookup failed.", {
        key,
        status: response.status,
      });
    }
    const payload = await parseJsonObject(response);
    const secret = payload.secret;
    if (secret === null || typeof secret !== "object" || Array.isArray(secret)) {
      throw new InfisicalError("INFISICAL_RESPONSE_INVALID", "Infisical secret lookup returned an invalid response.", {
        key,
        status: response.status,
      });
    }
    const record = secret as Record<string, unknown>;
    const value = record.secretValue;
    if (record.secretKey !== key || typeof value !== "string") {
      throw new InfisicalError("INFISICAL_RESPONSE_INVALID", "Infisical secret lookup returned an invalid response.", {
        key,
        status: response.status,
      });
    }
    return value;
  }

  async list(includeValues: boolean): Promise<readonly SecretRecord[]> {
    const url = `${this.config.baseUrl}/api/v4/secrets?${this.query(includeValues)}`;
    const response = await this.request(url);
    if (!response.ok) {
      throw new InfisicalError("INFISICAL_REQUEST_FAILED", "Infisical secret listing failed.", {
        status: response.status,
      });
    }
    const payload = await parseJsonObject(response);
    if (!Array.isArray(payload.secrets) || (payload.imports !== undefined && !Array.isArray(payload.imports))) {
      throw new InfisicalError("INFISICAL_RESPONSE_INVALID", "Infisical secret listing returned an invalid response.");
    }
    const resolved = new Map<SecretKey, SecretRecord>();
    const addRecords = (items: unknown[]): void => {
      const sourceKeys = new Set<SecretKey>();
      for (const item of items) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) {
          throw new InfisicalError(
            "INFISICAL_RESPONSE_INVALID",
            "Infisical secret listing returned an invalid response.",
          );
        }
        const record = item as Record<string, unknown>;
        if (typeof record.secretKey !== "string") {
          throw new InfisicalError(
            "INFISICAL_RESPONSE_INVALID",
            "Infisical secret listing returned an invalid response.",
          );
        }
        if (includeValues && typeof record.secretValue !== "string") {
          throw new InfisicalError(
            "INFISICAL_RESPONSE_INVALID",
            "Infisical secret listing returned an invalid response.",
          );
        }
        const parsed = {
          key: record.secretKey,
          ...(includeValues ? { value: record.secretValue as string } : {}),
        };
        if (sourceKeys.has(parsed.key)) {
          throw new InfisicalError(
            "INFISICAL_RESPONSE_INVALID",
            "Infisical secret listing returned duplicate keys within one source.",
            { key: parsed.key },
          );
        }
        sourceKeys.add(parsed.key);
        resolved.set(parsed.key, parsed);
      }
    };
    for (const importGroup of (payload.imports ?? []) as unknown[]) {
      if (importGroup === null || typeof importGroup !== "object" || Array.isArray(importGroup)) {
        throw new InfisicalError("INFISICAL_RESPONSE_INVALID", "Infisical secret listing returned an invalid response.");
      }
      const importedSecrets = (importGroup as Record<string, unknown>).secrets;
      if (!Array.isArray(importedSecrets)) {
        throw new InfisicalError("INFISICAL_RESPONSE_INVALID", "Infisical secret listing returned an invalid response.");
      }
      addRecords(importedSecrets);
    }
    addRecords(payload.secrets);
    return [...resolved.values()];
  }

  async replace(key: SecretKey, value: string): Promise<void> {
    const url = `${this.config.baseUrl}/api/v4/secrets/${encodeURIComponent(key)}`;
    const response = await this.request(
      url,
      {
        method: "PATCH",
        body: JSON.stringify({
          projectId: this.config.projectId,
          environment: this.config.environment,
          secretPath: this.config.secretPath,
          secretValue: value,
          type: "shared",
        }),
      },
      key,
    );
    if (!response.ok) {
      throw new InfisicalError("INFISICAL_REPLACEMENT_FAILED", "Infisical secret replacement failed.", {
        key,
        status: response.status,
      });
    }
  }
}
