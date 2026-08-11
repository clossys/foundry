import { InfisicalError } from "./errors.js";
import type { InfisicalAccessTokenProvider, OidcTokenProviderOptions } from "./types.js";
import { normalizeBaseUrl, parseJsonObject } from "./internal.js";

function requireToken(value: string): string {
  if (value.trim().length === 0) {
    throw new InfisicalError("INFISICAL_AUTH_FAILED", "Infisical authentication did not produce an access token.");
  }
  return value.trim();
}

export function createAccessTokenProvider(accessToken: string | (() => string | Promise<string>)): InfisicalAccessTokenProvider {
  return {
    async getAccessToken(): Promise<string> {
      try {
        const value = typeof accessToken === "function" ? await accessToken() : accessToken;
        return requireToken(value);
      } catch {
        throw new InfisicalError("INFISICAL_AUTH_FAILED", "Infisical access token acquisition failed.");
      }
    },
  };
}

export function createOidcTokenProvider(options: OidcTokenProviderOptions): InfisicalAccessTokenProvider {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const identityId = options.identityId.trim();
  if (identityId.length === 0) {
    throw new InfisicalError("INFISICAL_CONFIGURATION_INVALID", "Infisical OIDC identityId must not be empty.");
  }

  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  const exchange = async (): Promise<string> => {
    let jwt: string;
    try {
      jwt = requireToken(await options.getIdentityToken());
    } catch {
      throw new InfisicalError("INFISICAL_AUTH_FAILED", "Infisical OIDC identity token acquisition failed.");
    }
    let response: Response;
    try {
      response = await request(`${baseUrl}/api/v1/auth/oidc-auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, jwt }),
      });
    } catch {
      throw new InfisicalError("INFISICAL_AUTH_FAILED", "Infisical OIDC authentication request failed.");
    }
    if (!response.ok) {
      throw new InfisicalError("INFISICAL_AUTH_FAILED", "Infisical OIDC authentication was rejected.", {
        status: response.status,
      });
    }

    const payload = await parseJsonObject(
      response,
      "INFISICAL_AUTH_FAILED",
      "Infisical OIDC authentication response was invalid.",
    );
    const token = typeof payload.accessToken === "string" ? requireToken(payload.accessToken) : null;
    const expiresIn =
      typeof payload.expiresIn === "number" && Number.isFinite(payload.expiresIn) && payload.expiresIn > 0
        ? payload.expiresIn
        : null;
    if (token === null || expiresIn === null) {
      throw new InfisicalError("INFISICAL_AUTH_FAILED", "Infisical OIDC authentication response was invalid.");
    }
    cached = { token, expiresAt: now() + expiresIn * 1_000 };
    return token;
  };

  return {
    async getAccessToken(): Promise<string> {
      if (cached !== null && cached.expiresAt - 30_000 > now()) return cached.token;
      if (inFlight !== null) return inFlight;

      const pending = exchange();
      inFlight = pending;
      try {
        return await pending;
      } finally {
        if (inFlight === pending) inFlight = null;
      }
    },
  };
}
