/**
 * The record contract: what one person asked for and what came back, the
 * hand-offs raised on their behalf, the grounds retained behind each
 * answer, and the obligations that fired for them.
 *
 * Everything here is consumer-authored data. This package ships no
 * obligation, no register, no category, no jurisdiction rule and no
 * service-level number of its own; it ships the shapes those things are
 * written in and the checkers that read them back.
 *
 * THE VERDICT IS A TERNARY
 * ------------------------
 * `AnswerOutcome` is three variants — `delivered`, `refused`,
 * `handed-off` — and never a boolean, and never two. A binary can only say
 * "something went out" or "nothing did", which makes a request given to a
 * person and a request quietly dropped indistinguishable in the record.
 * Hand-off is the only outcome that requires a human, and it is a
 * first-class outcome precisely so declining to answer is representable as
 * a decision rather than as the absence of one.
 *
 * NO ABSENCE IS A POSITIVE ANSWER
 * --------------------------------
 * The defect this package was cut to repay is a collaborator that was
 * optional and defaulted to permissive: an absent policy hook read as
 * "allow", so a host that wired nothing sent everything to everyone and
 * nothing errored. Nothing in this file has that shape. `DeliveryState`
 * has a `"failed"` value and an `"unknown"` value, and neither is ever
 * folded into `"delivered"`; `StandingRead` has an `"unreadable"` status,
 * so a seam document that could not be loaded is a distinct, nameable
 * answer rather than a silent grant.
 *
 * IDENTIFIERS
 * ------------
 * `subjectId` is the person the request or the obligation belongs to;
 * `actorId` is whoever or whatever is acting — including the human a
 * hand-off is placed with. They are separate fields in every record and in
 * every signature, and are never unified: "we decided on our own reading"
 * and "the person asked for this" are the two things the whole record
 * exists to keep apart. Both are opaque host-owned references — never an
 * email address, a name, a phone number, or an IP.
 *
 * NO CONTENT, ANYWHERE
 * ---------------------
 * No record here holds the text of a request, an answer, a refusal, or a
 * message. Grounds are referenced by an opaque `groundId` and proofs by an
 * opaque `transportRef`; what those point at stays in the consumer's own
 * store. A gate can therefore run over a whole record set without any
 * person-attributable content passing through it, and no such record is
 * ever written into this repository.
 *
 * Validation here is hand-rolled over `unknown`, with no schema library,
 * matching every other package in this workspace. These validators exist
 * for the boundary where records arrive as untyped JSON — a file the CLI
 * reads, a value read back out of a host's own store — before anything
 * downstream is allowed to trust them.
 */

