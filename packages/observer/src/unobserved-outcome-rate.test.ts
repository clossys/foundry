import { describe, expect, it } from "vitest";
import { assessUnobservedOutcomeRate } from "./unobserved-outcome-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(subjectId: string, overrides: Record<string, unknown> = {}) {
  return {
    subjectId,
    independent: true,
    presence: { state: "observed", eventCount: 1 },
    observerRef: "observer-a",
    evidence: evidence(`evidence-${subjectId}`),
    ...overrides,
  };
}

describe("assessUnobservedOutcomeRate", () => {
  it("returns indeterminate with a null rate when declaredSubjects is empty, never a perfect 0", () => {
    const report = assessUnobservedOutcomeRate({ asOf: AS_OF, declaredSubjects: [], observations: [] });
    expect(report).toMatchObject({
      metric: "unobserved outcome rate",
      state: "indeterminate",
      rate: null,
      evaluatedSubjects: 0,
      unobservedSubjects: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-subjects-empty");
  });

  it("returns indeterminate when declaredSubjects is missing, never a perfect rate", () => {
    const report = assessUnobservedOutcomeRate({ asOf: AS_OF, observations: [observation("subject-one")] });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedSubjects).toBe(0);
    expect(report.unobservedSubjects).toBe(0);
  });

  it("returns satisfied with rate 0 when every declared subject is independently observed", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }, { id: "subject-two" }],
      observations: [observation("subject-one"), observation("subject-two")],
    });
    expect(report).toEqual({
      metric: "unobserved outcome rate",
      state: "satisfied",
      rate: 0,
      evaluatedSubjects: 2,
      unobservedSubjects: 0,
      findings: [],
      proposedPositions: [],
    });
  });

  it("returns violated with a fractional rate when one evaluated subject is unobserved", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }, { id: "subject-two" }],
      observations: [
        observation("subject-one"),
        observation("subject-two", { presence: { state: "unobserved" } }),
      ],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.evaluatedSubjects).toBe(2);
    expect(report.unobservedSubjects).toBe(1);
    expect(report.metric).toBe("unobserved outcome rate");
    expect(report.proposedPositions).toEqual([]);
    expect(report.findings.map((item) => item.rule)).toContain("subject-unobserved");
  });

  it("returns indeterminate when the only declared subject has no readable observation", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }],
      observations: [],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedSubjects).toBe(0);
    expect(report.unobservedSubjects).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("subject-unevaluated");
  });

  it("returns violated when a declared subject has no counting observation among a partial evaluated set", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }, { id: "subject-two" }],
      observations: [observation("subject-one")],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0);
    expect(report.evaluatedSubjects).toBe(1);
    expect(report.unobservedSubjects).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("subject-unevaluated");
  });

  it("does not count a reserved self-observer and records a finding", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }],
      observations: [observation("subject-one", { observerRef: "Observer" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedSubjects).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });

  it("does not count @clossys/observer as an independent observer", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }],
      observations: [observation("subject-one", { observerRef: "@clossys/observer" })],
    });
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
    expect(report.evaluatedSubjects).toBe(0);
    expect(report.state).toBe("indeterminate");
  });

  it("returns violated when a self-observation sits beside other evaluated subjects", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }, { id: "subject-two" }],
      observations: [
        observation("subject-one", { observerRef: "observer" }),
        observation("subject-two"),
      ],
    });
    expect(report.state).toBe("violated");
    expect(report.evaluatedSubjects).toBe(1);
    expect(report.rate).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
    expect(report.findings.map((item) => item.rule)).toContain("subject-unevaluated");
  });

  it("returns indeterminate for unreadable input", () => {
    for (const value of [null, undefined, "text", 1, true, []]) {
      const report = assessUnobservedOutcomeRate(value);
      expect(report.state, String(value)).toBe("indeterminate");
      expect(report.rate, String(value)).toBeNull();
      expect(report.evaluatedSubjects, String(value)).toBe(0);
      expect(report.unobservedSubjects, String(value)).toBe(0);
      expect(report.metric, String(value)).toBe("unobserved outcome rate");
      expect(report.proposedPositions, String(value)).toEqual([]);
    }
  });

  it("does not count independent !== true, invalid presence, missing evidence, or unknown subject ids", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }],
      observations: [
        observation("subject-one", { independent: false }),
        observation("subject-one", { independent: "true" }),
        observation("subject-one", { presence: { state: "could-not-read" } }),
        observation("subject-one", { presence: { state: "maybe" } }),
        observation("subject-one", { evidence: [] }),
        observation("subject-one", { evidence: undefined }),
        observation("unknown-subject"),
      ],
    });
    expect(report.evaluatedSubjects).toBe(0);
    expect(report.state).toBe("indeterminate");
    expect(report.findings.map((item) => item.rule)).toContain("unknown-subject");
  });

  it("treats duplicate declared ids as findings that cannot be satisfied", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }, { id: "subject-one" }],
      observations: [observation("subject-one")],
    });
    expect(report.findings.map((item) => item.rule)).toContain("duplicate-subject-id");
    expect(report.state).toBe("violated");
    expect(report.evaluatedSubjects).toBe(1);
    expect(report.unobservedSubjects).toBe(0);
  });

  it("treats disagreeing counting observations as could-not-read, not unobserved", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }],
      observations: [
        observation("subject-one", { observerRef: "observer-a" }),
        observation("subject-one", { observerRef: "observer-b", presence: { state: "unobserved" } }),
      ],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedSubjects).toBe(0);
    expect(report.unobservedSubjects).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("observation-disagreement");
    expect(report.findings.map((item) => item.rule)).toContain("subject-unevaluated");
  });

  it("cannot be satisfied when asOf is missing or uninterpretable", () => {
    const missing = assessUnobservedOutcomeRate({
      declaredSubjects: [{ id: "subject-one" }],
      observations: [observation("subject-one")],
    });
    expect(missing.findings.map((item) => item.rule)).toContain("assessment-as-of");
    expect(missing.state).toBe("violated");
    expect(missing.rate).toBe(0);

    const invalid = assessUnobservedOutcomeRate({
      asOf: "not-a-timestamp",
      declaredSubjects: [{ id: "subject-one" }],
      observations: [observation("subject-one")],
    });
    expect(invalid.findings.map((item) => item.rule)).toContain("assessment-as-of");
    expect(invalid.state).toBe("violated");
  });

  it("counts a could-not-read observation with a note as unevaluated, not unobserved", () => {
    const report = assessUnobservedOutcomeRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }, { id: "subject-two" }],
      observations: [
        observation("subject-one"),
        observation("subject-two", { presence: { state: "could-not-read", note: "store was not readable" } }),
      ],
    });
    expect(report.state).toBe("violated");
    expect(report.evaluatedSubjects).toBe(1);
    expect(report.unobservedSubjects).toBe(0);
    expect(report.rate).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("subject-unevaluated");
  });
});
