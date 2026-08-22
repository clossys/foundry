/**
 * The runtime contract: decide one request, evaluate one obligation, and
 * the three gates that read a whole set of them back.
 *
 * THE LOOP THIS CLOSES
 * ---------------------
 * What is permitted and what is owed are the setpoints. Delivering,
 * refusing or handing off is the act. Delivery proofs and placement
 * records are the observation. Comparison against the declared service
 * level and the declared window is the check. Re-sending, escalating and
 * recording lateness are the correction. A request answered and never
 * joined to a record of what the person actually got has no observation
 * and no comparison — it is an open loop, and closing it is the entire
 * reason this package exists.
 *
 * THE DEFECT THIS FILE REPAYS
 * ----------------------------
 * A send path in this workspace reads its policy collaborator as
 * `(await config.policy?.(message)) ?? { outcome: "allow" }` — an optional
 * collaborator defaulting to a positive outcome, so a host that wires
 * nothing sends everything to everyone and nothing errors. Two structural
 * rules follow here, and both are enforced by the types rather than by
 * this comment:
 *
 *   1. NO COLLABORATOR IS OPTIONAL. Every field of `OutcomeInputs` is
 *      required. "Nothing is owed" is written `owed: null`, not omitted;
 *      "no human is free" is written `{ available: false, namedReason }`,
 *      not omitted. There is no `?.` and no `??` anywhere in this file,
 *      and `collaborators.check.ts` proves at compile time that
 *      `OutcomeInputs` has zero optional keys.
 *
 *   2. NO INDETERMINATE RESULT BECOMES A DELIVERY, AND NONE BECOMES A BARE
 *      REFUSAL. `DeliveryBasis` has three variants and every one of them is
 *      a positive, named reason to send; there is no variant meaning "we
 *      could not tell", so a delivery decided on an indeterminate read is
 *      not merely discouraged, it is unconstructable. Symmetrically,
 *      `VerdictRefusalGrounds` has exactly two variants: a standing
 *      refusal, or an unplaceable hand-off — which CARRIES the hand-off
 *      record with it. There is no "refused because we could not decide"
 *      ground, so the more dangerous collapse (indeterminate silently
 *      becoming a refusal, which looks like discipline while real requests
 *      are dropped and the refusal metrics stay healthy) cannot be
 *      expressed either.
 *
 * Everything here is pure. No I/O, no clock read, no ambient state:
 * `decideOutcome` and `evaluateObligation` take their instant as a
 * parameter rather than calling `Date.now()` themselves, so the same
 * inputs always produce the same output and a gate replays a real decision
 * rather than re-deriving one against today.
 *
 * THE THREE GATES
 * ----------------
 * Each returns the same shape of three-state result: `ok: true` when it
 * genuinely checked something and found nothing; `ok: false` with a
 * violation reason and findings when it checked and found something; and
 * `ok: false` with an INDETERMINATE reason when there was nothing to check
 * at all, or when part of what it was handed could not be compared.
 * `cli.ts` maps those onto `0` / `1` / `2` and never collapses the third
 * into either of the first two.
 */

import type {
  AnswerRecord,
  DeliveryProof,
  GroundCitation,
  HandoffReason,
  HandoffRecord,
  HandoffSla,
  ObligationRecord,
  PlacementRecord,
  PolicyVersion,
  RetainedGround,
  StandingRead,
} from "./schema.js";

const MILLISECONDS_PER_MINUTE = 60_000;

function elapsedMinutes(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / MILLISECONDS_PER_MINUTE;
}

// ---------------------------------------------------------- the runtime verdict

/**
 * Why a delivery was allowed. Three variants, and every one of them names
 * a positive fact that justified sending. There is deliberately no fourth
 * variant meaning "indeterminate", "assumed", or "default" — which is what
 * makes "an indeterminate read became a delivery" unconstructable rather
 * than merely forbidden in prose.
 */
export type DeliveryBasis =
  /** A standing grant was on record and current, and the answer had grounds to cite. */
  | { kind: "standing-granted"; policyVersion: PolicyVersion }
  /** Something we owe. Owed sends do not need a grant; they need a register entry. */
  | { kind: "owed"; obligationId: string; register: string }
  /**
   * THE INVERTED RULE, as a record. Something we owe, sent while a
   * standing refusal was on record — and the refusal it was sent against
   * is carried in the basis, so the send is recorded against the denial
   * rather than quietly overwriting it.
   */
  | { kind: "owed-against-standing-refusal"; obligationId: string; register: string; refusedPolicyVersion: PolicyVersion; refusalDecidedAt: string };

