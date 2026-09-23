import { describe, expect, it } from "vitest";
import { checkRoutes } from "./http-check.js";
import type { WebSurfaceFetch } from "./http-check.js";

function fetchReturning(statusByPath: Record<string, number>): WebSurfaceFetch {
  return async (input) => {
    const url = new URL(String(input));
    const status = statusByPath[url.pathname];
    if (status === undefined) throw new Error(`unexpected request: ${url.pathname}`);
    return new Response(null, { status });
  };
}

describe("checkRoutes", () => {
  it("is satisfied when every route returns the expected status", async () => {
    const fetch = fetchReturning({ "/": 200, "/about": 200 });
    const result = await checkRoutes("example.com", ["/", "/about"], { fetch });
    expect(result).toEqual({ verdict: "satisfied", evaluated: 2 });
  });

  it("requests over https on the declared hostname", async () => {
    const requested: string[] = [];
    const fetch: WebSurfaceFetch = async (input) => { requested.push(String(input)); return new Response(null, { status: 200 }); };
    await checkRoutes("example.com", ["/"], { fetch });
    expect(requested).toEqual(["https://example.com/"]);
  });

  it("reports a wrong status as violated", async () => {
    const fetch = fetchReturning({ "/": 404 });
    const result = await checkRoutes("example.com", ["/"], { fetch });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") expect(result.findings[0]).toMatchObject({ rule: "http-status-mismatch", path: "/" });
  });

  it("honors a caller-supplied expected status", async () => {
    const fetch = fetchReturning({ "/redirect": 301 });
    const result = await checkRoutes("example.com", ["/redirect"], { fetch, expectedStatus: 301 });
    expect(result.verdict).toBe("satisfied");
  });

  it("reports a fetch rejection as indeterminate, never violated", async () => {
    const fetch: WebSurfaceFetch = async () => { throw new Error("network unreachable"); };
    const result = await checkRoutes("example.com", ["/"], { fetch });
    expect(result).toEqual({ verdict: "indeterminate", reason: "http-unreachable", detail: "https://example.com/: network unreachable" });
  });

  it("is indeterminate, never vacuously satisfied, for an empty route list", async () => {
    const result = await checkRoutes("example.com", [], { fetch: fetchReturning({}) });
    expect(result).toEqual({ verdict: "indeterminate", reason: "no-routes", detail: "No routes were supplied to check." });
  });
});
