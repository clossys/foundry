import { describe, expect, it } from "vitest";
import { createVercelInspector, VercelInspectionError } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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
    await expect(inspector.inspect({ project: "web", expectedDomains: ["www.example.test"] })).resolves.toEqual({ project: "present", deployment: "ready", domains: [{ domain: "www.example.test", status: "present" }] });
    expect(requests.every((request) => request.method === "GET" && request.credentials === "omit" && request.redirect === "error")).toBe(true);
    expect(urls.map((url) => url.pathname)).toEqual(["/v9/projects/web", "/v6/deployments", "/v9/projects/web/domains"]);
  });

  it("reports a missing project without exposing provider content", async () => {
    const inspector = createVercelInspector({ fetch: async () => response({}, 404), getBearerToken: () => "test-token" });
    await expect(inspector.inspect({ project: "web" })).resolves.toEqual({ project: "missing", deployment: "none", domains: [] });
  });

  it("uses stable errors for unavailable credentials", async () => {
    const inspector = createVercelInspector({ fetch: async () => response({}), getBearerToken: () => { throw new Error("private"); } });
    await expect(inspector.inspect({ project: "web" })).rejects.toMatchObject({ kind: "credential-unavailable" } satisfies Partial<VercelInspectionError>);
  });

  it("does not report an unseen domain as missing when pagination is bounded", async () => {
    let calls = 0;
    const inspector = createVercelInspector({
      fetch: async () => {
        calls += 1;
        if (calls === 1) return response({ id: "project-id" });
        if (calls === 2) return response({ deployments: [] });
        return response({ domains: [], pagination: { next: 1 } });
      },
      getBearerToken: () => "test-token",
    });
    await expect(inspector.inspect({ project: "web", expectedDomains: ["www.example.test"], maxDomainPages: 1 })).resolves.toMatchObject({ domains: [{ domain: "www.example.test", status: "unknown" }] });
  });
});
