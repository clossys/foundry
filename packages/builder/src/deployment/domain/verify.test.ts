import { gateSatisfied, gateViolated } from "@clossys/controller/gates";
import { describe, expect, it } from "vitest";
import { defineWebSurfaceDeclaration } from "./define.js";
import type { DnsResolver } from "./dns-check.js";
import type { WebSurfaceFetch } from "./http-check.js";
import type { TlsCertificateProbe } from "./tls-check.js";
import { verifyWebSurfaceLiveState } from "./verify.js";

function declaration() {
  return defineWebSurfaceDeclaration({
    schemaVersion: "1",
    domain: "example.com",
    dnsProvider: "cloudflare",
    records: [{ type: "A", name: "@", value: "192.0.2.1" }],
    hostingProvider: "vercel",
    hostingProject: "example-site",
    build: { command: "npm run build", outputDirectory: "dist", applicationRoot: "apps/site" },
    environments: [{ environment: "production", hostname: "example.com", branch: "main" }],
    routes: ["/about"],
  });
}

const resolveDns: DnsResolver = async () => ["192.0.2.1"];
const probeTls: TlsCertificateProbe = async () => ({ kind: "trusted", notAfter: "2099-01-01T00:00:00.000Z" });
const fetch: WebSurfaceFetch = async () => new Response(null, { status: 200 });

describe("verifyWebSurfaceLiveState", () => {
  it("is satisfied overall only when dns, tls, http, and a supplied hosting observation are all satisfied", async () => {
    const report = await verifyWebSurfaceLiveState(declaration(), { resolveDns, probeTls, fetch, hostingObservation: gateSatisfied(1) });
    expect(report.dns.verdict).toBe("satisfied");
    expect(report.tls.verdict).toBe("satisfied");
    expect(report.http.verdict).toBe("satisfied");
    expect(report.hosting).toEqual({ verdict: "satisfied", evaluated: 1 });
    expect(report.overall.verdict).toBe("satisfied");
  });

  it("reports hosting -- and therefore overall -- indeterminate when no hosting observation is supplied", async () => {
    const report = await verifyWebSurfaceLiveState(declaration(), { resolveDns, probeTls, fetch });
    expect(report.hosting).toEqual({ verdict: "indeterminate", reason: "hosting-not-configured", detail: "No hosting observation was supplied; the right-deployment-serving check was not run." });
    expect(report.overall.verdict).toBe("indeterminate");
  });

  it("is overall violated when one check is violated and none are indeterminate", async () => {
    const report = await verifyWebSurfaceLiveState(declaration(), {
      resolveDns,
      probeTls,
      fetch,
      hostingObservation: gateViolated([{ rule: "vercel-project-missing", severity: "error", message: "missing" }]),
    });
    expect(report.overall.verdict).toBe("violated");
  });

  it("is overall indeterminate when one check is indeterminate, even if another is violated", async () => {
    const report = await verifyWebSurfaceLiveState(declaration(), {
      resolveDns: async () => { throw new Error("ENOTFOUND"); },
      probeTls,
      fetch,
      hostingObservation: gateViolated([{ rule: "vercel-project-missing", severity: "error", message: "missing" }]),
    });
    expect(report.dns.verdict).toBe("indeterminate");
    expect(report.overall.verdict).toBe("indeterminate");
  });

  it("checks TLS and HTTP against the production environment's own hostname", async () => {
    const requestedTls: string[] = [];
    const requestedHttp: string[] = [];
    await verifyWebSurfaceLiveState(declaration(), {
      resolveDns,
      probeTls: async (hostname) => { requestedTls.push(hostname); return probeTls(hostname); },
      fetch: async (input) => { requestedHttp.push(String(input)); return fetch(input); },
      hostingObservation: gateSatisfied(1),
    });
    expect(requestedTls).toEqual(["example.com"]);
    expect(requestedHttp.every((url) => url.startsWith("https://example.com/"))).toBe(true);
  });
});
