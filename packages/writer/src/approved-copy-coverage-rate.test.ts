import { describe, expect, it } from "vitest";
import { assessApprovedCopyCoverageRate } from "./approved-copy-coverage-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(copyId: string, overrides: Record<string, unknown> = {}) {
  return {
    copyId,
    independent: true,
    approved: true,
    traceable: true,
    resolvedFromRegistry: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${copyId}`),
    ...overrides,
  };
}

describe("assessApprovedCopyCoverageRate", () => {
  it("returns indeterminate with a null rate when declaredCopy is empty, never 1", () => {
    const report = assessApprovedCopyCoverageRate({ asOf: AS_OF, declaredCopy: [], observations: [] });
    expect(report).toMatchObject({
      metric: "approved copy coverage rate",
      state: "indeterminate",
      rate: null,
      evaluatedCopy: 0,
      approvedCoveredCopy: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-copy-empty");
  });

  it("returns satisfied with rate 1 when every shipped copy is approved, traceable, and resolved", () => {
    const report = assessApprovedCopyCoverageRate({
      asOf: AS_OF,
      declaredCopy: [{ id: "copy-one" }, { id: "copy-two" }],
      observations: [observation("copy-one"), observation("copy-two")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedCopy).toBe(2);
  });

  it("returns violated when any conjunct of the AND fails", () => {
    const report = assessApprovedCopyCoverageRate({
      asOf: AS_OF,
      declaredCopy: [{ id: "copy-one" }, { id: "copy-two" }],
      observations: [observation("copy-one"), observation("copy-two", { resolvedFromRegistry: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("copy-not-covered");
  });

  it("rejects reserved self-observers", () => {
    const report = assessApprovedCopyCoverageRate({
      asOf: AS_OF,
      declaredCopy: [{ id: "copy-one" }],
      observations: [observation("copy-one", { observerRef: "@clossys/writer" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
