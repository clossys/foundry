/**
 * Redaction as a tested contract, not a setting.
 *
 * Redaction has already been found INERT in a shipped configuration in this
 * fleet — configured, believed working, doing nothing. A comment asserting
 * "this field is redacted" is exactly the kind of claim that shipped
 * unverified last time; it costs nothing to write and proves nothing.
 *
 * The actual contract lives in two places that must never drift apart:
 *
 *   1. `redactEvent` — the one function that turns a `TelemetryEvent` into
 *      a copy with every `redactedFields` key overwritten.
 *   2. `serializeEventAsJSON` / `serializeEventAsLogLine` /
 *      `serializeEventAsCsvRow` — the ONLY three ways this package turns an
 *      event into text, and each one calls `redactEvent` internally before
 *      touching a single field. There is no exported serialization path
 *      that skips it. A caller cannot forget to redact by calling the
 *      "wrong" function, because every function this package exports for
 *      turning an event into a string already does it.
 *
 * `redaction.test.ts` is the actual proof: it constructs an event with a
 * secret-shaped value in a redacted field, serializes it through every one
 * of these three functions, and asserts the secret string is not a
 * substring of any output — not "redaction ran without throwing," but "the
 * value cannot be found." That is the bar a comment can never clear.
 */
import type { TelemetryAttributeValue, TelemetryEvent } from "./telemetry.js";

/** What a redacted attribute's value becomes. Never derived from the original value. */
export const REDACTION_PLACEHOLDER = "[REDACTED]";

/** Returns a copy of `event` with every key named in `redactedFields` overwritten with `REDACTION_PLACEHOLDER`. */
export function redactEvent(event: TelemetryEvent): TelemetryEvent {
  if (event.redactedFields.length === 0) return event;

  const attributes: Record<string, TelemetryAttributeValue> = { ...event.attributes };
  for (const field of event.redactedFields) {
    if (Object.prototype.hasOwnProperty.call(attributes, field)) {
      attributes[field] = REDACTION_PLACEHOLDER;
    }
  }
  return { ...event, attributes };
}

/** JSON serialization. Always redacts first — there is no raw-JSON export from this package. */
export function serializeEventAsJSON(event: TelemetryEvent): string {
  return JSON.stringify(redactEvent(event));
}

/** A single-line, human-scannable log form. Always redacts first. */
export function serializeEventAsLogLine(event: TelemetryEvent): string {
  const redacted = redactEvent(event);
  const attributePairs = Object.entries(redacted.attributes)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  return `${redacted.occurredAt} ${redacted.subject} ${redacted.kind} id=${redacted.id}${
    attributePairs ? ` ${attributePairs}` : ""
  }`;
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** A CSV row form. Always redacts first. */
export function serializeEventAsCsvRow(event: TelemetryEvent): string {
  const redacted = redactEvent(event);
  const cells = [
    redacted.id,
    redacted.subject,
    redacted.kind,
    redacted.occurredAt,
    JSON.stringify(redacted.attributes),
  ];
  return cells.map(escapeCsvCell).join(",");
}

/** Every serialization form this package ships, for a caller (or a test) that wants to check all of them at once. */
export function serializeEventAllForms(event: TelemetryEvent): readonly string[] {
  return [serializeEventAsJSON(event), serializeEventAsLogLine(event), serializeEventAsCsvRow(event)];
}
