/**
 * The record schema, tested at the boundary it exists for: untyped JSON
 * arriving from a file the CLI reads or a host's own store.
 *
 * Two properties are load-bearing and are tested directly rather than
 * implied.
 *
 * FIRST: the states this package exists to FIND must be representable. A
 * holding that traces to nothing, and a belief that constrains behaviour with
 * no confirmation, are real records that really exist in real systems — that
 * is the point. A validator that refused them would turn every central
 * finding into "could not run", which is the one thing the exit contract
 * forbids.
 *
 * SECOND: a record whose shape this package cannot make sense of is a
 * validation failure, not a finding. An `inferred` item with no belief, or a
 * `saved` item carrying one, is not a holding this package understood well
 * enough to judge.
 */
import { describe, expect, it } from "vitest";
import {
  BELIEF_USE_MODES,
  DELETION_EFFECTS,
  DISCLOSURE_REACHES,
  HOLDING_ORIGINS,
  INDETERMINATE_PROVENANCE_KINDS,
  PROVENANCE_KINDS,
  isHeldItem,
  isSourceEvent,
  validateDeletionRecords,
  validateDisclosureRecords,
  validateHeldItem,
  validateHeldItems,
  validateRetentionRules,
  validateSourceEvent,
  validateSourceEvents,
} from "./schema.js";

const authored = {
  itemId: "item_1",
  subjectId: "sub_1",
  actorId: "actor_1",
  heldSince: "2026-01-01T00:00:00.000Z",
  holdingClass: "authored-notes",
  origin: "authored",
  provenance: { kind: "event", sourceEventId: "evt_1" },
  belief: null,
};

const belief = {
  itemId: "item_2",
  subjectId: "sub_1",
  actorId: "agent_1",
  heldSince: "2026-02-01T00:00:00.000Z",
  holdingClass: "inferred-preferences",
  origin: "inferred",
  provenance: { kind: "event", sourceEventId: "evt_2" },
  belief: {
    beliefClass: "scheduling-preference",
    inferredAt: "2026-02-01T00:00:00.000Z",
    use: { mode: "informs" },
  },
};

describe("closed vocabularies", () => {
  it("are the exact lists the gates and the CLI derive from", () => {
    expect(PROVENANCE_KINDS).toEqual(["event", "none", "indeterminate"]);
    expect(INDETERMINATE_PROVENANCE_KINDS).toEqual(["indeterminate"]);
    expect(HOLDING_ORIGINS).toEqual(["authored", "saved", "observed", "inferred"]);
    expect(BELIEF_USE_MODES).toEqual(["informs", "constrains"]);
    expect(DISCLOSURE_REACHES).toEqual(["visible", "hidden", "unknown"]);
    expect(DELETION_EFFECTS).toEqual(["erased", "failed", "unknown"]);
  });

  it("keep an explicit could-not-tell value in every judgement vocabulary", () => {
    // Removing one of these would not simplify the model: it would force a
    // real "I could not check" to be recorded as one of the answers this
    // package is supposed to distinguish it from.
    expect(PROVENANCE_KINDS).toContain("indeterminate");
    expect(DISCLOSURE_REACHES).toContain("unknown");
    expect(DELETION_EFFECTS).toContain("unknown");
  });
});

