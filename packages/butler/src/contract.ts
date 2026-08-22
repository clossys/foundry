/**
 * The runtime contract: evaluate one stored want, decide one change to it,
 * and the three gates that read a whole set of them.
 *
 * THE LOOP THIS CLOSES
 * ---------------------
 * A stated want is the setpoint. Acting on it is the act. Reading the
 * interpretation back to the person, and asking whether the standing
 * answer is still current, is the observation. Unconfirmed intents and
 * expired instructions are the comparison. Re-asking is the correction. A
 * preference written to a row and never re-checked has no observation and
 * no comparison — it is an open loop, and closing it is the entire reason
 * this package exists.
 *
 * Everything here is pure. No I/O, no clock read, no ambient state:
 * `evaluateStandingInstruction` and `decideStandingChange` take `now` as a
 * parameter rather than calling `Date.now()` themselves, so the same
 * inputs always produce the same output and a test can put the clock
 * anywhere it needs it. Storage and audit are host-supplied ports
 * (`StandingInstructionStore`, `StandingAuditLedger` in `schema.ts`); this
 * file never touches either.
 *
 * THE THREE GATES
 * ----------------
 * Each returns the same shape of three-state result: `ok: true` when it
 * genuinely checked something and found nothing; `ok: false` with a
 * violation reason and findings when it checked and found something; and
 * `ok: false` with an INDETERMINATE reason when there was nothing to check
 * at all. `cli.ts` maps those onto `0` / `1` / `2` and never collapses the
 * third into either of the first two. A gate that reports "clean" after
 * checking nothing is worse than no gate.
 */

import type {
  ConfidenceFloor,
  ConfirmationRecord,
  CurrencyWindow,
  InstructionUsage,
  IntentRecord,
  PolicyVersion,
  PreferencePath,
  StandingAction,
  StandingAuditEvent,
  StandingEvaluation,
  StandingEvaluationPolicy,
  StandingInstruction,
  StandingTopic,
} from "./schema.js";

const MILLISECONDS_PER_DAY = 86_400_000;

function samePolicyVersion(a: PolicyVersion, b: PolicyVersion): boolean {
  return a.policyId === b.policyId && a.version === b.version;
}

function windowElapsed(decidedAt: string, currency: CurrencyWindow, at: string): boolean {
  const decided = Date.parse(decidedAt);
  const asked = Date.parse(at);
  if (Number.isNaN(decided) || Number.isNaN(asked)) return false;
  return asked - decided > currency.days * MILLISECONDS_PER_DAY;
}

/**
 * Compares one stored instruction against the policy in force AND the
 * clock. This is the check a weaker tool skips: asking whether a row
 * exists, or reading a boolean off it, cannot see age, so a row three
 * policy versions old and a year past its own declared window both read as
 * a pass. Presence is not currency.
 *
 * - `undefined` input, and a record whose own `state.kind` is `"absent"`,
 *   both return `{ status: "absent", reason: "no-record" }`. There is no
 *   third "never asked" representation, and this function deliberately does
 *   not runtime-validate its typed input or fall back to `"absent"` for a
 *   malformed one — a silent fallback would make a broken record
 *   indistinguishable from a subject who was genuinely never asked. Untyped
 *   input is validated at the boundary, by `schema.ts`'s validators.
 * - An INFERRED instruction with no `confirmedAt` returns
 *   `{ status: "absent", reason: "unconfirmed-inference" }`. An inferred
 *   want is not a want we have until the person says it is; treating one as
 *   binding is the same defect as reading absence as permission, one step
 *   further upstream.
 * - A `"granted"` record whose `policyVersion` differs from
 *   `currentPolicyVersion` is ALWAYS stale, unconditionally. A policy
 *   change invalidates prior permission by definition.
 * - A `"denied"` record whose `policyVersion` differs is stale only when
 *   `policy.invalidateDenialOnPolicyBump` is `true`. Whether a policy bump
 *   also invalidates a prior refusal is a jurisdiction judgment; `policy`
 *   has no default, so nobody gets either answer by accident.
 * - Independently of the policy version, a record whose `decidedAt` is more
 *   than `currency.days` before `at` is stale with reason
 *   `"window-elapsed"` — for grants AND denials alike. The window is the
 *   consumer's own declared statement of how long their own answer keeps
 *   speaking, and a refusal that has expired is as much a reason to ask
 *   again as a permission that has.
 *
 * When both a policy bump and an elapsed window apply, `"policy-superseded"`
 * is reported: it is the more specific fact, it names something that
 * happened on this side of the boundary rather than merely time passing,
 * and either way the answer is the same — ask again.
 */
