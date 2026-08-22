/**
 * Inbound admission doctrine — deliberately NOT an HTTP handler.
 *
 * This is the front door of the butler role: a request arrives on some
 * channel and has to be admitted before anything can be interpreted into
 * an intent. Admission is the only question answered here. Interpretation,
 * the confidence it carries, and the read-back that follows all live in
 * the root export (`../schema.js`, `../contract.js`); nothing in this file
 * reads a request's content, and no field here can hold one.
 *
 * The ownership split is the same one the storage and audit ports use at
 * the root: the host implements a ledger interface and owns the transport;
 * this package owns the decision logic on top of it.
 *
 * - The consumer owns the HTTP route, raw-body access, and SIGNATURE
 *   VERIFICATION. Signature schemes are provider-specific — this package
 *   cannot test a provider's signing algorithm against a real secret and
 *   must not pretend to verify what it cannot exercise.
 * - This package owns the ADMISSION DECISION: dedupe, ack/reject doctrine,
 *   replay tolerance, and ordering tolerance, all as a pure function of the
 *   caller's own verification result plus a ledger's dedupe answer.
 *
 * Zero runtime dependencies, matching the rest of this package.
 */

/**
 * The host implements durable, atomic dedupe against its own storage.
 * Inbound events are at-least-once and may be delivered more than once and out of order, so
 * `recordIfNew` must be a single atomic check-and-record operation — not a
 * separate existence check followed by a later insert, or two concurrent
 * deliveries of the same event can both observe `"new"`.
 */
export interface InboundEventLedger {
  recordIfNew(event: { readonly provider: string; readonly eventId: string }): Promise<"new" | "duplicate">;
}

/**
 * One inbound provider webhook event, prior to any admission decision.
 *
 * `signature` is the result of the caller's OWN signature verification —
 * there is no default and no third option that means "not checked yet".
 * An unverified event is not representable by omission: leaving the field
 * out is a type error, and any runtime value other than the literal
 * `"verified"` is treated as not verified.
 */
export interface InboundAdmissionInput {
  /** The provider's name for this event source (e.g. "resend"). Scopes dedupe together with `eventId`. */
  provider: string;
  /** Unique within the provider; required for dedupe. */
  eventId: string;
  /** The provider-reported event timestamp, as an ISO-8601 (or otherwise `Date`-parseable) string. */
  occurredAt: string;
  /** The result of the CALLER's own signature verification. No default. */
  signature: "verified" | "invalid";
}

/** Why a durably-accepted event was not handed off for processing. */
export type InboundAdmissionIgnoreReason =
  | { kind: "duplicate" }
  | { kind: "malformed"; field: string; message: string };

/**
 * The admission decision. Never a bare boolean — a caller must be able to
 * see and act on ack vs. process as two separate questions.
 *
 * Doctrine encoded here:
 * - **Ack on durable acceptance, not on successful processing.** A
 *   processing failure downstream of `action: "process"` is not a reason to
 *   have withheld the ack; it already happened.
 * - **Reject only on signature failure.** `ack: false` is reserved for
 *   `reason: "signature-invalid"` — every other rejection of work is
 *   expressed as `ack: true, action: "ignore"` so a provider is never told
 *   to keep retrying data that will never become processable.
 * - **A replay is an ack with `action: "ignore"`, never an error.**
 */
export type InboundAdmissionDecision =
  | { ack: true; action: "process" }
  | { ack: true; action: "ignore"; reason: InboundAdmissionIgnoreReason }
  | { ack: false; reason: "signature-invalid" };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isParseableTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

/**
 * Validate an admission input independently of dedupe. Returns either
 * `{ valid: true }` — proceed to the ledger — or `{ valid: false, decision
 * }` with the exact terminal decision to return without ever consulting a
 * ledger.
 *
 * Order matters: signature is checked first. An unverified caller's claims
 * about `eventId`, `provider`, or `occurredAt` are not trustworthy input,
 * so nothing past the signature check runs until it passes.
 */
function validateInboundAdmissionInput(
  input: InboundAdmissionInput,
): { valid: true } | { valid: false; decision: InboundAdmissionDecision } {
  // Anything other than the exact literal "verified" — including "invalid",
  // an unrecognized string, undefined, or any other malformed value — fails
  // closed the same way. There is no default and no way to express "not yet
  // checked" that reaches processing.
  if (input?.signature !== "verified") {
    return { valid: false, decision: { ack: false, reason: "signature-invalid" } };
  }
  if (!isNonEmptyString(input.provider)) {
    return {
      valid: false,
      decision: {
        ack: true,
        action: "ignore",
        reason: { kind: "malformed", field: "provider", message: "must be a non-empty string" },
      },
    };
  }
  if (!isNonEmptyString(input.eventId)) {
    return {
      valid: false,
      decision: {
        ack: true,
        action: "ignore",
        reason: { kind: "malformed", field: "eventId", message: "must be a non-empty string" },
      },
    };
  }
  if (!isParseableTimestamp(input.occurredAt)) {
    return {
      valid: false,
      decision: {
        ack: true,
        action: "ignore",
        reason: { kind: "malformed", field: "occurredAt", message: "must be a parseable timestamp" },
      },
    };
  }
  return { valid: true };
}

/**
 * The pure decision core, kept separate from the ledger round-trip so it is
 * directly testable with a plain `"new" | "duplicate"` value instead of a
 * mock ledger. `admitInboundEvent` below is the only caller that needs an
 * actual `InboundEventLedger`.
 */
export function decideInboundAdmission(
  input: InboundAdmissionInput,
  dedupe: "new" | "duplicate",
): InboundAdmissionDecision {
  const validation = validateInboundAdmissionInput(input);
  if (!validation.valid) return validation.decision;
  if (dedupe === "duplicate") {
    return { ack: true, action: "ignore", reason: { kind: "duplicate" } };
  }
  return { ack: true, action: "process" };
}

/**
 * Decide whether an inbound provider webhook event should be acknowledged
 * and, if so, whether it should be processed.
 *
 * This function does no I/O of its own beyond calling `ledger.recordIfNew`
 * once, and only after `input` has already passed structural and signature
 * validation — a malformed or unverified event never reaches the ledger.
 *
 * No input combination yields `{ ack: true, action: "process" }` unless
 * `input.signature === "verified"` AND the ledger reports the event as new.
 *
 * A THROWING LEDGER REJECTS THIS PROMISE, AND THAT IS THE CORRECT DECLINE
 * PATH — do not catch it and ack. This is the same three-state discipline
 * the gates keep at the other end of the package: "could not check" is
 * never reported as "checked and fine". Inbound does not own anything
 * yet: if durable dedupe could not be performed, this function
 * cannot know whether the event is a replay, so acking it would silently
 * discard an event that may never have been processed. Rejecting lets the
 * caller's route return a 5xx and the provider redeliver, which is exactly
 * what at-least-once delivery is for. Ack means "durably accepted"; an
 * unreachable ledger means nothing was durably accepted.
 */
export async function admitInboundEvent(
  input: InboundAdmissionInput,
  ledger: InboundEventLedger,
): Promise<InboundAdmissionDecision> {
  const validation = validateInboundAdmissionInput(input);
  if (!validation.valid) return validation.decision;
  const dedupe = await ledger.recordIfNew({ provider: input.provider, eventId: input.eventId });
  return decideInboundAdmission(input, dedupe);
}