describe("validateHeldItem", () => {
  it("accepts a well-formed authored holding", () => {
    const result = validateHeldItem(authored);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.belief).toBeNull();
  });

  it("accepts a well-formed inferred belief", () => {
    const result = validateHeldItem(belief);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.belief?.beliefClass).toBe("scheduling-preference");
  });

  it("ADMITS a holding that traces to nothing, because that is the finding this package exists to report", () => {
    const result = validateHeldItem({ ...authored, provenance: { kind: "none", namedReason: "imported from a spreadsheet" } });
    expect(result.ok).toBe(true);
  });

  it("ADMITS a belief that constrains with no confirmation, for the same reason", () => {
    const result = validateHeldItem({
      ...belief,
      belief: { ...belief.belief, use: { mode: "constrains", confirmation: null } },
    });
    expect(result.ok).toBe(true);
  });

  it("ADMITS a provenance the store could not resolve, which is neither of those two", () => {
    const result = validateHeldItem({ ...authored, provenance: { kind: "indeterminate", namedReason: "the event ledger timed out" } });
    expect(result.ok).toBe(true);
  });

  it("requires a named reason on a provenance that is not an event", () => {
    // An absence that cannot say why is the shape this package is written
    // against, and it is refused at the boundary rather than reported later.
    for (const kind of ["none", "indeterminate"]) {
      expect(validateHeldItem({ ...authored, provenance: { kind } }).ok).toBe(false);
      expect(validateHeldItem({ ...authored, provenance: { kind, namedReason: "" } }).ok).toBe(false);
    }
  });

  it("requires the belief key to be written explicitly, even when it is null", () => {
    const { belief: _dropped, ...withoutBelief } = authored;
    const result = validateHeldItem(withoutBelief);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path.endsWith(".belief"))).toBe(true);
  });

  it("refuses an inferred item with no belief, and a non-inferred item carrying one", () => {
    expect(validateHeldItem({ ...belief, belief: null }).ok).toBe(false);
    expect(validateHeldItem({ ...authored, belief: belief.belief }).ok).toBe(false);
  });

  it("requires the confirmation key on a constraining belief, so the question cannot simply never come up", () => {
    const result = validateHeldItem({
      ...belief,
      belief: { ...belief.belief, use: { mode: "constrains" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.message.includes("write null explicitly"))).toBe(true);
  });

  it("accepts a constraining belief carrying a real confirmation", () => {
    const result = validateHeldItem({
      ...belief,
      belief: {
        ...belief.belief,
        use: { mode: "constrains", confirmation: { confirmedAt: "2026-03-01T00:00:00.000Z", sourceEventId: "evt_confirm" } },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("refuses an origin outside the closed list, and a belief mode outside its own", () => {
    expect(validateHeldItem({ ...authored, origin: "imported" }).ok).toBe(false);
    expect(validateHeldItem({ ...belief, belief: { ...belief.belief, use: { mode: "advises" } } }).ok).toBe(false);
  });

  it("refuses a missing id, an unparseable instant and a non-object", () => {
    expect(validateHeldItem({ ...authored, itemId: "" }).ok).toBe(false);
    expect(validateHeldItem({ ...authored, subjectId: 7 }).ok).toBe(false);
    expect(validateHeldItem({ ...authored, heldSince: "recently" }).ok).toBe(false);
    expect(validateHeldItem("item_1").ok).toBe(false);
  });

  it("reports every issue at an absolute path a reader can navigate to", () => {
    const result = validateHeldItems([authored, { ...authored, heldSince: 7 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("(root)[1].heldSince");
  });
});

describe("validateSourceEvent", () => {
  const event = { eventId: "evt_1", subjectId: "sub_1", actorId: "actor_1", occurredAt: "2026-01-01T00:00:00.000Z", kind: "note-written" };

  it("accepts a well-formed event and rejects one missing any required field", () => {
    expect(validateSourceEvent(event).ok).toBe(true);
    expect(validateSourceEvent({ ...event, kind: "" }).ok).toBe(false);
    expect(validateSourceEvent({ ...event, occurredAt: "yesterday" }).ok).toBe(false);
  });

  it("keeps the subject and the actor as separate required fields", () => {
    // The person acting and the person acted about are routinely different: a
    // colleague files a note, an agent infers from a session, an importer
    // loads a referral. Merging them would make that unrecoverable.
    const { actorId: _dropped, ...withoutActor } = event;
    expect(validateSourceEvent(withoutActor).ok).toBe(false);
  });

  it("validates arrays of events, empty included", () => {
    expect(validateSourceEvents([]).ok).toBe(true);
    expect(validateSourceEvents([event]).ok).toBe(true);
    expect(validateSourceEvents([event, {}]).ok).toBe(false);
  });
});

describe("validateDisclosureRecords", () => {
  const route = {
    itemId: "item_1",
    subjectId: "sub_1",
    surface: "account-data-page",
    reach: "visible",
    correctable: true,
    observedAt: "2026-08-01T00:00:00.000Z",
  };

  it("accepts every reach value including unknown", () => {
    for (const reach of DISCLOSURE_REACHES) {
      expect(validateDisclosureRecords([{ ...route, reach }]).ok).toBe(true);
    }
  });

  it("refuses an absent correctable rather than defaulting it", () => {
    const { correctable: _dropped, ...withoutCorrectable } = route;
    expect(validateDisclosureRecords([withoutCorrectable]).ok).toBe(false);
  });

  it("refuses a reach outside the closed list rather than reading it as visible", () => {
    expect(validateDisclosureRecords([{ ...route, reach: "shown" }]).ok).toBe(false);
  });
});

describe("validateRetentionRules", () => {
  it("accepts a whole-day period, including zero", () => {
    expect(validateRetentionRules([{ holdingClass: "session-notes", days: 90 }]).ok).toBe(true);
    expect(validateRetentionRules([{ holdingClass: "session-notes", days: 0 }]).ok).toBe(true);
  });

  it("refuses a fractional, negative or non-numeric period rather than rounding one", () => {
    expect(validateRetentionRules([{ holdingClass: "a", days: 1.5 }]).ok).toBe(false);
    expect(validateRetentionRules([{ holdingClass: "a", days: -1 }]).ok).toBe(false);
    expect(validateRetentionRules([{ holdingClass: "a", days: "90" }]).ok).toBe(false);
  });

  it("accepts an empty schedule — a consumer that declared nothing is a real, checkable state", () => {
    // It is not a clean one: every item's class is then undeclared, which the
    // disposal gate reports as unverifiable.
    expect(validateRetentionRules([]).ok).toBe(true);
  });
});

describe("validateDeletionRecords", () => {
  const deletion = { itemId: "item_1", subjectId: "sub_1", actorId: "actor_1", deletedAt: "2026-08-01T00:00:00.000Z", effect: "erased" };

  it("accepts every effect, including the one nobody observed", () => {
    for (const effect of DELETION_EFFECTS) {
      expect(validateDeletionRecords([{ ...deletion, effect }]).ok).toBe(true);
    }
  });

  it("refuses an effect outside the closed list rather than reading it as erased", () => {
    expect(validateDeletionRecords([{ ...deletion, effect: "deleted" }]).ok).toBe(false);
  });
});

describe("the boolean guards", () => {
  it("agree with the validators they wrap", () => {
    expect(isHeldItem(authored)).toBe(true);
    expect(isHeldItem({ ...authored, origin: "imported" })).toBe(false);
    expect(isSourceEvent({ eventId: "e", subjectId: "s", actorId: "a", occurredAt: "2026-01-01T00:00:00.000Z", kind: "k" })).toBe(true);
    expect(isSourceEvent({})).toBe(false);
  });
});