import {
  isOneOf,
  isPlainObject,
  pushIssue,
  requireArrayOf,
  requireNumber,
  requireString,
  requireTimestamp,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

// ------------------------------------------------------------ shared vocabulary

/**
 * Identifies which version of a policy document a standing answer
 * answered. Carried through from the seam document so a delivery made
 * under a grant, or a refusal made under a denial, names the version it
 * rested on rather than today's.
 */
export interface PolicyVersion {
  policyId: string;
  version: string;
}

// ---------------------------------------------------------- the standing read

/**
 * One standing answer, as this package sees it — the runtime input side of
 * the document seam described in `record.ts`.
 *
 * The first four statuses mirror what the producing package reports.
 * `"unreadable"` is this package's own fifth, and it is the point of the
 * whole type: a seam document that is missing, unparseable, or does not
 * validate produces an `"unreadable"` read, which is indeterminate. There
 * is no sixth status meaning "assume yes", and `decideOutcome` has no
 * branch that treats an unreadable read as a grant.
 */
export type StandingRead =
  | { status: "granted"; policyVersion: PolicyVersion; decidedAt: string }
  | { status: "denied"; policyVersion: PolicyVersion; decidedAt: string }
  | { status: "absent"; reason: string }
  | { status: "stale"; reason: string; previousPolicyVersion: PolicyVersion; decidedAt: string }
  | { status: "unreadable"; reason: string };

/** Every standing-read status, for a caller validating untyped input. */
export const STANDING_READ_STATUSES = ["granted", "denied", "absent", "stale", "unreadable"] as const;

/**
 * The three statuses that are neither a grant nor a refusal. Each one is a
 * read this package could not turn into a decision on its own, and each
 * one routes to a hand-off — never to a delivery, and never straight to a
 * refusal.
 */
export const INDETERMINATE_STANDING_STATUSES = ["absent", "stale", "unreadable"] as const;

// ------------------------------------------------------------------ hand-offs

/**
 * How long the consumer declared a raised hand-off may sit before someone
 * must have picked it up. Consumer-declared per hand-off, with NO default
 * anywhere in this package: a service level this package invented would be
 * this package authoring one of the consumer's own commitments, and a
 * missing one silently read as "whenever" is exactly the open loop the
 * placement gate exists to close.
 */
export interface HandoffSla {
  /** Whole minutes after `raisedAt` within which a placement must exist. */
  minutes: number;
}

/**
 * Why the machine stopped and asked for a person. Deliberately only the
 * two reasons this package can DERIVE itself — a consumer referring a
 * request for its own reasons builds a `HandoffRecord` directly rather
 * than being offered a vague third value here.
 */
export type HandoffReason = "standing-indeterminate" | "grounds-unavailable";

/** Every hand-off reason, for a caller validating untyped input. */
export const HANDOFF_REASONS: readonly HandoffReason[] = ["standing-indeterminate", "grounds-unavailable"];

/** One hand-off raised on one subject's behalf. */
export interface HandoffRecord {
  handoffId: string;
  /** The person whose request this is. */
  subjectId: string;
  /** Whoever or whatever raised it. Separate from `subjectId`, always. */
  actorId: string;
  raisedAt: string;
  sla: HandoffSla;
  reason: HandoffReason;
}

/**
 * One occasion on which a raised hand-off was actually picked up. This is
 * the observation half of the loop: a hand-off that is raised and never
 * joined to a placement is an open loop, and the placement gate reads
 * these, not the hand-offs alone.
 */
export interface PlacementRecord {
  handoffId: string;
  /** The human actor who took it. Separate from the subject's own id, always. */
  placedWithActorId: string;
  placedAt: string;
}

// ------------------------------------------------------------------- grounding

/**
 * A reference to the material an answer or a refusal rested on. The
 * `groundId` is opaque and consumer-owned; nothing here holds what it
 * points at.
 */
export interface GroundCitation {
  groundId: string;
  citedAt: string;
}

/**
 * A ground the consumer actually still holds. The grounding gate joins
 * citations to these: a citation naming nothing retained is a dangling
 * reference, and a refusal a person cannot be shown the basis of is a
 * refusal they cannot contest.
 */
export interface RetainedGround {
  groundId: string;
  retainedAt: string;
}

/**
 * The ternary, as a record. `cites` and `grounds` are plain arrays and are
 * allowed to be EMPTY at the validation boundary on purpose: an answer
 * that cited nothing is a real record that really happened, and the
 * grounding gate has to be able to read it and report it as a finding. A
 * validator that refused an empty array would turn that finding into a
 * "could not run", which is the one thing the exit contract forbids.
 */
export type AnswerOutcome =
  | { kind: "delivered"; at: string; cites: readonly GroundCitation[] }
  | { kind: "refused"; at: string; namedReason: string; grounds: readonly GroundCitation[] }
  | { kind: "handed-off"; at: string; handoffId: string };

/** Every outcome kind, for a caller validating untyped input. */
export const ANSWER_OUTCOME_KINDS = ["delivered", "refused", "handed-off"] as const;

/** One request, and what the person got back. */
export interface AnswerRecord {
  requestId: string;
  /** The person who asked. */
  subjectId: string;
  /** Whoever or whatever answered. Separate from `subjectId`, always. */
  actorId: string;
  receivedAt: string;
  outcome: AnswerOutcome;
}

// ----------------------------------------------------------------- obligations

/**
 * How long after firing the consumer declared it has to prove delivery.
 * Consumer-declared per obligation, with no default: this package ships no
 * obligation register and therefore no deadline of its own.
 */
export interface ObligationWindow {
  /** Whole minutes after `firedAt` within which delivery must be proven. */
  minutes: number;
}

/**
 * One obligation that fired for one subject. `register` is a
 * consumer-defined label naming which of the consumer's own registers this
 * came out of — this package enumerates no registers and inspects no
 * obligation's meaning.
 */
export interface ObligationRecord {
  obligationId: string;
  /** The person we owe. */
  subjectId: string;
  /** Consumer-defined label for the register this obligation came from. */
  register: string;
  firedAt: string;
  window: ObligationWindow;
}

/**
 * What was actually observed of one send.
 *
 * `"failed"` exists as its own value, and never rolls up into
 * `"delivered"`, because the send path this package was cut to repay
 * resolves its promise on failure: a caller that only checks the call
 * returned sees a success where the record says `state: "failed"`.
 * Counting attempts passes while nobody was told.
 *
 * `"unknown"` is the third value and is not a soft `"delivered"`: the send
 * was attempted and nothing observed what became of it. `evaluateObligation`
 * reports it as `unprovable`, never as discharged.
 */
export type DeliveryState = "delivered" | "failed" | "unknown";

/** Every delivery state, for a caller validating untyped input. */
export const DELIVERY_STATES: readonly DeliveryState[] = ["delivered", "failed", "unknown"];

/**
 * One observation of one send attempt. An obligation may have MANY: three
 * recorded attempts that all failed are three proofs and zero deliveries,
 * and the discharge gate says so.
 *
 * `transportRef` is an opaque, consumer-owned handle to the transport's
 * own result. Never its content, and never the message.
 */
export interface DeliveryProof {
  obligationId: string;
  /** Whoever or whatever performed the send. Separate from the obligation's `subjectId`, always. */
  actorId: string;
  state: DeliveryState;
  observedAt: string;
  transportRef: string;
}

// ------------------------------------------------------------------ validators

function result<T>(value: T | undefined, issues: ValidationIssue[]): ValidationResult<T> {
  if (value === undefined || issues.length > 0) return { ok: false, issues };
  return { ok: true, value };
}

export function readPolicyVersion(value: unknown, path: string, issues: ValidationIssue[]): PolicyVersion | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with policyId and version");
    return undefined;
  }
  const before = issues.length;
  const policyId = requireString(value.policyId, `${path}.policyId`, issues, { minLength: 1 });
  const version = requireString(value.version, `${path}.version`, issues, { minLength: 1 });
  if (issues.length > before || policyId === undefined || version === undefined) return undefined;
  return { policyId, version };
}

