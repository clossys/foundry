import { describe, expect, it } from "vitest";
import {
  TELEMETRY_RETENTION_WINDOW_DAYS,
  isWithinRetentionWindow,
  validateTelemetryEvent,
  type TelemetryEvent,
} from "./telemetry.js";

function event(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    id: "evt-1",
    subject: "gate:secret-scan",
    kind: "gate-run",
    occurredAt: "2026-08-01T00:00:00.000Z",
    attributes: {},
    redactedFields: [],
    ...overrides,
  };
}

describe("isWithinRetentionWindow", () => {
  const now = new Date("2026-08-18T00:00:00.000Z");

  it("is true for a timestamp inside the window", () => {
    expect(isWithinRetentionWindow("2026-08-01T00:00:00.000Z", now)).toBe(true);
  });

  it("is true exactly at the window boundary", () => {
    const boundary = new Date(now.getTime() - TELEMETRY_RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(isWithinRetentionWindow(boundary, now)).toBe(true);
  });

  it("is false just past the window boundary", () => {
    const pastBoundary = new Date(
      now.getTime() - (TELEMETRY_RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000 + 1),
    ).toISOString();
    expect(isWithinRetentionWindow(pastBoundary, now)).toBe(false);
  });

  it("is false for an unparseable timestamp", () => {
    expect(isWithinRetentionWindow("not-a-date", now)).toBe(false);
  });

  it("is false for a future timestamp — freshness is not evidence of validity", () => {
    expect(isWithinRetentionWindow("2026-08-19T00:00:00.000Z", now)).toBe(false);
  });
});

describe("validateTelemetryEvent", () => {
  it("accepts a well-formed event", () => {
    expect(validateTelemetryEvent(event())).toEqual([]);
  });

  it("rejects a missing id", () => {
    expect(validateTelemetryEvent(event({ id: "" }))).toContain("id must be a non-empty string.");
  });

  it("rejects an unparseable occurredAt", () => {
    const problems = validateTelemetryEvent(event({ occurredAt: "not-a-date" }));
    expect(problems.some((p) => p.includes("occurredAt"))).toBe(true);
  });

  it("rejects a non-array redactedFields", () => {
    const problems = validateTelemetryEvent(
      event({ redactedFields: "oops" as unknown as readonly string[] }),
    );
    expect(problems.some((p) => p.includes("redactedFields"))).toBe(true);
  });

  it("rejects a non-object attributes value", () => {
    const problems = validateTelemetryEvent(
      event({ attributes: null as unknown as TelemetryEvent["attributes"] }),
    );
    expect(problems.some((p) => p.includes("attributes"))).toBe(true);
  });
});