/**
 * A hand-off that was raised and could not be given to anyone. It carries
 * the whole `HandoffRecord`, not a flag, because the outcome is a refusal
 * AND a hand-off that could not be placed — the record has to reach the
 * placement gate, where it will be found unplaced, rather than
 * disappearing into the refusal.
 */
export interface UnplacedHandoff {
  handoff: HandoffRecord;
  /** Why nobody took it. Named, never empty, and never inferred. */
  namedReason: string;
}

/**
 * Why a refusal was given. Exactly two variants: a standing refusal on
 * record, or a hand-off that could not be placed. Every refusal therefore
 * either points at a decision the person themselves made, or carries the
 * hand-off it failed to place — and neither can be produced by rounding an
 * indeterminate read down.
 */
export type VerdictRefusalGrounds =
  | { kind: "standing-refusal"; policyVersion: PolicyVersion; decidedAt: string }
  | { kind: "handoff-unplaceable"; unplaced: UnplacedHandoff };

/**
 * The verdict. Three outcomes, never two, and never a boolean.
 * `handed-off` is the only outcome that requires a human.
 */
export type Verdict =
  | { kind: "delivered"; basis: DeliveryBasis }
  | { kind: "refused"; grounds: VerdictRefusalGrounds }
  | { kind: "handed-off"; handoff: HandoffRecord };

/** Every verdict kind, for a caller rendering or persisting one. */
export const VERDICT_KINDS = ["delivered", "refused", "handed-off"] as const;

/**
 * Something we owe this person on this request. `null` when nothing is
 * owed — an explicit value the caller has to write, not a field they can
 * leave off.
 */
export interface OwedObligation {
  obligationId: string;
  /** Consumer-defined label for the register it came from. This package ships no register. */
  register: string;
}

/**
 * Whether a person is actually available to take a hand-off. The
 * unavailable branch REQUIRES a named reason, so "no human" can never be
 * the absence of an answer — it is an answer, and it names itself.
 */
export type HumanAvailability = { available: true; actorId: string } | { available: false; namedReason: string };

/**
 * Whether the answer has anything to cite. The not-ready branch requires a
 * named reason for the same purpose: an answer with nothing behind it is
 * not delivered and not silently refused, it is handed to a person.
 */
export type GroundsReadiness = { ready: true; cites: readonly GroundCitation[] } | { ready: false; namedReason: string };

/**
 * Everything `decideOutcome` needs, all of it required.
 *
 * There is no optional field here and there is no default for any of them.
 * A caller that cannot say whether a human is free, or what the standing
 * answer is, or what the hand-off service level is, does not get a guess —
 * it gets a type error. `collaborators.check.ts` asserts that at compile
 * time so the property survives a future edit that adds a `?`.
 */
export interface OutcomeInputs {
  requestId: string;
  /** The person who asked. */
  subjectId: string;
  /** Whoever or whatever is answering. Separate from `subjectId`, always. */
  actorId: string;
  /** The instant this decision is being made at. Supplied, never read from the clock. */
  at: string;
  /** The standing answer, read across the document seam. Never optional, and `unreadable` is a real value. */
  standing: StandingRead;
  /** What we owe on this request, or `null` for nothing. Written explicitly either way. */
  owed: OwedObligation | null;
  /** Whether a person can take a hand-off right now. */
  humans: HumanAvailability;
  /** Whether the answer has grounds to cite. */
  grounds: GroundsReadiness;
  /** The id to use if a hand-off is raised. Supplied so this function stays pure. */
  handoffId: string;
  /** The consumer's own declared service level for a raised hand-off. No default exists here. */
  sla: HandoffSla;
}

function raise(inputs: OutcomeInputs, reason: HandoffReason, namedReason: string): Verdict {
  const handoff: HandoffRecord = {
    handoffId: inputs.handoffId,
    subjectId: inputs.subjectId,
    actorId: inputs.actorId,
    raisedAt: inputs.at,
    sla: inputs.sla,
    reason,
  };
  if (inputs.humans.available) return { kind: "handed-off", handoff };

  // Hand-off is the only outcome that requires a human. When there is no
  // human, the outcome is a REFUSAL with a named reason, recorded as a
  // hand-off that could not be placed. It is never a delivery, and the
  // hand-off record does not evaporate: it goes to the placement gate,
  // which will report it as raised and never picked up.
  return {
    kind: "refused",
    grounds: {
      kind: "handoff-unplaceable",
      unplaced: { handoff, namedReason: `${namedReason}; no human was available (${inputs.humans.namedReason})` },
    },
  };
}

