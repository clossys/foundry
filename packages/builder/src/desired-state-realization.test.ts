import { describe, expect, it } from "vitest";
import { assessDesiredStateRealizationRate } from "./desired-state-realization.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(subjectId: string, overrides: Record<string, unknown> = {}) {
  return {
    subjectId,
    independent: true,
    verified: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${subjectId}`),
    ...overrides,
  };
}

describe("assessDesiredStateRealizationRate", () => {
  it("returns indeterminate with a null rate when declaredSubjects is empty", () => {
    const report = assessDesiredStateRealizationRate({ asOf: AS_OF, declaredSubjects: [], observations: [] });
    expect(report).toMatchObject({
      metric: "desired-state realization rate",
      state: "indeterminate",
      rate: null,
      evaluatedSubjects: 0,
      realizedSubjects: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-subjects-empty");
  });

  it("returns satisfied with rate 1 when every declared subject is independently verified", () => {
    const report = assessDesiredStateRealizationRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }, { id: "subject-two" }],
      observations: [observation("subject-one"), observation("subject-two")],
    });
    expect(report).toEqual({
      metric: "desired-state realization rate",
      state: "satisfied",
      rate: 1,
      evaluatedSubjects: 2,
      realizedSubjects: 2,
      findings: [],
      proposedPositions: [],
    });
  });

  it("returns violated with a fractional rate when some evaluated subjects are not realized", () => {
    const report = assessDesiredStateRealizationRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }, { id: "subject-two" }],
      observations: [
        observation("subject-one"),
        observation("subject-two", { verified: false }),
      ],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.evaluatedSubjects).toBe(2);
    expect(report.realizedSubjects).toBe(1);
    expect(report.findings.map((item) => item.rule)).toContain("subject-not-realized");
  });

  it("returns violated when a declared subject has no counting observation, even if the evaluated rate is 1", () => {
    const report = assessDesiredStateRealizationRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }, { id: "subject-two" }],
      observations: [observation("subject-one")],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(1);
    expect(report.evaluatedSubjects).toBe(1);
    expect(report.findings.map((item) => item.rule)).toContain("subject-unevaluated");
  });

  it("rejects reserved self-observers and never treats them as independent evidence", () => {
    const report = assessDesiredStateRealizationRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }],
      observations: [observation("subject-one", { observerRef: "@clossys/builder" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
