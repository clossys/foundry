import { describe, expect, it } from "vitest";
import { observeVercelHosting } from "./vercel-hosting.js";
import type { VercelInspectionResult } from "../vercel/types.js";

describe("observeVercelHosting", () => {
  it("is satisfied when the project is present, the production deployment is ready, and every expected domain is verified", () => {
    const inspection: VercelInspectionResult = {
      kind: "inspected",
      project: "present",
      deployment: "ready",
      domains: [{ domain: "example.com", status: "present" }],
    };
    const result = observeVercelHosting(inspection, { expectedDomains: ["example.com"] });
    expect(result).toEqual({ verdict: "satisfied", evaluated: 2 });
  });

  it("reports a missing project as violated", () => {
    const inspection: VercelInspectionResult = { kind: "inspected", project: "missing", deployment: "none", domains: [] };
    const result = observeVercelHosting(inspection, { expectedDomains: [] });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") expect(result.findings.map((finding) => finding.rule)).toContain("vercel-project-missing");
  });

  it("reports a production deployment that is not ready as violated", () => {
    const inspection: VercelInspectionResult = { kind: "inspected", project: "present", deployment: "pending", domains: [] };
    const result = observeVercelHosting(inspection, { expectedDomains: [] });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") expect(result.findings.map((finding) => finding.rule)).toContain("vercel-production-deployment-not-ready");
  });

  it("reports an unverified expected domain as violated", () => {
    const inspection: VercelInspectionResult = {
      kind: "inspected",
      project: "present",
      deployment: "ready",
      domains: [{ domain: "example.com", status: "unverified" }],
    };
    const result = observeVercelHosting(inspection, { expectedDomains: ["example.com"] });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") expect(result.findings.map((finding) => finding.rule)).toContain("vercel-domain-not-verified");
  });

  it("folds an indeterminate inspection through with a scoped reason", () => {
    const result = observeVercelHosting({ kind: "indeterminate", reason: "network", detail: "timed out" }, { expectedDomains: [] });
    expect(result).toEqual({ verdict: "indeterminate", reason: "vercel-network", detail: "timed out" });
  });
});
