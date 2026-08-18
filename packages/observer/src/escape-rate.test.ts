import { describe, expect, it } from "vitest";
import { computeEscapeRate, type LandedChangeOutcome } from "./escape-rate.js";
import type { Observation } from "./observation.js";

function outcome(
  gate: string,
  changeId: string,
  violation: Observation<Record<string, never>>,
): LandedChangeOutcome {
  return { gate, changeId, violation };
}

describe("computeEscapeRate", () => {
  it("returns a null rate and zero counts when no changes landed for the gate", () => {
    const report = computeEscapeRate("secret-scan", []);
    expect(report).toEqual({
      kind: "escape-rate",
      gate: "secret-scan",
      landedCount: 0,
      escapedCount: 0,
      cleanCount: 0,
      couldNotReadCount: 0,
      rate: null,
    });
  });

  it("computes escaped / landed for a clean population", () => {
    const outcomes = [
      outcome("secret-scan", "pr-1", { state: "unobserved" }),
      outcome("secret-scan", "pr-2", { state: "unobserved" }),
    ];
    const report = computeEscapeRate("secret-scan", outcomes);
    expect(report.landedCount).toBe(2);
    expect(report.escapedCount).toBe(0);
    expect(report.rate).toBe(0);
  });

  it("counts a confirmed violation as an escape", () => {
    const outcomes = [
      outcome("secret-scan", "pr-1", { state: "observed" }),
      outcome("secret-scan", "pr-2", { state: "unobserved" }),
    ];
    const report = computeEscapeRate("secret-scan", outcomes);
    expect(report.escapedCount).toBe(1);
    expect(report.cleanCount).toBe(1);
    expect(report.rate).toBe(0.5);
  });

  it("reports could-not-read outcomes separately, never as clean", () => {
    const outcomes = [
      outcome("secret-scan", "pr-1", { state: "observed" }),
      outcome("secret-scan", "pr-2", { state: "could-not-read", note: "no audit record for this change" }),
    ];
    const report = computeEscapeRate("secret-scan", outcomes);
    expect(report.couldNotReadCount).toBe(1);
    expect(report.cleanCount).toBe(0);
    // landedCount still includes the unreadable row: it landed, we just
    // cannot say whether it violated the rule.
    expect(report.landedCount).toBe(2);
    expect(report.rate).toBe(0.5);
  });

  it("filters outcomes to only the requested gate", () => {
    const outcomes = [
      outcome("secret-scan", "pr-1", { state: "observed" }),
      outcome("task-record", "pr-2", { state: "observed" }),
    ];
    const report = computeEscapeRate("secret-scan", outcomes);
    expect(report.landedCount).toBe(1);
    expect(report.escapedCount).toBe(1);
  });
});