export function evaluateStandingInstruction(
  instruction: StandingInstruction | undefined,
  currentPolicyVersion: PolicyVersion,
  policy: StandingEvaluationPolicy,
  at: string,
): StandingEvaluation {
  if (instruction === undefined || instruction.state.kind === "absent") {
    return { status: "absent", reason: "no-record" };
  }
  if (instruction.provenance === "inferred" && instruction.confirmedAt === undefined) {
    return { status: "absent", reason: "unconfirmed-inference" };
  }

  const { state } = instruction;
  const current = samePolicyVersion(state.policyVersion, currentPolicyVersion);
  const expired = windowElapsed(state.decidedAt, instruction.currency, at);

  if (state.kind === "granted") {
    if (!current) return { status: "stale", reason: "policy-superseded", previousPolicyVersion: state.policyVersion, decidedAt: state.decidedAt };
    if (expired) return { status: "stale", reason: "window-elapsed", previousPolicyVersion: state.policyVersion, decidedAt: state.decidedAt };
    return { status: "granted", policyVersion: state.policyVersion };
  }

  // state.kind === "denied"
  if (!current && policy.invalidateDenialOnPolicyBump) {
    return { status: "stale", reason: "policy-superseded", previousPolicyVersion: state.policyVersion, decidedAt: state.decidedAt };
  }
  if (expired) return { status: "stale", reason: "window-elapsed", previousPolicyVersion: state.policyVersion, decidedAt: state.decidedAt };
  return { status: "denied", policyVersion: state.policyVersion };
}

/**
 * The pure decision core for one change to one standing instruction:
 * produces the new record and its audit event. The caller's
 * `StandingInstructionStore` and `StandingAuditLedger` perform the writes.
 *
 * `actorId` and `subjectId` are separate parameters, in that order, and
 * are never derived from one another — an actor recording a subject's own
 * decision and an actor deciding on a subject's behalf must be
 * distinguishable in the audit trail, and a single conflated id makes them
 * identical forever.
 *
 * Withdrawing produces `state: { kind: "absent" }`: the same value a
 * subject who was never asked has. That is deliberate and it is the point
 * of the three-state model — a withdrawal returns the person to "we do not
 * have a want here", which is not permission, rather than to a `false`
 * that some later boolean read could round back up.
 */
export function decideStandingChange(
  actorId: string,
  subjectId: string,
  instructionId: string,
  action: StandingAction,
  now: string,
): { instruction: StandingInstruction; auditEvent: StandingAuditEvent } {
  const base = { instructionId, subjectId, topic: action.topic, provenance: "stated" as const, currency: action.currency };
  const instruction: StandingInstruction =
    action.kind === "grant"
      ? { ...base, state: { kind: "granted", policyVersion: action.policyVersion, decidedAt: now } }
      : action.kind === "deny"
        ? { ...base, state: { kind: "denied", policyVersion: action.policyVersion, decidedAt: now } }
        : { ...base, state: { kind: "absent" } };

  const auditEvent: StandingAuditEvent = {
    subjectId,
    actorId,
    topic: action.topic,
    type: action.kind === "grant" ? "granted" : action.kind === "deny" ? "denied" : "withdrawn",
    policyVersion: action.policyVersion,
    occurredAt: now,
  };
  return { instruction, auditEvent };
}

/**
 * A pure audit-event builder for a subject reopening their preference
 * surface, independent of whether they change anything once it is open.
 * Reopening at all is audit-worthy on its own: it is the observation half
 * of the loop, and a surface nobody ever reopens is a surface whose
 * instructions are never re-checked.
 */
export function recordReopened(
  actorId: string,
  subjectId: string,
  topic: StandingTopic,
  policyVersion: PolicyVersion,
  now: string,
): StandingAuditEvent {
  return { subjectId, actorId, topic, type: "reopened", policyVersion, occurredAt: now };
}

/**
 * A pure audit-event builder for the moment `evaluateStandingInstruction`
 * reports a stored answer stale. `reason` picks the event type, so an
 * auditor can tell a policy bump from an expired window without re-deriving
 * it. `previousPolicyVersion` is the version the invalidated record
 * actually answered; `currentPolicyVersion` is the one in force now.
 * Calling this is optional — the evaluation itself performs no I/O and
 * emits nothing — but a host that wants staleness to appear in its trail
 * rather than only ever being silently recomputed on read calls it once it
 * observes a `"stale"` evaluation.
 */