function describeStanding(standing: StandingRead): string {
  if (standing.status === "absent") return `the standing answer is absent (${standing.reason})`;
  if (standing.status === "stale") return `the standing answer is stale (${standing.reason})`;
  if (standing.status === "unreadable") return `the standing answer could not be read (${standing.reason})`;
  return `the standing answer is ${standing.status}`;
}

/**
 * The one decision, and the one place the precedence rule between a
 * standing refusal and a thing we owe is resolved. It lives here and
 * nowhere else in this package.
 *
 * The order below is the rule:
 *
 *   1. SOMETHING WE OWE IS SENT. An obligation is owed regardless of what
 *      the standing record says — that is what distinguishes it from
 *      anything else we might send. When a standing refusal is on record
 *      the send still happens, and the basis becomes
 *      `owed-against-standing-refusal`, carrying the refusal it was made
 *      against. The refusal is not overwritten and not ignored; it is
 *      recorded alongside the send that overrode it, which is the only
 *      form in which "we sent this to someone who told us not to" is
 *      auditable afterwards.
 *   2. A STANDING REFUSAL REFUSES. With nothing owed, a denial on record
 *      is a refusal, and its grounds name the policy version and the date
 *      the person decided.
 *   3. A CURRENT GRANT DELIVERS — but only with grounds to cite. A grant
 *      with nothing behind the answer is not a delivery; it is a hand-off,
 *      because an answer nobody can show the basis of is exactly what the
 *      grounding gate exists to catch, one layer down.
 *   4. EVERYTHING ELSE IS A HAND-OFF. `absent`, `stale` and `unreadable`
 *      are the three indeterminate reads, and all three route to a person.
 *      If no person is available the result is a refusal carrying the
 *      unplaced hand-off (see `raise` above) — never a delivery, and never
 *      a bare refusal that loses the fact a person was needed.
 */
export function decideOutcome(inputs: OutcomeInputs): Verdict {
  const { standing, owed } = inputs;

  if (owed !== null) {
    if (standing.status === "denied") {
      return {
        kind: "delivered",
        basis: {
          kind: "owed-against-standing-refusal",
          obligationId: owed.obligationId,
          register: owed.register,
          refusedPolicyVersion: standing.policyVersion,
          refusalDecidedAt: standing.decidedAt,
        },
      };
    }
    return { kind: "delivered", basis: { kind: "owed", obligationId: owed.obligationId, register: owed.register } };
  }

  if (standing.status === "denied") {
    return { kind: "refused", grounds: { kind: "standing-refusal", policyVersion: standing.policyVersion, decidedAt: standing.decidedAt } };
  }

  if (standing.status === "granted") {
    if (inputs.grounds.ready) return { kind: "delivered", basis: { kind: "standing-granted", policyVersion: standing.policyVersion } };
    return raise(inputs, "grounds-unavailable", inputs.grounds.namedReason);
  }

  return raise(inputs, "standing-indeterminate", describeStanding(standing));
}

// -------------------------------------------------------- obligation evaluation

/** Why an obligation was not discharged. Each is a real, decided breach — never an "unknown". */
export type ObligationBreachReason =
  /** The window closed with nothing recorded at all. */
  | "no-delivery-proof"
  /** Attempts were recorded and every one of them failed. A resolved send call is not a delivery. */
  | "delivery-failed"
  /** A delivery was observed, outside the window the consumer declared for it. */
  | "delivered-outside-window";

/**
 * The obligation ternary. `unprovable` is the third value and it is never
 * rounded up into `discharged`: an attempted send nobody observed the
 * outcome of, and a window that has not closed yet, are both states in
 * which discharge cannot be shown — which is not the same as breach, and
 * is very much not the same as done.
 */
export type ObligationStatus =
  | { status: "discharged"; provenAt: string; attempts: number }
  | { status: "breached"; reason: ObligationBreachReason; attempts: number }
  | { status: "unprovable"; reason: "delivery-unobserved" | "window-open"; dueAt: string; attempts: number };

