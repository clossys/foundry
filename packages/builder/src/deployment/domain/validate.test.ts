import { describe, expect, it } from "vitest";
import { isValidWebSurfaceDeclaration, validateWebSurfaceDeclaration } from "./validate.js";

function validDeclaration() {
  return {
    schemaVersion: "1" as const,
    domain: "example.com",
    dnsProvider: "cloudflare",
    records: [
      { type: "A" as const, name: "@", value: "192.0.2.1" },
      { type: "CNAME" as const, name: "www", value: "example.com", proxied: true },
      { type: "TXT" as const, name: "@", value: "v=spf1 -all" },
      { type: "MX" as const, name: "@", value: "mail.example.com", priority: 10 },
    ],
    hostingProvider: "vercel",
    hostingProject: "example-site",
    build: { command: "npm run build", outputDirectory: "dist", applicationRoot: "apps/site" },
    environments: [
      { environment: "production" as const, hostname: "example.com", branch: "main" },
      { environment: "preview" as const, hostname: "preview.example.com", branch: "develop" },
    ],
    routes: ["/about"],
  };
}

describe("validateWebSurfaceDeclaration", () => {
  it("accepts a well-formed declaration", () => {
    expect(validateWebSurfaceDeclaration(validDeclaration())).toEqual([]);
    expect(isValidWebSurfaceDeclaration(validDeclaration())).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(validateWebSurfaceDeclaration(null).map((finding) => finding.rule)).toEqual(["web-surface-object"]);
    expect(validateWebSurfaceDeclaration("nope").map((finding) => finding.rule)).toEqual(["web-surface-object"]);
  });

  it("rejects an unsupported property", () => {
    const findings = validateWebSurfaceDeclaration({ ...validDeclaration(), extra: true });
    expect(findings.some((finding) => finding.rule === "web-surface-unknown-property")).toBe(true);
  });

  it("rejects a malformed domain", () => {
    const findings = validateWebSurfaceDeclaration({ ...validDeclaration(), domain: "not a domain" });
    expect(findings.some((finding) => finding.rule === "web-surface-domain")).toBe(true);
  });

  it("rejects a domain missing a label separator", () => {
    const findings = validateWebSurfaceDeclaration({ ...validDeclaration(), domain: "localhost" });
    expect(findings.some((finding) => finding.rule === "web-surface-domain")).toBe(true);
  });

  it("requires at least one record", () => {
    const findings = validateWebSurfaceDeclaration({ ...validDeclaration(), records: [] });
    expect(findings.some((finding) => finding.rule === "web-surface-records")).toBe(true);
  });

  it("rejects an A record with a non-IPv4 value", () => {
    const declaration = validDeclaration();
    declaration.records = [{ type: "A", name: "@", value: "not-an-ip" }];
    expect(validateWebSurfaceDeclaration(declaration).some((finding) => finding.rule === "dns-record-value")).toBe(true);
  });

  it("rejects an AAAA record with a malformed value", () => {
    const declaration = validDeclaration();
    declaration.records = [{ type: "AAAA", name: "@", value: "zzzz::1" } as never];
    expect(validateWebSurfaceDeclaration(declaration).some((finding) => finding.rule === "dns-record-value")).toBe(true);
  });

  it("accepts a well-formed AAAA record", () => {
    const declaration = validDeclaration();
    declaration.records = [{ type: "AAAA", name: "@", value: "2606:4700::1" } as never];
    expect(validateWebSurfaceDeclaration(declaration)).toEqual([]);
  });

  it("requires priority for MX and rejects it elsewhere", () => {
    const missingPriority = validDeclaration();
    missingPriority.records = [{ type: "MX", name: "@", value: "mail.example.com" }];
    expect(validateWebSurfaceDeclaration(missingPriority).some((finding) => finding.rule === "dns-record-priority-required")).toBe(true);

    const unsupportedPriority = validDeclaration();
    unsupportedPriority.records = [{ type: "A", name: "@", value: "192.0.2.1", priority: 1 } as never];
    expect(validateWebSurfaceDeclaration(unsupportedPriority).some((finding) => finding.rule === "dns-record-priority-unsupported")).toBe(true);
  });

  it("rejects proxied on record types that cannot be proxied", () => {
    const declaration = validDeclaration();
    declaration.records = [{ type: "TXT", name: "@", value: "hi", proxied: true } as never];
    expect(validateWebSurfaceDeclaration(declaration).some((finding) => finding.rule === "dns-record-proxied-unsupported")).toBe(true);
  });

  it("requires a production environment", () => {
    const declaration = validDeclaration();
    declaration.environments = [{ environment: "preview", hostname: "preview.example.com", branch: "develop" }];
    expect(validateWebSurfaceDeclaration(declaration).some((finding) => finding.rule === "web-surface-production-environment-required")).toBe(true);
  });

  it("rejects an environment hostname outside the declared domain", () => {
    const declaration = validDeclaration();
    declaration.environments = [{ environment: "production", hostname: "example.org", branch: "main" }];
    expect(validateWebSurfaceDeclaration(declaration).some((finding) => finding.rule === "web-surface-environment-hostname-scope")).toBe(true);
  });

  it("rejects a duplicate environment", () => {
    const declaration = validDeclaration();
    declaration.environments = [
      { environment: "production", hostname: "example.com", branch: "main" },
      { environment: "production", hostname: "example.com", branch: "other" },
    ];
    expect(validateWebSurfaceDeclaration(declaration).some((finding) => finding.rule === "duplicate-web-surface-environment")).toBe(true);
  });

  it("rejects a malformed build applicationRoot", () => {
    const declaration = validDeclaration();
    declaration.build = { ...declaration.build, applicationRoot: "/apps/site" };
    expect(validateWebSurfaceDeclaration(declaration).some((finding) => finding.rule === "web-surface-application-root")).toBe(true);
  });

  it("rejects a route without a leading slash", () => {
    const declaration = validDeclaration();
    declaration.routes = ["about"];
    expect(validateWebSurfaceDeclaration(declaration).some((finding) => finding.rule === "web-surface-route")).toBe(true);
  });

  it("never throws on an object with a throwing accessor", () => {
    const hostile = {};
    Object.defineProperty(hostile, "domain", { get() { throw new Error("boom"); } });
    expect(() => validateWebSurfaceDeclaration(hostile)).not.toThrow();
    expect(validateWebSurfaceDeclaration(hostile).length).toBeGreaterThan(0);
  });
});