function readWholeMinutes(value: unknown, path: string, issues: ValidationIssue[]): number | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with a whole-number minutes field");
    return undefined;
  }
  return requireNumber(value.minutes, `${path}.minutes`, issues, { min: 0, integer: true });
}

function readHandoffRecord(value: unknown, path: string, issues: ValidationIssue[]): HandoffRecord | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const handoffId = requireString(value.handoffId, `${path}.handoffId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const raisedAt = requireTimestamp(value.raisedAt, `${path}.raisedAt`, issues);
  const minutes = readWholeMinutes(value.sla, `${path}.sla`, issues);
  if (!isOneOf(value.reason, HANDOFF_REASONS)) {
    pushIssue(issues, `${path}.reason`, `must be one of ${HANDOFF_REASONS.join(", ")}`);
  }
  if (issues.length > before) return undefined;
  if (handoffId === undefined || subjectId === undefined || actorId === undefined || raisedAt === undefined || minutes === undefined) {
    return undefined;
  }
  return { handoffId, subjectId, actorId, raisedAt, sla: { minutes }, reason: value.reason as HandoffReason };
}

function readPlacementRecord(value: unknown, path: string, issues: ValidationIssue[]): PlacementRecord | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const handoffId = requireString(value.handoffId, `${path}.handoffId`, issues, { minLength: 1 });
  const placedWithActorId = requireString(value.placedWithActorId, `${path}.placedWithActorId`, issues, { minLength: 1 });
  const placedAt = requireTimestamp(value.placedAt, `${path}.placedAt`, issues);
  if (issues.length > before || handoffId === undefined || placedWithActorId === undefined || placedAt === undefined) return undefined;
  return { handoffId, placedWithActorId, placedAt };
}

function readGroundCitation(value: unknown, path: string, issues: ValidationIssue[]): GroundCitation | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with groundId and citedAt");
    return undefined;
  }
  const before = issues.length;
  const groundId = requireString(value.groundId, `${path}.groundId`, issues, { minLength: 1 });
  const citedAt = requireTimestamp(value.citedAt, `${path}.citedAt`, issues);
  if (issues.length > before || groundId === undefined || citedAt === undefined) return undefined;
  return { groundId, citedAt };
}

function readRetainedGround(value: unknown, path: string, issues: ValidationIssue[]): RetainedGround | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with groundId and retainedAt");
    return undefined;
  }
  const before = issues.length;
  const groundId = requireString(value.groundId, `${path}.groundId`, issues, { minLength: 1 });
  const retainedAt = requireTimestamp(value.retainedAt, `${path}.retainedAt`, issues);
  if (issues.length > before || groundId === undefined || retainedAt === undefined) return undefined;
  return { groundId, retainedAt };
}

function readAnswerOutcome(value: unknown, path: string, issues: ValidationIssue[]): AnswerOutcome | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `must be an object with a kind of ${ANSWER_OUTCOME_KINDS.join(", ")}`);
    return undefined;
  }
  const kind = value.kind;
  if (!isOneOf(kind, ANSWER_OUTCOME_KINDS)) {
    pushIssue(issues, `${path}.kind`, `must be one of ${ANSWER_OUTCOME_KINDS.join(", ")}`);
    return undefined;
  }
  const before = issues.length;
  const at = requireTimestamp(value.at, `${path}.at`, issues);
  if (kind === "handed-off") {
    const handoffId = requireString(value.handoffId, `${path}.handoffId`, issues, { minLength: 1 });
    if (issues.length > before || at === undefined || handoffId === undefined) return undefined;
    return { kind, at, handoffId };
  }
  if (kind === "delivered") {
    const cites = requireArrayOf(value.cites, `${path}.cites`, issues, readGroundCitation);
    if (issues.length > before || at === undefined || cites === undefined) return undefined;
    return { kind, at, cites };
  }
  const namedReason = requireString(value.namedReason, `${path}.namedReason`, issues, { minLength: 1 });
  const grounds = requireArrayOf(value.grounds, `${path}.grounds`, issues, readGroundCitation);
  if (issues.length > before || at === undefined || namedReason === undefined || grounds === undefined) return undefined;
  return { kind, at, namedReason, grounds };
}

function readAnswerRecord(value: unknown, path: string, issues: ValidationIssue[]): AnswerRecord | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const requestId = requireString(value.requestId, `${path}.requestId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const receivedAt = requireTimestamp(value.receivedAt, `${path}.receivedAt`, issues);
  const outcome = readAnswerOutcome(value.outcome, `${path}.outcome`, issues);
  if (issues.length > before) return undefined;
  if (requestId === undefined || subjectId === undefined || actorId === undefined || receivedAt === undefined || outcome === undefined) {
    return undefined;
  }
  return { requestId, subjectId, actorId, receivedAt, outcome };
}