/**
 * Evaluate one obligation against every proof recorded for it.
 *
 * This is the check a weaker tool skips. Asking whether a send was
 * ATTEMPTED cannot see that the attempt failed: the dispatcher this
 * package was cut to repay resolves its promise on failure, so a caller
 * that only checks the call returned sees a success where the record says
 * `state: "failed"`. Three recorded attempts that all failed are three
 * proofs and zero deliveries, and this function says `breached`.
 *
 * Precedence, in order:
 *   - A `"delivered"` proof observed inside `[firedAt, firedAt + window]`
 *     discharges the obligation, even if other attempts failed first.
 *     Retries are normal; the question is whether one landed in time.
 *   - A `"delivered"` proof observed OUTSIDE that interval — before the
 *     obligation fired, or after its deadline — breaches with
 *     `delivered-outside-window`. A proof that predates the obligation
 *     cannot discharge it.
 *   - With no delivery at all: while the window is still open the status
 *     is `unprovable` / `window-open`, because a retry may still land. Once
 *     it has closed, an `"unknown"` attempt makes the obligation
 *     `unprovable` / `delivery-unobserved`, failed attempts alone breach
 *     with `delivery-failed`, and no attempts at all breach with
 *     `no-delivery-proof`.
 */
export function evaluateObligation(obligation: ObligationRecord, proofs: readonly DeliveryProof[], at: string): ObligationStatus {
  const own = proofs.filter((proof) => proof.obligationId === obligation.obligationId);
  const attempts = own.length;
  const dueAt = new Date(Date.parse(obligation.firedAt) + obligation.window.minutes * MILLISECONDS_PER_MINUTE).toISOString();

  const delivered = own.filter((proof) => proof.state === "delivered");
  const inWindow = delivered.find((proof) => {
    const offset = elapsedMinutes(obligation.firedAt, proof.observedAt);
    return offset >= 0 && offset <= obligation.window.minutes;
  });
  if (inWindow !== undefined) return { status: "discharged", provenAt: inWindow.observedAt, attempts };
  if (delivered.length > 0) return { status: "breached", reason: "delivered-outside-window", attempts };

  const windowClosed = elapsedMinutes(obligation.firedAt, at) > obligation.window.minutes;
  if (!windowClosed) return { status: "unprovable", reason: "window-open", dueAt, attempts };

  if (own.some((proof) => proof.state === "unknown")) return { status: "unprovable", reason: "delivery-unobserved", dueAt, attempts };
  if (attempts > 0) return { status: "breached", reason: "delivery-failed", attempts };
  return { status: "breached", reason: "no-delivery-proof", attempts };
}

// ------------------------------------------------- gate 1: hand-off placement

export type HandoffPlacementFindingKind =
  /** Raised, the declared service level elapsed, and nobody ever picked it up. Silence is the finding. */
  | "never-placed"
  /** Picked up, after the declared service level had already elapsed. */
  | "placed-outside-sla"
  /** A placement names a hand-off that is not in the set being checked. */
  | "placement-without-handoff"
  /** A placement timestamped before the hand-off it claims to answer was raised. */
  | "placement-precedes-raise"
  /** A hand-off raised after the instant the run claims to check at. The record set and the instant disagree. */
  | "raised-after-check-instant";

export interface HandoffPlacementFinding {
  kind: HandoffPlacementFindingKind;
  handoffId: string;
  /** The subject the hand-off was raised for, where the hand-off is known. */
  subjectId?: string;
  message: string;
}

export type HandoffPlacementFailureReason = "handoffs-unplaced" | "no-handoffs-provided" | "no-handoffs-due";

export interface HandoffPlacementResult {
  ok: boolean;
  reason?: HandoffPlacementFailureReason;
  handoffsChecked: number;
  placementsChecked: number;
  placed: number;
  /** Raised, unplaced, and not yet past its declared service level. Counted and reported, never a finding. */
  awaitingPlacement: number;
  findings: HandoffPlacementFinding[];
}

/**
 * GATE 1 — every hand-off has a placement record inside its declared
 * service level.
 *
 * Pure, no I/O. `at` is supplied, with no default, because the difference
 * between "raised four minutes ago and nobody has taken it yet" and
 * "raised and abandoned" is entirely a function of the instant you ask at.
 * A gate that read its own clock would give a different answer on every
 * run and could never be replayed.
 *
 * A raised hand-off nobody picked up is a FINDING, not silence. That is
 * the whole gate: the failure this catches produces no error, no alert and
 * no record anywhere else — a person was told someone would get back to
 * them, and the queue simply never emptied.
 *
 * `ok: false` with `"no-handoffs-provided"` or `"no-handoffs-due"` is not a
 * violation — it is this gate saying it never formed an opinion, because
 * nothing it was handed had reached its own deadline yet. `cli.ts` maps
 * both to `2`.
 */
