import { describe, expect, it } from "vitest";
import {
  REDACTION_PLACEHOLDER,
  redactEvent,
  serializeEventAllForms,
  serializeEventAsCsvRow,
  serializeEventAsJSON,
  serializeEventAsLogLine,
} from "./redaction.js";
import type { TelemetryEvent } from "./telemetry.js";

/**
 * THE LOAD-BEARING TEST.
 *
 * Redaction has already been found INERT in a shipped configuration in this
 * fleet — configured, believed working, doing nothing. This suite exists to
 * make that specific failure impossible here: it constructs an event with a
 * secret-shaped value in a redacted field, serializes it through every form
 * this package can produce, and asserts the secret value is not a substring
 * of ANY output. Not "redaction ran without throwing" — the value must
 * actually be absent from the text, checked directly against the raw
 * output, never through the redaction function again (that would only prove
 * `redactEvent` agrees with itself).
 */

// Deliberately shaped like a real credential (GitHub personal access token
// format) so this test fails the same way a real leak would look, not a
// synthetic placeholder that no scanner would ever flag either way. This is
// not a real token — it is a fixture literal.
const SECRET_VALUE = "ghp_" + "A".repeat(36);

function eventWithSecret(): TelemetryEvent {
  return {
    id: "evt-secret-1",
    subject: "gate:secret-scan",
    kind: "gate-run",
    occurredAt: "2026-08-01T00:00:00.000Z",
    attributes: {
      token: SECRET_VALUE,
      changeId: "pr-1234",
      verdict: "satisfied",
    },
    redactedFields: ["token"],
  };
}

describe("redactEvent", () => {
  it("overwrites every redacted field with the placeholder", () => {
    const redacted = redactEvent(eventWithSecret());
    expect(redacted.attributes.token).toBe(REDACTION_PLACEHOLDER);
  });

  it("leaves non-redacted fields untouched", () => {
    const redacted = redactEvent(eventWithSecret());
    expect(redacted.attributes.changeId).toBe("pr-1234");
    expect(redacted.attributes.verdict).toBe("satisfied");
  });

  it("does not mutate the original event", () => {
    const original = eventWithSecret();
    redactEvent(original);
    expect(original.attributes.token).toBe(SECRET_VALUE);
  });

  it("is a no-op when redactedFields is empty", () => {
    const event = eventWithSecret();
    const clean = { ...event, redactedFields: [] };
    expect(redactEvent(clean)).toEqual(clean);
  });

  it("tolerates a redacted-field name that is not actually present in attributes", () => {
    const event = eventWithSecret();
    const withGhostField = { ...event, redactedFields: [...event.redactedFields, "doesNotExist"] };
    expect(() => redactEvent(withGhostField)).not.toThrow();
  });
});

describe("THE CONTRACT: a redacted field cannot survive serialization", () => {
  it("does not appear in the JSON form", () => {
    const output = serializeEventAsJSON(eventWithSecret());
    expect(output).not.toContain(SECRET_VALUE);
  });

  it("does not appear in the log-line form", () => {
    const output = serializeEventAsLogLine(eventWithSecret());
    expect(output).not.toContain(SECRET_VALUE);
  });

  it("does not appear in the CSV-row form", () => {
    const output = serializeEventAsCsvRow(eventWithSecret());
    expect(output).not.toContain(SECRET_VALUE);
  });

  it("does not appear in ANY form this package ships, checked as one assertion", () => {
    const outputs = serializeEventAllForms(eventWithSecret());
    for (const output of outputs) {
      expect(output).not.toContain(SECRET_VALUE);
    }
  });

  it("is not merely absent because everything was blanked — a non-redacted secret-shaped value DOES survive, proving the test is not vacuous", () => {
    // If this assertion failed, it would mean serialization blanks
    // everything indiscriminately, which would make the "does not
    // contain SECRET_VALUE" assertions above pass for the wrong reason —
    // not because redaction targeted the right field, but because nothing
    // survives serialization at all.
    const control = "ghp_" + "B".repeat(36);
    const withControlInNonRedactedField: TelemetryEvent = {
      ...eventWithSecret(),
      attributes: { ...eventWithSecret().attributes, controlValue: control },
    };
    const outputs = serializeEventAllForms(withControlInNonRedactedField);
    expect(outputs.some((output) => output.includes(control))).toBe(true);
  });

  it("still redacts the secret even in the same run where a control value survives", () => {
    const control = "ghp_" + "B".repeat(36);
    const withControlInNonRedactedField: TelemetryEvent = {
      ...eventWithSecret(),
      attributes: { ...eventWithSecret().attributes, controlValue: control },
    };
    const outputs = serializeEventAllForms(withControlInNonRedactedField);
    for (const output of outputs) {
      expect(output).not.toContain(SECRET_VALUE);
    }
  });

  it("redacts a secret-shaped value even when it is the only attribute on the event", () => {
    const minimal: TelemetryEvent = {
      id: "evt-secret-minimal",
      subject: "gate:secret-scan",
      kind: "gate-run",
      occurredAt: "2026-08-01T00:00:00.000Z",
      attributes: { token: SECRET_VALUE },
      redactedFields: ["token"],
    };
    for (const output of serializeEventAllForms(minimal)) {
      expect(output).not.toContain(SECRET_VALUE);
    }
  });

  it("the placeholder itself is present, proving the field was actively overwritten rather than dropped silently", () => {
    const output = serializeEventAsJSON(eventWithSecret());
    expect(output).toContain(REDACTION_PLACEHOLDER);
  });
});
