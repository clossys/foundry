/**
 * The want contract: what a person asked for right now, and what they told
 * us to keep doing.
 *
 * Two record families live here and they are deliberately not merged. An
 * INTENT is a single request, interpreted, carrying a confidence, and true
 * only until it has been acted on. A STANDING INSTRUCTION is a durable
 * answer that keeps speaking for the person until it expires or the policy
 * it answered is superseded. Both are consumer-authored data; nothing in
 * this package ships a value, a topic vocabulary, a jurisdiction rule, or
 * an obligation of its own.
 *
 * THE THREE-STATE MODEL, PRESERVED
 * ---------------------------------
 * `StandingState` is three states, not two. `"absent"` (never asked) is a
 * distinct value from `"denied"` (asked, refused), and neither is a
 * boolean. Collapsing them would make "never asked" indistinguishable from
 * a passing signal — the same absence-of-signal-looks-like-a-passing-signal
 * failure this repository already writes down for gate exit codes (see
 * this repository's own contribution guide, "Gate CLIs exit `0` clean,
 * `1` findings, `2` could not run"). `"granted"` and `"denied"` each carry
 * the policy version they answered and when; a bare boolean can carry
 * neither, which is exactly what turns a stored answer into an unauditable
 * guess instead of a record.
 *
 * A fourth value, `"stale"`, exists only as an EVALUATION status
 * (`StandingEvaluation`), never as a stored state — staleness is computed
 * by comparing a stored record against the policy in force and the clock,
 * so writing it down would be storing a derivation that starts rotting the
 * moment it is written.
 *
 * IDENTIFIERS
 * ------------
 * `subjectId` is the person the want belongs to; `actorId` is whoever or
 * whatever is acting. They are separate fields in every signature in this
 * package and are never unified, because "the system acted on its own
 * reading" and "the person asked for this" are the two things this whole
 * package exists to keep apart. Both are opaque host-owned references —
 * never an email address, a name, a phone number, or an IP. See
 * `audit-shape.check.ts` for the compile-time proof that the audit event
 * carries nothing else.
 *
 * Validation here is hand-rolled over `unknown`, with no schema library,
 * matching every other package in this workspace (see the root
 * `AGENTS.md`). These validators exist for the boundary where records
 * arrive as untyped JSON — a preference-centre route body, a file the CLI
 * reads, a value read back out of a host's own store — before anything
 * downstream is allowed to trust them.
 */