export function checkHandoffPlacement(
  handoffs: readonly HandoffRecord[],
  placements: readonly PlacementRecord[],
  at: string,
): HandoffPlacementResult {
  const base = { handoffsChecked: handoffs.length, placementsChecked: placements.length };
  if (handoffs.length === 0) {
    return { ok: false, reason: "no-handoffs-provided", ...base, placed: 0, awaitingPlacement: 0, findings: [] };
  }

  const byHandoffId = new Map<string, PlacementRecord>();
  for (const placement of placements) byHandoffId.set(placement.handoffId, placement);
  const knownHandoffIds = new Set(handoffs.map((handoff) => handoff.handoffId));

  const findings: HandoffPlacementFinding[] = [];
  let placed = 0;
  let awaitingPlacement = 0;

  for (const handoff of handoffs) {
    const where = { handoffId: handoff.handoffId, subjectId: handoff.subjectId };
    if (elapsedMinutes(handoff.raisedAt, at) < 0) {
      findings.push({
        ...where,
        kind: "raised-after-check-instant",
        message: `raised at ${handoff.raisedAt}, after the instant this run checks at (${at})`,
      });
      continue;
    }

    const placement = byHandoffId.get(handoff.handoffId);
    if (placement === undefined) {
      if (elapsedMinutes(handoff.raisedAt, at) > handoff.sla.minutes) {
        findings.push({
          ...where,
          kind: "never-placed",
          message: `raised at ${handoff.raisedAt} with a ${handoff.sla.minutes}-minute service level, and no placement record exists`,
        });
      } else {
        awaitingPlacement += 1;
      }
      continue;
    }

    const waited = elapsedMinutes(handoff.raisedAt, placement.placedAt);
    if (waited < 0) {
      findings.push({
        ...where,
        kind: "placement-precedes-raise",
        message: `placed at ${placement.placedAt}, before it was raised at ${handoff.raisedAt}`,
      });
      continue;
    }
    if (waited > handoff.sla.minutes) {
      findings.push({
        ...where,
        kind: "placed-outside-sla",
        message: `picked up after ${waited} minute(s) against a declared ${handoff.sla.minutes}-minute service level`,
      });
      continue;
    }
    placed += 1;
  }

  for (const placement of placements) {
    if (knownHandoffIds.has(placement.handoffId)) continue;
    findings.push({
      kind: "placement-without-handoff",
      handoffId: placement.handoffId,
      message: "a placement answers a hand-off that is not in the set being checked",
    });
  }

  if (findings.length > 0) return { ok: false, reason: "handoffs-unplaced", ...base, placed, awaitingPlacement, findings };
  if (placed === 0) {
    // Every hand-off is still inside its own declared service level. Nothing
    // has come due, so nothing was compared, and reporting that clean would
    // be a pass earned by checking nothing.
    return { ok: false, reason: "no-handoffs-due", ...base, placed, awaitingPlacement, findings: [] };
  }
  return { ok: true, ...base, placed, awaitingPlacement, findings: [] };
}

// ------------------------------------------------------------ gate 2: grounding

export type GroundingFindingKind =
  /** Delivered, citing nothing at all. */
  | "delivered-without-citation"
  /** Delivered, citing a ground the consumer no longer retains. The person cannot be shown what the answer rested on. */
  | "citation-not-retained"
  /** Refused, retaining no grounds at all. A refusal nobody can see the basis of is a refusal nobody can contest. */
  | "refusal-without-grounds"
  /** Refused, citing grounds the consumer no longer retains. */
  | "refusal-grounds-not-retained";

export interface GroundingFinding {
  kind: GroundingFindingKind;
  requestId: string;
  /** The actor that answered. Separate from the subject, always. */
  actorId: string;
  message: string;
}

export type GroundingFailureReason = "answers-ungrounded" | "no-answers-provided";

export interface GroundingResult {
  ok: boolean;
  reason?: GroundingFailureReason;
  answersChecked: number;
  retainedGroundsChecked: number;
  delivered: number;
  refused: number;
  handedOff: number;
  findings: GroundingFinding[];
}

