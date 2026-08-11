import { describe, expect, it } from "vitest";
import { createRenderInspector } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createRenderInspector", () => {
  it("fails closed on invalid runtime construction options", () => {
    const invalidOptions = [
      undefined,
      {},
      { fetch: async () => response({}) },
      { getBearerToken: () => "test-token" },
    ];
    for (const options of invalidOptions) {
      expect(() => createRenderInspector(options as unknown as { fetch: typeof globalThis.fetch; getBearerToken: () => string })).toThrowError(expect.objectContaining({ kind: "invalid-input" }));
    }
    expect(() => createRenderInspector({ fetch: async () => response({}), getBearerToken: () => "test-token", apiBaseUrl: 42 as unknown as string })).toThrowError(expect.objectContaining({ kind: "invalid-base-url" }));
  });

  it("accepts a cross-realm-compatible abort signal shape and stops before credential use", async () => {
    let credentialCalls = 0;
    const inspector = createRenderInspector({
      fetch: async () => response({}),
      getBearerToken: () => { credentialCalls += 1; return "test-token"; },
    });
    const signal = { aborted: true } as unknown as AbortSignal;
    await expect(inspector.inspect({ service: "srv-input", signal })).rejects.toMatchObject({ kind: "aborted" });
    expect(credentialCalls).toBe(0);
  });

  it("uses GET-only requests and returns a whitelist projection", async () => {
    const urls: URL[] = [];
    const inits: RequestInit[] = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      urls.push(new URL(String(input))); inits.push(init ?? {});
      if (urls.length === 1) return response({ id: "service-private-id", suspended: "not_suspended" });
      if (urls.length === 2) return response([{ cursor: "deploy-page", deploy: { status: "live", private: "not-returned" } }]);
      return response([{ cursor: "last-page", customDomain: { name: "app.example.test", verificationStatus: "verified", private: "not-returned" } }]);
    };
    const inspector = createRenderInspector({ fetch, getBearerToken: () => "test-token" });
    await expect(inspector.inspect({ service: "srv-123", expectedDomains: ["app.example.test"] })).resolves.toEqual({ service: "present", deployment: "live", serviceHealth: "unknown", domains: [{ domain: "app.example.test", status: "present" }] });
    expect(inits.every((init) => init.method === "GET" && init.credentials === "omit" && init.redirect === "error")).toBe(true);
    expect(urls.map((url) => url.pathname)).toEqual(["/v1/services/srv-123", "/v1/services/service-private-id/deploys", "/v1/services/service-private-id/custom-domains"]);
  });

  it("maps Render's suspended string without exposing provider fields", async () => {
    let calls = 0;
    const inspector = createRenderInspector({
      fetch: async () => {
        calls += 1;
        return calls === 1 ? response({ id: "service-private-id", suspended: "suspended" }) : response([{ cursor: "deploy-page", deploy: { status: "live" } }]);
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ service: "srv-123" })).resolves.toMatchObject({ serviceHealth: "unhealthy", deployment: "live" });
  });

  it("reports a missing service as a normal result", async () => {
    const inspector = createRenderInspector({ fetch: async () => response({}, 404), getBearerToken: () => "test-token" });
    await expect(inspector.inspect({ service: "srv-123" })).resolves.toEqual({ service: "missing", deployment: "none", serviceHealth: "unknown", domains: [] });
  });

  it("follows Render's paired cursor envelope for expected domains", async () => {
    let calls = 0;
    const urls: URL[] = [];
    const inspector = createRenderInspector({
      fetch: async (input) => {
        calls += 1;
        urls.push(new URL(String(input)));
        if (calls === 1) return response({ id: "srv-canonical" });
        if (calls === 2) return response([{ cursor: "deploy-page", deploy: { status: "live" } }]);
        if (calls === 3) return response([{ cursor: "next-page", customDomain: { name: "other.example.test", verificationStatus: "verified" } }]);
        return response([{ cursor: "last-page", customDomain: { name: "app.example.test", verificationStatus: "unverified" } }]);
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ service: "srv-input", expectedDomains: ["app.example.test"] })).resolves.toMatchObject({ domains: [{ domain: "app.example.test", status: "unverified" }] });
    expect(urls[3]!.searchParams.get("cursor")).toBe("next-page");
  });

  it("does not report an unseen domain as missing when pagination is bounded", async () => {
    let calls = 0;
    const inspector = createRenderInspector({
      fetch: async () => {
        calls += 1;
        if (calls === 1) return response({ id: "srv-canonical" });
        if (calls === 2) return response([]);
        return response([{ cursor: "next-page", customDomain: { name: "other.example.test", verificationStatus: "verified" } }]);
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ service: "srv-input", expectedDomains: ["app.example.test"], maxPages: 1 })).resolves.toMatchObject({ domains: [{ domain: "app.example.test", status: "unknown" }] });
  });

  it("stops on a repeated cursor and keeps unchecked domains unknown", async () => {
    let calls = 0;
    const inspector = createRenderInspector({
      fetch: async () => {
        calls += 1;
        if (calls === 1) return response({ id: "srv-canonical" });
        if (calls === 2) return response([{ cursor: "deploy-page", deploy: { status: "live" } }]);
        return response([{ cursor: "repeated-page", customDomain: { name: "other.example.test", verificationStatus: "verified" } }]);
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ service: "srv-input", expectedDomains: ["app.example.test"] })).resolves.toMatchObject({ domains: [{ domain: "app.example.test", status: "unknown" }] });
    expect(calls).toBe(4);
  });

  it("does not request custom domains when none are expected", async () => {
    const urls: URL[] = [];
    const inspector = createRenderInspector({
      fetch: async (input) => {
        urls.push(new URL(String(input)));
        return urls.length === 1
          ? response({ id: "srv-canonical" })
          : response([{ cursor: "deploy-page", deploy: { status: "live" } }]);
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ service: "srv-input" })).resolves.toMatchObject({ domains: [] });
    expect(urls.map((url) => url.pathname)).toEqual(["/v1/services/srv-input", "/v1/services/srv-canonical/deploys"]);
  });

  it("keeps an unknown provider verification value unknown", async () => {
    let calls = 0;
    const inspector = createRenderInspector({
      fetch: async () => {
        calls += 1;
        if (calls === 1) return response({ id: "srv-canonical" });
        if (calls === 2) return response([{ cursor: "deploy-page", deploy: { status: "live" } }]);
        return response([{ cursor: "domain-page", customDomain: { name: "app.example.test", verificationStatus: "pending" } }]);
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ service: "srv-input", expectedDomains: ["app.example.test"] })).resolves.toMatchObject({ domains: [{ domain: "app.example.test", status: "unknown" }] });
  });

  it("rejects malformed cursor envelopes instead of inferring a result", async () => {
    let calls = 0;
    const inspector = createRenderInspector({
      fetch: async () => {
        calls += 1;
        return calls === 1 ? response({ id: "srv-canonical" }) : response([{ status: "live" }]);
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ service: "srv-input" })).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("does not expose thrown credential values and rejects duplicate normalized domains", async () => {
    const inspector = createRenderInspector({
      fetch: async () => response({}),
      getBearerToken: () => { throw new Error("credential-sentinel"); },
    });
    await expect(inspector.inspect({ service: "srv-input" })).rejects.toEqual(expect.objectContaining({ kind: "credential-unavailable", message: "Render credentials are unavailable." }));
    await expect(inspector.inspect({ service: "srv-input", expectedDomains: ["app.example.test", "APP.EXAMPLE.TEST."] })).rejects.toMatchObject({ kind: "invalid-input" });
  });

  it("fails closed when an untyped caller provides a non-string credential", async () => {
    const inspector = createRenderInspector({
      fetch: async () => response({}),
      getBearerToken: () => undefined as unknown as string,
    });
    await expect(inspector.inspect({ service: "srv-input" })).rejects.toMatchObject({ kind: "credential-unavailable" });
  });

  it("fails closed on untyped invalid inspection input", async () => {
    const inspector = createRenderInspector({ fetch: async () => response({}), getBearerToken: () => "test-token" });
    await expect(inspector.inspect({ service: "srv-input", expectedDomains: [123] } as unknown as { service: string; expectedDomains: readonly string[] })).rejects.toMatchObject({ kind: "invalid-input" });
  });
});
