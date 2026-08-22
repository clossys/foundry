/**
 * The runtime contract: decide one holding, and the three gates that read a
 * whole set of them back.
 *
 * THE LOOP THIS CLOSES
 * ---------------------
 * The consumer's declared retention schedule and attribution rules are the
 * setpoint. Holding is the act. SHOWING THE PERSON WHAT IS HELD is the
 * observation. Their correction or deletion is the comparison and the
 * correction. Without the showing step there is no observation and no
 * comparison — what is left is a store, not a loop, and the showing step is
 * the one products skip. `checkVisibility` exists because that step is the
 * one nothing else in a codebase ever fails on.
 *
 * TWO TERNARIES, AND THEY ARE NOT THE SAME TERNARY
 * -------------------------------------------------
 * `Holding` is the runtime verdict — `held`, `forgotten`, `unjustifiable`.
 * The gate results are judgements — satisfied, violated, or INDETERMINATE.
 * They are different ternaries on purpose, and conflating them is the
 * mistake this file is written to avoid.
 *
 * A gate must be able to say "I could not check", and must never round that
 * to satisfied: `checkAttribution`, `checkVisibility` and `checkDisposal`
 * each have a per-record indeterminate route as well as an empty-set one,
 * and `cli.ts` maps both to `2`. That is the opposite of a sibling role
 * whose delivery outcomes deliberately have no indeterminate variant,
 * because a send either happened or it did not — a judgement is not a send,
 * and eliminating "I could not tell" from a judgement is how a gate reports
 * a clean bill for work it never did.
 *
 * The VERDICT has no indeterminate variant, and that is not the same
 * elimination. It fails CLOSED: a holding whose source could not be verified
 * is `unjustifiable`, not `held`. The metric this role is measured by —
 * unjustifiable holdings — is anything held about a person that traces to
 * nothing they did OR that they have no way to see and correct, and
 * something we cannot show traces to an act of theirs is squarely the first.
 * Every route out of indeterminacy in this file goes toward the adverse
 * answer, never toward the satisfied one.
 *
 * WHAT CANNOT BE WRITTEN HERE
 * ----------------------------
 * `HoldingBasis` is the reason for keeping something, and EVERY variant of
 * it carries a `sourceEventId`. There is no basis meaning "we could not
 * tell", "legacy", or "it was already there" — so a reason to keep something
 * that does not name a thing the person did is unconstructable rather than
 * merely discouraged. `justification.check.ts` proves that at compile time,
 * along with the boundary rule below.
 *
 * Everything here is pure. No I/O, no clock read, no ambient state:
 * `decideHolding` and every gate take their instant as a parameter rather
 * than calling `Date.now()`, so the same inputs always produce the same
 * output and a run is replayable. Nothing in this file writes anything, and
 * nothing in this file can — the store is a host-supplied port (see
 * `schema.ts`), because git cannot delete and this role must.
 */

import type {
  DeletionRecord,
  DisclosureRecord,
  HeldItem,
  InferredBelief,
  RetentionRule,
  SourceEvent,
} from "./schema.js";
import type { GiverRetainedGroundsDocument } from "./giver-record.js";

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Days between two instants, or `undefined` when either cannot be read.
 *
 * `undefined`, never `NaN`. Every comparison in this file is a
 * strictly-greater test, and `NaN > n` is `false` — so an unreadable timestamp
 * flowing through arithmetic would read as "inside its schedule" and count
 * toward the satisfied answer. That is a route out of indeterminacy toward
 * `ok`, which is the one direction this package does not allow.
 *
 * `validateHeldItem` guarantees a parseable `heldSince` at the JSON boundary,
 * but these checkers are exported and take any `HeldItem` a host constructs
 * directly. The guarantee therefore has to live here too, in the arithmetic
 * itself, rather than in a validator a caller can legitimately skip.
 */
function elapsedDays(from: string, to: string): number | undefined {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return undefined;
  return (toMs - fromMs) / MILLISECONDS_PER_DAY;
}

/** `true` when `later` is strictly after `earlier`, or `undefined` when either cannot be read. Same rule as `elapsedDays`. */
function isAfter(later: string, earlier: string): boolean | undefined {
  const laterMs = Date.parse(later);
  const earlierMs = Date.parse(earlier);
  if (Number.isNaN(laterMs) || Number.isNaN(earlierMs)) return undefined;
  return laterMs > earlierMs;
}

// ---------------------------------------------------------- the runtime verdict

/**
 * Why this is still held. Six variants, and EVERY ONE OF THEM names a source
 * event — the thing the person did that this holding traces back to.
 *
 * There is deliberately no variant meaning "indeterminate", "legacy",
 * "imported", or "default", which is what makes "held for no reason at all"
 * unconstructable rather than merely forbidden in prose. Widening this union
 * is a deliberate act that has to come through `justification.check.ts`.
 */
