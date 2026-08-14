import { describe, expect, it } from "vitest";
import { evaluateConsent } from "./evaluate.js";
import type { ConsentEvaluationPolicy, ConsentPolicyVersion, ConsentRecord } from "./types.js";

const V1: ConsentPolicyVersion = { policyId: "cookie-policy", version: "1" };
const V2: ConsentPolicyVersion = { policyId: "cookie-policy", version: "2" };
const INVALIDATE: ConsentEvaluationPolicy = { invalidateDenialOnPolicyBump: true };
const PRESERVE: ConsentEvaluationPolicy = { invalidateDenialOnPolicyBump: false };

function grantedRecord(policyVersion: ConsentPolicyVersion): ConsentRecord {
  return { subjectId: "sub-1", category: "marketing", state: { kind: "granted", policyVersion, decidedAt: "2026-01-01T00:00:00.000Z" } };
}

function deniedRecord(policyVersion: ConsentPolicyVersion): ConsentRecord {
  return { subjectId: "sub-1", category: "marketing", state: { kind: "denied", policyVersion, decidedAt: "2026-01-01T00:00:00.000Z" } };
}

describe("evaluateConsent", () => {
  it("returns absent for undefined input", () => {
    expect(evaluateConsent(undefined, V1, INVALIDATE)).toEqual({ status: "absent" });
  });

  it("returns absent for a record whose state is absent", () => {
    const record: ConsentRecord = { subjectId: "sub-1", category: "marketing", state: { kind: "absent" } };
    expect(evaluateConsent(record, V1, INVALIDATE)).toEqual({ status: "absent" });
  });

  it("returns granted when a granted record matches the current policy version", () => {
    expect(evaluateConsent(grantedRecord(V1), V1, INVALIDATE)).toEqual({ status: "granted", policyVersion: V1 });
  });

  it("returns stale for a granted record under an older policy version, regardless of the invalidation policy", () => {
    expect(evaluateConsent(grantedRecord(V1), V2, INVALIDATE)).toEqual({ status: "stale", previousPolicyVersion: V1 });
    expect(evaluateConsent(grantedRecord(V1), V2, PRESERVE)).toEqual({ status: "stale", previousPolicyVersion: V1 });
  });

  it("returns denied when a denied record matches the current policy version", () => {
    expect(evaluateConsent(deniedRecord(V1), V1, INVALIDATE)).toEqual({ status: "denied", policyVersion: V1 });
  });

  it("keeps a denied record denied across a policy bump when invalidateDenialOnPolicyBump is false", () => {
    expect(evaluateConsent(deniedRecord(V1), V2, PRESERVE)).toEqual({ status: "denied", policyVersion: V1 });
  });

  it("goes stale on a denied record across a policy bump when invalidateDenialOnPolicyBump is true", () => {
    expect(evaluateConsent(deniedRecord(V1), V2, INVALIDATE)).toEqual({ status: "stale", previousPolicyVersion: V1 });
  });

  it("treats a policyId change as a different policy version even if the version string matches", () => {
    const differentPolicy: ConsentPolicyVersion = { policyId: "privacy-policy", version: "1" };
    expect(evaluateConsent(grantedRecord(V1), differentPolicy, INVALIDATE)).toEqual({ status: "stale", previousPolicyVersion: V1 });
  });
});
