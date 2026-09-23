import { describe, expect, it } from "vitest";
import { checkTlsCertificate } from "./tls-check.js";
import type { TlsCertificateProbe } from "./tls-check.js";

const healthy: TlsCertificateProbe = async () => ({
  kind: "observed",
  validNow: true,
  notAfter: "2099-01-01T00:00:00.000Z",
  hostnameAuthorized: true,
  chainTrusted: true,
});

describe("checkTlsCertificate", () => {
  it("is satisfied when every hostname's certificate is valid, authorized, and trusted", async () => {
    const result = await checkTlsCertificate(["example.com", "www.example.com"], { probe: healthy });
    expect(result).toEqual({ verdict: "satisfied", evaluated: 2 });
  });

  it("reports an expired certificate as violated", async () => {
    const probe: TlsCertificateProbe = async () => ({ kind: "observed", validNow: false, notAfter: "2000-01-01T00:00:00.000Z", hostnameAuthorized: true, chainTrusted: true });
    const result = await checkTlsCertificate(["example.com"], { probe });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") expect(result.findings.map((finding) => finding.rule)).toEqual(["tls-certificate-expired"]);
  });

  it("reports a hostname mismatch and an untrusted chain as separate findings", async () => {
    const probe: TlsCertificateProbe = async () => ({ kind: "observed", validNow: true, notAfter: "2099-01-01T00:00:00.000Z", hostnameAuthorized: false, chainTrusted: false });
    const result = await checkTlsCertificate(["example.com"], { probe });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") expect(result.findings.map((finding) => finding.rule).sort()).toEqual(["tls-certificate-hostname-mismatch", "tls-certificate-untrusted-chain"]);
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
    const result = await checkTlsCertificate([], { probe: healthy });
    expect(result).toEqual({ verdict: "indeterminate", reason: "no-hostnames", detail: "No hostnames were supplied to check." });
  });
});