/**
 * GATE 2 — every delivered answer cites a source, and every refusal
 * retains its grounds.
 *
 * Pure, no I/O. It joins citations to the grounds the consumer says it
 * still holds, rather than trusting that a citation exists: a reference to
 * material that has since been dropped reads exactly like a good citation
 * right up until someone asks to see it.
 *
 * The refusal half is the half people forget. A person may ask why they
 * were refused and contest it, which is only possible if the grounds were
 * RETAINED rather than merely computed — an outcome recorded without its
 * reasons is a decision nobody, including its author, can revisit.
 *
 * A `handed-off` answer is not judged here. It has neither delivered
 * anything nor refused anything; whether it was picked up is gate 1's
 * question, and answering it here would be two gates grading the same
 * fact.
 *
 * `ok: false` with `"no-answers-provided"` is indeterminate, and `cli.ts`
 * maps it to `2`.
 */
export function checkGrounding(answers: readonly AnswerRecord[], retained: readonly RetainedGround[]): GroundingResult {
  const base = { answersChecked: answers.length, retainedGroundsChecked: retained.length };
  if (answers.length === 0) {
    return { ok: false, reason: "no-answers-provided", ...base, delivered: 0, refused: 0, handedOff: 0, findings: [] };
  }

  const retainedIds = new Set(retained.map((ground) => ground.groundId));
  const findings: GroundingFinding[] = [];
  let delivered = 0;
  let refused = 0;
  let handedOff = 0;

  for (const answer of answers) {
    const where = { requestId: answer.requestId, actorId: answer.actorId };
    const { outcome } = answer;

    if (outcome.kind === "handed-off") {
      handedOff += 1;
      continue;
    }

    if (outcome.kind === "delivered") {
      delivered += 1;
      if (outcome.cites.length === 0) {
        findings.push({ ...where, kind: "delivered-without-citation", message: "an answer was delivered citing no source at all" });
        continue;
      }
      const dangling = outcome.cites.filter((citation) => !retainedIds.has(citation.groundId));
      if (dangling.length > 0) {
        findings.push({
          ...where,
          kind: "citation-not-retained",
          message: `cites ${dangling.length} source(s) that are not in the retained set: ${dangling.map((c) => c.groundId).join(", ")}`,
        });
      }
      continue;
    }

    refused += 1;
    if (outcome.grounds.length === 0) {
      findings.push({
        ...where,
        kind: "refusal-without-grounds",
        message: `refused with the reason "${outcome.namedReason}" and no retained grounds behind it`,
      });
      continue;
    }
    const dangling = outcome.grounds.filter((citation) => !retainedIds.has(citation.groundId));
    if (dangling.length > 0) {
      findings.push({
        ...where,
        kind: "refusal-grounds-not-retained",
        message: `refused on ${dangling.length} ground(s) that are not in the retained set: ${dangling.map((c) => c.groundId).join(", ")}`,
      });
    }
  }

  if (findings.length > 0) return { ok: false, reason: "answers-ungrounded", ...base, delivered, refused, handedOff, findings };
  return { ok: true, ...base, delivered, refused, handedOff, findings: [] };
}

// -------------------------------------------------- gate 3: obligation discharge

export type ObligationDischargeFindingKind =
  /** The window closed with nothing recorded at all. */
  | "no-delivery-proof"
  /** Attempts were recorded and every one failed. THE adversarial case: counting attempts passes here. */
  | "delivery-failed"
  /** A delivery landed outside the declared window. */
  | "delivered-outside-window"
  /** A proof names an obligation that is not in the set being checked. */
  | "proof-without-obligation"
  /** The window closed and the outcome of the attempt was never observed. Indeterminate, never a pass. */
  | "delivery-unprovable";

export interface ObligationDischargeFinding {
  kind: ObligationDischargeFindingKind;
  obligationId: string;
  /** The person we owe, where the obligation is known. */
  subjectId?: string;
  /** How many sends were recorded against it. Present so a report can say "3 attempts, 0 deliveries" in one line. */
  attempts?: number;
  message: string;
}

/** The one indeterminate finding kind. Kept as a list so the CLI derives its exit code rather than restating the rule. */
export const INDETERMINATE_DISCHARGE_FINDING_KINDS: readonly ObligationDischargeFindingKind[] = ["delivery-unprovable"];

export type ObligationDischargeFailureReason =
  | "obligations-breached"
  | "discharge-unprovable"
  | "no-obligations-provided"
  | "no-obligations-due";