export type HoldingBasis =
  /** They wrote it. */
  | { kind: "authored"; sourceEventId: string }
  /** They kept it. */
  | { kind: "saved"; sourceEventId: string }
  /** The accumulated relationship — history, how something went, a referral — recorded about an act of theirs. */
  | { kind: "observed"; sourceEventId: string }
  /** A belief we formed, held as an understanding only. It may inform; it may not constrain. */
  | { kind: "belief-informs"; sourceEventId: string; beliefClass: string }
  /**
   * A belief we formed, put to the person, and confirmed by them — at which
   * point it stopped being an understanding and became an instruction. It
   * carries the confirmation instant, because the boundary was crossed on a
   * date and that date is the evidence.
   */
  | { kind: "belief-confirmed-as-instruction"; sourceEventId: string; beliefClass: string; confirmedAt: string }
  /** A closed account whose holder named a successor for this class of material. Succession is a thing the person did. */
  | { kind: "succession"; sourceEventId: string; successorSubjectId: string };

/**
 * Why this should no longer be held. Every variant is a positive, dated
 * reason to let go — never the absence of a reason to keep.
 */
export type ForgettingGrounds =
  | { kind: "erasure-requested"; requestedAt: string; sourceEventId: string }
  | { kind: "account-closed"; closedAt: string }
  | { kind: "retention-elapsed"; declaredDays: number; heldDays: number };

/**
 * Why this holding cannot be justified. Two families, and they are the two
 * halves of the metric.
 *
 * TRACES TO NOTHING THEY DID: `no-source-event`,
 * `inferred-belief-without-source-event`, `source-event-names-another-subject`,
 * `source-unverifiable`, and `belief-used-as-constraint` — the boundary rule
 * at runtime, where an understanding started constraining behaviour without
 * ever being put to the person, and therefore rests on no instruction of
 * theirs.
 *
 * NO WAY TO SEE AND CORRECT IT: `unreachable`, `not-correctable`,
 * `reach-unverifiable`.
 *
 * Plus `retention-undeclared`: material held under no declared schedule at
 * all. It is unjustifiable rather than indeterminate because there is
 * nothing to find out — the consumer never said how long, and "forever, by
 * omission" is not a commitment anyone made to the person.
 *
 * Every variant that arises from something this package could not establish
 * carries a `namedReason`. An absence that cannot say why is the shape this
 * package is written against.
 */
export type UnjustifiableFault =
  | { kind: "no-source-event"; namedReason: string }
  | { kind: "inferred-belief-without-source-event"; beliefClass: string; namedReason: string }
  | { kind: "source-event-names-another-subject"; sourceEventId: string; eventSubjectId: string }
  | { kind: "source-unverifiable"; namedReason: string }
  | { kind: "belief-used-as-constraint"; beliefClass: string }
  | { kind: "retention-undeclared"; namedReason: string }
  | { kind: "unreachable"; namedReason: string }
  | { kind: "not-correctable"; surface: string }
  | { kind: "reach-unverifiable"; namedReason: string }
  | { kind: "held-since-unreadable"; heldSince: string };

/** The verdict. Three outcomes, never a boolean. */
export type Holding =
  | { kind: "held"; basis: HoldingBasis }
  | { kind: "forgotten"; grounds: ForgettingGrounds }
  | { kind: "unjustifiable"; fault: UnjustifiableFault };

/** Every verdict kind, for a caller rendering or persisting one. */
export const HOLDING_KINDS = ["held", "forgotten", "unjustifiable"] as const;

// ------------------------------------------------------------- the collaborators

/**
 * What the consumer declared about this item's class, or an explicit
 * statement that it declared nothing. Never optional and never defaulted:
 * this package ships no retention period, so there is nothing for it to fall
 * back to.
 */
export type RetentionRead =
  | { status: "declared"; days: number }
  | { status: "undeclared"; namedReason: string };

/**
 * Whether the person can actually reach and correct this item.
 *
 * Four variants, and `"read-only"` is separate from `"reachable"` on
 * purpose: being shown something you cannot change is not the metric. It is
 * also separate from `"unreachable"`, because the fix is different — one
 * needs a surface, the other needs an edit path on a surface that already
 * exists.
 */
export type ReachRead =
  | { status: "reachable"; surface: string }
  | { status: "read-only"; surface: string }
  | { status: "unreachable"; namedReason: string }
  | { status: "unknown"; namedReason: string };

/**
 * Whether the source event behind this item is actually on record.
 *
 * `"missing"` and `"unknown"` are distinct all the way to the verdict: a
 * holding whose event we know is absent and one whose event we could not
 * look up are both unjustifiable, but they are different faults with
 * different fixes, and collapsing them would hide which one a consumer has.
 */
export type SourceRead =
  | { status: "retained"; event: SourceEvent }
  | { status: "missing"; namedReason: string }
  | { status: "unknown"; namedReason: string };

/**
 * A successor the subject themselves named, and the classes of material they
 * named them for.
 *
 * Succession is opt-in per class, not a blanket inheritance, and it carries
 * the event in which the subject named them. An estate that "obviously"
 * should get everything is an assumption, and this package has no way to
 * write one down.
 */
export interface SuccessionClaim {
  /** Opaque host-owned reference to the successor. Never a name, an email, or a relationship label. */
  successorSubjectId: string;
  /** The event in which the subject named them. */
  sourceEventId: string;
  /** Consumer-declared classes the successor may inherit. This package declares none. */
  classes: readonly string[];
}

