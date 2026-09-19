import { describe, expect, it } from "vitest";
import { assessJustifiedVisibleHoldingRate } from "./justified-visible-holding-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(itemId: string, overrides: Record<string, unknown> = {}) {
  return {
    itemId,
    independent: true,
    attributed: true,
    subjectVisibleCorrectable: true,
    currentRetention: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${itemId}`),
    ...overrides,
  };
}

describe("assessJustifiedVisibleHoldingRate", () => {
  it("returns indeterminate with a null rate when declaredItems is empty, never 1", () => {
    const report = assessJustifiedVisibleHoldingRate({ asOf: AS_OF, declaredItems: [], observations: [] });
    expect(report).toMatchObject({
      metric: "justified visible holding rate",
      state: "indeterminate",
      rate: null,
      evaluatedItems: 0,
      justifiedVisibleItems: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-items-empty");
  });

  it("returns satisfied with rate 1 when every held item is attributed, visible-correctable, and current", () => {
    const report = assessJustifiedVisibleHoldingRate({
      asOf: AS_OF,
      declaredItems: [{ id: "item-one" }, { id: "item-two" }],
      observations: [observation("item-one"), observation("item-two")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedItems).toBe(2);
  });

  it("returns violated when any conjunct of the AND fails", () => {
    const report = assessJustifiedVisibleHoldingRate({
      asOf: AS_OF,
      declaredItems: [{ id: "item-one" }, { id: "item-two" }],
      observations: [observation("item-one"), observation("item-two", { currentRetention: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("item-not-justified-visible");
  });

  it("rejects reserved self-observers", () => {
    const report = assessJustifiedVisibleHoldingRate({
      asOf: AS_OF,
      declaredItems: [{ id: "item-one" }],
      observations: [observation("item-one", { observerRef: "@clossys/keeper" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
