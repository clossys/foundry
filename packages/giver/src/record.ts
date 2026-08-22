/**
 * `@vespeneventures/giver/record` — the document seam, and the emitters
 * that turn one verdict into the records the gates read back.
 *
 * THE SEAM IS A DOCUMENT, NOT AN IMPORT
 * --------------------------------------
 * Whether a person has a standing instruction on file — granted, denied,
 * absent, or gone stale — is owned by the `butler` role, not by this one.
 * This package does not import that role, does not depend on it, and does
 * not restate its evaluation logic. It reads a DOCUMENT: a declared
 * filename (`STANDING_DECISIONS_DOCUMENT_FILENAME`), a declared schema
 * (`StandingDecisionDocument`), and JSON in between.
 *
 * That choice is deliberate and it costs something, so it is worth saying
 * why. An import would couple the send path to another package's release
 * cadence and let its internals leak into this one's decisions; worse, it
 * would make "the standing answer could not be determined" an exception
 * rather than a value. A document seam makes the failure mode explicit
 * instead: a file that is missing, unparseable, or does not validate
 * produces `unreadableStandingDecision(...)` — a first-class
 * `StandingRead` with status `"unreadable"` that `decideOutcome` routes to
 * a human. There is no code path from an unreadable document to a
 * delivery, and — this is the point — no way to write one, because
 * `DeliveryBasis` has no variant that would accept it.
 *
 * The document's own schema is a restatement of the producing role's
 * record shape, on purpose. Two independently-maintained copies of a
 * vocabulary agree only by luck, so the seam declares its version
 * (`STANDING_DECISIONS_SCHEMA_VERSION`) and refuses a document that
 * announces a different one, rather than reading unknown fields
 * optimistically.
 *
 * THE EMITTERS
 * -------------
 * `answerRecordFor` and `handoffRecordFor` turn a `Verdict` into exactly
 * the records the three gates later read. They exist so the decision and
 * the evidence of it cannot drift apart: a consumer that hand-wrote its
 * own records could record a delivery for a refused verdict, and nothing
 * downstream would ever know.
 *
 * `handoffRecordFor` is the one that matters most. It returns a record for
 * a `handed-off` verdict AND for a refusal whose grounds are an unplaceable
 * hand-off — because a hand-off nobody could take still happened, still
 * concerns a person who was told nothing, and must still reach the
 * placement gate, where it will be reported as raised and never picked up.
 * A refusal that swallowed its own hand-off would leave a clean record of a
 * request that quietly went nowhere.
 */

import type { Verdict } from "./contract.js";
import {
  readPolicyVersion,
  type AnswerRecord,
  type GroundCitation,
  type HandoffRecord,
  type PolicyVersion,
  type StandingRead,
} from "./schema.js";
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

// ------------------------------------------------------------------- the seam

/**
 * The declared filename this package expects the standing-decision
 * document at, relative to whatever directory the consumer nominates. A
 * bare filename, never an absolute path: where the directory lives is the
 * consumer's decision, and a path baked in here would be this package
 * describing someone else's machine.
 */
export const STANDING_DECISIONS_DOCUMENT_FILENAME = "standing-decisions.json";

/** The only `schemaVersion` this reader accepts. A document announcing any other version is refused, not read optimistically. */
export const STANDING_DECISIONS_SCHEMA_VERSION = 1;

/** The four statuses the producing role can report. `"unreadable"` is not among them — it is this side's own answer to a document it could not use. */
export const STANDING_DECISION_STATUSES = ["granted", "denied", "absent", "stale"] as const;

/** One subject's standing answer on one consumer-defined topic, as it appears in the seam document. */
export type StandingDecisionEntry = { subjectId: string; topic: string } & (
  | { status: "granted"; policyVersion: PolicyVersion; decidedAt: string }
  | { status: "denied"; policyVersion: PolicyVersion; decidedAt: string }
  | { status: "absent"; reason: string }
  | { status: "stale"; reason: string; previousPolicyVersion: PolicyVersion; decidedAt: string }
);

