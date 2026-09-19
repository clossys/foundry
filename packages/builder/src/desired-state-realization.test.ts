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

  it("behaves exactly as before when hubInventory is absent", () => {
    const report = assessDesiredStateRealizationRate({
      asOf: AS_OF,
      declaredSubjects: [{ id: "subject-one" }],
      observations: [observation("subject-one")],
    });
    expect(report).toEqual({
      metric: "desired-state realization rate",
      state: "satisfied",
      rate: 1,
      evaluatedSubjects: 1,
      realizedSubjects: 1,
      findings: [],
      proposedPositions: [],
    });
  });

  it("scopes reconciliation to inventoried repositories and flags unlisted ones", () => {
    const report = assessDesiredStateRealizationRate({
      asOf: AS_OF,
      hubInventory: { schemaVersion: 1, repositories: [{ id: "repo-a" }] },
      declaredSubjects: [
        { id: "subject-a", repositoryId: "repo-a" },
        { id: "subject-b", repositoryId: "repo-b" },
      ],
      observations: [observation("subject-a"), observation("subject-b")],
    });
    // subject-b is flagged unlisted and excluded from the denominator. The
    // run cannot be satisfied while an unlisted subject remains: the
    // finding is the signal, and rate/evaluated cover only listed subjects.
    expect(report).toMatchObject({ state: "violated", rate: 1, evaluatedSubjects: 1, realizedSubjects: 1 });
    expect(report.findings.map((item) => item.rule)).toEqual(["unlisted"]);
    expect(report.findings[0]?.message).toContain("subject-b");
    expect(report.findings[0]?.message).toContain("repo-b");
  });

  it("requires repositoryId on every declared subject when an inventory scopes the run", () => {
    const report = assessDesiredStateRealizationRate({
      asOf: AS_OF,
      hubInventory: { schemaVersion: 1, repositories: [{ id: "repo-a" }] },
      declaredSubjects: [{ id: "subject-one" }],
      observations: [observation("subject-one")],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("subject-repository-id-required");
  });

  it("never scopes when the supplied inventory is malformed, and says so", () => {
    for (const hubInventory of [null, { schemaVersion: 2, repositories: [] }, { schemaVersion: 1, repositories: [{ id: "" }] }, { schemaVersion: 1, repositories: "no" }]) {
      const report = assessDesiredStateRealizationRate({
        asOf: AS_OF,
        hubInventory,
        declaredSubjects: [{ id: "subject-one", repositoryId: "not-inventoried" }],
        observations: [observation("subject-one")],
      });
      expect(report.findings.map((item) => item.rule)).toContain("hub-inventory-shape");
      // All subjects stay in the denominator: the run is not scoped.
      expect(report.findings.map((item) => item.rule)).not.toContain("unlisted");
    }
  });
});
