import { describe, expect, it, vi } from "vitest";
import { defineSecretCatalog } from "../catalog.js";
import {
  InfisicalError,
  createAccessTokenProvider,
  createInfisicalClient,
  createInfisicalMaintenanceClient,
  createOidcTokenProvider,
  parseValueFreeCatalog,
} from "./index.js";

const config = (fetch: typeof globalThis.fetch) => ({
  baseUrl: "https://secrets.example.test",
  projectId: "project-example",
  environment: "test",
  secretPath: "/app",
  accessTokenProvider: createAccessTokenProvider("access-example"),
  fetch,
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("authentication", () => {
  it("supports late-bound access tokens", async () => {
    let token = "first-example";
    const provider = createAccessTokenProvider(() => token);
    await expect(provider.getAccessToken()).resolves.toBe("first-example");
    token = "second-example";
    await expect(provider.getAccessToken()).resolves.toBe("second-example");
  });

  it("exchanges and caches OIDC tokens without placing them in the URL", async () => {
    let now = 1_000;
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(String(_input)).toBe("https://secrets.example.test/api/v1/auth/oidc-auth/login");
      expect(String(_input)).not.toContain("identity-example-token");
      expect(JSON.parse(String(init?.body))).toEqual({
        identityId: "identity-example",
        jwt: "identity-example-token",
      });
      expect(init?.headers).toEqual({ "content-type": "application/json" });
      return response({ accessToken: "access-example", expiresIn: 120 });
    }) as unknown as typeof globalThis.fetch;
    const provider = createOidcTokenProvider({
      baseUrl: "https://secrets.example.test/",
      identityId: "  identity-example  ",
      getIdentityToken: async () => "identity-example-token",
      fetch,
      now: () => now,
    });

    await expect(provider.getAccessToken()).resolves.toBe("access-example");
    now += 10_000;
    await expect(provider.getAccessToken()).resolves.toBe("access-example");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects non-finite OIDC expiry values instead of caching indefinitely", async () => {
    const fetch = vi.fn(async () => response({ accessToken: "access-example", expiresIn: Number.POSITIVE_INFINITY })) as unknown as typeof globalThis.fetch;
    const provider = createOidcTokenProvider({
      baseUrl: "https://secrets.example.test",
      identityId: "identity-example",
      getIdentityToken: async () => "identity-example-token",
      fetch,
    });

    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "INFISICAL_AUTH_FAILED" });
  });

  it("shares concurrent OIDC exchanges and retries after a rejected exchange", async () => {
    const getIdentityToken = vi.fn(async () => "identity-example-token");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ message: "rejected detail" }, 503))
      .mockResolvedValue(
        response({ accessToken: "access-example", expiresIn: 120 }),
      ) as unknown as typeof globalThis.fetch;
    const provider = createOidcTokenProvider({
      baseUrl: "https://secrets.example.test",
      identityId: "identity-example",
      getIdentityToken,
      fetch,
    });

    const firstAttempt = await Promise.allSettled([
      provider.getAccessToken(),
      provider.getAccessToken(),
    ]);
    expect(firstAttempt.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(getIdentityToken).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(
      Promise.all([provider.getAccessToken(), provider.getAccessToken()]),
    ).resolves.toEqual(["access-example", "access-example"]);
    expect(getIdentityToken).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retain a rejected provider response body in the error", async () => {
    const fetch = vi.fn(async () => response({ message: "sensitive provider detail" }, 401)) as unknown as typeof globalThis.fetch;
    const provider = createOidcTokenProvider({
      baseUrl: "https://secrets.example.test",
      identityId: "identity-example",
      getIdentityToken: async () => "identity-example-token",
      fetch,
    });
    const error = await provider.getAccessToken().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InfisicalError);
    expect(String(error)).not.toContain("sensitive provider detail");
  });

  it("replaces access-token factory errors instead of retaining their details", async () => {
    const provider = createAccessTokenProvider(() => {
      throw new Error("sensitive token-source detail");
    });
    const error = await provider.getAccessToken().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "INFISICAL_AUTH_FAILED" });
    expect(String(error)).not.toContain("sensitive token-source detail");
  });

  it("replaces typed access-token factory errors instead of retaining their details", async () => {
    const provider = createAccessTokenProvider(() => {
      throw new InfisicalError("INFISICAL_AUTH_FAILED", "sensitive typed token-source detail");
    });
    const error = await provider.getAccessToken().catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "INFISICAL_AUTH_FAILED",
      message: "Infisical access token acquisition failed.",
    });
    expect(String(error)).not.toContain("sensitive typed token-source detail");
  });
});

