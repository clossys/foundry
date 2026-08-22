/**
 * The decision core and the three gates, exercised as pure values.
 *
 * The first block is the one that matters most: it walks the WHOLE input
 * space of `decideOutcome` — every standing status, crossed with owed and
 * not owed, crossed with a human being available and not, crossed with
 * grounds being ready and not — and asserts the two collapses never happen
 * anywhere in it. An example-based test proves a rule holds for the cases
 * someone thought of; the sweep proves it holds for the ones nobody did.
 */
import { describe, expect, it } from "vitest";
import {
  checkGrounding,
  checkHandoffPlacement,
  checkObligationDischarge,
  decideOutcome,
  evaluateObligation,
  type GroundsReadiness,
  type HumanAvailability,
  type OutcomeInputs,
  type OwedObligation,
} from "./contract.js";
import type {
  AnswerRecord,
  DeliveryProof,
  HandoffRecord,
  ObligationRecord,
  PlacementRecord,
  RetainedGround,
  StandingRead,
} from "./schema.js";

const v3 = { policyId: "answers", version: "3" };
const v4 = { policyId: "answers", version: "4" };
const AT = "2026-08-22T12:00:00.000Z";

const STANDING_READS: readonly StandingRead[] = [
  { status: "granted", policyVersion: v3, decidedAt: "2026-08-01T00:00:00.000Z" },
  { status: "denied", policyVersion: v3, decidedAt: "2026-08-01T00:00:00.000Z" },
  { status: "absent", reason: "nobody ever asked" },
  { status: "stale", reason: "policy superseded", previousPolicyVersion: v3, decidedAt: "2026-01-01T00:00:00.000Z" },
  { status: "unreadable", reason: "the seam document did not validate" },
];

const OWED_OPTIONS: readonly (OwedObligation | null)[] = [null, { obligationId: "obl-1", register: "statements" }];

const HUMAN_OPTIONS: readonly HumanAvailability[] = [
  { available: true, actorId: "human-1" },
  { available: false, namedReason: "the queue is closed outside published hours" },
];

const GROUNDS_OPTIONS: readonly GroundsReadiness[] = [
  { ready: true, cites: [{ groundId: "ground-1", citedAt: AT }] },
  { ready: false, namedReason: "the retrieval step returned nothing" },
];

function inputs(overrides: Partial<OutcomeInputs> = {}): OutcomeInputs {
  return {
    requestId: "req-1",
    subjectId: "subject-1",
    actorId: "actor-1",
    at: AT,
    standing: { status: "granted", policyVersion: v3, decidedAt: "2026-08-01T00:00:00.000Z" },
    owed: null,
    humans: { available: true, actorId: "human-1" },
    grounds: { ready: true, cites: [{ groundId: "ground-1", citedAt: AT }] },
    handoffId: "handoff-1",
    sla: { minutes: 60 },
    ...overrides,
  };
}

function everyCombination(): OutcomeInputs[] {
  const all: OutcomeInputs[] = [];
  for (const standing of STANDING_READS) {
    for (const owed of OWED_OPTIONS) {
      for (const humans of HUMAN_OPTIONS) {
        for (const grounds of GROUNDS_OPTIONS) {
          all.push(inputs({ standing, owed, humans, grounds }));
        }
      }
    }
  }
  return all;
}

