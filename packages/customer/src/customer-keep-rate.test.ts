import { describe, expect, it } from "vitest";
import { assessCustomerKeepRate } from "./customer-keep-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(candidateId: string, overrides: Record<string, unknown> = {}) {
  return {
    candidateId,
    independent: true,
    inhabited: true,
    kept: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${candidateId}`),
    ...overrides,
  };
}

describe("assessCustomerKeepRate", () => {
  it("returns indeterminate with a null rate when declaredCandidates is empty, never 1", () => {
    const report = assessCustomerKeepRate({ asOf: AS_OF, declaredCandidates: [], observations: [] });
    expect(report).toMatchObject({
      metric: "customer keep rate",
      state: "indeterminate",
      rate: null,
      evaluatedCandidates: 0,
      keptCandidates: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-candidates-empty");
  });

  it("returns satisfied with rate 1 when every declared candidate was kept", () => {
    const report = assessCustomerKeepRate({
      asOf: AS_OF,
      declaredCandidates: [{ id: "candidate-one" }, { id: "candidate-two" }],
      observations: [observation("candidate-one"), observation("candidate-two")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedCandidates).toBe(2);
  });

  it("returns violated when any declared candidate was not kept", () => {
    const report = assessCustomerKeepRate({
      asOf: AS_OF,
      declaredCandidates: [{ id: "candidate-one" }, { id: "candidate-two" }],
      observations: [observation("candidate-one"), observation("candidate-two", { kept: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("candidate-not-kept");
  });

  it("rejects reserved self-observers and does not count them", () => {
    const report = assessCustomerKeepRate({
      asOf: AS_OF,
      declaredCandidates: [{ id: "candidate-one" }],
      observations: [observation("candidate-one", { observerRef: "@clossys/customer" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });

  it("does not count speed-dial testimony observations toward keep rate", () => {
    for (const intent of ["feedback", "compare", "refer", "churn", "adopt", "worth"]) {
      const report = assessCustomerKeepRate({
        asOf: AS_OF,
        declaredCandidates: [{ id: "candidate-one" }],
        observations: [observation("candidate-one", { intent, kept: true })],
      });
      expect(report.state).toBe("indeterminate");
      expect(report.rate).toBeNull();
      expect(report.findings.map((item) => item.rule)).toContain("candidate-unevaluated");
    }
  });
});
