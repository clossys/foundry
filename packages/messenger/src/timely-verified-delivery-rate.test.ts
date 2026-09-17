import { describe, expect, it } from "vitest";
import { assessTimelyVerifiedDeliveryRate } from "./timely-verified-delivery-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(intentId: string, overrides: Record<string, unknown> = {}) {
  return {
    intentId,
    independent: true,
    deliveredWithinWindow: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${intentId}`),
    ...overrides,
  };
}

describe("assessTimelyVerifiedDeliveryRate", () => {
  it("returns indeterminate with a null rate when declaredIntents is empty, never 1", () => {
    const report = assessTimelyVerifiedDeliveryRate({ asOf: AS_OF, declaredIntents: [], observations: [] });
    expect(report).toMatchObject({
      metric: "timely verified delivery rate",
      state: "indeterminate",
      rate: null,
      evaluatedIntents: 0,
      timelyIntents: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-intents-empty");
  });

  it("returns satisfied with rate 1 when every due intent is independently delivered within window", () => {
    const report = assessTimelyVerifiedDeliveryRate({
      asOf: AS_OF,
      declaredIntents: [{ id: "intent-one" }, { id: "intent-two" }],
      observations: [observation("intent-one"), observation("intent-two")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedIntents).toBe(2);
  });

  it("returns violated when a due intent is independently observed late or missing", () => {
    const report = assessTimelyVerifiedDeliveryRate({
      asOf: AS_OF,
      declaredIntents: [{ id: "intent-one" }, { id: "intent-two" }],
      observations: [observation("intent-one"), observation("intent-two", { deliveredWithinWindow: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("intent-not-timely");
  });

  it("rejects reserved self-observers", () => {
    const report = assessTimelyVerifiedDeliveryRate({
      asOf: AS_OF,
      declaredIntents: [{ id: "intent-one" }],
      observations: [observation("intent-one", { observerRef: "@clossys/messenger" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