describe("decideOutcome — the whole input space", () => {
  it("covers all forty combinations, so the sweeps below are over the real space and not a subset", () => {
    expect(everyCombination()).toHaveLength(STANDING_READS.length * 2 * 2 * 2);
  });

  it("never converts an indeterminate standing read into a delivery", () => {
    // The first collapse. `absent`, `stale` and `unreadable` are the three
    // reads that decided nothing; none of them may produce a send. The one
    // thing that legitimately still sends is an obligation, which is owed
    // regardless of what the standing record says — and it is excluded here
    // because it is not the indeterminate read producing the delivery.
    for (const candidate of everyCombination()) {
      if (candidate.owed !== null) continue;
      if (candidate.standing.status === "granted" || candidate.standing.status === "denied") continue;
      expect(decideOutcome(candidate).kind).not.toBe("delivered");
    }
  });

  it("never converts an indeterminate standing read into a bare refusal either", () => {
    // The second collapse, and the more dangerous one: it looks like
    // discipline while real requests are dropped and the refusal metrics
    // stay healthy. An indeterminate read either reaches a person, or
    // produces a refusal that CARRIES the hand-off it could not place —
    // never a refusal that lost the fact a person was needed.
    for (const candidate of everyCombination()) {
      if (candidate.owed !== null) continue;
      if (candidate.standing.status === "granted" || candidate.standing.status === "denied") continue;
      const verdict = decideOutcome(candidate);
      if (verdict.kind === "handed-off") continue;
      expect(verdict.kind).toBe("refused");
      if (verdict.kind !== "refused") throw new Error("unreachable");
      expect(verdict.grounds.kind).toBe("handoff-unplaceable");
    }
  });

  it("produces a delivery only on a positive basis, never on an absent one", () => {
    for (const candidate of everyCombination()) {
      const verdict = decideOutcome(candidate);
      if (verdict.kind !== "delivered") continue;
      const positive =
        (verdict.basis.kind === "standing-granted" && candidate.standing.status === "granted") ||
        ((verdict.basis.kind === "owed" || verdict.basis.kind === "owed-against-standing-refusal") && candidate.owed !== null);
      expect(positive).toBe(true);
    }
  });

  it("raises a hand-off whenever a human is available and the read did not decide", () => {
    for (const candidate of everyCombination()) {
      if (candidate.owed !== null) continue;
      if (!candidate.humans.available) continue;
      if (candidate.standing.status === "denied") continue;
      if (candidate.standing.status === "granted" && candidate.grounds.ready) continue;
      expect(decideOutcome(candidate).kind).toBe("handed-off");
    }
  });
});

