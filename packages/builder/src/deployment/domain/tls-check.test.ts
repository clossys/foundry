import { describe, expect, it } from "vitest";
import { checkTlsCertificate } from "./tls-check.js";
import type { TlsCertificateProbe } from "./tls-check.js";

const trusted: TlsCertificateProbe = async () => ({ kind: "trusted", notAfter: "2099-01-01T00:00:00.000Z" });

describe("checkTlsCertificate", () => {
  it("is satisfied when every hostname's certificate passes real verification", async () => {
    const result = await checkTlsCertificate(["example.com", "www.example.com"], { probe: trusted });
    expect(result).toEqual({ verdict: "satisfied", evaluated: 2 });
  });

  it("reports an untrusted certificate as violated, carrying the platform's own reason", async () => {
    const probe: TlsCertificateProbe = async () => ({ kind: "untrusted", reason: "certificate has expired" });
    const result = await checkTlsCertificate(["example.com"], { probe });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.findings).toEqual([{
        rule: "tls-certificate-untrusted",
        severity: "error",
        message: "TLS certificate for example.com did not pass verification: certificate has expired",
        path: "example.com",
      }]);
    }
  });

  it("reports an unreachable host as indeterminate, never violated", async () => {
    const probe: TlsCertificateProbe = async () => ({ kind: "unreachable", detail: "connection refused" });
    const result = await checkTlsCertificate(["example.com"], { probe });
    expect(result).toEqual({ verdict: "indeterminate", reason: "tls-unreachable", detail: "example.com: connection refused" });
  });

  it("reports a thrown probe error as indeterminate", async () => {
    const probe: TlsCertificateProbe = async () => { throw new Error("boom"); };
    const result = await checkTlsCertificate(["example.com"], { probe });
    expect(result.verdict).toBe("indeterminate");
  });

  it("is indeterminate, never vacuously satisfied, for an empty hostname list", async () => {
    const result = await checkTlsCertificate([], { probe: trusted });
    expect(result).toEqual({ verdict: "indeterminate", reason: "no-hostnames", detail: "No hostnames were supplied to check." });
  });
});
