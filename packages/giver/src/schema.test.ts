/**
 * The record validators, at the boundary they exist for: untyped JSON
 * arriving from a file or a host's own store.
 *
 * Two properties are asserted throughout. First, a malformed record fails
 * rather than being read with a substituted field — a hand-off with no
 * service level is not a hand-off with an assumed one. Second, an EMPTY
 * array of citations or grounds validates, because "delivered citing
 * nothing" is a real record that really happened and the grounding gate
 * has to be able to read it and report it. A validator that refused it
 * would convert a finding into a "could not run".
 */
import { describe, expect, it } from "vitest";
import {
  ANSWER_OUTCOME_KINDS,
  DELIVERY_STATES,
  HANDOFF_REASONS,
  INDETERMINATE_STANDING_STATUSES,
  STANDING_READ_STATUSES,
  isAnswerRecord,
  isHandoffRecord,
  isObligationRecord,
  validateAnswerRecord,
  validateAnswerRecords,
  validateDeliveryProofs,
  validateHandoffRecord,
  validateHandoffRecords,
  validateObligationRecord,
  validateObligationRecords,
  validatePlacementRecords,
  validateRetainedGrounds,
} from "./schema.js";

const AT = "2026-08-22T12:00:00.000Z";

const handoff = {
  handoffId: "handoff-1",
  subjectId: "subject-1",
  actorId: "actor-1",
  raisedAt: "2026-08-22T10:00:00.000Z",
  sla: { minutes: 60 },
  reason: "standing-indeterminate",
};

const placement = { handoffId: "handoff-1", placedWithActorId: "human-1", placedAt: "2026-08-22T10:30:00.000Z" };

const obligation = {
  obligationId: "obl-1",
  subjectId: "subject-1",
  register: "statements",
  firedAt: "2026-08-22T10:00:00.000Z",
  window: { minutes: 60 },
};

const deliveryProof = { obligationId: "obl-1", actorId: "sender-1", state: "delivered", observedAt: AT, transportRef: "ref-1" };

describe("vocabularies", () => {
  it("publishes every closed list a caller validating untyped input needs", () => {
    expect(STANDING_READ_STATUSES).toEqual(["granted", "denied", "absent", "stale", "unreadable"]);
    expect(INDETERMINATE_STANDING_STATUSES).toEqual(["absent", "stale", "unreadable"]);
    expect(HANDOFF_REASONS).toEqual(["standing-indeterminate", "grounds-unavailable"]);
    expect(ANSWER_OUTCOME_KINDS).toEqual(["delivered", "refused", "handed-off"]);
    expect(DELIVERY_STATES).toEqual(["delivered", "failed", "unknown"]);
  });

  it("keeps the three indeterminate standing statuses disjoint from the two that decide", () => {
    for (const status of INDETERMINATE_STANDING_STATUSES) {
      expect(status).not.toBe("granted");
      expect(status).not.toBe("denied");
    }
  });
});

describe("validateHandoffRecord", () => {
  it("accepts a well-formed record", () => {
    const result = validateHandoffRecord(handoff);
    expect(result.ok).toBe(true);
    expect(isHandoffRecord(handoff)).toBe(true);
  });

  it("refuses a record with no declared service level rather than assuming one", () => {
    const { sla, ...withoutSla } = handoff;
    void sla;
    const result = validateHandoffRecord(withoutSla);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((issue) => issue.path.includes("sla"))).toBe(true);
  });

  it("refuses a fractional or negative service level", () => {
    expect(validateHandoffRecord({ ...handoff, sla: { minutes: 1.5 } }).ok).toBe(false);
    expect(validateHandoffRecord({ ...handoff, sla: { minutes: -1 } }).ok).toBe(false);
  });

  it("refuses a reason outside the closed list", () => {
    expect(validateHandoffRecord({ ...handoff, reason: "because" }).ok).toBe(false);
  });

  it("refuses an unparseable raisedAt rather than reading it as now", () => {
    expect(validateHandoffRecord({ ...handoff, raisedAt: "this morning" }).ok).toBe(false);
  });

  it("requires the subject and the actor separately", () => {
    expect(validateHandoffRecord({ ...handoff, actorId: "" }).ok).toBe(false);
    expect(validateHandoffRecord({ ...handoff, subjectId: "" }).ok).toBe(false);
  });

  it("validates arrays, reporting each bad item's own index", () => {
    const result = validateHandoffRecords([handoff, { ...handoff, sla: { minutes: "soon" } }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues[0]?.path).toContain("[1]");
  });

  it("accepts an empty array", () => {
    expect(validateHandoffRecords([]).ok).toBe(true);
  });
});

describe("validatePlacementRecords", () => {
  it("accepts a well-formed placement and refuses one with no human named", () => {
    expect(validatePlacementRecords([placement]).ok).toBe(true);
    expect(validatePlacementRecords([{ ...placement, placedWithActorId: "" }]).ok).toBe(false);
  });

  it("refuses an unparseable placedAt", () => {
    expect(validatePlacementRecords([{ ...placement, placedAt: "later" }]).ok).toBe(false);
  });
});