describe("decideOutcome — the inverted rule", () => {
  it("refuses on a standing refusal when nothing is owed", () => {
    const verdict = decideOutcome(inputs({ standing: { status: "denied", policyVersion: v3, decidedAt: "2026-08-01T00:00:00.000Z" } }));
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") throw new Error("unreachable");
    expect(verdict.grounds.kind).toBe("standing-refusal");
  });

  it("still sends the thing we owe, and records the send against the denial", () => {
    // The inverted rule. This is the one case where a refusal on record does
    // not stop a send, and the send is only defensible because the refusal
    // it overrode travels with it.
    const verdict = decideOutcome(
      inputs({
        standing: { status: "denied", policyVersion: v3, decidedAt: "2026-08-01T00:00:00.000Z" },
        owed: { obligationId: "obl-9", register: "statements" },
      }),
    );
    expect(verdict.kind).toBe("delivered");
    if (verdict.kind !== "delivered") throw new Error("unreachable");
    expect(verdict.basis).toEqual({
      kind: "owed-against-standing-refusal",
      obligationId: "obl-9",
      register: "statements",
      refusedPolicyVersion: v3,
      refusalDecidedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("sends what we owe on an indeterminate read too, without pretending the read said yes", () => {
    const verdict = decideOutcome(
      inputs({ standing: { status: "unreadable", reason: "no document" }, owed: { obligationId: "obl-9", register: "statements" } }),
    );
    expect(verdict.kind).toBe("delivered");
    if (verdict.kind !== "delivered") throw new Error("unreachable");
    expect(verdict.basis.kind).toBe("owed");
  });

  it("delivers on a current grant with grounds, naming the version it rested on", () => {
    const verdict = decideOutcome(inputs());
    expect(verdict).toEqual({ kind: "delivered", basis: { kind: "standing-granted", policyVersion: v3 } });
  });

  it("hands a granted request with nothing to cite to a person rather than delivering an ungrounded answer", () => {
    const verdict = decideOutcome(inputs({ grounds: { ready: false, namedReason: "retrieval returned nothing" } }));
    expect(verdict.kind).toBe("handed-off");
    if (verdict.kind !== "handed-off") throw new Error("unreachable");
    expect(verdict.handoff.reason).toBe("grounds-unavailable");
  });
});

describe("decideOutcome — no human available", () => {
  it("refuses with a named reason, and keeps the hand-off it could not place", () => {
    const verdict = decideOutcome(
      inputs({
        standing: { status: "absent", reason: "nobody ever asked" },
        humans: { available: false, namedReason: "the queue is closed outside published hours" },
      }),
    );
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") throw new Error("unreachable");
    if (verdict.grounds.kind !== "handoff-unplaceable") throw new Error("unreachable");
    expect(verdict.grounds.unplaced.namedReason).toContain("the queue is closed outside published hours");
    expect(verdict.grounds.unplaced.handoff).toEqual({
      handoffId: "handoff-1",
      subjectId: "subject-1",
      actorId: "actor-1",
      raisedAt: AT,
      sla: { minutes: 60 },
      reason: "standing-indeterminate",
    });
  });

  it("does not deliver when no human is available, on any read that needed one", () => {
    for (const standing of STANDING_READS) {
      if (standing.status === "denied") continue;
      const verdict = decideOutcome(
        inputs({
          standing,
          grounds: { ready: false, namedReason: "retrieval returned nothing" },
          humans: { available: false, namedReason: "nobody on shift" },
        }),
      );
      expect(verdict.kind).toBe("refused");
    }
  });

  it("keeps the actor and the subject separate in every hand-off it raises", () => {
    const verdict = decideOutcome(inputs({ standing: { status: "absent", reason: "never asked" } }));
    if (verdict.kind !== "handed-off") throw new Error("unreachable");
    expect(verdict.handoff.subjectId).toBe("subject-1");
    expect(verdict.handoff.actorId).toBe("actor-1");
    expect(verdict.handoff.subjectId).not.toBe(verdict.handoff.actorId);
  });

  it("is pure: the same inputs give the same verdict, and nothing reads the clock", () => {
    const candidate = inputs({ standing: { status: "stale", reason: "window elapsed", previousPolicyVersion: v3, decidedAt: "2026-01-01T00:00:00.000Z" } });
    expect(decideOutcome(candidate)).toEqual(decideOutcome(candidate));
  });
});

// ------------------------------------------------------------- obligations

const obligation: ObligationRecord = {
  obligationId: "obl-1",
  subjectId: "subject-1",
  register: "statements",
  firedAt: "2026-08-22T10:00:00.000Z",
  window: { minutes: 60 },
};

function proof(overrides: Partial<DeliveryProof> = {}): DeliveryProof {
  return {
    obligationId: "obl-1",
    actorId: "sender-1",
    state: "delivered",
    observedAt: "2026-08-22T10:30:00.000Z",
    transportRef: "ref-1",
    ...overrides,
  };
}

describe("evaluateObligation", () => {
  it("discharges on a delivery observed inside the declared window", () => {
    expect(evaluateObligation(obligation, [proof()], AT)).toEqual({
      status: "discharged",
      provenAt: "2026-08-22T10:30:00.000Z",
      attempts: 1,
    });
  });

  it("discharges when an earlier attempt failed and a later one landed in time", () => {
    const status = evaluateObligation(
      obligation,
      [proof({ state: "failed", observedAt: "2026-08-22T10:05:00.000Z", transportRef: "ref-a" }), proof()],
      AT,
    );
    expect(status.status).toBe("discharged");
    expect(status.attempts).toBe(2);
  });

  it("BREACHES when every recorded send failed — an attempt is not a delivery", () => {
    // The adversarial case. A weaker tool counts that a send was attempted
    // and passes here: the send path this package repays resolves its
    // promise on failure, so three recorded attempts look like three
    // successful calls to anything that only checks the call returned.
    const status = evaluateObligation(
      obligation,
      [
        proof({ state: "failed", observedAt: "2026-08-22T10:05:00.000Z", transportRef: "a" }),
        proof({ state: "failed", observedAt: "2026-08-22T10:15:00.000Z", transportRef: "b" }),
        proof({ state: "failed", observedAt: "2026-08-22T10:45:00.000Z", transportRef: "c" }),
      ],
      AT,
    );
    expect(status).toEqual({ status: "breached", reason: "delivery-failed", attempts: 3 });
  });

  it("is unprovable, never discharged, when the outcome of an attempt was never observed", () => {
    const status = evaluateObligation(obligation, [proof({ state: "unknown" })], AT);
    expect(status.status).toBe("unprovable");
    if (status.status !== "unprovable") throw new Error("unreachable");
    expect(status.reason).toBe("delivery-unobserved");
  });

  it("breaches when the window closed with nothing recorded at all", () => {
    expect(evaluateObligation(obligation, [], AT)).toEqual({ status: "breached", reason: "no-delivery-proof", attempts: 0 });
  });

  it("breaches on a delivery observed after the window closed", () => {
    const status = evaluateObligation(obligation, [proof({ observedAt: "2026-08-22T11:30:00.000Z" })], AT);
    expect(status).toEqual({ status: "breached", reason: "delivered-outside-window", attempts: 1 });
  });

  it("breaches on a proof that predates the obligation, rather than letting it discharge one", () => {
    const status = evaluateObligation(obligation, [proof({ observedAt: "2026-08-22T09:00:00.000Z" })], AT);
    expect(status).toEqual({ status: "breached", reason: "delivered-outside-window", attempts: 1 });
  });

  it("is unprovable with reason window-open while the window is still running", () => {
    const status = evaluateObligation(obligation, [], "2026-08-22T10:30:00.000Z");
    expect(status).toEqual({ status: "unprovable", reason: "window-open", dueAt: "2026-08-22T11:00:00.000Z", attempts: 0 });
  });

  it("ignores proofs belonging to another obligation", () => {
    const status = evaluateObligation(obligation, [proof({ obligationId: "obl-other" })], AT);
    expect(status).toEqual({ status: "breached", reason: "no-delivery-proof", attempts: 0 });
  });
});

// --------------------------------------------------- gate 1: hand-off placement

function handoff(overrides: Partial<HandoffRecord> = {}): HandoffRecord {
  return {
    handoffId: "handoff-1",
    subjectId: "subject-1",
    actorId: "actor-1",
    raisedAt: "2026-08-22T10:00:00.000Z",
    sla: { minutes: 60 },
    reason: "standing-indeterminate",
    ...overrides,
  };
}

function placement(overrides: Partial<PlacementRecord> = {}): PlacementRecord {
  return { handoffId: "handoff-1", placedWithActorId: "human-1", placedAt: "2026-08-22T10:30:00.000Z", ...overrides };
}

describe("checkHandoffPlacement", () => {
  it("passes when every hand-off that came due was picked up in time", () => {
    const result = checkHandoffPlacement([handoff()], [placement()], AT);
    expect(result.ok).toBe(true);
    expect(result.placed).toBe(1);
  });

  it("reports a raised hand-off nobody picked up as a finding, not as silence", () => {
    const result = checkHandoffPlacement([handoff()], [], AT);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("handoffs-unplaced");
    expect(result.findings.map((f) => f.kind)).toEqual(["never-placed"]);
  });

  it("reports a hand-off picked up after its declared service level had elapsed", () => {
    const result = checkHandoffPlacement([handoff()], [placement({ placedAt: "2026-08-22T11:30:00.000Z" })], AT);
    expect(result.findings.map((f) => f.kind)).toEqual(["placed-outside-sla"]);
  });

  it("reports a placement that predates the hand-off it claims to answer", () => {
    const result = checkHandoffPlacement([handoff()], [placement({ placedAt: "2026-08-22T09:00:00.000Z" })], AT);
    expect(result.findings.map((f) => f.kind)).toEqual(["placement-precedes-raise"]);
  });

  it("reports a placement naming a hand-off outside the set being checked", () => {
    const result = checkHandoffPlacement([handoff()], [placement(), placement({ handoffId: "handoff-unknown" })], AT);
    expect(result.findings.map((f) => f.kind)).toEqual(["placement-without-handoff"]);
  });

  it("reports a hand-off raised after the instant the run claims to check at", () => {
    const result = checkHandoffPlacement([handoff({ raisedAt: "2026-08-22T18:00:00.000Z" })], [], AT);
    expect(result.findings.map((f) => f.kind)).toEqual(["raised-after-check-instant"]);
  });

  it("counts a hand-off still inside its service level as awaiting, never as a finding", () => {
    const result = checkHandoffPlacement([handoff({ raisedAt: "2026-08-22T11:45:00.000Z" })], [], AT);
    expect(result.awaitingPlacement).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it("is indeterminate when nothing has come due, rather than reporting a pass earned by checking nothing", () => {
    const result = checkHandoffPlacement([handoff({ raisedAt: "2026-08-22T11:45:00.000Z" })], [], AT);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-handoffs-due");
  });

  it("is indeterminate on an empty hand-off set", () => {
    expect(checkHandoffPlacement([], [], AT).reason).toBe("no-handoffs-provided");
  });

  it("has no mixed indeterminate-and-violated state, and this pins why", () => {
    // Every hand-off is placed, late, unplaced past its level, or not yet
    // due — all four are determinate. The only indeterminate reasons are
    // "nothing provided" and "nothing due", and neither can coexist with a
    // finding: a finding means at least one hand-off came due and was
    // compared.
    const result = checkHandoffPlacement([handoff(), handoff({ handoffId: "handoff-2", raisedAt: "2026-08-22T11:45:00.000Z" })], [], AT);
    expect(result.reason).toBe("handoffs-unplaced");
    expect(result.awaitingPlacement).toBe(1);
  });
});

// -------------------------------------------------------------- gate 2: grounding

const ground: RetainedGround = { groundId: "ground-1", retainedAt: "2026-08-22T09:00:00.000Z" };

function answer(outcome: AnswerRecord["outcome"], overrides: Partial<AnswerRecord> = {}): AnswerRecord {
  return { requestId: "req-1", subjectId: "subject-1", actorId: "actor-1", receivedAt: "2026-08-22T09:59:00.000Z", outcome, ...overrides };
}

describe("checkGrounding", () => {
  it("passes when every delivery cites retained material and every refusal retains its grounds", () => {
    const result = checkGrounding(
      [
        answer({ kind: "delivered", at: AT, cites: [{ groundId: "ground-1", citedAt: AT }] }),
        answer({ kind: "refused", at: AT, namedReason: "a standing refusal", grounds: [{ groundId: "ground-1", citedAt: AT }] }, { requestId: "req-2" }),
      ],
      [ground],
    );
    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(1);
    expect(result.refused).toBe(1);
  });

  it("fails a delivered answer that cites nothing at all", () => {
    const result = checkGrounding([answer({ kind: "delivered", at: AT, cites: [] })], [ground]);
    expect(result.reason).toBe("answers-ungrounded");
    expect(result.findings.map((f) => f.kind)).toEqual(["delivered-without-citation"]);
  });

  it("fails a delivered answer citing material the consumer no longer holds", () => {
    const result = checkGrounding([answer({ kind: "delivered", at: AT, cites: [{ groundId: "gone", citedAt: AT }] })], [ground]);
    expect(result.findings.map((f) => f.kind)).toEqual(["citation-not-retained"]);
  });

  it("fails a refusal that retained no grounds — a refusal nobody can see the basis of is one nobody can contest", () => {
    const result = checkGrounding([answer({ kind: "refused", at: AT, namedReason: "policy", grounds: [] })], [ground]);
    expect(result.findings.map((f) => f.kind)).toEqual(["refusal-without-grounds"]);
  });

  it("fails a refusal whose grounds are no longer retained", () => {
    const result = checkGrounding([answer({ kind: "refused", at: AT, namedReason: "policy", grounds: [{ groundId: "gone", citedAt: AT }] })], [ground]);
    expect(result.findings.map((f) => f.kind)).toEqual(["refusal-grounds-not-retained"]);
  });

  it("does not judge a handed-off answer, which has neither delivered nor refused anything", () => {
    const result = checkGrounding([answer({ kind: "handed-off", at: AT, handoffId: "handoff-1" })], []);
    expect(result.ok).toBe(true);
    expect(result.handedOff).toBe(1);
  });

  it("is indeterminate on an empty answer set", () => {
    expect(checkGrounding([], [ground]).reason).toBe("no-answers-provided");
  });

  it("treats an empty retained set as a real, checkable state rather than an excuse not to run", () => {
    const result = checkGrounding([answer({ kind: "delivered", at: AT, cites: [{ groundId: "ground-1", citedAt: AT }] })], []);
    expect(result.reason).toBe("answers-ungrounded");
    expect(result.findings.map((f) => f.kind)).toEqual(["citation-not-retained"]);
  });

  it("has no mixed indeterminate-and-violated state, and this pins why", () => {
    // Every answer is delivered, refused or handed off, and all three are
    // determinate against a retained set. The only indeterminate reason is
    // an empty answer set, which can produce no findings at all.
    expect(checkGrounding([], []).findings).toEqual([]);
  });
});

// --------------------------------------------- gate 3: obligation discharge

describe("checkObligationDischarge", () => {
  it("passes when every obligation that came due was proven delivered in time", () => {
    const result = checkObligationDischarge([obligation], [proof()], AT);
    expect(result.ok).toBe(true);
    expect(result.discharged).toBe(1);
  });

  it("fails when every send against an obligation failed — the case a weaker tool passes", () => {
    const result = checkObligationDischarge([obligation], [proof({ state: "failed" })], AT);
    expect(result.reason).toBe("obligations-breached");
    expect(result.findings.map((f) => f.kind)).toEqual(["delivery-failed"]);
    expect(result.findings[0]?.attempts).toBe(1);
  });

  it("fails when the window closed with nothing recorded", () => {
    const result = checkObligationDischarge([obligation], [], AT);
    expect(result.findings.map((f) => f.kind)).toEqual(["no-delivery-proof"]);
  });

  it("fails on a delivery outside the declared window", () => {
    const result = checkObligationDischarge([obligation], [proof({ observedAt: "2026-08-22T11:30:00.000Z" })], AT);
    expect(result.findings.map((f) => f.kind)).toEqual(["delivered-outside-window"]);
  });

  it("fails on a proof naming an obligation outside the set being checked", () => {
    const result = checkObligationDischarge([obligation], [proof(), proof({ obligationId: "obl-unknown" })], AT);
    expect(result.findings.map((f) => f.kind)).toEqual(["proof-without-obligation"]);
  });

  it("is indeterminate — never clean — when an attempt's outcome was never observed", () => {
    const result = checkObligationDischarge([obligation], [proof({ state: "unknown" })], AT);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("discharge-unprovable");
    expect(result.findings.map((f) => f.kind)).toEqual(["delivery-unprovable"]);
  });

  it("reports the indeterminate reason on a mixed run, and still carries the breach it did find", () => {
    // The completeness of the answer is what the reason describes; the
    // findings are the answer so far. A reader has to be able to act on the
    // breach that WAS found while going back for the send nobody observed.
    const other: ObligationRecord = { ...obligation, obligationId: "obl-2" };
    const result = checkObligationDischarge([obligation, other], [proof({ state: "failed" }), proof({ obligationId: "obl-2", state: "unknown" })], AT);
    expect(result.reason).toBe("discharge-unprovable");
    expect(result.findings.map((f) => f.kind).sort()).toEqual(["delivery-failed", "delivery-unprovable"]);
  });

  it("counts an obligation still inside its window as awaiting, never as a finding", () => {
    const result = checkObligationDischarge([obligation], [], "2026-08-22T10:30:00.000Z");
    expect(result.awaitingWindow).toBe(1);
    expect(result.findings).toEqual([]);
    expect(result.reason).toBe("no-obligations-due");
  });

  it("is indeterminate on an empty obligation set", () => {
    expect(checkObligationDischarge([], [], AT).reason).toBe("no-obligations-provided");
  });
});