export function recordStaleness(
  actorId: string,
  subjectId: string,
  topic: StandingTopic,
  reason: "policy-superseded" | "window-elapsed",
  previousPolicyVersion: PolicyVersion,
  currentPolicyVersion: PolicyVersion,
  now: string,
): StandingAuditEvent {
  return {
    subjectId,
    actorId,
    topic,
    type: reason,
    policyVersion: currentPolicyVersion,
    previousPolicyVersion,
    occurredAt: now,
  };
}

// ------------------------------------------------- gate 1: confirmation completeness

export type ConfirmationFindingKind =
  /** Something was done on this reading and the subject never answered a read-back at all. */
  | "acted-without-confirmation"
  /** Something was done on this reading after the subject said it was misread. */
  | "acted-against-misread"
  /** Something was done on this reading after the subject said they could not tell. `"unclear"` is not a quiet yes. */
  | "acted-against-unclear"
  /** A reading below the declared floor was acted on with no hand-off and no confirmation. */
  | "below-floor-acted-silently"
  /** A read-back answers an intent that is not in the set being checked. */
  | "confirmation-without-intent";

export interface ConfirmationFinding {
  kind: ConfirmationFindingKind;
  intentId: string;
  /** The actor that dispositioned the intent, or the subject that answered a dangling read-back. Never both, never merged. */
  actorId?: string;
  message: string;
}

export type ConfirmationFailureReason = "unconfirmed-intents" | "no-intents-provided";

export interface ConfirmationCompletenessResult {
  ok: boolean;
  reason?: ConfirmationFailureReason;
  intentsChecked: number;
  confirmationsChecked: number;
  /** The floor actually applied, echoed back so a report names the number it judged against rather than implying a universal one. */
  floorApplied: number;
  findings: ConfirmationFinding[];
}

/**
 * GATE 1 — every acted-on intent has the subject's own confirmation, or an
 * explicit below-floor hand-off.
 *
 * Pure, no I/O. `floor` is supplied by the caller and has no default
 * anywhere in this package: the number below which a reading is too weak
 * to act on is one of the consumer's own values, and a floor this package
 * invented would be this package authoring it.
 *
 * The below-floor rule is the AI-native half. A reading whose confidence
 * is strictly below the floor may still be acted on — but only after the
 * subject confirms it. What it may never be is acted on SILENTLY: a
 * below-floor reading has to become a confirmation request or an explicit
 * hand-off, and `"handed-off"` is a first-class disposition precisely so
 * declining to act is representable as a decision rather than as an
 * absence of one.
 *
 * `ok: false` with `"no-intents-provided"` is not a violation — it is this
 * gate saying it never formed an opinion, and `cli.ts` maps it to `2`.
 */
export function checkConfirmationCompleteness(
  intents: readonly IntentRecord[],
  confirmations: readonly ConfirmationRecord[],
  floor: ConfidenceFloor,
): ConfirmationCompletenessResult {
  const base = { intentsChecked: intents.length, confirmationsChecked: confirmations.length, floorApplied: floor.minimumConfidence };
  if (intents.length === 0) {
    return { ok: false, reason: "no-intents-provided", ...base, findings: [] };
  }

  const byIntentId = new Map<string, ConfirmationRecord>();
  for (const confirmation of confirmations) byIntentId.set(confirmation.intentId, confirmation);
  const knownIntentIds = new Set(intents.map((intent) => intent.intentId));

  const findings: ConfirmationFinding[] = [];
  for (const intent of intents) {
    const confirmation = byIntentId.get(intent.intentId);
    const belowFloor = intent.confidence < floor.minimumConfidence;

    if (intent.disposition !== "acted") {
      // "handed-off" and "awaiting-confirmation" are both explicit,
      // recorded decisions not to act yet. Neither needs a confirmation to
      // be complete, because neither has done anything.
      continue;
    }

    if (confirmation === undefined) {
      findings.push({
        kind: belowFloor ? "below-floor-acted-silently" : "acted-without-confirmation",
        intentId: intent.intentId,
        actorId: intent.actorId,
        message: belowFloor
          ? `acted on a reading of confidence ${intent.confidence} below the declared floor ${floor.minimumConfidence}, with no confirmation and no hand-off`
          : "acted with no confirmation record from the subject",
      });
      continue;
    }
    if (confirmation.verdict === "misread") {
      findings.push({
        kind: "acted-against-misread",
        intentId: intent.intentId,
        actorId: intent.actorId,
        message: "acted after the subject answered the read-back with \"misread\"",
      });
      continue;
    }
    if (confirmation.verdict === "unclear") {
      findings.push({
        kind: "acted-against-unclear",
        intentId: intent.intentId,
        actorId: intent.actorId,
        message: "acted after the subject answered the read-back with \"unclear\"",
      });
    }
  }

  for (const confirmation of confirmations) {
    if (knownIntentIds.has(confirmation.intentId)) continue;
    findings.push({
      kind: "confirmation-without-intent",
      intentId: confirmation.intentId,
      message: "a read-back answers an intent that is not in the set being checked",
    });
  }

  if (findings.length > 0) return { ok: false, reason: "unconfirmed-intents", ...base, findings };
  return { ok: true, ...base, findings: [] };
}

