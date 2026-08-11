import { describe, expect, it } from "vitest";
import { createVercelInspector, VercelInspectionError } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function inspectorForResponses(responses: readonly Response[], token = "test-token") {
  let index = 0;
  return createVercelInspector({
    fetch: async () => responses[index++] ?? response({}, 500),
    getBearerToken: () => token,
  });
}

describe("createVercelInspector", () => {
  it("uses GET-only requests and returns a whitelist projection", async () => {
    const requests: RequestInit[] = [];
    const urls: URL[] = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      requests.push(init ?? {}); urls.push(new URL(String(input)));
      if (urls.length === 1) return response({ id: "project-private-id", name: "ignored" });
      if (urls.length === 2) return response({ deployments: [{ readyState: "READY", url: "not-returned" }] });
      return response({ domains: [{ name: "www.example.test", verified: true }], pagination: {} });
    };
    const inspector = createVercelInspector({ fetch, getBearerToken: () => "test-token" });
    await expect(inspector.inspect({ project: "web", teamId: "team-1", expectedDomains: ["WWW.EXAMPLE.TEST."] })).resolves.toEqual({ project: "present", deployment: "ready", domains: [{ domain: "www.example.test", status: "present" }] });
    expect(requests.every((request) => request.method === "GET" && request.credentials === "omit" && request.redirect === "error")).toBe(true);
    expect(requests.every((request) => (request.headers as Record<string, string>).Accept === "application/json" && (request.headers as Record<string, string>).Authorization === "Bearer test-token")).toBe(true);
    expect(urls.map((url) => url.pathname)).toEqual(["/v9/projects/web", "/v6/deployments", "/v9/projects/web/domains"]);
    expect(urls.every((url) => url.searchParams.get("teamId") === "team-1")).toBe(true);
    expect(urls[1]?.searchParams.get("projectId")).toBe("project-private-id");
    expect(urls[1]?.searchParams.get("target")).toBe("production");
    expect(urls[1]?.searchParams.get("limit")).toBe("1");
    expect(urls[2]?.searchParams.get("limit")).toBe("100");
  });

  it("reports a missing project without exposing provider content", async () => {
    const inspector = createVercelInspector({ fetch: async () => response({}, 404), getBearerToken: () => "test-token" });
    await expect(inspector.inspect({ project: "web" })).resolves.toEqual({ project: "missing", deployment: "none", domains: [] });
  });

  it("uses stable errors for unavailable credentials and never preserves their message", async () => {
    const inspector = createVercelInspector({ fetch: async () => response({}), getBearerToken: () => { throw new Error("credential-not-exposed"); } });
    await expect(inspector.inspect({ project: "web" })).rejects.toMatchObject({ kind: "credential-unavailable", message: "Vercel credentials are unavailable." } satisfies Partial<VercelInspectionError>);
  });

  it("normalizes malformed runtime credential values without a TypeError", async () => {
    const inspector = createVercelInspector({ fetch: async () => response({}), getBearerToken: () => ({ not: "a-token" }) as unknown as string });
    await expect(inspector.inspect({ project: "web" })).rejects.toMatchObject({ kind: "credential-unavailable", message: "Vercel credentials are unavailable." } satisfies Partial<VercelInspectionError>);
  });

  it("rejects malformed JavaScript inputs before requesting credentials", async () => {
    let credentialCalls = 0;
    const inspector = createVercelInspector({ fetch: async () => response({}), getBearerToken: () => { credentialCalls += 1; return "test-token"; } });
    await expect(inspector.inspect({ project: "web", expectedDomains: ["example.test", "EXAMPLE.TEST"] })).rejects.toMatchObject({ kind: "invalid-input" } satisfies Partial<VercelInspectionError>);
    await expect(inspector.inspect({ project: "web", expectedDomains: "example.test" } as unknown as { project: string })).rejects.toMatchObject({ kind: "invalid-input" } satisfies Partial<VercelInspectionError>);
    await expect(inspector.inspect({ project: "web", expectedDomains: ["https://example.test"] })).rejects.toMatchObject({ kind: "invalid-input" } satisfies Partial<VercelInspectionError>);
    expect(credentialCalls).toBe(0);
  });

  it("does not request a credential for an already aborted inspection", async () => {
    const controller = new AbortController();
    controller.abort();
    let credentialCalls = 0;
    const inspector = createVercelInspector({ fetch: async () => response({}), getBearerToken: () => { credentialCalls += 1; return "test-token"; } });
    await expect(inspector.inspect({ project: "web", signal: controller.signal })).rejects.toMatchObject({ kind: "aborted" } satisfies Partial<VercelInspectionError>);
    expect(credentialCalls).toBe(0);
  });

  it("normalizes an arbitrary fetch failure without preserving its message", async () => {
    const inspector = createVercelInspector({ fetch: async () => { throw new Error("provider-detail-not-exposed"); }, getBearerToken: () => "test-token" });
    await expect(inspector.inspect({ project: "web" })).rejects.toMatchObject({ kind: "network", message: "Vercel inspection request failed." } satisfies Partial<VercelInspectionError>);
  });

  it("does not report an unseen domain as missing when pagination is bounded", async () => {
    const inspector = inspectorForResponses([
      response({ id: "project-id" }),
      response({ deployments: [] }),
      response({ domains: [], pagination: { next: 1 } }),
    ]);
    await expect(inspector.inspect({ project: "web", expectedDomains: ["www.example.test"], maxDomainPages: 1 })).resolves.toMatchObject({ domains: [{ domain: "www.example.test", status: "unknown" }] });
  });

  it("does not call the domains endpoint when no domains are expected", async () => {
    let calls = 0;
    const inspector = createVercelInspector({
      fetch: async () => {
        calls += 1;
        return calls === 1 ? response({ id: "project-id" }) : response({ deployments: [] });
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ project: "web" })).resolves.toEqual({ project: "present", deployment: "none", domains: [] });
    expect(calls).toBe(2);
  });

  it("follows opaque pagination cursors and stops safely on a cursor loop", async () => {
    const urls: URL[] = [];
    const inspector = createVercelInspector({
      fetch: async (input) => {
        urls.push(new URL(String(input)));
        if (urls.length === 1) return response({ id: "project-id" });
        if (urls.length === 2) return response({ deployments: [] });
        if (urls.length === 3) return response({ domains: [], pagination: { next: "cursor-a" } });
        return response({ domains: [], pagination: { next: "cursor-a" } });
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ project: "web", expectedDomains: ["www.example.test"] })).resolves.toMatchObject({ domains: [{ status: "unknown" }] });
    expect(urls.map((url) => url.searchParams.get("until"))).toEqual([null, null, null, "cursor-a"]);
  });

  it("treats unverified and incompletely decoded expected domains conservatively", async () => {
    const unverified = inspectorForResponses([
      response({ id: "project-id" }),
      response({ deployments: [] }),
      response({ domains: [{ name: "www.example.test", verified: false }], pagination: {} }),
    ]);
    await expect(unverified.inspect({ project: "web", expectedDomains: ["www.example.test"] })).resolves.toMatchObject({ domains: [{ status: "unverified" }] });

    const unknown = inspectorForResponses([
      response({ id: "project-id" }),
      response({ deployments: [] }),
      response({ domains: [{ name: "www.example.test" }], pagination: {} }),
    ]);
    await expect(unknown.inspect({ project: "web", expectedDomains: ["www.example.test"] })).resolves.toMatchObject({ domains: [{ status: "unknown" }] });
  });

  it("uses a stable invalid-response error for malformed provider pages", async () => {
    const inspector = inspectorForResponses([
      response({ id: "project-id" }),
      response({ deployments: [] }),
      response({ domains: [], pagination: { next: {} } }),
    ]);
    await expect(inspector.inspect({ project: "web", expectedDomains: ["www.example.test"] })).rejects.toMatchObject({ kind: "invalid-response", message: "Vercel returned an invalid response." } satisfies Partial<VercelInspectionError>);
  });
});