/**
 * What the person has said about their holdings as a whole.
 *
 * `succession` on a closed account is REQUIRED and explicitly nullable: a
 * consumer closing an account has to write down whether anyone inherits,
 * rather than leaving a field off and letting a default decide what happens
 * to someone's material after they are gone.
 */
export type DispositionRead =
  | { status: "standing" }
  | { status: "erasure-requested"; requestedAt: string; sourceEventId: string }
  | { status: "account-closed"; closedAt: string; succession: SuccessionClaim | null };

/**
 * Everything `decideHolding` needs, all of it required.
 *
 * There is no optional field here and no default for any of them. A caller
 * that cannot say what the declared retention is, or whether the person can
 * reach the item, or whether the source event is on record, does not get a
 * guess — it gets a type error, or it writes the explicit "I could not tell"
 * variant and gets `unjustifiable`. `justification.check.ts` asserts the
 * zero-optional-keys property at compile time so it survives a future edit
 * that adds a `?`.
 */
export interface HoldingInputs {
  /** The item being judged. Carries its own subject, origin, provenance and belief. */
  item: HeldItem;
  /** Whoever or whatever is asking. Separate from the item's subject, always. */
  actorId: string;
  /** The instant this is judged at. Supplied, never read from the clock. */
  at: string;
  retention: RetentionRead;
  reach: ReachRead;
  source: SourceRead;
  disposition: DispositionRead;
}

function beliefBasis(belief: InferredBelief, sourceEventId: string): HoldingBasis | UnjustifiableFault {
  if (belief.use.mode === "informs") {
    return { kind: "belief-informs", sourceEventId, beliefClass: belief.beliefClass };
  }
  if (belief.use.confirmation === null) {
    // THE BOUNDARY RULE, at runtime. An understanding started constraining
    // behaviour without ever being put to the person. It is now an
    // instruction, and an instruction nobody gave is a holding that traces to
    // nothing they did.
    return { kind: "belief-used-as-constraint", beliefClass: belief.beliefClass };
  }
  return {
    kind: "belief-confirmed-as-instruction",
    sourceEventId,
    beliefClass: belief.beliefClass,
    confirmedAt: belief.use.confirmation.confirmedAt,
  };
}

function isFault(value: HoldingBasis | UnjustifiableFault): value is UnjustifiableFault {
  return value.kind === "belief-used-as-constraint";
}

/**
 * The one decision. It answers, for one item at one instant: is this still
 * held, should it be gone, or was it never ours to have?
 *
 * The order below is the rule, and it is the rule everywhere in this
 * package:
 *
 *   1. THE PERSON'S OWN INSTRUCTION WINS. An erasure they asked for makes
 *      the item `forgotten` regardless of anything else — including a
 *      perfectly good basis for having held it. Nothing here weighs our
 *      reason to keep against their request to be forgotten.
 *   2. A CLOSED ACCOUNT FORGETS, UNLESS THEY NAMED A SUCCESSOR FOR THIS
 *      CLASS. Succession is opt-in per class and carries the event in which
 *      they named it. An account closed with no succession is `forgotten`;
 *      one whose successor covers this class continues to step 3 with the
 *      succession recorded as the basis — including for an inferred belief,
 *      whose own basis it replaces, because on a closed account the fact a
 *      reader needs is who inherited it. Step 5 still runs first, so a
 *      constraint the person never agreed to is not laundered by being
 *      inherited.
 *   3. DECLARED RETENTION RUNS OUT. Past the days the consumer's own
 *      schedule declared for this class, the item is `forgotten`. Note this
 *      sits ABOVE justification: an item that is both past its schedule and
 *      unjustifiable is `forgotten`, because forgetting resolves it and
 *      reporting it as a holding to justify would ask the wrong question.
 *      Material held under NO declared schedule is `unjustifiable`, not
 *      indeterminate — "forever, by omission" is not a commitment anyone
 *      made to the person.
 *   4. IT MUST TRACE TO SOMETHING THEY DID. No source event, an event that
 *      belongs to somebody else, or an event we could not look up: all
 *      `unjustifiable`, each with its own named fault. An inferred belief
 *      with no source event gets its own fault kind, because it is the one
 *      holding a person is least likely to know exists.
 *   5. A BELIEF MAY NOT CONSTRAIN UNCONFIRMED. See `beliefBasis` above.
 *   6. THEY MUST BE ABLE TO SEE IT AND CORRECT IT. Unreachable, read-only,
 *      or a reach nobody could establish: all `unjustifiable`. Read-only is
 *      its own fault — a surface that shows a person a belief about them
 *      they cannot change is worse than one that shows nothing, because it
 *      looks like transparency.
 *   7. Otherwise it is `held`, on a basis that names the source event.
 */
