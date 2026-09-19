// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assessDesignConformanceRate } from "./design-conformance-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(surfaceId: string, overrides: Record<string, unknown> = {}) {
  return {
    surfaceId,
    independent: true,
    tokenConforming: true,
    brandConforming: true,
    structureConforming: true,
    accessibilityConforming: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${surfaceId}`),
    ...overrides,
  };
}

describe("assessDesignConformanceRate", () => {
  it("returns indeterminate with a null rate when declaredSurfaces is empty, never 1", () => {
    const report = assessDesignConformanceRate({ asOf: AS_OF, declaredSurfaces: [], observations: [] });
    expect(report).toMatchObject({
      metric: "design conformance rate",
      state: "indeterminate",
      rate: null,
      evaluatedSurfaces: 0,
      conformingSurfaces: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-surfaces-empty");
  });

  it("returns satisfied with rate 1 when every surface meets all four constraints", () => {
    const report = assessDesignConformanceRate({
      asOf: AS_OF,
      declaredSurfaces: [{ id: "surface-one" }, { id: "surface-two" }],
      observations: [observation("surface-one"), observation("surface-two")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedSurfaces).toBe(2);
  });

  it("returns violated when any conjunct of the AND fails", () => {
    const report = assessDesignConformanceRate({
      asOf: AS_OF,
      declaredSurfaces: [{ id: "surface-one" }, { id: "surface-two" }],
      observations: [observation("surface-one"), observation("surface-two", { accessibilityConforming: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("surface-not-conforming");
  });

  it("rejects reserved self-observers", () => {
    const report = assessDesignConformanceRate({
      asOf: AS_OF,
      declaredSurfaces: [{ id: "surface-one" }],
      observations: [observation("surface-one", { observerRef: "@clossys/designer" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
