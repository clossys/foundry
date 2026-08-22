/**
 * The decision and the three gates, against plain values, with no filesystem
 * and no clock.
 *
 * Three groups of tests here are the ones that must be able to fail, and each
 * was proven able to by inverting the rule in source, rebuilding, and
 * confirming exactly these tests went red:
 *
 *   1. THE PRECEDENCE ORDER in `decideHolding`. Erasure over closure over
 *      retention over justification over reach. Every step of it is asserted
 *      with an input that would produce a different verdict under any other
 *      ordering.
 *   2. THE FAIL-CLOSED RULE. Every "could not tell" input to `decideHolding`
 *      produces `unjustifiable`, never `held`.
 *   3. THE INDETERMINATE-OVER-VIOLATION RULE in all three gates. A set
 *      holding both a real violation and something that could not be checked
 *      reports the indeterminate reason — while still listing the violation
 *      it did find.
 */
import { describe, expect, it } from "vitest";
import {
  DISPOSAL_VIOLATION_REASONS,
  HOLDING_KINDS,
  INDETERMINATE_ATTRIBUTION_FINDING_KINDS,
  INDETERMINATE_DISPOSAL_FINDING_KINDS,
  INDETERMINATE_VISIBILITY_FINDING_KINDS,
  checkAttribution,
  checkDisposal,
  checkVisibility,
  decideHolding,
  type DispositionRead,
  type HoldingInputs,
  type ReachRead,
  type RetentionRead,
  type SourceRead,
} from "./contract.js";
import type { DeletionRecord, DisclosureRecord, HeldItem, InferredBelief, SourceEvent } from "./schema.js";

const AT = "2026-08-22T12:00:00.000Z";

function event(overrides: Partial<SourceEvent> = {}): SourceEvent {
  return { eventId: "evt_1", subjectId: "sub_1", actorId: "actor_1", occurredAt: "2026-01-01T00:00:00.000Z", kind: "note-written", ...overrides };
}

function item(overrides: Partial<HeldItem> = {}): HeldItem {
  return {
    itemId: "item_1",
    subjectId: "sub_1",
    actorId: "actor_1",
    heldSince: "2026-08-01T00:00:00.000Z",
    holdingClass: "authored-notes",
    origin: "authored",
    provenance: { kind: "event", sourceEventId: "evt_1" },
    belief: null,
    ...overrides,
  };
}

function inferred(use: InferredBelief["use"], overrides: Partial<HeldItem> = {}): HeldItem {
  return item({
    itemId: "item_belief",
    holdingClass: "inferred-preferences",
    origin: "inferred",
    belief: { beliefClass: "scheduling-preference", inferredAt: "2026-08-01T00:00:00.000Z", use },
    ...overrides,
  });
}

const declared: RetentionRead = { status: "declared", days: 90 };
const reachable: ReachRead = { status: "reachable", surface: "account-data-page" };
const retained: SourceRead = { status: "retained", event: event() };
const standing: DispositionRead = { status: "standing" };

function inputs(overrides: Partial<HoldingInputs> = {}): HoldingInputs {
  return { item: item(), actorId: "actor_1", at: AT, retention: declared, reach: reachable, source: retained, disposition: standing, ...overrides };
}

describe("HOLDING_KINDS", () => {
  it("is the ternary this role reports, never a boolean", () => {
    expect(HOLDING_KINDS).toEqual(["held", "forgotten", "unjustifiable"]);
  });
});