// -------------------------------------------------------------- gate 2: currency

export type CurrencyFindingKind =
  /** An instruction was relied on after its own declared window ran out. */
  | "used-past-window"
  /** An instruction was relied on after the policy version it answered was superseded. */
  | "used-after-policy-superseded"
  /** An instruction was relied on while there was no answer on record — including an inference the subject never confirmed. Absence is not permission. */
  | "used-while-absent"
  /** A usage names an instruction that is not in the set being checked. */
  | "usage-without-instruction";

export interface CurrencyFinding {
  kind: CurrencyFindingKind;
  instructionId: string;
  /** Whoever relied on the instruction. Separate from the instruction's own `subjectId`, always. */
  actorId: string;
  usedAt: string;
  message: string;
}

export type CurrencyFailureReason = "stale-instructions-used" | "no-instructions-provided" | "no-usages-provided";

export interface CurrencyResult {
  ok: boolean;
  reason?: CurrencyFailureReason;
  instructionsChecked: number;
  usagesChecked: number;
  findings: CurrencyFinding[];
}

/**
 * GATE 2 — no standing instruction is used past its declared window.
 *
 * Pure, no I/O. Reads USAGES, not instructions alone, and that is the
 * whole design: a set of instructions with nobody relying on them proves
 * nothing, while a set of usages is a record of the loop actually being
 * closed or not. Each usage carries the policy version in force at the
 * moment it happened, so this gate replays a real decision rather than
 * re-deriving one against today's policy.
 *
 * `policy.invalidateDenialOnPolicyBump` has no default — see
 * `evaluateStandingInstruction`. A caller that cannot supply it does not
 * get a guess.
 *
 * `used-while-absent` is here because it is the same defect the three-state
 * model exists to prevent, observed one layer up: relying on nothing at all
 * — a subject never asked, or an inference they never confirmed — is not a
 * currency problem in the narrow sense, but it is exactly what a boolean
 * read of a missing row silently permits, and a gate that only measured
 * age would pass it.
 *
 * `ok: false` with either "nothing provided" reason is indeterminate, and
 * `cli.ts` maps it to `2`.
 */
export function checkCurrency(
  instructions: readonly StandingInstruction[],
  usages: readonly InstructionUsage[],
  policy: StandingEvaluationPolicy,
): CurrencyResult {
  const base = { instructionsChecked: instructions.length, usagesChecked: usages.length };
  if (instructions.length === 0) return { ok: false, reason: "no-instructions-provided", ...base, findings: [] };
  if (usages.length === 0) return { ok: false, reason: "no-usages-provided", ...base, findings: [] };

  const byId = new Map<string, StandingInstruction>();
  for (const instruction of instructions) byId.set(instruction.instructionId, instruction);

  const findings: CurrencyFinding[] = [];
  for (const usage of usages) {
    const instruction = byId.get(usage.instructionId);
    if (instruction === undefined) {
      findings.push({
        kind: "usage-without-instruction",
        instructionId: usage.instructionId,
        actorId: usage.actorId,
        usedAt: usage.usedAt,
        message: "relied on an instruction that is not in the set being checked",
      });
      continue;
    }

    const evaluation = evaluateStandingInstruction(instruction, usage.currentPolicyVersion, policy, usage.usedAt);
    if (evaluation.status === "absent") {
      findings.push({
        kind: "used-while-absent",
        instructionId: usage.instructionId,
        actorId: usage.actorId,
        usedAt: usage.usedAt,
        message:
          evaluation.reason === "unconfirmed-inference"
            ? "relied on an inferred instruction the subject never confirmed"
            : "relied on an instruction with no answer on record",
      });
      continue;
    }
    if (evaluation.status === "stale") {
      findings.push({
        kind: evaluation.reason === "window-elapsed" ? "used-past-window" : "used-after-policy-superseded",
        instructionId: usage.instructionId,
        actorId: usage.actorId,
        usedAt: usage.usedAt,
        message:
          evaluation.reason === "window-elapsed"
            ? `relied on an answer decided at ${evaluation.decidedAt}, past its declared window of ${instruction.currency.days} day(s)`
            : `relied on an answer to policy ${evaluation.previousPolicyVersion.policyId}@${evaluation.previousPolicyVersion.version}, superseded by ${usage.currentPolicyVersion.policyId}@${usage.currentPolicyVersion.version}`,
      });
    }
  }

  if (findings.length > 0) return { ok: false, reason: "stale-instructions-used", ...base, findings };
  return { ok: true, ...base, findings: [] };
}