import {
  isOneOf,
  isPlainObject,
  pushIssue,
  optionalTimestamp,
  requireArrayOf,
  requireBoolean,
  requireNumber,
  requireString,
  requireTimestamp,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

// ------------------------------------------------------------ shared vocabulary

/**
 * Identifies which version of a policy document a record answers. A
 * standing instruction that cannot name what it answered cannot be shown
 * to have gone stale.
 */
export interface PolicyVersion {
  policyId: string;
  version: string;
}

/**
 * Consumer-defined; this package does not enumerate topics. A topic is
 * whatever a consumer's own policy defines ("marketing-email",
 * "contact-window", "language", ...) — nothing here needs it to be more
 * than a stable string used to key one subject's standing instructions.
 */
export type StandingTopic = string;

/**
 * Where a standing instruction came from. `"stated"` is the person's own
 * words. `"inferred"` is a reading of their behaviour, and an inferred
 * instruction is NEVER binding until they confirm it — see
 * `evaluateStandingInstruction` (`contract.ts`), which reports an
 * unconfirmed inference as `absent`, because an unconfirmed guess is not a
 * want we have.
 */
export type StandingProvenance = "stated" | "inferred";

/** Every provenance value, for a caller validating untyped input. */
export const STANDING_PROVENANCES: readonly StandingProvenance[] = ["stated", "inferred"];

/**
 * How long a stored answer keeps speaking for the person. Consumer-declared
 * per instruction, with NO default anywhere in this package: a window this
 * package invented would be this package authoring one of the consumer's
 * values, and a missing window silently read as "forever" is precisely the
 * open loop the currency gate exists to close.
 */
export interface CurrencyWindow {
  /** Whole days after `decidedAt` during which the answer is still current. */
  days: number;
}

/**
 * Three states, not two. See this file's header for why `"absent"` is a
 * value rather than the absence of one, and why neither `"granted"` nor
 * `"denied"` is a boolean.
 */
export type StandingState =
  | { kind: "absent" }
  | { kind: "denied"; policyVersion: PolicyVersion; decidedAt: string }
  | { kind: "granted"; policyVersion: PolicyVersion; decidedAt: string };

/** One durable answer, for one subject, on one topic. */
export interface StandingInstruction {
  /** Stable, host-owned id for this instruction. The currency gate joins usages to instructions on it. */
  instructionId: string;
  /** Host-owned identity reference — an opaque id, never raw personal data. */
  subjectId: string;
  topic: StandingTopic;
  state: StandingState;
  provenance: StandingProvenance;
  currency: CurrencyWindow;
  /** When the subject confirmed an INFERRED instruction. Absent on an unconfirmed inference; meaningless (and ignored) on a `"stated"` one. */
  confirmedAt?: string;
}

/**
 * The result of comparing a stored instruction against the policy in force
 * and the clock. `"stale"` means a stored answer no longer speaks for the
 * subject and they should be asked again; it carries WHY, because "the
 * policy moved" and "the window ran out" are different facts about the
 * same record and a consumer's re-ask copy will differ between them.
 *
 * `"absent"` likewise carries a reason. An unconfirmed inference and a
 * subject who was genuinely never asked are both "we do not have a want
 * here" — the same status, correctly — but they are not the same event,
 * and flattening them would hide the more interesting of the two.
 * `previousPolicyVersion` on a `"stale"` result is the version the stale
 * answer actually answered, not the current one; `"granted"`/`"denied"`
 * likewise report the version actually answered rather than echoing the
 * caller's current version back.
 */
export type StandingEvaluation =
  | { status: "absent"; reason: "no-record" | "unconfirmed-inference" }
  | { status: "stale"; reason: "policy-superseded" | "window-elapsed"; previousPolicyVersion: PolicyVersion; decidedAt: string }
  | { status: "granted"; policyVersion: PolicyVersion }
  | { status: "denied"; policyVersion: PolicyVersion };

/**
 * Governs whether a policy-version bump also invalidates a stored `denied`
 * record. Left as a caller-supplied value with **no default** in either
 * direction: whether a policy bump invalidates a prior refusal is a
 * jurisdiction judgment, and this package answers no jurisdiction
 * questions. A `granted` record always goes stale on a version bump
 * regardless of this flag; only the `denied` case is caller-decided.
 */
export interface StandingEvaluationPolicy {
  invalidateDenialOnPolicyBump: boolean;
}

/**
 * The three things a subject can do to their own standing instruction.
 * Every variant carries the `policyVersion` in force at the moment of the
 * action — including `withdraw`, so an audit event never has to guess one
 * or leave the field empty. There is no fourth, harder variant for
 * withdrawing, and no variant an actor can use to decide FOR a subject.
 */
export type StandingAction =
  | { kind: "grant"; topic: StandingTopic; policyVersion: PolicyVersion; currency: CurrencyWindow }
  | { kind: "deny"; topic: StandingTopic; policyVersion: PolicyVersion; currency: CurrencyWindow }
  | { kind: "withdraw"; topic: StandingTopic; policyVersion: PolicyVersion; currency: CurrencyWindow };

/**
 * `"reopened"` records that a subject reopened their preference surface —
 * audit-worthy on its own, independent of whether they changed anything.
 * `"policy-superseded"` and `"window-elapsed"` record that a stored answer
 * was found stale, by a policy bump and by the clock respectively.
 * `"confirmed"` and `"misread"` record the outcome of an intent read-back.
 * None of the last four is emitted by `decideStandingChange`, which only
 * ever emits `"granted"` / `"denied"` / `"withdrawn"`.
 */
export type StandingAuditEventType =
  | "granted"
  | "denied"
  | "withdrawn"
  | "reopened"
  | "policy-superseded"
  | "window-elapsed"
  | "confirmed"
  | "misread";

/** Every audit event type, for a caller validating untyped input. */
export const STANDING_AUDIT_EVENT_TYPES: readonly StandingAuditEventType[] = [
  "granted",
  "denied",
  "withdrawn",
  "reopened",
  "policy-superseded",
  "window-elapsed",
  "confirmed",
  "misread",
];

/**
 * An audit trail entry. Deliberately carries no raw personal-data field —
 * no email, no name, no phone, no address, no IP — only the opaque
 * `subjectId` and the separately-opaque `actorId`. `topic` is a
 * consumer-defined label, never itself personal data.
 * `src/audit-shape.check.ts` is a compile-time contract test that fails the
 * build if a personal-data-shaped key is ever added to this type.
 *
 * `previousPolicyVersion` is present only on a `"policy-superseded"` event;
 * every other type's `policyVersion` fully describes which version the
 * event pertains to on its own.
 */
export interface StandingAuditEvent {
  /** The subject the want belongs to. */
  subjectId: string;
  /** Whoever or whatever performed the action. Separate from `subjectId`, always. */
  actorId: string;
  topic: StandingTopic;
  type: StandingAuditEventType;
  policyVersion: PolicyVersion;
  occurredAt: string;
  previousPolicyVersion?: PolicyVersion;
}

/**
 * Host-implemented audit ledger. This package decides what an audit event
 * contains; the host decides where it is durably recorded. No
 * implementation of this interface ships here, and no person-attributable
 * record is ever written into this repository.
 */
export interface StandingAuditLedger {
  record(event: StandingAuditEvent): Promise<void>;
}

/**
 * Host-implemented storage port. This package does not choose a database,
 * a cookie, a session, or a file — that choice, and its durability
 * guarantees, belongs entirely to the host, and no concrete implementation
 * of this interface ships here.
 */
export interface StandingInstructionStore {
  read(subjectId: string, topic: StandingTopic): Promise<StandingInstruction | undefined>;
  write(instruction: StandingInstruction): Promise<void>;
  readAll(subjectId: string): Promise<readonly StandingInstruction[]>;
}

// ------------------------------------------------------------------- intents

/**
 * What happened to an interpreted intent. `"acted"` means something was
 * done in the world on the strength of this reading. `"handed-off"` means
 * it was explicitly given to a person instead — the only legitimate exit
 * for a reading the machine was not confident enough to act on.
 * `"awaiting-confirmation"` means it is still waiting on the subject's own
 * read-back and nothing has acted yet.
 */
export type IntentDisposition = "acted" | "handed-off" | "awaiting-confirmation";

/** Every disposition, for a caller validating untyped input. */
export const INTENT_DISPOSITIONS: readonly IntentDisposition[] = ["acted", "handed-off", "awaiting-confirmation"];

/**
 * One request, admitted on some channel and interpreted into a structured
 * reading.
 *
 * `confidence` is a first-class value on the record, not an
 * implementation detail left inside whichever model produced the reading:
 * a number in `[0, 1]` that a gate can read months later and compare
 * against the floor that was in force. `interpretation` is a
 * consumer-defined label for what the reading concluded — this package
 * never enumerates interpretations and never inspects the request text,
 * which is why no field here holds it.
 */
export interface IntentRecord {
  intentId: string;
  /** The person whose want this is. */
  subjectId: string;
  /** Whoever or whatever produced and dispositioned this reading. Separate from `subjectId`, always. */
  actorId: string;
  /** Consumer-defined label for what the reading concluded. */
  interpretation: string;
  /** `0`–`1` inclusive. Read against a declared floor; never against a floor this package invented. */
  confidence: number;
  observedAt: string;
  disposition: IntentDisposition;
}

/**
 * The subject's own answer to a read-back. Three outcomes, not two:
 * `"unclear"` is the person saying they cannot tell, which is a real,
 * distinct answer and must never be rounded up into `"confirmed"`.
 */
export type ConfirmationVerdict = "confirmed" | "misread" | "unclear";

/** Every verdict, for a caller validating untyped input. */
export const CONFIRMATION_VERDICTS: readonly ConfirmationVerdict[] = ["confirmed", "misread", "unclear"];

/** One read-back answered by the subject, naming the intent it answers. */
export interface ConfirmationRecord {
  intentId: string;
  subjectId: string;
  verdict: ConfirmationVerdict;
  confirmedAt: string;
}

/**
 * The declared confidence floor. Consumer-authored, with no default: this
 * package will not invent the number below which a reading is too weak to
 * act on, and a run that cannot find one refuses to run at all rather than
 * assume one.
 */
export interface ConfidenceFloor {
  /** `0`–`1` inclusive. A reading strictly below this may not be acted on silently. */
  minimumConfidence: number;
}

/**
 * One occasion on which a standing instruction was actually relied on.
 * This is the observation half of the loop: an instruction that is written
 * and never re-checked is an open loop, and a usage record is what closes
 * it — the currency gate reads these, not the instructions alone.
 *
 * `currentPolicyVersion` is the version in force AT THE MOMENT OF USE, not
 * today's; that is what makes this record replayable rather than a
 * derivation that changes every time it is read.
 */
export interface InstructionUsage {
  instructionId: string;
  actorId: string;
  usedAt: string;
  currentPolicyVersion: PolicyVersion;
}

// --------------------------------------------------------------- parity paths

/**
 * What one route through a consumer's own interface costs the person.
 * Deliberately three coarse, countable facts rather than a score: a
 * comparison that produces a number nobody can trace back to a step is not
 * evidence of anything.
 */
export interface PathCost {
  /** How many discrete actions the person takes, counted the same way on both sides of the comparison. */
  steps: number;
  /** Whether the route requires contacting a human (writing in, calling) rather than completing it themselves. */
  requiresContact: boolean;
  /** Whether the route requires an authenticated account. */
  requiresAccount: boolean;
}

/**
 * The grant route and the withdraw route for one topic on one surface,
 * measured the same way, so "withdrawing is no harder than granting" stops
 * being an assurance and becomes a comparison. `withdraw` is optional
 * precisely so its ABSENCE is representable and reportable — a surface
 * that offers no way out at all is the worst version of this defect, and a
 * required field would have made it unsayable.
 */
export interface PreferencePath {
  surfaceId: string;
  topic: StandingTopic;
  grant: PathCost;
  withdraw?: PathCost;
}

// ------------------------------------------------------------------ validators

function result<T>(value: T | undefined, issues: ValidationIssue[]): ValidationResult<T> {
  if (value === undefined || issues.length > 0) return { ok: false, issues };
  return { ok: true, value };
}

function readPolicyVersion(value: unknown, path: string, issues: ValidationIssue[]): PolicyVersion | undefined {
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

function readCurrencyWindow(value: unknown, path: string, issues: ValidationIssue[]): CurrencyWindow | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with a whole-number days field");
    return undefined;
  }
  const days = requireNumber(value.days, `${path}.days`, issues, { min: 0, integer: true });
  if (days === undefined) return undefined;
  return { days };
}