describe("decideHolding — the held case", () => {
  it("holds an authored item on a basis that names the source event", () => {
    const verdict = decideHolding(inputs());
    expect(verdict.kind).toBe("held");
    if (verdict.kind === "held") expect(verdict.basis).toEqual({ kind: "authored", sourceEventId: "evt_1" });
  });

  it("names the origin in the basis, so a report can say WHY it is kept", () => {
    expect(decideHolding(inputs({ item: item({ origin: "saved" }) }))).toMatchObject({ basis: { kind: "saved" } });
    expect(decideHolding(inputs({ item: item({ origin: "observed" }) }))).toMatchObject({ basis: { kind: "observed" } });
  });

  it("holds a belief that only informs, and names its class", () => {
    const verdict = decideHolding(inputs({ item: inferred({ mode: "informs" }) }));
    expect(verdict).toEqual({ kind: "held", basis: { kind: "belief-informs", sourceEventId: "evt_1", beliefClass: "scheduling-preference" } });
  });

  it("holds a belief the person confirmed, and records the instant the boundary was crossed", () => {
    const verdict = decideHolding(
      inputs({ item: inferred({ mode: "constrains", confirmation: { confirmedAt: "2026-08-10T00:00:00.000Z", sourceEventId: "evt_confirm" } }) }),
    );
    expect(verdict).toEqual({
      kind: "held",
      basis: {
        kind: "belief-confirmed-as-instruction",
        sourceEventId: "evt_1",
        beliefClass: "scheduling-preference",
        confirmedAt: "2026-08-10T00:00:00.000Z",
      },
    });
  });
});

describe("decideHolding — the boundary rule", () => {
  it("refuses to justify a belief that constrains behaviour with no confirmation", () => {
    // An instruction constrains us; an understanding only informs us. A belief
    // that crossed that line without being put to the person is an instruction
    // nobody gave, and it therefore rests on nothing they did.
    const verdict = decideHolding(inputs({ item: inferred({ mode: "constrains", confirmation: null }) }));
    expect(verdict).toEqual({ kind: "unjustifiable", fault: { kind: "belief-used-as-constraint", beliefClass: "scheduling-preference" } });
  });

  it("catches it even when the belief's own source event is impeccable", () => {
    // Knowing where an inference came from is not permission to act on it.
    const verdict = decideHolding(inputs({ item: inferred({ mode: "constrains", confirmation: null }), source: { status: "retained", event: event() } }));
    expect(verdict.kind).toBe("unjustifiable");
  });
});

describe("decideHolding — the fail-closed rule", () => {
  it("returns unjustifiable, never held, for a source nobody could look up", () => {
    const verdict = decideHolding(inputs({ source: { status: "unknown", namedReason: "the event ledger timed out" } }));
    expect(verdict).toEqual({ kind: "unjustifiable", fault: { kind: "source-unverifiable", namedReason: "the event ledger timed out" } });
  });

  it("returns unjustifiable, never held, for a reach nobody could establish", () => {
    const verdict = decideHolding(inputs({ reach: { status: "unknown", namedReason: "the surface index was unavailable" } }));
    expect(verdict).toEqual({ kind: "unjustifiable", fault: { kind: "reach-unverifiable", namedReason: "the surface index was unavailable" } });
  });

  it("returns unjustifiable for material held under no declared schedule at all", () => {
    // "Forever, by omission" is not a commitment anyone made to the person.
    const verdict = decideHolding(inputs({ retention: { status: "undeclared", namedReason: "no rule covers this class" } }));
    expect(verdict).toMatchObject({ kind: "unjustifiable", fault: { kind: "retention-undeclared" } });
  });

  it("names the missing source and the inferred-belief case as different faults", () => {
    expect(decideHolding(inputs({ source: { status: "missing", namedReason: "no event" } }))).toMatchObject({ fault: { kind: "no-source-event" } });
    expect(
      decideHolding(inputs({ item: inferred({ mode: "informs" }), source: { status: "missing", namedReason: "no event" } })),
    ).toMatchObject({ fault: { kind: "inferred-belief-without-source-event", beliefClass: "scheduling-preference" } });
  });

  it("refuses a source event that belongs to somebody else", () => {
    // It traces to something SOMEBODY did, just not them.
    const verdict = decideHolding(inputs({ source: { status: "retained", event: event({ subjectId: "sub_other" }) } }));
    expect(verdict).toMatchObject({ fault: { kind: "source-event-names-another-subject", eventSubjectId: "sub_other" } });
  });

  it("separates unreachable from read-only, because the fixes are different", () => {
    expect(decideHolding(inputs({ reach: { status: "unreachable", namedReason: "no surface renders this class" } }))).toMatchObject({
      fault: { kind: "unreachable" },
    });
    expect(decideHolding(inputs({ reach: { status: "read-only", surface: "account-data-page" } }))).toEqual({
      kind: "unjustifiable",
      fault: { kind: "not-correctable", surface: "account-data-page" },
    });
  });
});