export interface ObligationDischargeResult {
  ok: boolean;
  reason?: ObligationDischargeFailureReason;
  obligationsChecked: number;
  proofsChecked: number;
  discharged: number;
  /** Fired, undischarged, and not yet past its declared window. Counted and reported, never a finding. */
  awaitingWindow: number;
  findings: ObligationDischargeFinding[];
}

/**
 * GATE 3 — every fired obligation has delivery proof timestamped inside
 * its window.
 *
 * Pure, no I/O. `at` is supplied with no default, for the same reason gate
 * 1's is: an obligation eleven minutes into a sixty-minute window is not
 * late, and only the instant you ask at can tell you that.
 *
 * THE ADVERSARIAL CASE. A weaker tool checks that a send was ATTEMPTED and
 * passes on a record whose own state says the send failed — the dispatcher
 * this package repays resolves its promise on failure, and its own
 * documentation says plainly that a resolved promise is not a success.
 * Counting attempts reports a clean run while nobody was told. This gate
 * reads the observed STATE of each proof: `"failed"` is a breach,
 * `"unknown"` is unprovable, and only `"delivered"` inside the declared
 * window discharges anything.
 *
 * A mixed run — one obligation breached and another whose outcome was
 * never observed — reports the INDETERMINATE reason and exits `2`, not
 * `1`, and still prints the breach it did find. The exit code describes
 * the completeness of the answer; the printed findings are the answer so
 * far. That is the same resolution the sibling role's reconciliation gate
 * uses for the same shape of mixed result.
 *
 * `no-obligations-provided` and `no-obligations-due` are both
 * indeterminate: nothing to scan, and nothing yet due, are runs that
 * examined nothing.
 */
export function checkObligationDischarge(
  obligations: readonly ObligationRecord[],
  proofs: readonly DeliveryProof[],
  at: string,
): ObligationDischargeResult {
  const base = { obligationsChecked: obligations.length, proofsChecked: proofs.length };
  if (obligations.length === 0) {
    return { ok: false, reason: "no-obligations-provided", ...base, discharged: 0, awaitingWindow: 0, findings: [] };
  }

  const knownObligationIds = new Set(obligations.map((obligation) => obligation.obligationId));
  const findings: ObligationDischargeFinding[] = [];
  let discharged = 0;
  let awaitingWindow = 0;

  for (const obligation of obligations) {
    const where = { obligationId: obligation.obligationId, subjectId: obligation.subjectId };
    const status = evaluateObligation(obligation, proofs, at);

    if (status.status === "discharged") {
      discharged += 1;
      continue;
    }
    if (status.status === "unprovable") {
      if (status.reason === "window-open") {
        awaitingWindow += 1;
        continue;
      }
      findings.push({
        ...where,
        kind: "delivery-unprovable",
        attempts: status.attempts,
        message: `${status.attempts} send(s) recorded, none observed to have arrived, and the window closed at ${status.dueAt}`,
      });
      continue;
    }

    findings.push({
      ...where,
      kind: status.reason,
      attempts: status.attempts,
      message:
        status.reason === "delivery-failed"
          ? `${status.attempts} send(s) recorded against this obligation and every one of them failed: an attempt is not a delivery`
          : status.reason === "delivered-outside-window"
            ? `delivery was observed outside the declared ${obligation.window.minutes}-minute window from ${obligation.firedAt}`
            : `the declared ${obligation.window.minutes}-minute window from ${obligation.firedAt} closed with no delivery proof at all`,
    });
  }

  for (const proof of proofs) {
    if (knownObligationIds.has(proof.obligationId)) continue;
    findings.push({
      kind: "proof-without-obligation",
      obligationId: proof.obligationId,
      message: "a delivery proof names an obligation that is not in the set being checked",
    });
  }

  const indeterminate = findings.some((finding) => INDETERMINATE_DISCHARGE_FINDING_KINDS.includes(finding.kind));
  if (indeterminate) return { ok: false, reason: "discharge-unprovable", ...base, discharged, awaitingWindow, findings };
  if (findings.length > 0) return { ok: false, reason: "obligations-breached", ...base, discharged, awaitingWindow, findings };
  if (discharged === 0) {
    return { ok: false, reason: "no-obligations-due", ...base, discharged, awaitingWindow, findings: [] };
  }
  return { ok: true, ...base, discharged, awaitingWindow, findings: [] };
}