function readStandingState(value: unknown, path: string, issues: ValidationIssue[]): StandingState | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with a kind of absent, denied, or granted");
    return undefined;
  }
  const kind = value.kind;
  if (kind === "absent") return { kind: "absent" };
  if (kind !== "denied" && kind !== "granted") {
    pushIssue(issues, `${path}.kind`, 'must be "absent", "denied", or "granted"');
    return undefined;
  }
  const before = issues.length;
  const policyVersion = readPolicyVersion(value.policyVersion, `${path}.policyVersion`, issues);
  const decidedAt = requireTimestamp(value.decidedAt, `${path}.decidedAt`, issues);
  if (issues.length > before || policyVersion === undefined || decidedAt === undefined) return undefined;
  return { kind, policyVersion, decidedAt };
}

function readStandingInstruction(value: unknown, path: string, issues: ValidationIssue[]): StandingInstruction | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const instructionId = requireString(value.instructionId, `${path}.instructionId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const topic = requireString(value.topic, `${path}.topic`, issues, { minLength: 1 });
  const state = readStandingState(value.state, `${path}.state`, issues);
  const currency = readCurrencyWindow(value.currency, `${path}.currency`, issues);
  const confirmedAt = optionalTimestamp(value.confirmedAt, `${path}.confirmedAt`, issues);
  if (!isOneOf(value.provenance, STANDING_PROVENANCES)) {
    pushIssue(issues, `${path}.provenance`, 'must be "stated" or "inferred"');
  }
  if (issues.length > before) return undefined;
  if (instructionId === undefined || subjectId === undefined || topic === undefined || state === undefined || currency === undefined) return undefined;
  return {
    instructionId,
    subjectId,
    topic,
    state,
    provenance: value.provenance as StandingProvenance,
    currency,
    ...(confirmedAt !== undefined ? { confirmedAt } : {}),
  };
}

function readIntentRecord(value: unknown, path: string, issues: ValidationIssue[]): IntentRecord | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const intentId = requireString(value.intentId, `${path}.intentId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const interpretation = requireString(value.interpretation, `${path}.interpretation`, issues, { minLength: 1 });
  const confidence = requireNumber(value.confidence, `${path}.confidence`, issues, { min: 0, max: 1 });
  const observedAt = requireTimestamp(value.observedAt, `${path}.observedAt`, issues);
  if (!isOneOf(value.disposition, INTENT_DISPOSITIONS)) {
    pushIssue(issues, `${path}.disposition`, 'must be "acted", "handed-off", or "awaiting-confirmation"');
  }
  if (issues.length > before) return undefined;
  if (
    intentId === undefined ||
    subjectId === undefined ||
    actorId === undefined ||
    interpretation === undefined ||
    confidence === undefined ||
    observedAt === undefined
  ) {
    return undefined;
  }
  return { intentId, subjectId, actorId, interpretation, confidence, observedAt, disposition: value.disposition as IntentDisposition };
}

