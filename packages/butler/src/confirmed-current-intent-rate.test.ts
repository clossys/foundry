import { describe, expect, it } from "vitest";
import { assessConfirmedCurrentIntentRate } from "./confirmed-current-intent-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(intentId: string, overrides: Record<string, unknown> = {}) {
  return {
    intentId,
    independent: true,
    confirmed: true,
    current: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${intentId}`),
    ...overrides,
  };
}

describe("assessConfirmedCurrentIntentRate", () => {
  it("returns indeterminate with a null rate when declaredIntents is empty, never 1", () => {
    const report = assessConfirmedCurrentIntentRate({ asOf: AS_OF, declaredIntents: [], observations: [] });
    expect(report).toMatchObject({
      metric: "confirmed current intent rate",
      state: "indeterminate",
      rate: null,
      evaluatedIntents: 0,
      confirmedCurrentIntents: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-intents-empty");
  });

  it("returns satisfied with rate 1 when every acted request and standing-instruction use is confirmed and current", () => {
    const report = assessConfirmedCurrentIntentRate({
      asOf: AS_OF,
      declaredIntents: [
        { id: "intent-one", kind: "acted-request" },
        { id: "intent-two", kind: "standing-instruction-use" },
      ],
      observations: [observation("intent-one"), observation("intent-two")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedIntents).toBe(2);
  });

  it("returns violated when a declared intent is independently observed without current confirmation", () => {
    const report = assessConfirmedCurrentIntentRate({
      asOf: AS_OF,
      declaredIntents: [
        { id: "intent-one", kind: "acted-request" },
        { id: "intent-two", kind: "standing-instruction-use" },
      ],
      observations: [observation("intent-one"), observation("intent-two", { current: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("intent-not-confirmed-current");
  });

  it("rejects reserved self-observers", () => {
    const report = assessConfirmedCurrentIntentRate({
      asOf: AS_OF,
      declaredIntents: [{ id: "intent-one", kind: "acted-request" }],
      observations: [observation("intent-one", { observerRef: "@clossys/butler" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });

  it("does not count confirmation without current, or current without confirmation", () => {
    const unconfirmed = assessConfirmedCurrentIntentRate({
      asOf: AS_OF,
      declaredIntents: [{ id: "intent-one", kind: "acted-request" }],
      observations: [observation("intent-one", { confirmed: false, current: true })],
    });
    expect(unconfirmed.state).toBe("violated");
    expect(unconfirmed.rate).toBe(0);

    const stale = assessConfirmedCurrentIntentRate({
      asOf: AS_OF,
      declaredIntents: [{ id: "intent-one", kind: "standing-instruction-use" }],
      observations: [observation("intent-one", { confirmed: true, current: false })],
    });
    expect(stale.state).toBe("violated");
    expect(stale.rate).toBe(0);
  });
});