export function decideHolding(inputs: HoldingInputs): Holding {
  const { item, at, retention, reach, source, disposition } = inputs;

  if (disposition.status === "erasure-requested") {
    return {
      kind: "forgotten",
      grounds: { kind: "erasure-requested", requestedAt: disposition.requestedAt, sourceEventId: disposition.sourceEventId },
    };
  }

  let succession: SuccessionClaim | null = null;
  if (disposition.status === "account-closed") {
    const claim = disposition.succession;
    if (claim === null || !claim.classes.includes(item.holdingClass)) {
      return { kind: "forgotten", grounds: { kind: "account-closed", closedAt: disposition.closedAt } };
    }
    succession = claim;
  }

  if (retention.status === "declared") {
    const heldDays = elapsedDays(item.heldSince, at);
    if (heldDays === undefined) {
      // Neither held nor forgotten: nothing could be compared, and the
      // adverse answer is the only one available to a verdict with no
      // indeterminate variant.
      return { kind: "unjustifiable", fault: { kind: "held-since-unreadable", heldSince: item.heldSince } };
    }
    if (heldDays > retention.days) {
      return { kind: "forgotten", grounds: { kind: "retention-elapsed", declaredDays: retention.days, heldDays } };
    }
  } else {
    return { kind: "unjustifiable", fault: { kind: "retention-undeclared", namedReason: retention.namedReason } };
  }

  if (source.status === "missing") {
    if (item.origin === "inferred" && item.belief !== null) {
      return {
        kind: "unjustifiable",
        fault: { kind: "inferred-belief-without-source-event", beliefClass: item.belief.beliefClass, namedReason: source.namedReason },
      };
    }
    return { kind: "unjustifiable", fault: { kind: "no-source-event", namedReason: source.namedReason } };
  }
  if (source.status === "unknown") {
    return { kind: "unjustifiable", fault: { kind: "source-unverifiable", namedReason: source.namedReason } };
  }
  if (source.event.subjectId !== item.subjectId) {
    return {
      kind: "unjustifiable",
      fault: { kind: "source-event-names-another-subject", sourceEventId: source.event.eventId, eventSubjectId: source.event.subjectId },
    };
  }

  const sourceEventId = source.event.eventId;

  // The boundary rule is judged BEFORE any basis is chosen, and independently
  // of succession: a belief that constrains behaviour unconfirmed is
  // unjustifiable whether or not somebody inherited it. Inheriting a
  // constraint the person never agreed to would launder it.
  let beliefHeld: HoldingBasis | undefined;
  if (item.origin === "inferred" && item.belief !== null) {
    const decided = beliefBasis(item.belief, sourceEventId);
    if (isFault(decided)) return { kind: "unjustifiable", fault: decided };
    beliefHeld = decided;
  }

  // Succession then wins the BASIS, including over a belief that passed the
  // rule above. On a closed account, why this is still here is the successor
  // the person named — and `successorSubjectId` is the only place that fact
  // survives. Letting the belief basis win instead would leave a verdict that
  // cannot say the material is held for somebody else.
  let basis: HoldingBasis;
  if (succession !== null) {
    basis = { kind: "succession", sourceEventId: succession.sourceEventId, successorSubjectId: succession.successorSubjectId };
  } else if (beliefHeld !== undefined) {
    basis = beliefHeld;
  } else if (item.origin === "authored") {
    basis = { kind: "authored", sourceEventId };
  } else if (item.origin === "saved") {
    basis = { kind: "saved", sourceEventId };
  } else {
    basis = { kind: "observed", sourceEventId };
  }

  if (reach.status === "unreachable") return { kind: "unjustifiable", fault: { kind: "unreachable", namedReason: reach.namedReason } };
  if (reach.status === "read-only") return { kind: "unjustifiable", fault: { kind: "not-correctable", surface: reach.surface } };
  if (reach.status === "unknown") return { kind: "unjustifiable", fault: { kind: "reach-unverifiable", namedReason: reach.namedReason } };

  return { kind: "held", basis };
}

// ------------------------------------------------------- gate 1: attribution

export type AttributionFindingKind =
  /** Held, tracing to nothing the person did. */
  | "held-without-source-event"
  /** An inferred belief tracing to nothing the person did. THE central finding. */
  | "inferred-belief-without-source-event"
  /** The named source event is not in the set the consumer says it retains. A citation nobody can follow. */
  | "source-event-not-retained"
  /** The named source event belongs to a different person. It traces to something SOMEBODY did, just not them. */
  | "source-event-names-another-subject"
  /** The named source event happened after we started holding the item. We had it before they did the thing. */
  | "source-event-postdates-holding"
  /** THE BOUNDARY RULE. A belief constrains behaviour and the person was never asked. */
  | "belief-constrains-without-confirmation"
  /** A belief's confirmation names an event the consumer no longer retains. A confirmation nobody can produce. */
  | "belief-confirmation-not-retained"
  /** The store could not say where this came from. Indeterminate, never a pass. */
  | "source-unverifiable"
  /** An instant on the item or its source event could not be read, so the two could not be ordered. Indeterminate, never a pass. */
  | "instant-unreadable";

export interface AttributionFinding {
  kind: AttributionFindingKind;
  itemId: string;
  /** The person the item is about, where the item is known. */
  subjectId?: string;
  message: string;
}

/** The one indeterminate finding kind. Kept as a list so the CLI derives its exit code rather than restating the rule. */
export const INDETERMINATE_ATTRIBUTION_FINDING_KINDS: readonly AttributionFindingKind[] = ["source-unverifiable", "instant-unreadable"];

export type AttributionFailureReason = "holdings-unattributed" | "attribution-unverifiable" | "no-items-provided";

