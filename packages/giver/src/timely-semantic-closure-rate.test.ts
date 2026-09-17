import { describe, expect, it } from "vitest";
import { assessTimelySemanticClosureRate } from "./timely-semantic-closure-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(itemId: string, overrides: Record<string, unknown> = {}) {
  return {
    itemId,
    independent: true,
    closedWithinWindow: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${itemId}`),
    ...overrides,
  };
}

describe("assessTimelySemanticClosureRate", () => {
  it("returns indeterminate with a null rate when declaredItems is empty, never 1", () => {
    const report = assessTimelySemanticClosureRate({ asOf: AS_OF, declaredItems: [], observations: [] });
    expect(report).toMatchObject({
      metric: "timely semantic closure rate",
      state: "indeterminate",
      rate: null,
      evaluatedItems: 0,
      closedItems: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-items-empty");
  });

  it("returns satisfied with rate 1 when every due request and obligation closed in window", () => {
    const report = assessTimelySemanticClosureRate({
      asOf: AS_OF,
      declaredItems: [
        { id: "request-one", kind: "due-request" },
        { id: "obligation-one", kind: "obligation" },
      ],
      observations: [observation("request-one"), observation("obligation-one")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedItems).toBe(2);
  });

  it("returns violated when one evaluated item did not close in window", () => {
    const report = assessTimelySemanticClosureRate({
      asOf: AS_OF,
      declaredItems: [
        { id: "request-one", kind: "due-request" },
        { id: "obligation-one", kind: "obligation" },
      ],
      observations: [observation("request-one"), observation("obligation-one", { closedWithinWindow: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("item-not-closed");
  });

  it("rejects reserved self-observers", () => {
    const report = assessTimelySemanticClosureRate({
      asOf: AS_OF,
      declaredItems: [{ id: "request-one", kind: "due-request" }],
      observations: [observation("request-one", { observerRef: "@clossys/giver" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