function readObligationRecord(value: unknown, path: string, issues: ValidationIssue[]): ObligationRecord | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const obligationId = requireString(value.obligationId, `${path}.obligationId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const register = requireString(value.register, `${path}.register`, issues, { minLength: 1 });
  const firedAt = requireTimestamp(value.firedAt, `${path}.firedAt`, issues);
  const minutes = readWholeMinutes(value.window, `${path}.window`, issues);
  if (issues.length > before) return undefined;
  if (obligationId === undefined || subjectId === undefined || register === undefined || firedAt === undefined || minutes === undefined) {
    return undefined;
  }
  return { obligationId, subjectId, register, firedAt, window: { minutes } };
}

function readDeliveryProof(value: unknown, path: string, issues: ValidationIssue[]): DeliveryProof | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const obligationId = requireString(value.obligationId, `${path}.obligationId`, issues, { minLength: 1 });
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const observedAt = requireTimestamp(value.observedAt, `${path}.observedAt`, issues);
  const transportRef = requireString(value.transportRef, `${path}.transportRef`, issues, { minLength: 1 });
  if (!isOneOf(value.state, DELIVERY_STATES)) {
    pushIssue(issues, `${path}.state`, `must be one of ${DELIVERY_STATES.join(", ")}`);
  }
  if (issues.length > before) return undefined;
  if (obligationId === undefined || actorId === undefined || observedAt === undefined || transportRef === undefined) return undefined;
  return { obligationId, actorId, state: value.state as DeliveryState, observedAt, transportRef };
}

/** Validates one untyped `HandoffRecord`. Never throws. */
export function validateHandoffRecord(value: unknown): ValidationResult<HandoffRecord> {
  const issues: ValidationIssue[] = [];
  return result(readHandoffRecord(value, "(root)", issues), issues);
}

/** Validates an untyped array of `HandoffRecord`s. Never throws. */
export function validateHandoffRecords(value: unknown): ValidationResult<HandoffRecord[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readHandoffRecord), issues);
}

/** Validates an untyped array of `PlacementRecord`s. Never throws. */
export function validatePlacementRecords(value: unknown): ValidationResult<PlacementRecord[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readPlacementRecord), issues);
}

/** Validates one untyped `AnswerRecord`. Never throws. */
export function validateAnswerRecord(value: unknown): ValidationResult<AnswerRecord> {
  const issues: ValidationIssue[] = [];
  return result(readAnswerRecord(value, "(root)", issues), issues);
}

/** Validates an untyped array of `AnswerRecord`s. Never throws. */
export function validateAnswerRecords(value: unknown): ValidationResult<AnswerRecord[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readAnswerRecord), issues);
}

/** Validates an untyped array of `RetainedGround`s. Never throws. */
export function validateRetainedGrounds(value: unknown): ValidationResult<RetainedGround[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readRetainedGround), issues);
}

/** Validates one untyped `ObligationRecord`. Never throws. */
export function validateObligationRecord(value: unknown): ValidationResult<ObligationRecord> {
  const issues: ValidationIssue[] = [];
  return result(readObligationRecord(value, "(root)", issues), issues);
}

/** Validates an untyped array of `ObligationRecord`s. Never throws. */
export function validateObligationRecords(value: unknown): ValidationResult<ObligationRecord[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readObligationRecord), issues);
}

/** Validates an untyped array of `DeliveryProof`s. Never throws. */
export function validateDeliveryProofs(value: unknown): ValidationResult<DeliveryProof[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readDeliveryProof), issues);
}

/** Convenience guard over `validateHandoffRecord`, for callers that only need the boolean answer at a type boundary. */
export function isHandoffRecord(value: unknown): value is HandoffRecord {
  return validateHandoffRecord(value).ok;
}

/** Convenience guard over `validateAnswerRecord`. */
export function isAnswerRecord(value: unknown): value is AnswerRecord {
  return validateAnswerRecord(value).ok;
}

/** Convenience guard over `validateObligationRecord`. */
export function isObligationRecord(value: unknown): value is ObligationRecord {
  return validateObligationRecord(value).ok;
}
