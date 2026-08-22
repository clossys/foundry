import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_VERDICTS,
  INTENT_DISPOSITIONS,
  STANDING_AUDIT_EVENT_TYPES,
  STANDING_PROVENANCES,
  isConfirmationRecord,
  isIntentRecord,
  isStandingInstruction,
  validateConfidenceFloor,
  validateConfirmationRecord,
  validateConfirmationRecords,
  validateInstructionUsages,
  validateIntentRecord,
  validateIntentRecords,
  validatePolicyVersion,
  validatePreferencePaths,
  validateStandingInstruction,
  validateStandingInstructions,
} from "./schema.js";

const policyVersion = { policyId: "wants", version: "3" };

const grantedInstruction = {
  instructionId: "ins_1",
  subjectId: "sub_1",
  topic: "contact-window",
  state: { kind: "granted", policyVersion, decidedAt: "2026-08-01T00:00:00.000Z" },
  provenance: "stated",
  currency: { days: 90 },
};

const intent = {
  intentId: "int_1",
  subjectId: "sub_1",
  actorId: "agent_1",
  interpretation: "reschedule",
  confidence: 0.91,
  observedAt: "2026-08-20T00:00:00.000Z",
  disposition: "acted",
};

describe("closed vocabularies", () => {
  it("keeps three consent states reachable through StandingState, with absent as a first-class value", () => {
    for (const state of [{ kind: "absent" }, { kind: "denied", policyVersion, decidedAt: "2026-08-01T00:00:00.000Z" }, { kind: "granted", policyVersion, decidedAt: "2026-08-01T00:00:00.000Z" }]) {
      expect(validateStandingInstruction({ ...grantedInstruction, state }).ok).toBe(true);
    }
  });

  it("rejects a boolean where a state belongs — there is no two-state shortcut into this schema", () => {
    expect(validateStandingInstruction({ ...grantedInstruction, state: true }).ok).toBe(false);
    expect(validateStandingInstruction({ ...grantedInstruction, state: { kind: true } }).ok).toBe(false);
    expect(validateStandingInstruction({ ...grantedInstruction, state: { kind: "yes" } }).ok).toBe(false);
  });

  it("publishes its vocabularies for a caller validating untyped input", () => {
    expect(STANDING_PROVENANCES).toEqual(["stated", "inferred"]);
    expect(INTENT_DISPOSITIONS).toEqual(["acted", "handed-off", "awaiting-confirmation"]);
    expect(CONFIRMATION_VERDICTS).toEqual(["confirmed", "misread", "unclear"]);
    expect(STANDING_AUDIT_EVENT_TYPES).toContain("policy-superseded");
    expect(STANDING_AUDIT_EVENT_TYPES).toContain("window-elapsed");
  });
});

describe("validateStandingInstruction", () => {
  it("accepts a well-formed instruction", () => {
    const result = validateStandingInstruction(grantedInstruction);
    expect(result.ok).toBe(true);
    expect(isStandingInstruction(grantedInstruction)).toBe(true);
  });

  it("requires a decided answer to name the policy version it answered", () => {
    const result = validateStandingInstruction({ ...grantedInstruction, state: { kind: "granted", decidedAt: "2026-08-01T00:00:00.000Z" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path.includes("policyVersion"))).toBe(true);
  });

  it("requires a currency window, and will not read a missing one as forever", () => {
    const { currency: _dropped, ...withoutWindow } = grantedInstruction;
    const result = validateStandingInstruction(withoutWindow);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path.includes("currency"))).toBe(true);
  });

  it("rejects an unparseable decidedAt rather than letting the currency arithmetic run on it", () => {
    const result = validateStandingInstruction({ ...grantedInstruction, state: { kind: "granted", policyVersion, decidedAt: "whenever" } });
    expect(result.ok).toBe(false);
  });

  it("carries confirmedAt through when present and omits the key when absent", () => {
    const withConfirmation = validateStandingInstruction({ ...grantedInstruction, provenance: "inferred", confirmedAt: "2026-08-02T00:00:00.000Z" });
    expect(withConfirmation.ok).toBe(true);
    if (withConfirmation.ok) expect(withConfirmation.value.confirmedAt).toBe("2026-08-02T00:00:00.000Z");
    const plain = validateStandingInstruction(grantedInstruction);
    if (plain.ok) expect("confirmedAt" in plain.value).toBe(false);
  });

  it("validates a whole array and names the failing index", () => {
    const result = validateStandingInstructions([grantedInstruction, { ...grantedInstruction, topic: "" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toContain("[1]");
  });

  it("refuses a non-array where an array of instructions belongs", () => {
    expect(validateStandingInstructions({ instructionId: "ins_1" }).ok).toBe(false);
  });
});

describe("validateIntentRecord", () => {
  it("accepts a well-formed intent and keeps actor and subject as separate fields", () => {
    const result = validateIntentRecord(intent);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actorId).toBe("agent_1");
      expect(result.value.subjectId).toBe("sub_1");
      expect(result.value.actorId).not.toBe(result.value.subjectId);
    }
    expect(isIntentRecord(intent)).toBe(true);
  });

  it("requires confidence to be a real number inside 0..1", () => {
    for (const confidence of [-0.1, 1.1, "0.9", undefined, Number.NaN]) {
      expect(validateIntentRecord({ ...intent, confidence }).ok).toBe(false);
    }
  });

  it("rejects a disposition outside the closed set", () => {
    expect(validateIntentRecord({ ...intent, disposition: "done" }).ok).toBe(false);
  });

  it("validates a whole array", () => {
    expect(validateIntentRecords([intent]).ok).toBe(true);
    expect(validateIntentRecords([{ ...intent, intentId: "" }]).ok).toBe(false);
  });
});

