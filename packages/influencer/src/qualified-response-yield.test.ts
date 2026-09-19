import { describe, expect, it } from "vitest";
import { assessQualifiedResponseYieldPerThousand } from "./qualified-response-yield.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id: string) {
  return [{ id, description: "Independent observation evidence." }];
}

function exposure(id: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "exposure",
    exposureId: id,
    independent: true,
    eligible: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${id}`),
    ...overrides,
  };
}

function response(id: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "response",
    responseId: id,
    independent: true,
    qualified: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${id}`),
    ...overrides,
  };
}

describe("assessQualifiedResponseYieldPerThousand", () => {
  it("returns indeterminate with a null yield when declaredExposures is empty, never a perfect yield", () => {
    const report = assessQualifiedResponseYieldPerThousand({
      asOf: AS_OF,
      setpointPerThousand: 50,
      declaredExposures: [],
      observations: [],
    });
    expect(report).toMatchObject({
      metric: "qualified response yield per thousand",
      state: "indeterminate",
      rate: null,
      eligibleExposures: 0,
      qualifiedResponses: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-exposures-empty");
  });

  it("returns satisfied when the per-thousand yield meets the setpoint", () => {
    const report = assessQualifiedResponseYieldPerThousand({
      asOf: AS_OF,
      setpointPerThousand: 50,
      declaredExposures: [{ id: "exposure-one" }, { id: "exposure-two" }],
      observations: [
        exposure("exposure-one"),
        exposure("exposure-two"),
        response("response-one"),
      ],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(500);
    expect(report.eligibleExposures).toBe(2);
    expect(report.qualifiedResponses).toBe(1);
  });

  it("returns violated when the yield is below the setpoint", () => {
    const report = assessQualifiedResponseYieldPerThousand({
      asOf: AS_OF,
      setpointPerThousand: 50,
      declaredExposures: [{ id: "exposure-one" }, { id: "exposure-two" }],
      observations: [exposure("exposure-one"), exposure("exposure-two")],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0);
    expect(report.qualifiedResponses).toBe(0);
  });

  it("rejects reserved self-observers", () => {
    const report = assessQualifiedResponseYieldPerThousand({
      asOf: AS_OF,
      setpointPerThousand: 50,
      declaredExposures: [{ id: "exposure-one" }],
      observations: [exposure("exposure-one", { observerRef: "@clossys/influencer" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