describe("Infisical client", () => {
  it("resolves one secret through the v4 API", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("/api/v4/secrets/EXAMPLE_KEY?");
      expect(String(input)).toContain("projectId=project-example");
      expect(String(input)).toContain("expandSecretReferences=true");
      expect(init?.headers).toMatchObject({ authorization: "Bearer access-example" });
      return response({ secret: { secretKey: "EXAMPLE_KEY", secretValue: "example-value" } });
    }) as unknown as typeof globalThis.fetch;

    await expect(createInfisicalClient(config(fetch)).get("EXAMPLE_KEY")).resolves.toBe("example-value");
  });

  it("redacts errors from custom access-token providers", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const client = createInfisicalClient({
      ...config(fetch),
      accessTokenProvider: {
        async getAccessToken() {
          throw new InfisicalError("INFISICAL_AUTH_FAILED", "sensitive custom-provider detail");
        },
      },
    });
    const error = await client.get("EXAMPLE_KEY").catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "INFISICAL_AUTH_FAILED",
      message: "Infisical access token acquisition failed.",
      key: "EXAMPLE_KEY",
    });
    expect(String(error)).not.toContain("sensitive custom-provider detail");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a lookup response for a different secret key", async () => {
    const fetch = vi.fn(async () =>
      response({ secret: { secretKey: "OTHER_KEY", secretValue: "example-value" } }),
    ) as unknown as typeof globalThis.fetch;

    await expect(createInfisicalClient(config(fetch)).get("EXAMPLE_KEY")).rejects.toMatchObject({
      code: "INFISICAL_RESPONSE_INVALID",
      key: "EXAMPLE_KEY",
    });
  });

  it("lists names without asking the provider for values", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("viewSecretValue=false");
      expect(String(input)).toContain("expandSecretReferences=false");
      return response({
        secrets: [{ secretKey: "SECOND_KEY" }, { secretKey: "FIRST_KEY" }],
        imports: [{ secrets: [{ secretKey: "IMPORTED_KEY" }] }],
      });
    }) as unknown as typeof globalThis.fetch;

    await expect(createInfisicalClient(config(fetch)).listSecretNames()).resolves.toEqual([
      "FIRST_KEY",
      "IMPORTED_KEY",
      "SECOND_KEY",
    ]);
  });

  it("checks catalog readiness from a names-only listing", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("viewSecretValue=false");
      expect(String(input)).toContain("expandSecretReferences=false");
      return response({
        imports: [],
        secrets: [{ secretKey: "OPTIONAL_KEY" }],
      });
    }) as unknown as typeof globalThis.fetch;
    const report = await createInfisicalClient(config(fetch)).checkCatalog(
      defineSecretCatalog([
        { key: "REQUIRED_KEY", required: true },
        { key: "OPTIONAL_KEY", required: false },
      ]),
    );

    expect(report).toEqual({
      ok: false,
      entries: [
        { key: "REQUIRED_KEY", required: true, present: false },
        { key: "OPTIONAL_KEY", required: false, present: true },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects empty readiness coverage before making a request", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;

    await expect(createInfisicalClient(config(fetch)).checkCatalog(defineSecretCatalog([]))).rejects.toMatchObject({
      code: "INFISICAL_CONFIGURATION_INVALID",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects duplicate programmatic readiness coverage before making a request", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;

    await expect(
      createInfisicalClient(config(fetch)).checkCatalog(
        defineSecretCatalog([
          { key: "EXAMPLE_KEY", required: true },
          { key: "EXAMPLE_KEY", required: false },
        ]),
      ),
    ).rejects.toMatchObject({ code: "INFISICAL_CONFIGURATION_INVALID", key: "EXAMPLE_KEY" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unsafe project paths before making a request", () => {
    expect(() => createInfisicalClient({ ...config(vi.fn() as unknown as typeof globalThis.fetch), secretPath: "/../other" })).toThrow(
      /parent traversal/,
    );
  });

  it("injects imported and local secrets into one non-shell child process", async () => {
    const fetch = vi.fn(async () =>
      response({
        imports: [{ secrets: [{ secretKey: "IMPORTED_KEY", secretValue: "imported-example" }] }],
        secrets: [
          { secretKey: "EXAMPLE_KEY", secretValue: "example-value" },
          { secretKey: "IMPORTED_KEY", secretValue: "local-example" },
        ],
      }),
    ) as unknown as typeof globalThis.fetch;

    await expect(
      createInfisicalClient(config(fetch)).run(
        [
          process.execPath,
          "-e",
          "process.exit(process.env.EXAMPLE_KEY === 'example-value' && process.env.IMPORTED_KEY === 'local-example' && process.env.INFISICAL_TOKEN === undefined && process.env.infisical_token === undefined && process.env.INFISICAL_JWT === undefined && process.env.INFISICAL_MACHINE_IDENTITY_ID === undefined && process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID === undefined ? 0 : 1)",
        ],
        {
          env: {
            INFISICAL_TOKEN: "provider-access-example",
            infisical_token: "provider-case-example",
            INFISICAL_JWT: "provider-identity-example",
            INFISICAL_MACHINE_IDENTITY_ID: "identity-example",
            INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: "client-example",
          },
        },
      ),
    ).resolves.toEqual({ exitCode: 0, signal: null });
  });

  it("forwards termination signals to the child and removes wrapper listeners", async () => {
    const fetch = vi.fn(async () => response({ imports: [], secrets: [] })) as unknown as typeof globalThis.fetch;
    const existing = new Set(process.listeners("SIGTERM"));
    const result = createInfisicalClient(config(fetch)).run([
      process.execPath,
      "-e",
      "setInterval(() => undefined, 1_000)",
    ]);

    await vi.waitFor(() => {
      expect(process.listeners("SIGTERM").some((listener) => !existing.has(listener))).toBe(true);
    });
    const forwarder = process.listeners("SIGTERM").find((listener) => !existing.has(listener));
    expect(forwarder).toBeDefined();
    forwarder?.("SIGTERM");

    await expect(result).resolves.toEqual({ exitCode: null, signal: "SIGTERM" });
    expect(process.listeners("SIGTERM").every((listener) => existing.has(listener))).toBe(true);
  });

  it("redacts synchronous child-process validation failures", async () => {
    const rejectedValue = "example\u0000value";
    const fetch = vi.fn(async () =>
      response({
        imports: [],
        secrets: [{ secretKey: "EXAMPLE_KEY", secretValue: rejectedValue }],
      }),
    ) as unknown as typeof globalThis.fetch;
    let thrown: unknown;

    try {
      await createInfisicalClient(config(fetch)).run([process.execPath, "-e", "process.exit(0)"]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "INFISICAL_RUN_FAILED",
      message: "Infisical child process failed to start.",
    });
    expect(String(thrown)).not.toContain(rejectedValue);
  });

  it("preserves accepted environment keys with special object semantics", async () => {
    const fetch = vi.fn(async () =>
      response({
        imports: [],
        secrets: [{ secretKey: "__proto__", secretValue: "example-value" }],
      }),
    ) as unknown as typeof globalThis.fetch;

    await expect(
      createInfisicalClient(config(fetch)).run([
        process.execPath,
        "-e",
        "process.exit(Object.hasOwn(process.env, '__proto__') && process.env['__proto__'] === 'example-value' ? 0 : 1)",
      ]),
    ).resolves.toEqual({ exitCode: 0, signal: null });
  });

  it("rejects provider authentication keys returned as application secrets", async () => {
    const fetch = vi.fn(async () =>
      response({
        secrets: [{ secretKey: "INFISICAL_MACHINE_IDENTITY_ID", secretValue: "identity-example" }],
        imports: [],
      }),
    ) as unknown as typeof globalThis.fetch;
    await expect(createInfisicalClient(config(fetch)).run([process.execPath, "-e", "process.exit(0)"])).rejects.toMatchObject({
      code: "INFISICAL_RUN_FAILED",
      key: "INFISICAL_MACHINE_IDENTITY_ID",
    });
  });

  it("rejects universal-auth client identity returned as an application secret", async () => {
    const fetch = vi.fn(async () =>
      response({
        secrets: [{ secretKey: "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", secretValue: "identity-example" }],
        imports: [],
      }),
    ) as unknown as typeof globalThis.fetch;
    await expect(createInfisicalClient(config(fetch)).run([process.execPath, "-e", "process.exit(0)"])).rejects.toMatchObject({
      code: "INFISICAL_RUN_FAILED",
      key: "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID",
    });
  });

  it("rejects case variants of provider authentication keys", async () => {
    const fetch = vi.fn(async () =>
      response({
        secrets: [{ secretKey: "infisical_token", secretValue: "access-example" }],
        imports: [],
      }),
    ) as unknown as typeof globalThis.fetch;
    await expect(createInfisicalClient(config(fetch)).run([process.execPath, "-e", "process.exit(0)"])).rejects.toMatchObject({
      code: "INFISICAL_RUN_FAILED",
      key: "infisical_token",
    });
  });

  it("rejects duplicate keys within a provider source list", async () => {
    const fetch = vi.fn(async () =>
      response({
        secrets: [
          { secretKey: "EXAMPLE_KEY", secretValue: "first-example" },
          { secretKey: "EXAMPLE_KEY", secretValue: "second-example" },
        ],
        imports: [],
      }),
    ) as unknown as typeof globalThis.fetch;

    await expect(createInfisicalClient(config(fetch)).run([process.execPath, "-e", "process.exit(0)"])).rejects.toMatchObject({
      code: "INFISICAL_RESPONSE_INVALID",
      key: "EXAMPLE_KEY",
    });
  });

  it("rejects case-folded provider and inherited key collisions on Windows", async () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      const duplicateFetch = vi.fn(async () =>
        response({
          secrets: [
            { secretKey: "APP_TOKEN", secretValue: "first-example" },
            { secretKey: "app_token", secretValue: "second-example" },
          ],
          imports: [],
        }),
      ) as unknown as typeof globalThis.fetch;
      await expect(
        createInfisicalClient(config(duplicateFetch)).run([process.execPath, "-e", "process.exit(0)"]),
      ).rejects.toMatchObject({ code: "INFISICAL_RUN_FAILED", key: "app_token" });

      const inheritedFetch = vi.fn(async () =>
        response({
          secrets: [{ secretKey: "APP_TOKEN", secretValue: "injected-example" }],
          imports: [],
        }),
      ) as unknown as typeof globalThis.fetch;
      await expect(
        createInfisicalClient(config(inheritedFetch)).run(
          [process.execPath, "-e", "process.exit(0)"],
          { env: { app_token: "inherited-example" } },
        ),
      ).rejects.toMatchObject({ code: "INFISICAL_RUN_FAILED", key: "app_token" });
    } finally {
      platform.mockRestore();
    }
  });
});

describe("value-free catalog parser", () => {
  it("accepts metadata and rejects value-bearing or duplicate entries", () => {
    expect(parseValueFreeCatalog({ version: 1, entries: [{ key: "EXAMPLE_KEY", required: true }] })).toEqual({
      version: 1,
      entries: [{ key: "EXAMPLE_KEY", required: true }],
    });
    expect(() =>
      parseValueFreeCatalog({ version: 1, entries: [{ key: "EXAMPLE_KEY", required: true, value: "example-value" }] }),
    ).toThrow(/value-free/);
    expect(() =>
      parseValueFreeCatalog({ version: 1, entries: [{ key: "EXAMPLE_KEY", required: true }], token: "example-value" }),
    ).toThrow(/value-free/);
    expect(() => parseValueFreeCatalog({ version: 1, entries: [] })).toThrow(/value-free/);
    expect(() =>
      parseValueFreeCatalog({
        version: 1,
        entries: [
          { key: "EXAMPLE_KEY", required: true },
          { key: "EXAMPLE_KEY", required: false },
        ],
      }),
    ).toThrow(/unique/);
  });
});

describe("permission-gated maintenance", () => {
  it("denies replacement before reading or writing", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const maintenance = createInfisicalMaintenanceClient(config(fetch), () => false);
    await expect(maintenance.replaceSecret("EXAMPLE_KEY", "replacement-example")).rejects.toMatchObject({
      code: "INFISICAL_MUTATION_DENIED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats an authorization callback failure as a denial without retaining details", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const maintenance = createInfisicalMaintenanceClient(config(fetch), () => {
      throw new Error("sensitive approval detail");
    });
    const error = await maintenance.replaceSecret("EXAMPLE_KEY", "replacement-example").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "INFISICAL_MUTATION_DENIED" });
    expect(String(error)).not.toContain("sensitive approval detail");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not issue an unsafe automatic rollback when verification fails", async () => {
    const writes: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { secretValue: string };
        writes.push(body.secretValue);
        return response({ secret: {} });
      }
      expect(String(input)).toContain("expandSecretReferences=false");
      return response({ secret: { secretKey: "EXAMPLE_KEY", secretValue: "${REFERENCE_KEY}" } });
    }) as unknown as typeof globalThis.fetch;
    const maintenance = createInfisicalMaintenanceClient(config(fetch), (request) => request.operation === "replace");

    await expect(
      maintenance.replaceSecret("EXAMPLE_KEY", "replacement-example", {
        verify: async () => {
          throw new Error("not ready");
        },
      }),
    ).rejects.toMatchObject({ code: "INFISICAL_REPLACEMENT_FAILED" });
    expect(writes).toEqual(["replacement-example"]);
  });

  it("serializes same-key replacements across clients within one process", async () => {
    let current = "original-example";
    const writes: string[] = [];
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { secretValue: string };
        current = body.secretValue;
        writes.push(current);
        return response({ secret: {} });
      }
      return response({ secret: { secretKey: "EXAMPLE_KEY", secretValue: current } });
    }) as unknown as typeof globalThis.fetch;
    const firstClient = createInfisicalMaintenanceClient(config(fetch), () => true);
    const secondClient = createInfisicalMaintenanceClient(config(fetch), () => true);
    let markVerificationStarted!: () => void;
    const verificationStarted = new Promise<void>((resolve) => {
      markVerificationStarted = resolve;
    });
    let releaseVerification!: () => void;
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });

    const first = firstClient.replaceSecret("EXAMPLE_KEY", "first-replacement", {
      verify: async () => {
        markVerificationStarted();
        await verificationGate;
        throw new Error("not ready");
      },
    });
    await verificationStarted;
    const second = secondClient.replaceSecret("EXAMPLE_KEY", "second-replacement");
    await Promise.resolve();
    expect(writes).toEqual(["first-replacement"]);

    releaseVerification();
    await expect(first).rejects.toMatchObject({ code: "INFISICAL_REPLACEMENT_FAILED" });
    await expect(second).resolves.toEqual({ key: "EXAMPLE_KEY", replaced: true, verified: false });
    expect(writes).toEqual(["first-replacement", "second-replacement"]);
    expect(current).toBe("second-replacement");
  });
});