describe("validateConfirmationRecord", () => {
  it("keeps unclear as a distinct third verdict", () => {
    for (const verdict of CONFIRMATION_VERDICTS) {
      expect(validateConfirmationRecord({ intentId: "int_1", subjectId: "sub_1", verdict, confirmedAt: "2026-08-20T00:00:00.000Z" }).ok).toBe(true);
    }
    expect(validateConfirmationRecord({ intentId: "int_1", subjectId: "sub_1", verdict: true, confirmedAt: "2026-08-20T00:00:00.000Z" }).ok).toBe(false);
    expect(isConfirmationRecord({ intentId: "int_1", subjectId: "sub_1", verdict: "confirmed", confirmedAt: "2026-08-20T00:00:00.000Z" })).toBe(true);
  });

  it("validates a whole array", () => {
    expect(validateConfirmationRecords([]).ok).toBe(true);
    expect(validateConfirmationRecords([{ intentId: "int_1" }]).ok).toBe(false);
  });
});

describe("validateInstructionUsages", () => {
  it("requires each usage to carry the policy version in force at the moment of use", () => {
    const usage = { instructionId: "ins_1", actorId: "agent_1", usedAt: "2026-08-20T00:00:00.000Z", currentPolicyVersion: policyVersion };
    expect(validateInstructionUsages([usage]).ok).toBe(true);
    const { currentPolicyVersion: _dropped, ...withoutVersion } = usage;
    expect(validateInstructionUsages([withoutVersion]).ok).toBe(false);
  });
});

describe("validatePreferencePaths", () => {
  const grant = { steps: 2, requiresContact: false, requiresAccount: false };

  it("accepts a path with no withdraw route, so its absence stays representable", () => {
    const result = validatePreferencePaths([{ surfaceId: "prefs", topic: "email", grant }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.withdraw).toBeUndefined();
  });

  it("refuses a cost whose booleans are strings", () => {
    expect(validatePreferencePaths([{ surfaceId: "prefs", topic: "email", grant, withdraw: { steps: 2, requiresContact: "no", requiresAccount: false } }]).ok).toBe(false);
  });
});

describe("validateConfidenceFloor", () => {
  it("accepts a floor inside 0..1 and refuses anything else", () => {
    expect(validateConfidenceFloor({ minimumConfidence: 0 }).ok).toBe(true);
    expect(validateConfidenceFloor({ minimumConfidence: 1 }).ok).toBe(true);
    expect(validateConfidenceFloor({ minimumConfidence: 1.2 }).ok).toBe(false);
    expect(validateConfidenceFloor({}).ok).toBe(false);
    expect(validateConfidenceFloor(0.8).ok).toBe(false);
  });
});

describe("validatePolicyVersion", () => {
  it("requires both a policy id and a version", () => {
    expect(validatePolicyVersion(policyVersion).ok).toBe(true);
    expect(validatePolicyVersion({ policyId: "wants" }).ok).toBe(false);
  });
});