export interface AttributionResult {
  ok: boolean;
  reason?: AttributionFailureReason;
  itemsChecked: number;
  sourceEventsChecked: number;
  attributed: number;
  /** How many of the checked items were inferred beliefs. Reported so a run can say what proportion of a holding set nobody was ever told about. */
  beliefsChecked: number;
  findings: AttributionFinding[];
}

/**
 * GATE 1 — every held item names the source event it came from, and every
 * inferred belief carries the behaviour it was inferred from.
 *
 * Pure, no I/O. It JOINS each item's provenance to the source events the
 * consumer says it retains, rather than trusting that an id is present: a
 * reference to an event that has since been dropped reads exactly like a
 * good one right up until somebody asks "why do you think that about me".
 *
 * THE CENTRAL FINDING is an inferred belief with no source event. It gets
 * its own finding kind rather than being folded into
 * `held-without-source-event` because it is the holding a person is least
 * likely to know exists, least able to guess at, and most likely to be
 * wrong about — and because a report that says "3 unattributed items" hides
 * whether any of them were things nobody ever told the person we believed.
 *
 * THE BOUNDARY RULE is checked here too, and it belongs here rather than in
 * a gate of its own. An instruction constrains us; an understanding only
 * informs us. A belief that has started constraining behaviour is an
 * instruction, and an instruction the person never gave traces to nothing
 * they did — which is precisely what this gate measures. The fix is not to
 * delete the belief: it is to confirm it with the person, at which point it
 * becomes theirs and belongs to the role that owns standing instructions.
 *
 * `ok: false` with `"attribution-unverifiable"` is indeterminate, not a
 * violation, and `cli.ts` maps it to `2`. `"no-items-provided"` likewise: an
 * empty holding set is not a clean run, it is a run that examined nothing.
 */
export function checkAttribution(items: readonly HeldItem[], events: readonly SourceEvent[]): AttributionResult {
  const base = { itemsChecked: items.length, sourceEventsChecked: events.length };
  if (items.length === 0) {
    return { ok: false, reason: "no-items-provided", ...base, attributed: 0, beliefsChecked: 0, findings: [] };
  }

  const byEventId = new Map<string, SourceEvent>();
  for (const event of events) byEventId.set(event.eventId, event);

  const findings: AttributionFinding[] = [];
  let attributed = 0;
  let beliefsChecked = 0;

  for (const item of items) {
    const where = { itemId: item.itemId, subjectId: item.subjectId };
    const belief = item.belief;
    if (belief !== null) beliefsChecked += 1;

    // The boundary rule is judged independently of provenance: a belief that
    // constrains without confirmation is a finding even when its own source
    // event is impeccable. Knowing where an inference came from is not
    // permission to act on it.
    if (belief !== null && belief.use.mode === "constrains") {
      if (belief.use.confirmation === null) {
        findings.push({
          ...where,
          kind: "belief-constrains-without-confirmation",
          message: `a belief of class "${belief.beliefClass}" constrains behaviour and the person was never asked to confirm it; an understanding only informs, an instruction constrains`,
        });
      } else if (!byEventId.has(belief.use.confirmation.sourceEventId)) {
        findings.push({
          ...where,
          kind: "belief-confirmation-not-retained",
          message: `a belief of class "${belief.beliefClass}" claims a confirmation at ${belief.use.confirmation.confirmedAt} naming an event that is not in the retained set`,
        });
      }
    }

    if (item.provenance.kind === "indeterminate") {
      findings.push({
        ...where,
        kind: "source-unverifiable",
        message: `the store could not say where this came from (${item.provenance.namedReason})`,
      });
      continue;
    }

    if (item.provenance.kind === "none") {
      if (belief !== null) {
        findings.push({
          ...where,
          kind: "inferred-belief-without-source-event",
          message: `a belief of class "${belief.beliefClass}" was inferred at ${belief.inferredAt} and names no source event (${item.provenance.namedReason})`,
        });
      } else {
        findings.push({
          ...where,
          kind: "held-without-source-event",
          message: `held since ${item.heldSince} and names no source event (${item.provenance.namedReason})`,
        });
      }
      continue;
    }

    const event = byEventId.get(item.provenance.sourceEventId);
    if (event === undefined) {
      findings.push({
        ...where,
        kind: "source-event-not-retained",
        message: `names source event ${item.provenance.sourceEventId}, which is not in the retained set`,
      });
      continue;
    }
    if (event.subjectId !== item.subjectId) {
      findings.push({
        ...where,
        kind: "source-event-names-another-subject",
        message: `names source event ${event.eventId}, which belongs to a different subject`,
      });
      continue;
    }
    const postdates = isAfter(event.occurredAt, item.heldSince);
    if (postdates === undefined) {
      findings.push({
        ...where,
        kind: "instant-unreadable",
        message: `held since "${item.heldSince}" and its source event occurred at "${event.occurredAt}"; the two could not be ordered`,
      });
      continue;
    }
    if (postdates) {
      findings.push({
        ...where,
        kind: "source-event-postdates-holding",
        message: `held since ${item.heldSince}, but the source event it names occurred at ${event.occurredAt}`,
      });
      continue;
    }
    attributed += 1;
  }

  const indeterminate = findings.some((finding) => INDETERMINATE_ATTRIBUTION_FINDING_KINDS.includes(finding.kind));
  if (indeterminate) return { ok: false, reason: "attribution-unverifiable", ...base, attributed, beliefsChecked, findings };
  if (findings.length > 0) return { ok: false, reason: "holdings-unattributed", ...base, attributed, beliefsChecked, findings };
  return { ok: true, ...base, attributed, beliefsChecked, findings: [] };
}

