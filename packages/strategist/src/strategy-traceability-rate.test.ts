import { describe, expect, it } from "vitest";
import { assessStrategyTraceabilityRate } from "./strategy-traceability-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(claimId: string, overrides: Record<string, unknown> = {}) {
  return {
    claimId,
    independent: true,
    currentEvidence: true,
    derived: true,
    approved: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${claimId}`),
    ...overrides,
  };
}

describe("assessStrategyTraceabilityRate", () => {
  it("returns indeterminate with a null rate when declaredClaims is empty, never 1", () => {
    const report = assessStrategyTraceabilityRate({ asOf: AS_OF, declaredClaims: [], observations: [] });
    expect(report).toMatchObject({
      metric: "strategy traceability rate",
      state: "indeterminate",
      rate: null,
      evaluatedClaims: 0,
      tracedClaims: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-claims-empty");
  });

  it("returns satisfied with rate 1 when every claim has current evidence, derivation, and approval", () => {
    const report = assessStrategyTraceabilityRate({
      asOf: AS_OF,
      declaredClaims: [{ id: "claim-one" }, { id: "claim-two" }],
      observations: [observation("claim-one"), observation("claim-two")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedClaims).toBe(2);
  });

  it("returns violated when any conjunct of the AND fails", () => {
    const report = assessStrategyTraceabilityRate({
      asOf: AS_OF,
      declaredClaims: [{ id: "claim-one" }, { id: "claim-two" }],
      observations: [observation("claim-one"), observation("claim-two", { approved: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("claim-not-traced");
  });

  it("rejects reserved self-observers", () => {
    const report = assessStrategyTraceabilityRate({
      asOf: AS_OF,
      declaredClaims: [{ id: "claim-one" }],
      observations: [observation("claim-one", { observerRef: "@clossys/strategist" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
