import { describe, expect, it } from "vitest";
import { decideConsentChange, recordPolicySuperseded, recordReopened } from "./decide.js";
import type { ConsentAction, ConsentPolicyVersion, ConsentRecord, GpcSignal } from "./types.js";

const V1: ConsentPolicyVersion = { policyId: "cookie-policy", version: "1" };
const NOW = "2026-08-13T00:00:00.000Z";
const GPC: GpcSignal = { present: true, observedAt: "2026-08-12T00:00:00.000Z" };

describe("decideConsentChange", () => {
  it("is pure: identical inputs produce identical, deep-equal output", () => {
    const action: ConsentAction = { kind: "grant", category: "marketing", policyVersion: V1 };
    const first = decideConsentChange("sub-1", undefined, action, NOW);
    const second = decideConsentChange("sub-1", undefined, action, NOW);
    expect(first).toEqual(second);
  });

  it("grant produces a granted record and a granted audit event", () => {
    const action: ConsentAction = { kind: "grant", category: "marketing", policyVersion: V1 };
    const { record, auditEvent } = decideConsentChange("sub-1", undefined, action, NOW);
    expect(record).toEqual({ subjectId: "sub-1", category: "marketing", state: { kind: "granted", policyVersion: V1, decidedAt: NOW } });
    expect(auditEvent).toEqual({ subjectId: "sub-1", category: "marketing", type: "granted", policyVersion: V1, occurredAt: NOW });
  });

  it("deny produces a denied record and a denied audit event", () => {
    const action: ConsentAction = { kind: "deny", category: "marketing", policyVersion: V1 };
    const { record, auditEvent } = decideConsentChange("sub-1", undefined, action, NOW);
    expect(record.state).toEqual({ kind: "denied", policyVersion: V1, decidedAt: NOW });
    expect(auditEvent.type).toBe("denied");
  });

  it("withdraw produces an absent record and a withdrawn audit event, reachable the same way as grant/deny", () => {
    const granted: ConsentRecord = { subjectId: "sub-1", category: "marketing", state: { kind: "granted", policyVersion: V1, decidedAt: NOW } };
    const action: ConsentAction = { kind: "withdraw", category: "marketing", policyVersion: V1 };
    const { record, auditEvent } = decideConsentChange("sub-1", granted, action, NOW);
    expect(record.state).toEqual({ kind: "absent" });
    expect(auditEvent.type).toBe("withdrawn");
    expect(auditEvent.policyVersion).toEqual(V1);
  });

  it("carries a prior gpcSignal forward onto the new record and the audit event", () => {
    const current: ConsentRecord = { subjectId: "sub-1", category: "marketing", state: { kind: "absent" }, gpcSignal: GPC };
    const action: ConsentAction = { kind: "grant", category: "marketing", policyVersion: V1 };
    const { record, auditEvent } = decideConsentChange("sub-1", current, action, NOW);
    expect(record.gpcSignal).toEqual(GPC);
    expect(auditEvent.gpcSignal).toEqual(GPC);
  });

  it("never carries a gpcSignal key at all when none was observed", () => {
    const action: ConsentAction = { kind: "grant", category: "marketing", policyVersion: V1 };
    const { record, auditEvent } = decideConsentChange("sub-1", undefined, action, NOW);
    expect(Object.hasOwn(record, "gpcSignal")).toBe(false);
    expect(Object.hasOwn(auditEvent, "gpcSignal")).toBe(false);
  });

  it("audit events never carry a personal-data-shaped key beyond subjectId", () => {
    const action: ConsentAction = { kind: "grant", category: "marketing", policyVersion: V1 };
    const { auditEvent } = decideConsentChange("sub-1", undefined, action, NOW);
    const forbidden = ["email", "name", "phone", "address", "ip", "ipAddress"];
    for (const key of forbidden) expect(Object.hasOwn(auditEvent, key)).toBe(false);
  });
});

describe("recordReopened", () => {
  it("builds a reopened audit event without touching any consent state", () => {
    const event = recordReopened("sub-1", "marketing", V1, NOW);
    expect(event).toEqual({ subjectId: "sub-1", category: "marketing", type: "reopened", policyVersion: V1, occurredAt: NOW });
  });
});

describe("recordPolicySuperseded", () => {
  it("builds a policy-superseded audit event citing both the previous and current version", () => {
    const V2: ConsentPolicyVersion = { policyId: "cookie-policy", version: "2" };
    const event = recordPolicySuperseded("sub-1", "marketing", V1, V2, NOW);
    expect(event).toEqual({ subjectId: "sub-1", category: "marketing", type: "policy-superseded", policyVersion: V2, previousPolicyVersion: V1, occurredAt: NOW });
  });
});