/** The whole document, as read off disk. */
export interface StandingDecisionDocument {
  schemaVersion: number;
  producedAt: string;
  decisions: StandingDecisionEntry[];
}

function readStandingDecisionEntry(value: unknown, path: string, issues: ValidationIssue[]): StandingDecisionEntry | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const topic = requireString(value.topic, `${path}.topic`, issues, { minLength: 1 });
  const status = value.status;
  if (!isOneOf(status, STANDING_DECISION_STATUSES)) {
    pushIssue(issues, `${path}.status`, `must be one of ${STANDING_DECISION_STATUSES.join(", ")}`);
    return undefined;
  }

  // Each status is required to carry its own companions. A "granted" entry
  // with no policy version is not read as a grant with the version left
  // out; it fails validation, and a document that fails validation becomes
  // an `unreadable` read rather than a permissive one.
  if (status === "granted" || status === "denied") {
    const policyVersion = readPolicyVersion(value.policyVersion, `${path}.policyVersion`, issues);
    const decidedAt = requireTimestamp(value.decidedAt, `${path}.decidedAt`, issues);
    if (issues.length > before || subjectId === undefined || topic === undefined || policyVersion === undefined || decidedAt === undefined) {
      return undefined;
    }
    return { subjectId, topic, status, policyVersion, decidedAt };
  }
  if (status === "stale") {
    const reason = requireString(value.reason, `${path}.reason`, issues, { minLength: 1 });
    const previousPolicyVersion = readPolicyVersion(value.previousPolicyVersion, `${path}.previousPolicyVersion`, issues);
    const decidedAt = requireTimestamp(value.decidedAt, `${path}.decidedAt`, issues);
    if (
      issues.length > before ||
      subjectId === undefined ||
      topic === undefined ||
      reason === undefined ||
      previousPolicyVersion === undefined ||
      decidedAt === undefined
    ) {
      return undefined;
    }
    return { subjectId, topic, status, reason, previousPolicyVersion, decidedAt };
  }
  const reason = requireString(value.reason, `${path}.reason`, issues, { minLength: 1 });
  if (issues.length > before || subjectId === undefined || topic === undefined || reason === undefined) return undefined;
  return { subjectId, topic, status, reason };
}

/**
 * Validates one untyped standing-decision document. Never throws.
 *
 * A document announcing a `schemaVersion` this reader does not know is a
 * validation failure, not a document read with best effort. The seam's
 * whole value is that both sides can name what they agreed on; reading an
 * unknown version anyway would give that up in exchange for nothing.
 */
export function validateStandingDecisionDocument(value: unknown): ValidationResult<StandingDecisionDocument> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    pushIssue(issues, "(root)", "must be an object with schemaVersion, producedAt and decisions");
    return { ok: false, issues };
  }
  const schemaVersion = requireNumber(value.schemaVersion, "(root).schemaVersion", issues, { integer: true, min: 0 });
  if (schemaVersion !== undefined && schemaVersion !== STANDING_DECISIONS_SCHEMA_VERSION) {
    pushIssue(issues, "(root).schemaVersion", `must be ${STANDING_DECISIONS_SCHEMA_VERSION}, got ${schemaVersion}`);
  }
  const producedAt = requireTimestamp(value.producedAt, "(root).producedAt", issues);
  const decisions = requireArrayOf(value.decisions, "(root).decisions", issues, readStandingDecisionEntry);
  if (issues.length > 0 || schemaVersion === undefined || producedAt === undefined || decisions === undefined) {
    return { ok: false, issues };
  }
  return { ok: true, value: { schemaVersion, producedAt, decisions } };
}

/**
 * The `StandingRead` a host produces when the seam document itself could
 * not be used — it does not exist, it is not readable, it is not JSON, or
 * it does not validate.
 *
 * This function is the entire reason the seam is safe. It is the only
 * thing a caller can construct out of a failed read, it is not a grant,
 * and `decideOutcome` routes it to a person. The alternative — the shape
 * this package was cut to repay — is an optional collaborator whose
 * absence resolves to `{ outcome: "allow" }`, which is how a host that
 * wired nothing ends up sending everything to everyone with no error
 * anywhere.
 */