// -------------------------------------------------------- gate 2: visibility

export type VisibilityFindingKind =
  /** Held, with no disclosure route at all. Nobody can see it, including the person it is about. */
  | "item-not-disclosed"
  /** A route exists and the item is hidden on it. */
  | "item-hidden"
  /** The only route belongs to a different person. Visible, to somebody else. */
  | "disclosed-to-another-subject"
  /** Reachable, and they cannot change it. Transparency that ends at reading is not correction. */
  | "visible-but-not-correctable"
  /** A route names an item that is not in the set being checked. */
  | "disclosure-without-item"
  /** Nobody could establish whether the item is reachable. Indeterminate, never a pass. */
  | "reach-unverifiable"
  /** A retained grounds record in giver's register has no route by which the person it concerns can reach and correct it. */
  | "retained-ground-unreachable"
  /** A retained grounds record's route could not establish its reach. Indeterminate, never a pass. */
  | "retained-ground-reach-unverifiable";

export interface VisibilityFinding {
  kind: VisibilityFindingKind;
  itemId: string;
  /** The person the item is about, where the item is known. */
  subjectId?: string;
  message: string;
}

/** The one indeterminate finding kind. Kept as a list so the CLI derives its exit code rather than restating the rule. */
export const INDETERMINATE_VISIBILITY_FINDING_KINDS: readonly VisibilityFindingKind[] = ["reach-unverifiable", "retained-ground-reach-unverifiable"];

export type VisibilityFailureReason = "holdings-unreachable" | "visibility-unverifiable" | "no-items-provided";

export interface VisibilityResult {
  ok: boolean;
  reason?: VisibilityFailureReason;
  itemsChecked: number;
  /** Retained decision grounds checked from giver's declared JSON document. */
  groundsChecked: number;
  disclosuresChecked: number;
  /** Reachable by the person it is about, and correctable by them. Both, or it does not count. */
  reachable: number;
  findings: VisibilityFinding[];
}

/**
 * GATE 2 — every held item, and every retained decision ground in giver's
 * declared JSON document, is reachable by the person it is about and
 * correctable by them.
 *
 * Pure, no I/O. This is the observation step of the loop, and it is the step
 * a store never fails on by itself: nothing errors when material is held and
 * never shown. There is no exception, no alert and no broken build. The
 * person simply never finds out, and nobody who works on the system finds
 * out either.
 *
 * The join is on the SUBJECT, not just the item. A disclosure route for an
 * item, pointing at a different person, is reported as
 * `disclosed-to-another-subject` rather than counted as visibility — because
 * "somebody can see this" was never the question.
 *
 * `correctable` is checked separately from `reach` because reading is not
 * correcting. A surface that shows a person a belief about them they cannot
 * change looks like transparency and is not: the metric names seeing AND
 * correcting, and this gate fails on a route that offers only the first.
 *
 * `ok: false` with `"visibility-unverifiable"` is indeterminate — a route
 * whose reach nobody could establish is a route nobody checked — and
 * `cli.ts` maps it to `2`, as it does `"no-items-provided"`.
 */
