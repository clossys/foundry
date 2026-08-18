import { describe, expect, it } from "vitest";
import { computeGateEfficacy, type GateRunHistoryRead, type GateRunRecord, type RunHistoryReader } from "./gate-efficacy.js";
import type { LandedChangeOutcome } from "./escape-rate.js";

function readerReturning(read: GateRunHistoryRead): RunHistoryReader {
  return { readRunHistory: () => read };
}

describe("computeGateEfficacy", () => {
  it("tallies ran/did-not-run and verdicts from an observed read", async () => {
    const records: readonly GateRunRecord[] = [
      { gate: "secret-scan", changeId: "pr-1", ran: true, verdict: "satisfied" },
      { gate: "secret-scan", changeId: "pr-2", ran: true, verdict: "satisfied" },
      { gate: "secret-scan", changeId: "pr-3", ran: true, verdict: "violated" },
      { gate: "secret-scan", changeId: "pr-4", ran: false },
    ];
    const reader = readerReturning({ state: "observed", records });

    const report = await computeGateEfficacy("secret-scan", reader, []);

    expect(report.state).toBe("observed");
    expect(report.ranCount).toBe(3);
    expect(report.didNotRunCount).toBe(1);
    expect(report.verdictCounts).toEqual({ satisfied: 2, violated: 1 });
  });

  it("filters records to only the requested gate", async () => {
    const records: readonly GateRunRecord[] = [
      { gate: "secret-scan", changeId: "pr-1", ran: true, verdict: "satisfied" },
      { gate: "task-record", changeId: "pr-1", ran: true, verdict: "satisfied" },
    ];
    const reader = readerReturning({ state: "observed", records });

    const report = await computeGateEfficacy("secret-scan", reader, []);

    expect(report.ranCount).toBe(1);
  });

  it("reports could-not-read with a note, and zero counts, rather than collapsing into a pass", async () => {
    const reader = readerReturning({
      state: "could-not-read",
      note: "the run-history API requires a credential this plane does not hold",
    });

    const report = await computeGateEfficacy("secret-scan", reader, []);

    expect(report.state).toBe("could-not-read");
    expect(report.note).toContain("credential");
    expect(report.ranCount).toBe(0);
    expect(report.didNotRunCount).toBe(0);
    expect(report.verdictCounts).toEqual({});
  });

  it("reports unobserved distinctly from could-not-read", async () => {
    const reader = readerReturning({ state: "unobserved" });

    const report = await computeGateEfficacy("secret-scan", reader, []);

    expect(report.state).toBe("unobserved");
    expect(report.note).toBeUndefined();
  });

  it("folds in the escape-rate metric computed from independently-supplied outcomes", async () => {
    const reader = readerReturning({ state: "observed", records: [] });
    const outcomes: readonly LandedChangeOutcome[] = [
      { gate: "secret-scan", changeId: "pr-1", violation: { state: "observed" } },
      { gate: "secret-scan", changeId: "pr-2", violation: { state: "unobserved" } },
    ];

    const report = await computeGateEfficacy("secret-scan", reader, outcomes);

    expect(report.escapeRate.kind).toBe("escape-rate");
    expect(report.escapeRate.landedCount).toBe(2);
    expect(report.escapeRate.escapedCount).toBe(1);
    expect(report.escapeRate.rate).toBe(0.5);
  });

  it("supports an async reader — the port may be backed by a real I/O call on the caller's side", async () => {
    const reader: RunHistoryReader = {
      readRunHistory: async (gate) => ({
        state: "observed",
        records: [{ gate, changeId: "pr-1", ran: true, verdict: "satisfied" }],
      }),
    };

    const report = await computeGateEfficacy("secret-scan", reader, []);

    expect(report.ranCount).toBe(1);
  });
});