export function unreadableStandingDecision(reason: string): StandingRead {
  return { status: "unreadable", reason };
}

/**
 * Finds one subject's standing answer on one topic.
 *
 * A document that simply has no entry for this subject and topic yields
 * `absent`, which is indeterminate and routes to a person — it is NOT a
 * grant and it is not a refusal either. "Nobody ever asked them" and "they
 * said no" stay different answers all the way through.
 */
export function readStandingDecision(document: StandingDecisionDocument, subjectId: string, topic: string): StandingRead {
  const entry = document.decisions.find((decision) => decision.subjectId === subjectId && decision.topic === topic);
  if (entry === undefined) {
    return { status: "absent", reason: `no entry for this subject and topic in a document produced at ${document.producedAt}` };
  }
  if (entry.status === "granted" || entry.status === "denied") {
    return { status: entry.status, policyVersion: entry.policyVersion, decidedAt: entry.decidedAt };
  }
  if (entry.status === "stale") {
    return { status: "stale", reason: entry.reason, previousPolicyVersion: entry.previousPolicyVersion, decidedAt: entry.decidedAt };
  }
  return { status: "absent", reason: entry.reason };
}

// ---------------------------------------------------------------- the emitters

/** Everything an `AnswerRecord` needs that the verdict itself does not carry. */
export interface AnswerRecordMeta {
  requestId: string;
  /** The person who asked. */
  subjectId: string;
  /** Whoever or whatever answered. Separate from `subjectId`, always. */
  actorId: string;
  receivedAt: string;
  /** The instant the outcome was reached. */
  at: string;
  /** What the answer or the refusal rested on. Empty is allowed here and is exactly what the grounding gate reports. */
  cites: readonly GroundCitation[];
}

function namedReasonFor(verdict: Extract<Verdict, { kind: "refused" }>): string {
  if (verdict.grounds.kind === "standing-refusal") {
    return `a standing refusal on record against policy ${verdict.grounds.policyVersion.policyId}@${verdict.grounds.policyVersion.version}, decided ${verdict.grounds.decidedAt}`;
  }
  return verdict.grounds.unplaced.namedReason;
}

/**
 * Turns one verdict into the answer record the grounding gate reads.
 *
 * The mapping is total and mechanical: there is no argument that lets a
 * caller record a `delivered` outcome for a verdict that refused, and a
 * refusal always carries a named reason derived from its own grounds
 * rather than one the caller supplies.
 */
export function answerRecordFor(verdict: Verdict, meta: AnswerRecordMeta): AnswerRecord {
  const base = { requestId: meta.requestId, subjectId: meta.subjectId, actorId: meta.actorId, receivedAt: meta.receivedAt };
  if (verdict.kind === "delivered") {
    return { ...base, outcome: { kind: "delivered", at: meta.at, cites: meta.cites } };
  }
  if (verdict.kind === "handed-off") {
    return { ...base, outcome: { kind: "handed-off", at: meta.at, handoffId: verdict.handoff.handoffId } };
  }
  return { ...base, outcome: { kind: "refused", at: meta.at, namedReason: namedReasonFor(verdict), grounds: meta.cites } };
}

/**
 * The hand-off record a verdict produced, if it produced one.
 *
 * Returns a record for a `handed-off` verdict and for a refusal whose
 * grounds are an unplaceable hand-off; `undefined` for a delivery and for
 * a refusal that rests on the person's own standing decision, neither of
 * which needed a human.
 *
 * The second case is the one worth being explicit about. When no human was
 * available the outcome is a refusal — and the hand-off is still recorded,
 * so the placement gate sees a hand-off that was raised and never picked
 * up. Dropping it would turn an unanswered person into a clean row.
 */
export function handoffRecordFor(verdict: Verdict): HandoffRecord | undefined {
  if (verdict.kind === "handed-off") return verdict.handoff;
  if (verdict.kind === "refused" && verdict.grounds.kind === "handoff-unplaceable") return verdict.grounds.unplaced.handoff;
  return undefined;
}