// ------------------------------------------------------ gate 3: withdrawal parity

export type WithdrawalParityFindingKind =
  /** The surface declares a way in and no way out. */
  | "withdrawal-unavailable"
  /** Withdrawing takes more discrete actions than granting did. */
  | "withdrawal-costs-more-steps"
  /** Withdrawing requires contacting a human where granting did not. */
  | "withdrawal-requires-contact"
  /** Withdrawing requires an account where granting did not. */
  | "withdrawal-requires-account";

export interface WithdrawalParityFinding {
  kind: WithdrawalParityFindingKind;
  surfaceId: string;
  topic: StandingTopic;
  message: string;
}

export type WithdrawalParityFailureReason = "withdrawal-harder-than-granting" | "no-paths-provided";

export interface WithdrawalParityResult {
  ok: boolean;
  reason?: WithdrawalParityFailureReason;
  pathsChecked: number;
  findings: WithdrawalParityFinding[];
}

/**
 * GATE 3 — withdrawing is no harder than granting.
 *
 * Pure, no I/O. Compares the two routes a consumer measured itself, using
 * three coarse countable facts rather than a score: a parity claim that
 * produces a number nobody can trace back to a step is not evidence.
 *
 * A missing `withdraw` path is the loudest finding here, not a skipped
 * comparison. A surface that offers a way in and no way out is the extreme
 * of the same defect, and a gate that quietly had nothing to compare would
 * report it as a pass.
 *
 * Reopening is not a degraded path, and this gate is only the measurement
 * half of that. The API half is structural and lives in `./web`, where
 * `withdraw` shares `grant`'s and `deny`'s exact call shape, so there is no
 * separate, harder-to-reach function for revoking than for giving.
 *
 * `ok: false` with `"no-paths-provided"` is indeterminate, and `cli.ts`
 * maps it to `2`.
 */
export function checkWithdrawalParity(paths: readonly PreferencePath[]): WithdrawalParityResult {
  if (paths.length === 0) return { ok: false, reason: "no-paths-provided", pathsChecked: 0, findings: [] };

  const findings: WithdrawalParityFinding[] = [];
  for (const path of paths) {
    const where = { surfaceId: path.surfaceId, topic: path.topic };
    if (path.withdraw === undefined) {
      findings.push({ ...where, kind: "withdrawal-unavailable", message: "declares a grant path and no withdraw path at all" });
      continue;
    }
    if (path.withdraw.steps > path.grant.steps) {
      findings.push({
        ...where,
        kind: "withdrawal-costs-more-steps",
        message: `withdrawing takes ${path.withdraw.steps} step(s) against granting's ${path.grant.steps}`,
      });
    }
    if (path.withdraw.requiresContact && !path.grant.requiresContact) {
      findings.push({ ...where, kind: "withdrawal-requires-contact", message: "withdrawing requires contacting a human where granting did not" });
    }
    if (path.withdraw.requiresAccount && !path.grant.requiresAccount) {
      findings.push({ ...where, kind: "withdrawal-requires-account", message: "withdrawing requires an account where granting did not" });
    }
  }

  if (findings.length > 0) return { ok: false, reason: "withdrawal-harder-than-granting", pathsChecked: paths.length, findings };
  return { ok: true, pathsChecked: paths.length, findings: [] };
}
