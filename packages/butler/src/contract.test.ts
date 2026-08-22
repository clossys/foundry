import { describe, expect, it } from "vitest";
import {
  checkConfirmationCompleteness,
  checkCurrency,
  checkWithdrawalParity,
  decideStandingChange,
  evaluateStandingInstruction,
  recordReopened,
  recordStaleness,
} from "./contract.js";
import type { ConfirmationRecord, InstructionUsage, IntentRecord, PolicyVersion, PreferencePath, StandingInstruction } from "./schema.js";

const v3: PolicyVersion = { policyId: "wants", version: "3" };
const v4: PolicyVersion = { policyId: "wants", version: "4" };
const strict = { invalidateDenialOnPolicyBump: true };
const lenient = { invalidateDenialOnPolicyBump: false };

function instruction(overrides: Partial<StandingInstruction> = {}): StandingInstruction {
  return {
    instructionId: "ins_1",
    subjectId: "sub_1",
    topic: "contact-window",
    state: { kind: "granted", policyVersion: v3, decidedAt: "2026-01-01T00:00:00.000Z" },
    provenance: "stated",
    currency: { days: 90 },
    ...overrides,
  };
}

describe("evaluateStandingInstruction", () => {
  it("reports absent for no record at all, distinctly from a denial", () => {
    expect(evaluateStandingInstruction(undefined, v3, strict, "2026-01-02T00:00:00.000Z")).toEqual({ status: "absent", reason: "no-record" });
    expect(evaluateStandingInstruction(instruction({ state: { kind: "absent" } }), v3, strict, "2026-01-02T00:00:00.000Z")).toEqual({
      status: "absent",
      reason: "no-record",
    });
  });

  it("never reports absence as permission — the absent result carries no policy version to act on", () => {
    const result = evaluateStandingInstruction(undefined, v3, strict, "2026-01-02T00:00:00.000Z");
    expect(result.status).not.toBe("granted");
    expect("policyVersion" in result).toBe(false);
  });

  it("reports an unconfirmed inference as absent, because an inferred want is not binding", () => {
    const inferred = instruction({ provenance: "inferred" });
    expect(evaluateStandingInstruction(inferred, v3, strict, "2026-01-02T00:00:00.000Z")).toEqual({
      status: "absent",
      reason: "unconfirmed-inference",
    });
  });

  it("binds an inferred instruction only once the subject confirmed it", () => {
    const confirmed = instruction({ provenance: "inferred", confirmedAt: "2026-01-01T12:00:00.000Z" });
    expect(evaluateStandingInstruction(confirmed, v3, strict, "2026-01-02T00:00:00.000Z")).toEqual({ status: "granted", policyVersion: v3 });
  });

  it("reports a current grant as granted, reporting the version actually answered", () => {
    expect(evaluateStandingInstruction(instruction(), v3, strict, "2026-01-02T00:00:00.000Z")).toEqual({ status: "granted", policyVersion: v3 });
  });

  it("stales a grant on any policy bump, unconditionally", () => {
    for (const policy of [strict, lenient]) {
      expect(evaluateStandingInstruction(instruction(), v4, policy, "2026-01-02T00:00:00.000Z")).toEqual({
        status: "stale",
        reason: "policy-superseded",
        previousPolicyVersion: v3,
        decidedAt: "2026-01-01T00:00:00.000Z",
      });
    }
  });

  it("stales a denial on a policy bump only when the caller says so — there is no default", () => {
    const denied = instruction({ state: { kind: "denied", policyVersion: v3, decidedAt: "2026-01-01T00:00:00.000Z" } });
    expect(evaluateStandingInstruction(denied, v4, strict, "2026-01-02T00:00:00.000Z").status).toBe("stale");
    expect(evaluateStandingInstruction(denied, v4, lenient, "2026-01-02T00:00:00.000Z")).toEqual({ status: "denied", policyVersion: v3 });
  });

  it("stales an answer past its own declared window even when the policy never moved — presence is not currency", () => {
    // This is the adversarial case: the row exists, its state is "granted",
    // and its policy version is exactly current. Only the window says no.
    expect(evaluateStandingInstruction(instruction(), v3, strict, "2026-06-01T00:00:00.000Z")).toEqual({
      status: "stale",
      reason: "window-elapsed",
      previousPolicyVersion: v3,
      decidedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("expires a denial by the window too, so an expired refusal is also re-asked", () => {
    const denied = instruction({ state: { kind: "denied", policyVersion: v3, decidedAt: "2026-01-01T00:00:00.000Z" } });
    expect(evaluateStandingInstruction(denied, v3, lenient, "2026-06-01T00:00:00.000Z").status).toBe("stale");
  });

  it("treats the window as inclusive of its last day and exclusive after it", () => {
    const onTheEdge = instruction({ currency: { days: 1 } });
    expect(evaluateStandingInstruction(onTheEdge, v3, strict, "2026-01-02T00:00:00.000Z").status).toBe("granted");
    expect(evaluateStandingInstruction(onTheEdge, v3, strict, "2026-01-02T00:00:00.001Z").status).toBe("stale");
  });

  it("reports policy supersession rather than the window when both apply", () => {
    const result = evaluateStandingInstruction(instruction(), v4, strict, "2026-06-01T00:00:00.000Z");
    expect(result).toMatchObject({ status: "stale", reason: "policy-superseded" });
  });
});

describe("decideStandingChange", () => {
  it("keeps actor and subject separate on both the record and the audit event", () => {
    const { instruction: written, auditEvent } = decideStandingChange(
      "agent_1",
      "sub_1",
      "ins_1",
      { kind: "grant", topic: "email", policyVersion: v3, currency: { days: 30 } },
      "2026-02-01T00:00:00.000Z",
    );
    expect(written.subjectId).toBe("sub_1");
    expect(auditEvent.actorId).toBe("agent_1");
    expect(auditEvent.subjectId).toBe("sub_1");
  });

  it("writes a grant and a denial that each carry the version they answered and when", () => {
    const granted = decideStandingChange("agent_1", "sub_1", "ins_1", { kind: "grant", topic: "email", policyVersion: v3, currency: { days: 30 } }, "2026-02-01T00:00:00.000Z");
    expect(granted.instruction.state).toEqual({ kind: "granted", policyVersion: v3, decidedAt: "2026-02-01T00:00:00.000Z" });
    expect(granted.auditEvent.type).toBe("granted");
    const denied = decideStandingChange("agent_1", "sub_1", "ins_1", { kind: "deny", topic: "email", policyVersion: v3, currency: { days: 30 } }, "2026-02-01T00:00:00.000Z");
    expect(denied.instruction.state).toEqual({ kind: "denied", policyVersion: v3, decidedAt: "2026-02-01T00:00:00.000Z" });
    expect(denied.auditEvent.type).toBe("denied");
  });

  it("returns a withdrawal to absent, not to a denial and not to a falsy value", () => {
    const { instruction: written, auditEvent } = decideStandingChange(
      "agent_1",
      "sub_1",
      "ins_1",
      { kind: "withdraw", topic: "email", policyVersion: v3, currency: { days: 30 } },
      "2026-02-01T00:00:00.000Z",
    );
    expect(written.state).toEqual({ kind: "absent" });
    expect(auditEvent.type).toBe("withdrawn");
    expect(auditEvent.policyVersion).toEqual(v3);
  });

  it("is pure: identical inputs produce identical output, with no clock of its own", () => {
    const args = ["agent_1", "sub_1", "ins_1", { kind: "grant" as const, topic: "email", policyVersion: v3, currency: { days: 30 } }, "2026-02-01T00:00:00.000Z"] as const;
    expect(decideStandingChange(...args)).toEqual(decideStandingChange(...args));
  });

  it("writes a decided instruction as stated provenance — a decision is never recorded as an inference", () => {
    const { instruction: written } = decideStandingChange("agent_1", "sub_1", "ins_1", { kind: "grant", topic: "email", policyVersion: v3, currency: { days: 30 } }, "2026-02-01T00:00:00.000Z");
    expect(written.provenance).toBe("stated");
  });
});

describe("audit-event builders", () => {
  it("records a reopening as its own event, independent of any decision made inside it", () => {
    expect(recordReopened("agent_1", "sub_1", "email", v3, "2026-02-01T00:00:00.000Z")).toEqual({
      subjectId: "sub_1",
      actorId: "agent_1",
      topic: "email",
      type: "reopened",
      policyVersion: v3,
      occurredAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("records staleness with the reason as the event type, so an auditor need not re-derive it", () => {
    expect(recordStaleness("agent_1", "sub_1", "email", "window-elapsed", v3, v3, "2026-02-01T00:00:00.000Z").type).toBe("window-elapsed");
    const superseded = recordStaleness("agent_1", "sub_1", "email", "policy-superseded", v3, v4, "2026-02-01T00:00:00.000Z");
    expect(superseded.type).toBe("policy-superseded");
    expect(superseded.previousPolicyVersion).toEqual(v3);
    expect(superseded.policyVersion).toEqual(v4);
  });
});

// ------------------------------------------------------------------- gate 1

function intent(overrides: Partial<IntentRecord> = {}): IntentRecord {
  return {
    intentId: "int_1",
    subjectId: "sub_1",
    actorId: "agent_1",
    interpretation: "reschedule",
    confidence: 0.95,
    observedAt: "2026-02-01T00:00:00.000Z",
    disposition: "acted",
    ...overrides,
  };
}

function confirmation(overrides: Partial<ConfirmationRecord> = {}): ConfirmationRecord {
  return { intentId: "int_1", subjectId: "sub_1", verdict: "confirmed", confirmedAt: "2026-02-01T00:01:00.000Z", ...overrides };
}

describe("checkConfirmationCompleteness", () => {
  const floor = { minimumConfidence: 0.8 };

  it("is satisfied when every acted-on intent carries the subject's confirmation", () => {
    const result = checkConfirmationCompleteness([intent()], [confirmation()], floor);
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.floorApplied).toBe(0.8);
  });

  it("flags an acted-on intent with no confirmation at all", () => {
    const result = checkConfirmationCompleteness([intent()], [], floor);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unconfirmed-intents");
    expect(result.findings[0]?.kind).toBe("acted-without-confirmation");
  });

  it("flags acting against a misread and against an unclear separately", () => {
    const misread = checkConfirmationCompleteness([intent()], [confirmation({ verdict: "misread" })], floor);
    expect(misread.findings[0]?.kind).toBe("acted-against-misread");
    const unclear = checkConfirmationCompleteness([intent()], [confirmation({ verdict: "unclear" })], floor);
    expect(unclear.findings[0]?.kind).toBe("acted-against-unclear");
  });

  it("flags a below-floor reading acted on with no hand-off and no confirmation", () => {
    const result = checkConfirmationCompleteness([intent({ confidence: 0.2 })], [], floor);
    expect(result.findings[0]?.kind).toBe("below-floor-acted-silently");
    expect(result.findings[0]?.actorId).toBe("agent_1");
  });

  it("accepts a below-floor reading that was handed off instead of acted on", () => {
    const result = checkConfirmationCompleteness([intent({ confidence: 0.2, disposition: "handed-off" })], [], floor);
    expect(result.ok).toBe(true);
  });

  it("accepts a below-floor reading that was confirmed before it was acted on", () => {
    const result = checkConfirmationCompleteness([intent({ confidence: 0.2 })], [confirmation()], floor);
    expect(result.ok).toBe(true);
  });

  it("does not require a confirmation for an intent still awaiting one", () => {
    const result = checkConfirmationCompleteness([intent({ disposition: "awaiting-confirmation" })], [], floor);
    expect(result.ok).toBe(true);
  });

  it("flags a read-back that answers an intent outside the set being checked", () => {
    const result = checkConfirmationCompleteness([intent()], [confirmation(), confirmation({ intentId: "int_ghost" })], floor);
    expect(result.findings.map((f) => f.kind)).toEqual(["confirmation-without-intent"]);
  });

  it("is indeterminate, not clean, when there are no intents to check", () => {
    const result = checkConfirmationCompleteness([], [confirmation()], floor);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-intents-provided");
    expect(result.findings).toHaveLength(0);
  });
});

// ------------------------------------------------------------------- gate 2

function usage(overrides: Partial<InstructionUsage> = {}): InstructionUsage {
  return { instructionId: "ins_1", actorId: "agent_1", usedAt: "2026-01-02T00:00:00.000Z", currentPolicyVersion: v3, ...overrides };
}

describe("checkCurrency", () => {
  it("is satisfied when every usage relied on a current answer", () => {
    const result = checkCurrency([instruction()], [usage()], strict);
    expect(result.ok).toBe(true);
    expect(result.instructionsChecked).toBe(1);
    expect(result.usagesChecked).toBe(1);
  });

  it("flags a usage past the declared window — the case a presence check passes", () => {
    const result = checkCurrency([instruction()], [usage({ usedAt: "2026-06-01T00:00:00.000Z" })], strict);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("stale-instructions-used");
    expect(result.findings[0]?.kind).toBe("used-past-window");
  });

  it("flags a usage after the policy version the answer answered was superseded", () => {
    const result = checkCurrency([instruction()], [usage({ currentPolicyVersion: v4 })], strict);
    expect(result.findings[0]?.kind).toBe("used-after-policy-superseded");
  });

  it("flags relying on an instruction with no answer on record — absence is not permission", () => {
    const result = checkCurrency([instruction({ state: { kind: "absent" } })], [usage()], strict);
    expect(result.findings[0]?.kind).toBe("used-while-absent");
    expect(result.findings[0]?.message).toContain("no answer on record");
  });

  it("flags relying on an inference the subject never confirmed, with its own message", () => {
    const result = checkCurrency([instruction({ provenance: "inferred" })], [usage()], strict);
    expect(result.findings[0]?.kind).toBe("used-while-absent");
    expect(result.findings[0]?.message).toContain("never confirmed");
  });

  it("flags a usage naming an instruction outside the set being checked", () => {
    const result = checkCurrency([instruction()], [usage({ instructionId: "ins_ghost" })], strict);
    expect(result.findings[0]?.kind).toBe("usage-without-instruction");
  });

  it("carries the caller's denial-invalidation decision through rather than choosing one", () => {
    const denied = instruction({ state: { kind: "denied", policyVersion: v3, decidedAt: "2026-01-01T00:00:00.000Z" } });
    expect(checkCurrency([denied], [usage({ currentPolicyVersion: v4 })], strict).ok).toBe(false);
    expect(checkCurrency([denied], [usage({ currentPolicyVersion: v4 })], lenient).ok).toBe(true);
  });

  it("is indeterminate when there is nothing to check on either side", () => {
    expect(checkCurrency([], [usage()], strict)).toMatchObject({ ok: false, reason: "no-instructions-provided" });
    expect(checkCurrency([instruction()], [], strict)).toMatchObject({ ok: false, reason: "no-usages-provided" });
  });
});

// ------------------------------------------------------------------- gate 3

const easyGrant = { steps: 2, requiresContact: false, requiresAccount: false };

function path(overrides: Partial<PreferencePath> = {}): PreferencePath {
  return { surfaceId: "prefs", topic: "email", grant: easyGrant, withdraw: easyGrant, ...overrides };
}

describe("checkWithdrawalParity", () => {
  it("is satisfied when withdrawing costs no more than granting", () => {
    const result = checkWithdrawalParity([path(), path({ withdraw: { steps: 1, requiresContact: false, requiresAccount: false } })]);
    expect(result.ok).toBe(true);
    expect(result.pathsChecked).toBe(2);
  });

  it("flags a surface offering a way in and no way out", () => {
    const result = checkWithdrawalParity([{ surfaceId: "prefs", topic: "email", grant: easyGrant }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("withdrawal-harder-than-granting");
    expect(result.findings[0]?.kind).toBe("withdrawal-unavailable");
  });

  it("flags extra steps, an extra contact requirement, and an extra account requirement independently", () => {
    const result = checkWithdrawalParity([path({ withdraw: { steps: 6, requiresContact: true, requiresAccount: true } })]);
    expect(result.findings.map((f) => f.kind)).toEqual([
      "withdrawal-costs-more-steps",
      "withdrawal-requires-contact",
      "withdrawal-requires-account",
    ]);
  });

  it("does not flag a requirement withdrawing shares with granting", () => {
    const result = checkWithdrawalParity([
      path({ grant: { steps: 2, requiresContact: true, requiresAccount: true }, withdraw: { steps: 2, requiresContact: true, requiresAccount: true } }),
    ]);
    expect(result.ok).toBe(true);
  });

  it("is indeterminate, not clean, when no paths were supplied", () => {
    expect(checkWithdrawalParity([])).toEqual({ ok: false, reason: "no-paths-provided", pathsChecked: 0, findings: [] });
  });
});