export function checkVisibility(
  items: readonly HeldItem[],
  disclosures: readonly DisclosureRecord[],
  giverGrounds: GiverRetainedGroundsDocument,
): VisibilityResult {
  const base = { itemsChecked: items.length, groundsChecked: giverGrounds.grounds.length, disclosuresChecked: disclosures.length };
  if (items.length === 0 && giverGrounds.grounds.length === 0) {
    return { ok: false, reason: "no-items-provided", ...base, reachable: 0, findings: [] };
  }

  const byItemId = new Map<string, DisclosureRecord[]>();
  for (const disclosure of disclosures) {
    const existing = byItemId.get(disclosure.itemId);
    if (existing === undefined) byItemId.set(disclosure.itemId, [disclosure]);
    else existing.push(disclosure);
  }
  const knownItemIds = new Set([...items.map((item) => item.itemId), ...giverGrounds.grounds.map((ground) => ground.groundId)]);

  const findings: VisibilityFinding[] = [];
  let reachable = 0;

  for (const item of items) {
    const where = { itemId: item.itemId, subjectId: item.subjectId };
    const routes = byItemId.get(item.itemId) ?? [];
    if (routes.length === 0) {
      findings.push({
        ...where,
        kind: "item-not-disclosed",
        message: `held since ${item.heldSince} with no disclosure route at all: the person it is about has no way to see it`,
      });
      continue;
    }

    const own = routes.filter((route) => route.subjectId === item.subjectId);
    if (own.length === 0) {
      findings.push({
        ...where,
        kind: "disclosed-to-another-subject",
        message: `${routes.length} disclosure route(s) exist for this item and none of them belong to the person it is about`,
      });
      continue;
    }

    if (own.some((route) => route.reach === "visible" && route.correctable)) {
      reachable += 1;
      continue;
    }
    if (own.some((route) => route.reach === "visible")) {
      const surface = own.find((route) => route.reach === "visible")?.surface ?? "(unnamed surface)";
      findings.push({
        ...where,
        kind: "visible-but-not-correctable",
        message: `reachable on "${surface}" and not correctable there: reading is not correcting`,
      });
      continue;
    }
    if (own.some((route) => route.reach === "unknown")) {
      findings.push({
        ...where,
        kind: "reach-unverifiable",
        message: "no route reports this item as visible and at least one could not say either way",
      });
      continue;
    }
    findings.push({
      ...where,
      kind: "item-hidden",
      message: `${own.length} route(s) exist for the person it is about and every one of them reports it hidden`,
    });
  }

  // Grounds are not keeper holdings: their register remains in giver. They
  // are nevertheless person-facing material, so visibility joins the
  // declared JSON document to the same disclosure routes. Their findings are
  // deliberately distinct from ordinary holdings so a reader knows which
  // register needs a disclosure route.
  for (const ground of giverGrounds.grounds) {
    const where = { itemId: ground.groundId, subjectId: ground.subjectId };
    const routes = byItemId.get(ground.groundId) ?? [];
    if (routes.length === 0) {
      findings.push({
        ...where,
        kind: "retained-ground-unreachable",
        message: `retained since ${ground.retainedAt} with no disclosure route at all: the person it explains a decision about has no way to see it`,
      });
      continue;
    }

    const own = routes.filter((route) => route.subjectId === ground.subjectId);
    if (own.length === 0) {
      findings.push({
        ...where,
        kind: "retained-ground-unreachable",
        message: `${routes.length} disclosure route(s) exist for this retained ground and none belong to the person it explains a decision about`,
      });
      continue;
    }
    if (own.some((route) => route.reach === "visible" && route.correctable)) {
      reachable += 1;
      continue;
    }
    if (own.some((route) => route.reach === "visible")) {
      const surface = own.find((route) => route.reach === "visible")?.surface ?? "(unnamed surface)";
      findings.push({
        ...where,
        kind: "retained-ground-unreachable",
        message: `reachable on "${surface}" and not correctable there: reading decision grounds is not contesting them`,
      });
      continue;
    }
    if (own.some((route) => route.reach === "unknown")) {
      findings.push({
        ...where,
        kind: "retained-ground-reach-unverifiable",
        message: "no route reports this retained ground as visible and at least one could not say either way",
      });
      continue;
    }
    findings.push({
      ...where,
      kind: "retained-ground-unreachable",
      message: `${own.length} route(s) exist for the person this retained ground explains a decision about and every one reports it hidden`,
    });
  }

  for (const disclosure of disclosures) {
    if (knownItemIds.has(disclosure.itemId)) continue;
    findings.push({
      kind: "disclosure-without-item",
      itemId: disclosure.itemId,
      message: "a disclosure route names an item that is not in the set being checked",
    });
  }

  const indeterminate = findings.some((finding) => INDETERMINATE_VISIBILITY_FINDING_KINDS.includes(finding.kind));
  if (indeterminate) return { ok: false, reason: "visibility-unverifiable", ...base, reachable, findings };
  if (findings.length > 0) return { ok: false, reason: "holdings-unreachable", ...base, reachable, findings };
  return { ok: true, ...base, reachable, findings: [] };
}

// ---------------------------------------------------------- gate 3: disposal

export type DisposalFindingKind =
  /** THE adversarial case: still held, past the days its own class declared. */
  | "retained-past-schedule"
  /** A deletion recorded as erased, and the item is still in the held set. Erasure with residue is not erasure. */
  | "deletion-residue"
  /** A deletion that failed, and the item is still held. A delete call that returned is not a record that is gone. */
  | "deletion-failed"
  /** The item's class appears nowhere in the declared schedule. Indeterminate, never a pass. */
  | "retention-undeclared"
  /** A deletion nobody observed the effect of, and the item is still held. Indeterminate, never a pass. */
  | "deletion-unobserved"
  /** The item's own `heldSince` could not be read, so its age could not be compared. Indeterminate, never a pass. */
  | "held-since-unreadable";

export interface DisposalFinding {
  kind: DisposalFindingKind;
  itemId: string;
  /** The person the item is about, where the item is known. */
  subjectId?: string;
  message: string;
}

/** The two indeterminate finding kinds. Kept as a list so the CLI derives its exit code rather than restating the rule. */
export const INDETERMINATE_DISPOSAL_FINDING_KINDS: readonly DisposalFindingKind[] = [
  "retention-undeclared",
  "deletion-unobserved",
  "held-since-unreadable",
];

/**
 * The two violation reasons, kept apart deliberately.
 *
 * A set whose only fault is erasure residue is not a set that outlived its
 * retention, and reporting it under that reason names the wrong defect to
 * whoever reads the output — sending them to inspect a schedule that is
 * working. `cli.ts` derives its exit code from this list rather than restating
 * either name.
 */
export const DISPOSAL_VIOLATION_REASONS = ["items-retained-past-schedule", "deletions-left-residue"] as const;