function readConfirmationRecord(value: unknown, path: string, issues: ValidationIssue[]): ConfirmationRecord | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const intentId = requireString(value.intentId, `${path}.intentId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const confirmedAt = requireTimestamp(value.confirmedAt, `${path}.confirmedAt`, issues);
  if (!isOneOf(value.verdict, CONFIRMATION_VERDICTS)) {
    pushIssue(issues, `${path}.verdict`, 'must be "confirmed", "misread", or "unclear"');
  }
  if (issues.length > before) return undefined;
  if (intentId === undefined || subjectId === undefined || confirmedAt === undefined) return undefined;
  return { intentId, subjectId, verdict: value.verdict as ConfirmationVerdict, confirmedAt };
}

function readInstructionUsage(value: unknown, path: string, issues: ValidationIssue[]): InstructionUsage | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const instructionId = requireString(value.instructionId, `${path}.instructionId`, issues, { minLength: 1 });
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const usedAt = requireTimestamp(value.usedAt, `${path}.usedAt`, issues);
  const currentPolicyVersion = readPolicyVersion(value.currentPolicyVersion, `${path}.currentPolicyVersion`, issues);
  if (issues.length > before) return undefined;
  if (instructionId === undefined || actorId === undefined || usedAt === undefined || currentPolicyVersion === undefined) return undefined;
  return { instructionId, actorId, usedAt, currentPolicyVersion };
}

function readPathCost(value: unknown, path: string, issues: ValidationIssue[]): PathCost | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with steps, requiresContact and requiresAccount");
    return undefined;
  }
  const before = issues.length;
  const steps = requireNumber(value.steps, `${path}.steps`, issues, { min: 0, integer: true });
  const requiresContact = requireBoolean(value.requiresContact, `${path}.requiresContact`, issues);
  const requiresAccount = requireBoolean(value.requiresAccount, `${path}.requiresAccount`, issues);
  if (issues.length > before || steps === undefined || requiresContact === undefined || requiresAccount === undefined) return undefined;
  return { steps, requiresContact, requiresAccount };
}

function readPreferencePath(value: unknown, path: string, issues: ValidationIssue[]): PreferencePath | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const surfaceId = requireString(value.surfaceId, `${path}.surfaceId`, issues, { minLength: 1 });
  const topic = requireString(value.topic, `${path}.topic`, issues, { minLength: 1 });
  const grant = readPathCost(value.grant, `${path}.grant`, issues);
  const withdraw = value.withdraw === undefined ? undefined : readPathCost(value.withdraw, `${path}.withdraw`, issues);
  if (issues.length > before || surfaceId === undefined || topic === undefined || grant === undefined) return undefined;
  return { surfaceId, topic, grant, ...(withdraw !== undefined ? { withdraw } : {}) };
}

/** Validates one untyped `StandingInstruction`. Never throws. */
export function validateStandingInstruction(value: unknown): ValidationResult<StandingInstruction> {
  const issues: ValidationIssue[] = [];
  return result(readStandingInstruction(value, "(root)", issues), issues);
}

/** Validates an untyped array of `StandingInstruction`s. Never throws. */
export function validateStandingInstructions(value: unknown): ValidationResult<StandingInstruction[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readStandingInstruction), issues);
}

/** Validates one untyped `IntentRecord`. Never throws. */
export function validateIntentRecord(value: unknown): ValidationResult<IntentRecord> {
  const issues: ValidationIssue[] = [];
  return result(readIntentRecord(value, "(root)", issues), issues);
}

/** Validates an untyped array of `IntentRecord`s. Never throws. */
export function validateIntentRecords(value: unknown): ValidationResult<IntentRecord[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readIntentRecord), issues);
}

/** Validates one untyped `ConfirmationRecord`. Never throws. */
export function validateConfirmationRecord(value: unknown): ValidationResult<ConfirmationRecord> {
  const issues: ValidationIssue[] = [];
  return result(readConfirmationRecord(value, "(root)", issues), issues);
}

/** Validates an untyped array of `ConfirmationRecord`s. Never throws. */
export function validateConfirmationRecords(value: unknown): ValidationResult<ConfirmationRecord[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readConfirmationRecord), issues);
}

/** Validates an untyped array of `InstructionUsage`s. Never throws. */
export function validateInstructionUsages(value: unknown): ValidationResult<InstructionUsage[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readInstructionUsage), issues);
}

/** Validates an untyped array of `PreferencePath`s. Never throws. */
export function validatePreferencePaths(value: unknown): ValidationResult<PreferencePath[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readPreferencePath), issues);
}

/**
 * Validates an untyped `ConfidenceFloor`. Separate from the record
 * validators because the floor is not a record: it is the one declared
 * value the confirmation gate reads, and a run that cannot validate it
 * must decline rather than substitute one.
 */
export function validateConfidenceFloor(value: unknown): ValidationResult<ConfidenceFloor> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    pushIssue(issues, "(root)", "must be an object with a minimumConfidence field");
    return { ok: false, issues };
  }
  const minimumConfidence = requireNumber(value.minimumConfidence, "(root).minimumConfidence", issues, { min: 0, max: 1 });
  return result(minimumConfidence === undefined ? undefined : { minimumConfidence }, issues);
}

/** Validates an untyped `PolicyVersion`. Never throws. */
export function validatePolicyVersion(value: unknown): ValidationResult<PolicyVersion> {
  const issues: ValidationIssue[] = [];
  return result(readPolicyVersion(value, "(root)", issues), issues);
}

/** Convenience guard over `validateStandingInstruction`, for callers that only need the boolean answer at a type boundary. */
export function isStandingInstruction(value: unknown): value is StandingInstruction {
  return validateStandingInstruction(value).ok;
}

/** Convenience guard over `validateIntentRecord`. */
export function isIntentRecord(value: unknown): value is IntentRecord {
  return validateIntentRecord(value).ok;
}

/** Convenience guard over `validateConfirmationRecord`. */
export function isConfirmationRecord(value: unknown): value is ConfirmationRecord {
  return validateConfirmationRecord(value).ok;
}