describe("validateAnswerRecord", () => {
  const base = { requestId: "req-1", subjectId: "subject-1", actorId: "actor-1", receivedAt: AT };

  it("accepts each of the three outcomes", () => {
    expect(validateAnswerRecord({ ...base, outcome: { kind: "delivered", at: AT, cites: [{ groundId: "g", citedAt: AT }] } }).ok).toBe(true);
    expect(validateAnswerRecord({ ...base, outcome: { kind: "refused", at: AT, namedReason: "no", grounds: [] } }).ok).toBe(true);
    expect(validateAnswerRecord({ ...base, outcome: { kind: "handed-off", at: AT, handoffId: "handoff-1" } }).ok).toBe(true);
    expect(isAnswerRecord({ ...base, outcome: { kind: "handed-off", at: AT, handoffId: "handoff-1" } })).toBe(true);
  });

  it("accepts an empty citation list, so an ungrounded delivery stays a FINDING rather than becoming a could-not-run", () => {
    const result = validateAnswerRecord({ ...base, outcome: { kind: "delivered", at: AT, cites: [] } });
    expect(result.ok).toBe(true);
  });

  it("refuses a fourth outcome kind — the ternary is closed", () => {
    expect(validateAnswerRecord({ ...base, outcome: { kind: "ignored", at: AT } }).ok).toBe(false);
    expect(validateAnswerRecord({ ...base, outcome: { kind: true, at: AT } }).ok).toBe(false);
  });

  it("requires a refusal to name its reason", () => {
    expect(validateAnswerRecord({ ...base, outcome: { kind: "refused", at: AT, grounds: [] } }).ok).toBe(false);
    expect(validateAnswerRecord({ ...base, outcome: { kind: "refused", at: AT, namedReason: "  ", grounds: [] } }).ok).toBe(false);
  });

  it("requires a handed-off outcome to name the hand-off it raised", () => {
    expect(validateAnswerRecord({ ...base, outcome: { kind: "handed-off", at: AT } }).ok).toBe(false);
  });

  it("refuses a citation with no timestamp", () => {
    expect(validateAnswerRecord({ ...base, outcome: { kind: "delivered", at: AT, cites: [{ groundId: "g" }] } }).ok).toBe(false);
  });

  it("validates arrays", () => {
    expect(validateAnswerRecords([{ ...base, outcome: { kind: "handed-off", at: AT, handoffId: "h" } }]).ok).toBe(true);
    expect(validateAnswerRecords("not an array").ok).toBe(false);
  });
});

describe("validateRetainedGrounds", () => {
  it("accepts well-formed grounds and refuses one with no id", () => {
    expect(validateRetainedGrounds([{ groundId: "g", subjectId: "s", retainedAt: AT }]).ok).toBe(true);
    expect(validateRetainedGrounds([{ groundId: "", retainedAt: AT }]).ok).toBe(false);
  });

  it("accepts an empty set, which is a real state the grounding gate reports on", () => {
    expect(validateRetainedGrounds([]).ok).toBe(true);
  });
});

describe("validateObligationRecord", () => {
  it("accepts a well-formed obligation", () => {
    expect(validateObligationRecord(obligation).ok).toBe(true);
    expect(isObligationRecord(obligation)).toBe(true);
  });

  it("refuses an obligation with no declared window rather than assuming one", () => {
    const { window, ...withoutWindow } = obligation;
    void window;
    expect(validateObligationRecord(withoutWindow).ok).toBe(false);
  });

  it("requires the consumer's own register label", () => {
    expect(validateObligationRecord({ ...obligation, register: "" }).ok).toBe(false);
  });

  it("validates arrays and refuses a non-array", () => {
    expect(validateObligationRecords([obligation]).ok).toBe(true);
    expect(validateObligationRecords({}).ok).toBe(false);
  });
});

describe("validateDeliveryProofs", () => {
  it("accepts all three observed states", () => {
    for (const state of DELIVERY_STATES) {
      expect(validateDeliveryProofs([{ ...deliveryProof, state }]).ok).toBe(true);
    }
  });

  it("refuses a state outside the closed list, including a boolean stand-in for success", () => {
    expect(validateDeliveryProofs([{ ...deliveryProof, state: "sent" }]).ok).toBe(false);
    expect(validateDeliveryProofs([{ ...deliveryProof, state: true }]).ok).toBe(false);
  });

  it("requires a transport reference, so a proof can actually be traced back", () => {
    expect(validateDeliveryProofs([{ ...deliveryProof, transportRef: "" }]).ok).toBe(false);
  });

  it("refuses an unparseable observedAt", () => {
    expect(validateDeliveryProofs([{ ...deliveryProof, observedAt: "around noon" }]).ok).toBe(false);
  });

  it("accepts an empty set — no attempts recorded is exactly what the discharge gate must be able to see", () => {
    expect(validateDeliveryProofs([]).ok).toBe(true);
  });
});