export type DisposalFailureReason = (typeof DISPOSAL_VIOLATION_REASONS)[number] | "disposal-unverifiable" | "no-items-provided";

export interface DisposalResult {
  ok: boolean;
  reason?: DisposalFailureReason;
  itemsChecked: number;
  retentionRulesChecked: number;
  deletionsChecked: number;
  /** Items compared against a declared rule and found inside it. */
  withinSchedule: number;
  findings: DisposalFinding[];
}

/**
 * GATE 3 — nothing outlives the retention its own class declared, and a
 * deletion leaves no residue.
 *
 * Pure, no I/O. `at` is supplied with no default: whether a record is 400
 * days into a 90-day schedule is entirely a function of the instant you ask
 * at, and a gate that read its own clock could never be replayed.
 *
 * THE ADVERSARIAL CASE. A weaker tool checks that a retention policy EXISTS.
 * It reads the schedule, finds it well-formed, and passes — while three
 * records sit 400 days into a 90-day policy, because nothing ever compared
 * the declaration against the data. Declaration present, drift unmeasured.
 * That is not a gap in coverage; it is a gate that grades the wrong noun. A
 * policy is a claim about records, and the only way to check a claim about
 * records is to read the records.
 *
 * This gate joins each item to the rule its own class declared and compares
 * ages in days. An item whose class the schedule NEVER DECLARED is reported
 * as `retention-undeclared` and is INDETERMINATE — the one answer a weaker
 * tool cannot give, and the one that matters most, because a schedule with a
 * hole in it looks exactly like a schedule without one until something is
 * held under the hole.
 *
 * A deletion is checked the same way: by the record it claims to have
 * removed, not by the call that claimed to remove it. A deletion recorded as
 * `erased` whose item is still in the held set is `deletion-residue`; one
 * recorded as `failed` is `deletion-failed`; one whose effect was never
 * observed is `deletion-unobserved`, which is indeterminate. A deletion
 * naming an item that is NOT in the held set is the success case and is not
 * a finding — that is the shape a working erasure actually has.
 */
export function checkDisposal(
  items: readonly HeldItem[],
  schedule: readonly RetentionRule[],
  deletions: readonly DeletionRecord[],
  at: string,
): DisposalResult {
  const base = { itemsChecked: items.length, retentionRulesChecked: schedule.length, deletionsChecked: deletions.length };
  if (items.length === 0) {
    return { ok: false, reason: "no-items-provided", ...base, withinSchedule: 0, findings: [] };
  }

  const byClass = new Map<string, RetentionRule>();
  for (const rule of schedule) byClass.set(rule.holdingClass, rule);
  const heldItemIds = new Set(items.map((item) => item.itemId));
  const findings: DisposalFinding[] = [];
  let withinSchedule = 0;

  for (const item of items) {
    const where = { itemId: item.itemId, subjectId: item.subjectId };
    const rule = byClass.get(item.holdingClass);
    if (rule === undefined) {
      findings.push({
        ...where,
        kind: "retention-undeclared",
        message: `held under class "${item.holdingClass}", which the declared schedule does not cover: there is nothing to compare this record against`,
      });
      continue;
    }
    const heldDays = elapsedDays(item.heldSince, at);
    if (heldDays === undefined) {
      findings.push({
        ...where,
        kind: "held-since-unreadable",
        message: `held since "${item.heldSince}", which cannot be read as an instant: its age against the ${rule.days}-day retention could not be compared`,
      });
      continue;
    }
    if (heldDays > rule.days) {
      findings.push({
        ...where,
        kind: "retained-past-schedule",
        message: `held since ${item.heldSince}, ${Math.floor(heldDays)} day(s) against the ${rule.days}-day retention its own class declared`,
      });
      continue;
    }
    withinSchedule += 1;
  }

  for (const deletion of deletions) {
    if (!heldItemIds.has(deletion.itemId)) continue;
    const where = { itemId: deletion.itemId, subjectId: deletion.subjectId };
    if (deletion.effect === "erased") {
      findings.push({
        ...where,
        kind: "deletion-residue",
        message: `recorded as erased at ${deletion.deletedAt} and still present in the held set: an erasure with residue is not an erasure`,
      });
      continue;
    }
    if (deletion.effect === "failed") {
      findings.push({
        ...where,
        kind: "deletion-failed",
        message: `a deletion recorded at ${deletion.deletedAt} failed and the item is still held`,
      });
      continue;
    }
    findings.push({
      ...where,
      kind: "deletion-unobserved",
      message: `a deletion at ${deletion.deletedAt} was never observed to have taken effect, and the item is still held`,
    });
  }

  const indeterminate = findings.some((finding) => INDETERMINATE_DISPOSAL_FINDING_KINDS.includes(finding.kind));
  if (indeterminate) return { ok: false, reason: "disposal-unverifiable", ...base, withinSchedule, findings };
  if (findings.some((finding) => finding.kind === "retained-past-schedule")) {
    return { ok: false, reason: "items-retained-past-schedule", ...base, withinSchedule, findings };
  }
  if (findings.length > 0) return { ok: false, reason: "deletions-left-residue", ...base, withinSchedule, findings };
  return { ok: true, ...base, withinSchedule, findings: [] };
}