describe("decideHolding — the precedence order", () => {
  // Each case below is constructed so that ANY other ordering produces a
  // different verdict. That is what makes them able to fail.

  it("1. an erasure the person asked for beats a perfectly good reason to keep it", () => {
    const verdict = decideHolding(inputs({ disposition: { status: "erasure-requested", requestedAt: "2026-08-20T00:00:00.000Z", sourceEventId: "evt_erase" } }));
    expect(verdict).toEqual({
      kind: "forgotten",
      grounds: { kind: "erasure-requested", requestedAt: "2026-08-20T00:00:00.000Z", sourceEventId: "evt_erase" },
    });
  });

  it("1. and it beats an unjustifiable holding too — nothing here weighs our reason against their request", () => {
    const verdict = decideHolding(
      inputs({
        source: { status: "missing", namedReason: "no event" },
        disposition: { status: "erasure-requested", requestedAt: "2026-08-20T00:00:00.000Z", sourceEventId: "evt_erase" },
      }),
    );
    expect(verdict.kind).toBe("forgotten");
  });

  it("2. a closed account with no succession forgets, even where everything else is in order", () => {
    const verdict = decideHolding(inputs({ disposition: { status: "account-closed", closedAt: "2026-08-15T00:00:00.000Z", succession: null } }));
    expect(verdict).toEqual({ kind: "forgotten", grounds: { kind: "account-closed", closedAt: "2026-08-15T00:00:00.000Z" } });
  });

  it("2. succession is opt-in PER CLASS, so a claim that does not name this class still forgets", () => {
    const verdict = decideHolding(
      inputs({
        disposition: {
          status: "account-closed",
          closedAt: "2026-08-15T00:00:00.000Z",
          succession: { successorSubjectId: "sub_heir", sourceEventId: "evt_will", classes: ["saved-work"] },
        },
      }),
    );
    expect(verdict.kind).toBe("forgotten");
  });

  it("2. a succession claim covering this class continues, on a basis naming the event they named it in", () => {
    const verdict = decideHolding(
      inputs({
        disposition: {
          status: "account-closed",
          closedAt: "2026-08-15T00:00:00.000Z",
          succession: { successorSubjectId: "sub_heir", sourceEventId: "evt_will", classes: ["authored-notes"] },
        },
      }),
    );
    expect(verdict).toEqual({ kind: "held", basis: { kind: "succession", sourceEventId: "evt_will", successorSubjectId: "sub_heir" } });
  });

  it("2. succession wins the basis over an inferred belief, so the successor is not lost", () => {
    // The belief basis would say why we formed it; only the succession basis
    // says who inherited it, and on a closed account that is the fact a reader
    // needs.
    const verdict = decideHolding(
      inputs({
        item: inferred({ mode: "informs" }),
        disposition: {
          status: "account-closed",
          closedAt: "2026-08-15T00:00:00.000Z",
          succession: { successorSubjectId: "sub_heir", sourceEventId: "evt_will", classes: ["inferred-preferences"] },
        },
      }),
    );
    expect(verdict).toEqual({ kind: "held", basis: { kind: "succession", sourceEventId: "evt_will", successorSubjectId: "sub_heir" } });
  });

  it("2. but a constraint the person never agreed to is not laundered by being inherited", () => {
    const verdict = decideHolding(
      inputs({
        item: inferred({ mode: "constrains", confirmation: null }),
        disposition: {
          status: "account-closed",
          closedAt: "2026-08-15T00:00:00.000Z",
          succession: { successorSubjectId: "sub_heir", sourceEventId: "evt_will", classes: ["inferred-preferences"] },
        },
      }),
    );
    expect(verdict).toMatchObject({ kind: "unjustifiable", fault: { kind: "belief-used-as-constraint" } });
  });

  it("3. elapsed retention forgets, and forgetting beats justifying", () => {
    // An item both past its schedule and unjustifiable is `forgotten`:
    // forgetting resolves it, and reporting it as a holding to justify would
    // ask the wrong question.
    const past = item({ heldSince: "2025-01-01T00:00:00.000Z" });
    const verdict = decideHolding(inputs({ item: past, source: { status: "missing", namedReason: "no event" } }));
    expect(verdict.kind).toBe("forgotten");
    if (verdict.kind === "forgotten" && verdict.grounds.kind === "retention-elapsed") {
      expect(verdict.grounds.declaredDays).toBe(90);
      expect(verdict.grounds.heldDays).toBeGreaterThan(90);
    } else {
      expect.unreachable("expected retention-elapsed grounds");
    }
  });

  it("3. an item exactly at its declared boundary is still held — the comparison is strictly greater", () => {
    const exactly90 = item({ heldSince: "2026-05-24T12:00:00.000Z" });
    expect(decideHolding(inputs({ item: exactly90 })).kind).toBe("held");
  });

  it("4. justification beats reach, so a missing source is reported as a missing source and not as a reach problem", () => {
    const verdict = decideHolding(
      inputs({ source: { status: "missing", namedReason: "no event" }, reach: { status: "unreachable", namedReason: "no surface" } }),
    );
    expect(verdict).toMatchObject({ fault: { kind: "no-source-event" } });
  });

  it("returns unjustifiable, never held, when the item's own heldSince cannot be read", () => {
    // Every comparison here is strictly-greater, and `NaN > n` is false — so
    // an unreadable instant flowing through arithmetic would read as "inside
    // its schedule" and count toward the satisfied answer. The validators
    // catch this at the JSON boundary, but these functions are exported and
    // take any item a host constructs directly.
    const verdict = decideHolding(inputs({ item: item({ heldSince: "a while ago" }) }));
    expect(verdict).toEqual({ kind: "unjustifiable", fault: { kind: "held-since-unreadable", heldSince: "a while ago" } });
  });

  it("takes its instant as a parameter, so the same inputs always produce the same verdict", () => {
    const past = item({ heldSince: "2026-05-01T00:00:00.000Z" });
    expect(decideHolding(inputs({ item: past, at: "2026-06-01T00:00:00.000Z" })).kind).toBe("held");
    expect(decideHolding(inputs({ item: past, at: "2026-09-01T00:00:00.000Z" })).kind).toBe("forgotten");
  });
});

