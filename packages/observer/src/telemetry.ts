/**
 * The telemetry contract: the event shape every subject in the catalogue
 * emits against, a retention window, and the redaction rule declared
 * alongside the field it protects — never a setting configured elsewhere
 * and hoped to apply. See `redaction.ts` for why the rule ships with a test
 * that proves it, rather than a comment that asserts it.
 */

/** The only value shapes an attribute may hold. Deliberately not `unknown` — an
 * attribute this package cannot faithfully redact-and-serialize is one it
 * should refuse to accept, not one it accepts and mishandles later. */
export type TelemetryAttributeValue = string | number | boolean | null;

/**
 * One observed event. `redactedFields` is carried ON the event, not in a
 * side-channel setting: a field's redaction requirement travels with the
 * data it protects, so nothing downstream can serialize the event without
 * also knowing which fields must never leave in the clear.
 */
export interface TelemetryEvent {
  /** Stable identifier for this event. Opaque to this package. */
  readonly id: string;
  /** What produced this event — a gate id, a package name, a subject id. Opaque, caller-defined vocabulary. */
  readonly subject: string;
  /** The event's kind, e.g. "gate-run", "gate-conclusion", "change-landed". Opaque, caller-defined vocabulary. */
  readonly kind: string;
  /** ISO-8601 timestamp of when the underlying fact occurred, not when it was recorded. */
  readonly occurredAt: string;
  /** Arbitrary caller-defined attributes. */
  readonly attributes: Readonly<Record<string, TelemetryAttributeValue>>;
  /**
   * Attribute keys that MUST be redacted before this event leaves this
   * package's serialization functions. An attribute named here that is
   * absent from `attributes` is not an error — it is simply nothing to
   * redact.
   */
  readonly redactedFields: readonly string[];
}

/**
 * The retention window this contract declares: 90 days. Chosen as a
 * concrete, stated number rather than left to each consuming plane to
 * invent independently — a retention window nobody wrote down is a
 * retention window that silently becomes "forever" the first time nobody
 * remembers to prune. A consuming plane may declare a shorter window for
 * its own store; this is the contract's own default and the number
 * `isWithinRetentionWindow` checks against.
 */
export const TELEMETRY_RETENTION_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True when `occurredAt` falls inside the retention window measured back
 * from `now`. An `occurredAt` that fails to parse, or that lies in the
 * future relative to `now`, is never "within" — a malformed or
 * future-dated timestamp is not evidence of freshness, it is evidence the
 * event is untrustworthy.
 */
export function isWithinRetentionWindow(occurredAt: string, now: Date = new Date()): boolean {
  const eventTimeMs = Date.parse(occurredAt);
  if (Number.isNaN(eventTimeMs)) return false;
  const ageMs = now.getTime() - eventTimeMs;
  if (ageMs < 0) return false;
  return ageMs <= TELEMETRY_RETENTION_WINDOW_DAYS * MS_PER_DAY;
}

/** Says what is wrong with a candidate `TelemetryEvent`, or returns no problems for a well-formed one. */
export function validateTelemetryEvent(event: TelemetryEvent): readonly string[] {
  const problems: string[] = [];

  if (typeof event.id !== "string" || event.id.trim() === "") {
    problems.push("id must be a non-empty string.");
  }
  if (typeof event.subject !== "string" || event.subject.trim() === "") {
    problems.push("subject must be a non-empty string.");
  }
  if (typeof event.kind !== "string" || event.kind.trim() === "") {
    problems.push("kind must be a non-empty string.");
  }
  if (typeof event.occurredAt !== "string" || Number.isNaN(Date.parse(event.occurredAt))) {
    problems.push("occurredAt must be a parseable ISO-8601 timestamp.");
  }
  if (!Array.isArray(event.redactedFields)) {
    problems.push("redactedFields must be an array of attribute keys.");
  }
  if (event.attributes === null || typeof event.attributes !== "object" || Array.isArray(event.attributes)) {
    problems.push("attributes must be a plain object of attribute keys to values.");
  }

  return problems;
}
