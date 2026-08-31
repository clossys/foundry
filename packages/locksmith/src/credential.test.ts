import { describe, expect, it } from "vitest";
import { defineCredentialEvidence, evaluateCredential, type CredentialEvaluation } from "./index.js";

const ephemeral = {
  key: "GITHUB_TOKEN",
  credentialClass: "ephemeral-job",
  provider: "github-actions",
  scope: ["packages:read"],
  jobStartedAt: "2026-08-18T00:00:00.000Z",
  jobEndedAt: "2026-08-18T00:01:00.000Z",
  expiresAtJobEnd: true,
  scopedUseObserved: true,
} as const;

const manual = {
  key: "GH_PACKAGES_TOKEN",
  credentialClass: "manually-rotatable",
  provider: "github",
  scope: ["packages:write"],
  repositorySecretUpdatedAt: "2026-08-17T00:00:00.000Z",
  ownerProvenance: {
    source: "owner-controlled",
    tokenCreatedAt: "2026-08-10T00:00:00.000Z",
    observedAt: "2026-08-18T00:00:00.000Z",
  },
} as const;

describe("evaluateCredential", () => {
  it.each([
    [ephemeral, "satisfied", 0],
    [manual, "satisfied", 0],
  ] as const)("judges valid %s evidence with its 0/1/2 result", (evidence, verdict, exitCode) => {
    const result = evaluateCredential(evidence);
    expect(result.verdict).toBe(verdict);
    expect(result.exitCode).toBe(exitCode);
    expect(result.reasons).toEqual([]);
  });

  it("does not treat repository-secret updated_at as PAT rotation provenance", () => {
    const result = evaluateCredential({ ...manual, ownerProvenance: null });
    expect(result).toMatchObject({ verdict: "indeterminate", exitCode: 2 });
    expect(result.reasons).toEqual(["owner-provenance-unverifiable"]);
  });

  it("rejects an unscoped ephemeral credential as violated", () => {
    const result = evaluateCredential({ ...ephemeral, scope: [] });
    expect(result).toMatchObject({ verdict: "violated", exitCode: 1 });
    expect(result.reasons).toEqual(["missing-scope"]);
  });

  it("rejects duplicate and untrimmed scope entries instead of treating them as a closed scope", () => {
    expect(evaluateCredential({ ...ephemeral, scope: ["packages:read", "packages:read"] })).toMatchObject({
      verdict: "violated",
      exitCode: 1,
      reasons: ["non-canonical-scope"],
    });
    expect(evaluateCredential({ ...ephemeral, scope: [" packages:read"] })).toMatchObject({
      verdict: "violated",
      exitCode: 1,
      reasons: ["non-canonical-scope"],
    });
  });

  it("requires a dense, sorted, provider-valid closed scope", () => {
    const sparse = Array(2) as string[];
    sparse[1] = "packages:read";
    const decorated = ["packages:read"];
    Object.defineProperty(decorated, "extra", { value: "contents:read" });

    for (const scope of [
      sparse,
      decorated,
      ["packages:write", "contents:read"],
      ["repository:admin"],
    ]) {
      expect(evaluateCredential({ ...ephemeral, scope })).toMatchObject({
        verdict: "violated",
        exitCode: 1,
        reasons: ["non-canonical-scope"],
      });
    }
    expect(evaluateCredential({ ...manual, scope: ["id-token:write"] })).toMatchObject({
      verdict: "violated",
      exitCode: 1,
      reasons: ["non-canonical-scope"],
    });
  });

  it("requires class-specific providers", () => {
    expect(evaluateCredential({ ...ephemeral, provider: "github" })).toMatchObject({
      verdict: "violated",
      exitCode: 1,
      reasons: ["unsupported-provider"],
    });
    expect(evaluateCredential({ ...manual, provider: "github-actions" })).toMatchObject({
      verdict: "violated",
      exitCode: 1,
      reasons: ["unsupported-provider"],
    });
  });

  it("does not let a non-ephemeral credential claim the ephemeral path", () => {
    const result = evaluateCredential({ ...ephemeral, expiresAtJobEnd: false });
    expect(result).toMatchObject({ verdict: "violated", exitCode: 1 });
    expect(result.reasons).toEqual(["job-expiry-semantics-unproven"]);
  });

  it("distinguishes unknown expiry evidence from an explicit false assertion", () => {
    const { expiresAtJobEnd: _omitted, ...missingExpiry } = ephemeral;
    expect(evaluateCredential(missingExpiry)).toMatchObject({
      verdict: "indeterminate",
      exitCode: 2,
      reasons: ["job-expiry-semantics-unproven"],
    });
    expect(evaluateCredential({ ...ephemeral, expiresAtJobEnd: "true" })).toMatchObject({
      verdict: "indeterminate",
      exitCode: 2,
      reasons: ["job-expiry-semantics-unproven"],
    });
    expect(evaluateCredential({ ...ephemeral, expiresAtJobEnd: false })).toMatchObject({
      verdict: "violated",
      exitCode: 1,
      reasons: ["job-expiry-semantics-unproven"],
    });
  });

  it("requires a complete job lifetime and never invents a rotation timestamp", () => {
    const result = evaluateCredential({ ...ephemeral, jobEndedAt: "not-a-date" });
    expect(result).toMatchObject({ verdict: "indeterminate", exitCode: 2 });
    expect(result.reasons).toEqual(["job-lifetime-unverifiable"]);
    expect(result).not.toHaveProperty("lastRotatedAt");
  });

  it("requires canonical UTC timestamps and truthful chronology", () => {
    expect(evaluateCredential({ ...ephemeral, jobStartedAt: "2026-08-18T00:00:00Z" })).toMatchObject({
      verdict: "indeterminate",
      reasons: ["job-lifetime-unverifiable"],
    });
    expect(evaluateCredential({ ...ephemeral, jobStartedAt: "2026-08-18T00:02:00.000Z" })).toMatchObject({
      verdict: "indeterminate",
      reasons: ["job-lifetime-unverifiable"],
    });
    expect(evaluateCredential({ ...ephemeral, jobEndedAt: ephemeral.jobStartedAt })).toMatchObject({
      verdict: "indeterminate",
      exitCode: 2,
      reasons: ["job-lifetime-unverifiable"],
    });
    expect(
      evaluateCredential({
        ...manual,
        ownerProvenance: { ...manual.ownerProvenance, tokenCreatedAt: "2026-08-18T01:00:00.000Z" },
      }),
    ).toMatchObject({
      verdict: "indeterminate",
      reasons: ["owner-provenance-unverifiable"],
    });
  });

  it("distinguishes an invalid key from a missing provider", () => {
    expect(evaluateCredential({ ...ephemeral, key: "   " })).toMatchObject({ verdict: "violated", reasons: ["missing-key"] });
    expect(evaluateCredential({ ...ephemeral, provider: "" })).toMatchObject({ verdict: "violated", reasons: ["missing-provider"] });
  });

  it("rejects unknown fields, including credential-shaped values, without echoing them", () => {
    const result = evaluateCredential({ ...ephemeral, value: "do-not-store-this" });
    expect(result).toMatchObject({ verdict: "indeterminate", exitCode: 2 });
    expect(result.reasons).toEqual(["unsupported-fields"]);
    expect(JSON.stringify(result)).not.toContain("do-not-store-this");
  });

  it("rejects unknown nested owner-provenance fields", () => {
    const result = evaluateCredential({
      ...manual,
      ownerProvenance: { ...manual.ownerProvenance, token: "do-not-store-this" },
    });
    expect(result).toMatchObject({ verdict: "indeterminate", exitCode: 2 });
    expect(result.reasons).toEqual(["unsupported-fields"]);
  });

  it("rejects symbol and non-enumerable own keys at both evidence levels", () => {
    const topLevelSymbol = { ...ephemeral } as Record<PropertyKey, unknown>;
    topLevelSymbol[Symbol("token")] = "do-not-store-this";
    const nestedSymbol = {
      ...manual,
      ownerProvenance: { ...manual.ownerProvenance } as Record<PropertyKey, unknown>,
    };
    nestedSymbol.ownerProvenance[Symbol("token")] = "do-not-store-this";
    const nonEnumerable = { ...ephemeral } as Record<PropertyKey, unknown>;
    Object.defineProperty(nonEnumerable, "token", { value: "do-not-store-this" });

    for (const evidence of [topLevelSymbol, nestedSymbol, nonEnumerable]) {
      const result = evaluateCredential(evidence);
      expect(result).toMatchObject({ verdict: "indeterminate", exitCode: 2, reasons: ["unsupported-fields"] });
      expect(JSON.stringify(result)).not.toContain("do-not-store-this");
    }
  });

  it("returns a closed, frozen value-free evaluation", () => {
    const result: CredentialEvaluation = evaluateCredential(ephemeral);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasons)).toBe(true);
    expect(new Set(Object.keys(result))).toEqual(new Set(["key", "credentialClass", "verdict", "exitCode", "reasons"]));
  });
});

