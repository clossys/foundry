import { describe, expect, it } from "vitest";
import { createRenderInspector } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createRenderInspector", () => {
  it("uses GET-only requests and returns a whitelist projection", async () => {
    const urls: URL[] = [];
    const inits: RequestInit[] = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      urls.push(new URL(String(input))); inits.push(init ?? {});
      if (urls.length === 1) return response({ id: "service-private-id", suspended: false });
      if (urls.length === 2) return response([{ status: "live", private: "not-returned" }]);
      return response([{ name: "app.example.test", verified: true }]);
    };
    const inspector = createRenderInspector({ fetch, getBearerToken: () => "test-token" });
    await expect(inspector.inspect({ service: "srv-123", expectedDomains: ["app.example.test"] })).resolves.toEqual({ service: "present", deployment: "live", serviceHealth: "unknown", domains: [{ domain: "app.example.test", status: "present" }] });
    expect(inits.every((init) => init.method === "GET" && init.credentials === "omit" && init.redirect === "error")).toBe(true);
    expect(urls.map((url) => url.pathname)).toEqual(["/v1/services/srv-123", "/v1/services/service-private-id/deploys", "/v1/services/service-private-id/custom-domains"]);
  });

  it("maps suspended services without exposing provider fields", async () => {
    let calls = 0;
    const inspector = createRenderInspector({
      fetch: async () => {
        calls += 1;
        return calls === 1 ? response({ id: "service-private-id", suspended: true }) : response([{ status: "live" }]);
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
        if (calls === 3) return response([{ cursor: "next-page", customDomain: { name: "other.example.test", verified: true } }]);
        return response([{ cursor: "last-page", customDomain: { name: "app.example.test", verified: false } }]);
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
        return response([{ cursor: "next-page", customDomain: { name: "other.example.test", verified: true } }]);
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ service: "srv-input", expectedDomains: ["app.example.test"], maxPages: 1 })).resolves.toMatchObject({ domains: [{ domain: "app.example.test", status: "unknown" }] });
  });
});
