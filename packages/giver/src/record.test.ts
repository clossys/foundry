/**
 * The document seam and the emitters.
 *
 * The seam's whole claim is that a standing answer arrives as a validated
 * document rather than as an import, and that every way of failing to get
 * one produces an INDETERMINATE read. So the tests below spend most of
 * their effort on the failure directions: a document that does not
 * validate, a version this reader does not know, a status missing its own
 * companions, and a subject with no entry at all. None of them may produce
 * a grant.
 */
import { describe, expect, it } from "vitest";
import { decideOutcome, type OutcomeInputs, type Verdict } from "./contract.js";
import {
  STANDING_DECISIONS_DOCUMENT_FILENAME,
  STANDING_DECISIONS_SCHEMA_VERSION,
  STANDING_DECISION_STATUSES,
  answerRecordFor,
  handoffRecordFor,
  readStandingDecision,
  unreadableStandingDecision,
  validateStandingDecisionDocument,
} from "./record.js";

const AT = "2026-08-22T12:00:00.000Z";
const v3 = { policyId: "answers", version: "3" };

const document = {
  schemaVersion: 1,
  producedAt: "2026-08-22T09:00:00.000Z",
  decisions: [
    { subjectId: "subject-1", topic: "statements", status: "granted", policyVersion: v3, decidedAt: "2026-08-01T00:00:00.000Z" },
    { subjectId: "subject-2", topic: "statements", status: "denied", policyVersion: v3, decidedAt: "2026-08-02T00:00:00.000Z" },
    { subjectId: "subject-3", topic: "statements", status: "absent", reason: "never asked" },
    {
      subjectId: "subject-4",
      topic: "statements",
      status: "stale",
      reason: "policy superseded",
      previousPolicyVersion: v3,
      decidedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

function valid() {
  const result = validateStandingDecisionDocument(document);
  if (!result.ok) throw new Error(`fixture should validate: ${JSON.stringify(result.issues)}`);
  return result.value;
}

describe("the declared seam", () => {
  it("declares a bare filename, never an absolute path — where the directory lives is the consumer's decision", () => {
    expect(STANDING_DECISIONS_DOCUMENT_FILENAME).toBe("standing-decisions.json");
    expect(STANDING_DECISIONS_DOCUMENT_FILENAME).not.toContain("/");
  });

  it("names the four statuses the producing role can report, and does not include this side's own unreadable", () => {
    expect(STANDING_DECISION_STATUSES).toEqual(["granted", "denied", "absent", "stale"]);
    expect(STANDING_DECISION_STATUSES as readonly string[]).not.toContain("unreadable");
  });
});

describe("validateStandingDecisionDocument", () => {
  it("accepts a document at the declared version", () => {
    expect(valid().decisions).toHaveLength(4);
    expect(STANDING_DECISIONS_SCHEMA_VERSION).toBe(1);
  });

  it("refuses a version it does not know rather than reading unknown fields optimistically", () => {
    const result = validateStandingDecisionDocument({ ...document, schemaVersion: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((issue) => issue.path.includes("schemaVersion"))).toBe(true);
  });

  it("refuses a granted entry with no policy version, rather than reading it as a grant with the version left out", () => {
    const result = validateStandingDecisionDocument({
      ...document,
      decisions: [{ subjectId: "s", topic: "t", status: "granted", decidedAt: AT }],
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a stale entry with no previous version and an absent entry with no reason", () => {
    expect(validateStandingDecisionDocument({ ...document, decisions: [{ subjectId: "s", topic: "t", status: "stale", reason: "x", decidedAt: AT }] }).ok).toBe(
      false,
    );
    expect(validateStandingDecisionDocument({ ...document, decisions: [{ subjectId: "s", topic: "t", status: "absent" }] }).ok).toBe(false);
  });

  it("refuses a status outside the four, and a document that is not an object at all", () => {
    expect(validateStandingDecisionDocument({ ...document, decisions: [{ subjectId: "s", topic: "t", status: "maybe" }] }).ok).toBe(false);
    expect(validateStandingDecisionDocument("{}").ok).toBe(false);
    expect(validateStandingDecisionDocument(null).ok).toBe(false);
  });

  it("refuses a document with no producedAt, because a read has to be able to say how old it is", () => {
    const { producedAt, ...withoutProducedAt } = document;
    void producedAt;
    expect(validateStandingDecisionDocument(withoutProducedAt).ok).toBe(false);
  });
});

describe("readStandingDecision", () => {
  it("returns each of the four statuses, carrying what they rested on", () => {
    expect(readStandingDecision(valid(), "subject-1", "statements")).toEqual({ status: "granted", policyVersion: v3, decidedAt: "2026-08-01T00:00:00.000Z" });
    expect(readStandingDecision(valid(), "subject-2", "statements")).toEqual({ status: "denied", policyVersion: v3, decidedAt: "2026-08-02T00:00:00.000Z" });
    expect(readStandingDecision(valid(), "subject-3", "statements")).toEqual({ status: "absent", reason: "never asked" });
    expect(readStandingDecision(valid(), "subject-4", "statements")).toEqual({
      status: "stale",
      reason: "policy superseded",
      previousPolicyVersion: v3,
      decidedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("returns absent — not granted — for a subject with no entry, and says which document it looked in", () => {
    const read = readStandingDecision(valid(), "subject-unknown", "statements");
    expect(read.status).toBe("absent");
    if (read.status !== "absent") throw new Error("unreachable");
    expect(read.reason).toContain("2026-08-22T09:00:00.000Z");
  });

  it("keys on subject AND topic together, so an answer about one topic never speaks for another", () => {
    expect(readStandingDecision(valid(), "subject-1", "marketing").status).toBe("absent");
  });
});

describe("unreadableStandingDecision", () => {
  it("is the only thing a failed read can produce, and it is not a grant", () => {
    const read = unreadableStandingDecision("the file does not exist");
    expect(read).toEqual({ status: "unreadable", reason: "the file does not exist" });
  });

  it("routes to a person when the seam document could not be read at all", () => {
    // The end-to-end shape of the repayment: an absent collaborator does not
    // become a permissive default anywhere along this path.
    const inputs: OutcomeInputs = {
      requestId: "req-1",
      subjectId: "subject-1",
      actorId: "actor-1",
      at: AT,
      standing: unreadableStandingDecision("the file does not exist"),
      owed: null,
      humans: { available: true, actorId: "human-1" },
      grounds: { ready: true, cites: [] },
      handoffId: "handoff-1",
      sla: { minutes: 30 },
    };
    const verdict = decideOutcome(inputs);
    expect(verdict.kind).toBe("handed-off");
    if (verdict.kind !== "handed-off") throw new Error("unreachable");
    expect(verdict.handoff.reason).toBe("standing-indeterminate");
  });
});

// ------------------------------------------------------------------ emitters

const meta = {
  requestId: "req-1",
  subjectId: "subject-1",
  actorId: "actor-1",
  receivedAt: "2026-08-22T11:59:00.000Z",
  at: AT,
  cites: [{ groundId: "ground-1", citedAt: AT }],
};

const handoff = {
  handoffId: "handoff-1",
  subjectId: "subject-1",
  actorId: "actor-1",
  raisedAt: AT,
  sla: { minutes: 30 },
  reason: "standing-indeterminate" as const,
};

const delivered: Verdict = { kind: "delivered", basis: { kind: "standing-granted", policyVersion: v3 } };
const standingRefusal: Verdict = { kind: "refused", grounds: { kind: "standing-refusal", policyVersion: v3, decidedAt: "2026-08-02T00:00:00.000Z" } };
const handedOff: Verdict = { kind: "handed-off", handoff };
const unplaceable: Verdict = {
  kind: "refused",
  grounds: { kind: "handoff-unplaceable", unplaced: { handoff, namedReason: "no human was available (queue closed)" } },
};

describe("answerRecordFor", () => {
  it("records a delivery with the grounds it cited", () => {
    expect(answerRecordFor(delivered, meta).outcome).toEqual({ kind: "delivered", at: AT, cites: meta.cites });
  });

  it("records a standing refusal with a reason derived from its own grounds, never one the caller supplied", () => {
    const outcome = answerRecordFor(standingRefusal, meta).outcome;
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") throw new Error("unreachable");
    expect(outcome.namedReason).toContain("answers@3");
    expect(outcome.grounds).toEqual(meta.cites);
  });

  it("records a hand-off by the id of the hand-off it raised", () => {
    expect(answerRecordFor(handedOff, meta).outcome).toEqual({ kind: "handed-off", at: AT, handoffId: "handoff-1" });
  });

  it("records an unplaceable hand-off as a refusal carrying that hand-off's own named reason", () => {
    const outcome = answerRecordFor(unplaceable, meta).outcome;
    if (outcome.kind !== "refused") throw new Error("unreachable");
    expect(outcome.namedReason).toBe("no human was available (queue closed)");
  });

  it("keeps the subject and the actor separate on every record it emits", () => {
    for (const verdict of [delivered, standingRefusal, handedOff, unplaceable]) {
      const record = answerRecordFor(verdict, meta);
      expect(record.subjectId).toBe("subject-1");
      expect(record.actorId).toBe("actor-1");
    }
  });
});

describe("handoffRecordFor", () => {
  it("returns the record for a hand-off that was placed", () => {
    expect(handoffRecordFor(handedOff)).toEqual(handoff);
  });

  it("STILL returns the record for a refusal that could not place its hand-off", () => {
    // The one that matters. Dropping it here would turn a person who was
    // told nothing into a clean row, and the placement gate would never see
    // a hand-off that was raised and never picked up.
    expect(handoffRecordFor(unplaceable)).toEqual(handoff);
  });

  it("returns nothing for a delivery or for a refusal resting on the person's own decision", () => {
    expect(handoffRecordFor(delivered)).toBeUndefined();
    expect(handoffRecordFor(standingRefusal)).toBeUndefined();
  });
});