describe("defineCredentialEvidence", () => {
  it("freezes evidence and its nested metadata without introducing a value field", () => {
    const evidence = defineCredentialEvidence({ ...manual, scope: ["contents:read", "packages:write"] });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.scope)).toBe(true);
    expect(evidence.scope).toEqual(["contents:read", "packages:write"]);
    expect(evidence).not.toHaveProperty("value");
    expect(evidence).not.toHaveProperty("token");
  });

  it("refuses incomplete evidence instead of authoring a false satisfied record", () => {
    expect(() => defineCredentialEvidence({ ...manual, ownerProvenance: null })).toThrow(RangeError);
  });

  it("refuses an invalid key with whitespace", () => {
    expect(() => defineCredentialEvidence({ ...manual, key: " GH_PACKAGES_TOKEN" })).toThrow(RangeError);
  });

  it("refuses non-canonical scope, expiry, chronology, and unsupported own keys while authoring", () => {
    const topLevelSymbol = { ...manual } as Record<PropertyKey, unknown>;
    topLevelSymbol[Symbol("token")] = "do-not-store-this";
    const nestedSymbol = {
      ...manual,
      ownerProvenance: { ...manual.ownerProvenance } as Record<PropertyKey, unknown>,
    };
    nestedSymbol.ownerProvenance[Symbol("token")] = "do-not-store-this";
    const sparse = Array(2) as string[];
    sparse[1] = "packages:read";
    const { expiresAtJobEnd: _omitted, ...missingExpiry } = ephemeral;

    for (const evidence of [
      { ...ephemeral, scope: sparse },
      { ...ephemeral, scope: ["repository:admin"] },
      { ...manual, scope: ["packages:write", "contents:read"] },
      { ...manual, scope: ["packages:write", "packages:write"] },
      { ...manual, scope: [" packages:write"] },
      missingExpiry,
      { ...ephemeral, expiresAtJobEnd: false },
      { ...ephemeral, expiresAtJobEnd: "true" },
      { ...ephemeral, jobEndedAt: ephemeral.jobStartedAt },
      topLevelSymbol,
      nestedSymbol,
    ]) {
      expect(() => defineCredentialEvidence(evidence as never)).toThrow(RangeError);
    }
  });
});
