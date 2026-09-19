import { describe, expect, it } from "vitest";
import { assessVerifiedPublicationRate } from "./verified-publication-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(intentId: string, overrides: Record<string, unknown> = {}) {
  return {
    intentId,
    independent: true,
    audienceReleased: true,
    matchingImmutableRecord: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${intentId}`),
    ...overrides,
  };
}

describe("assessVerifiedPublicationRate", () => {
  it("returns indeterminate with a null rate when declaredIntents is empty, never 1", () => {
    const report = assessVerifiedPublicationRate({ asOf: AS_OF, declaredIntents: [], observations: [] });
    expect(report).toMatchObject({
      metric: "verified publication rate",
      state: "indeterminate",
      rate: null,
      evaluatedIntents: 0,
      verifiedIntents: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-intents-empty");
  });

  it("returns satisfied with rate 1 when every due intent is released and recorded", () => {
    const report = assessVerifiedPublicationRate({
      asOf: AS_OF,
      declaredIntents: [{ id: "intent-one" }, { id: "intent-two" }],
      observations: [observation("intent-one"), observation("intent-two")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedIntents).toBe(2);
  });

  it("returns violated when any conjunct of the AND fails", () => {
    const report = assessVerifiedPublicationRate({
      asOf: AS_OF,
      declaredIntents: [{ id: "intent-one" }, { id: "intent-two" }],
      observations: [observation("intent-one"), observation("intent-two", { matchingImmutableRecord: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("intent-not-verified");
  });

  it("rejects reserved self-observers", () => {
    const report = assessVerifiedPublicationRate({
      asOf: AS_OF,
      declaredIntents: [{ id: "intent-one" }],
      observations: [observation("intent-one", { observerRef: "@clossys/publisher" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