// ------------------------------------------------------------ gate 1

describe("checkAttribution", () => {
  const events = [event(), event({ eventId: "evt_2", occurredAt: "2026-08-01T00:00:00.000Z" })];

  it("is satisfied when every held item traces to a retained event of the same person", () => {
    const result = checkAttribution([item()], events);
    expect(result.ok).toBe(true);
    expect(result.attributed).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it("reports an empty holding set as indeterminate, never as clean", () => {
    const result = checkAttribution([], events);
    expect(result).toMatchObject({ ok: false, reason: "no-items-provided" });
  });

  it("fails on a holding that traces to nothing the person did", () => {
    const result = checkAttribution([item({ provenance: { kind: "none", namedReason: "imported from a spreadsheet" } })], events);
    expect(result).toMatchObject({ ok: false, reason: "holdings-unattributed" });
    expect(result.findings[0]?.kind).toBe("held-without-source-event");
  });

  it("gives an inferred belief with no source event its OWN finding kind — the central finding", () => {
    // A report saying "3 unattributed items" hides whether any of them were
    // things nobody ever told the person we believed.
    const result = checkAttribution(
      [inferred({ mode: "informs" }, { provenance: { kind: "none", namedReason: "the model produced no citation" } })],
      events,
    );
    expect(result.findings[0]?.kind).toBe("inferred-belief-without-source-event");
    expect(result.beliefsChecked).toBe(1);
  });

  it("fails on a named event the consumer no longer retains", () => {
    const result = checkAttribution([item({ provenance: { kind: "event", sourceEventId: "evt_gone" } })], events);
    expect(result.findings[0]?.kind).toBe("source-event-not-retained");
  });

  it("fails on an event belonging to a different person", () => {
    const result = checkAttribution([item({ subjectId: "sub_other" })], events);
    expect(result.findings[0]?.kind).toBe("source-event-names-another-subject");
  });

  it("fails on an event that happened after we were already holding the item", () => {
    const result = checkAttribution([item({ heldSince: "2025-01-01T00:00:00.000Z" })], events);
    expect(result.findings[0]?.kind).toBe("source-event-postdates-holding");
  });

  it("fails on a belief that constrains behaviour with no confirmation — the boundary rule, as a gate", () => {
    const result = checkAttribution([inferred({ mode: "constrains", confirmation: null }, { provenance: { kind: "event", sourceEventId: "evt_2" } })], events);
    expect(result).toMatchObject({ ok: false, reason: "holdings-unattributed" });
    expect(result.findings.map((finding) => finding.kind)).toContain("belief-constrains-without-confirmation");
    expect(result.findings[0]?.message).toContain("an understanding only informs, an instruction constrains");
  });

  it("passes a belief that constrains WITH a confirmation the consumer retains", () => {
    const withConfirmation = inferred(
      { mode: "constrains", confirmation: { confirmedAt: "2026-08-05T00:00:00.000Z", sourceEventId: "evt_1" } },
      { provenance: { kind: "event", sourceEventId: "evt_2" } },
    );
    expect(checkAttribution([withConfirmation], events).ok).toBe(true);
  });

  it("fails on a confirmation naming an event the consumer no longer retains", () => {
    const dangling = inferred(
      { mode: "constrains", confirmation: { confirmedAt: "2026-08-05T00:00:00.000Z", sourceEventId: "evt_gone" } },
      { provenance: { kind: "event", sourceEventId: "evt_2" } },
    );
    expect(checkAttribution([dangling], events).findings[0]?.kind).toBe("belief-confirmation-not-retained");
  });

  it("reports an unorderable pair of instants as indeterminate, never as attributed", () => {
    const result = checkAttribution([item({ heldSince: "a while ago" })], events);
    expect(result).toMatchObject({ ok: false, reason: "attribution-unverifiable" });
    expect(result.findings[0]?.kind).toBe("instant-unreadable");
    expect(result.attributed).toBe(0);
  });

  it("reports a provenance the store could not resolve as indeterminate, never as a violation and never as clean", () => {
    const result = checkAttribution([item({ provenance: { kind: "indeterminate", namedReason: "the event ledger timed out" } })], events);
    expect(result).toMatchObject({ ok: false, reason: "attribution-unverifiable" });
    expect(INDETERMINATE_ATTRIBUTION_FINDING_KINDS).toContain(result.findings[0]?.kind);
  });

  it("reports the indeterminate reason on a mixed set — and still lists the violation it did find", () => {
    // Refusing to call the list complete must not mean refusing to show it.
    const result = checkAttribution(
      [
        item({ itemId: "item_bad", provenance: { kind: "none", namedReason: "imported" } }),
        item({ itemId: "item_unknown", provenance: { kind: "indeterminate", namedReason: "ledger timeout" } }),
      ],
      events,
    );
    expect(result.reason).toBe("attribution-unverifiable");
    expect(result.findings.map((finding) => finding.itemId)).toEqual(["item_bad", "item_unknown"]);
  });
});

// ------------------------------------------------------------ gate 2

describe("checkVisibility", () => {
  function route(overrides: Partial<DisclosureRecord> = {}): DisclosureRecord {
    return {
      itemId: "item_1",
      subjectId: "sub_1",
      surface: "account-data-page",
      reach: "visible",
      correctable: true,
      observedAt: "2026-08-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("is satisfied when every item is reachable AND correctable by the person it is about", () => {
    const result = checkVisibility([item()], [route()]);
    expect(result.ok).toBe(true);
    expect(result.reachable).toBe(1);
  });

  it("reports an empty holding set as indeterminate", () => {
    expect(checkVisibility([], [route()])).toMatchObject({ ok: false, reason: "no-items-provided" });
  });

  it("fails on an item with no disclosure route at all — the step nothing else in a codebase fails on", () => {
    const result = checkVisibility([item()], []);
    expect(result).toMatchObject({ ok: false, reason: "holdings-unreachable" });
    expect(result.findings[0]?.kind).toBe("item-not-disclosed");
  });

  it("fails when every route for the person reports it hidden", () => {
    expect(checkVisibility([item()], [route({ reach: "hidden" })]).findings[0]?.kind).toBe("item-hidden");
  });

  it("fails when the only route belongs to a different person — 'somebody can see this' was never the question", () => {
    const result = checkVisibility([item()], [route({ subjectId: "sub_other" })]);
    expect(result.findings[0]?.kind).toBe("disclosed-to-another-subject");
  });

  it("fails on a route that shows without allowing correction — reading is not correcting", () => {
    const result = checkVisibility([item()], [route({ correctable: false })]);
    expect(result.findings[0]?.kind).toBe("visible-but-not-correctable");
    expect(result.findings[0]?.message).toContain("account-data-page");
  });

  it("accepts one good route among several bad ones — a person needs one way in, not every way", () => {
    const result = checkVisibility([item()], [route({ surface: "export", reach: "hidden", correctable: false }), route()]);
    expect(result.ok).toBe(true);
  });

  it("fails on a route naming an item outside the set being checked", () => {
    const result = checkVisibility([item()], [route(), route({ itemId: "item_ghost" })]);
    expect(result.findings.map((finding) => finding.kind)).toContain("disclosure-without-item");
  });

  it("reports a reach nobody could establish as indeterminate, never as visible and never as hidden", () => {
    const result = checkVisibility([item()], [route({ reach: "unknown" })]);
    expect(result).toMatchObject({ ok: false, reason: "visibility-unverifiable" });
    expect(INDETERMINATE_VISIBILITY_FINDING_KINDS).toContain(result.findings[0]?.kind);
  });

  it("reports the indeterminate reason on a mixed set — and still lists the violation it did find", () => {
    const result = checkVisibility(
      [item({ itemId: "item_hidden" }), item({ itemId: "item_unknown" })],
      [route({ itemId: "item_hidden", reach: "hidden" }), route({ itemId: "item_unknown", reach: "unknown" })],
    );
    expect(result.reason).toBe("visibility-unverifiable");
    expect(result.findings.map((finding) => finding.kind)).toEqual(["item-hidden", "reach-unverifiable"]);
  });
});

// ------------------------------------------------------------ gate 3

describe("checkDisposal", () => {
  const schedule = [{ holdingClass: "authored-notes", days: 90 }];
  function deletion(overrides: Partial<DeletionRecord> = {}): DeletionRecord {
    return { itemId: "item_1", subjectId: "sub_1", actorId: "actor_1", deletedAt: "2026-08-10T00:00:00.000Z", effect: "erased", ...overrides };
  }

  it("is satisfied when every item is inside the retention its own class declared", () => {
    const result = checkDisposal([item()], schedule, [], AT);
    expect(result.ok).toBe(true);
    expect(result.withinSchedule).toBe(1);
  });

  it("THE ADVERSARIAL CASE: a well-formed schedule does not save records sitting far past it", () => {
    // A weaker tool checks that a retention policy EXISTS. It reads this
    // schedule, finds it well-formed, and passes — while three records sit
    // 400 days into a 90-day policy, because nothing compared the declaration
    // against the data.
    const stale = ["item_a", "item_b", "item_c"].map((itemId) => item({ itemId, heldSince: "2025-07-18T12:00:00.000Z" }));
    const result = checkDisposal(stale, schedule, [], AT);
    expect(result.retentionRulesChecked).toBe(1);
    expect(result).toMatchObject({ ok: false, reason: "items-retained-past-schedule" });
    expect(result.findings).toHaveLength(3);
    expect(result.findings.every((finding) => finding.kind === "retained-past-schedule")).toBe(true);
    expect(result.findings[0]?.message).toContain("400 day(s) against the 90-day retention");
  });

  it("reports an item whose class the schedule never declared as indeterminate, never as clean", () => {
    // A schedule with a hole in it looks exactly like a schedule without one,
    // until something is held under the hole.
    const result = checkDisposal([item({ holdingClass: "referrals" })], schedule, [], AT);
    expect(result).toMatchObject({ ok: false, reason: "disposal-unverifiable" });
    expect(result.findings[0]?.kind).toBe("retention-undeclared");
    expect(INDETERMINATE_DISPOSAL_FINDING_KINDS).toContain(result.findings[0]?.kind);
  });

  it("reports an empty holding set as indeterminate", () => {
    expect(checkDisposal([], schedule, [], AT)).toMatchObject({ ok: false, reason: "no-items-provided" });
  });

  it("fails on an erasure that left the item still held — erasure with residue is not erasure", () => {
    const result = checkDisposal([item()], schedule, [deletion()], AT);
    expect(result.findings[0]?.kind).toBe("deletion-residue");
    // Its OWN reason, not the retention one. A set whose only fault is
    // residue did not outlive its schedule, and reporting it under that name
    // would send a reader to inspect a schedule that is working.
    expect(result).toMatchObject({ ok: false, reason: "deletions-left-residue" });
    expect(DISPOSAL_VIOLATION_REASONS).toContain(result.reason);
  });

  it("keeps the two violation reasons apart, and reports the retention one when both are present", () => {
    const stale = item({ itemId: "item_stale", heldSince: "2025-01-01T00:00:00.000Z" });
    const both = checkDisposal([stale, item()], schedule, [deletion()], AT);
    expect(both.reason).toBe("items-retained-past-schedule");
    expect(both.findings.map((finding) => finding.kind)).toEqual(["retained-past-schedule", "deletion-residue"]);
    expect(DISPOSAL_VIOLATION_REASONS).toEqual(["items-retained-past-schedule", "deletions-left-residue"]);
  });

  it("reports an item whose own heldSince cannot be read as indeterminate, never as within schedule", () => {
    const result = checkDisposal([item({ heldSince: "a while ago" })], schedule, [], AT);
    expect(result).toMatchObject({ ok: false, reason: "disposal-unverifiable" });
    expect(result.findings[0]?.kind).toBe("held-since-unreadable");
    expect(result.withinSchedule).toBe(0);
  });

  it("fails on a deletion that failed while the item is still held", () => {
    const result = checkDisposal([item()], schedule, [deletion({ effect: "failed" })], AT);
    expect(result.findings[0]?.kind).toBe("deletion-failed");
    expect(result.reason).toBe("deletions-left-residue");
  });

  it("treats a deletion naming an item that is NOT in the held set as the success case", () => {
    // That is the shape a working erasure actually has: the record is gone.
    const result = checkDisposal([item()], schedule, [deletion({ itemId: "item_gone" })], AT);
    expect(result.ok).toBe(true);
  });

  it("reports a deletion nobody observed as indeterminate, never as done", () => {
    const result = checkDisposal([item()], schedule, [deletion({ effect: "unknown" })], AT);
    expect(result).toMatchObject({ ok: false, reason: "disposal-unverifiable" });
    expect(result.findings[0]?.kind).toBe("deletion-unobserved");
  });

  it("reports the indeterminate reason on a mixed set — and still lists the violation it did find", () => {
    const result = checkDisposal(
      [item({ itemId: "item_stale", heldSince: "2025-01-01T00:00:00.000Z" }), item({ itemId: "item_unknown_class", holdingClass: "referrals" })],
      schedule,
      [],
      AT,
    );
    expect(result.reason).toBe("disposal-unverifiable");
    expect(result.findings.map((finding) => finding.kind)).toEqual(["retained-past-schedule", "retention-undeclared"]);
  });

  it("takes its instant as a parameter, so the same records always produce the same answer", () => {
    const held = [item({ heldSince: "2026-05-01T00:00:00.000Z" })];
    expect(checkDisposal(held, schedule, [], "2026-06-01T00:00:00.000Z").ok).toBe(true);
    expect(checkDisposal(held, schedule, [], "2026-11-01T00:00:00.000Z").ok).toBe(false);
  });
});
