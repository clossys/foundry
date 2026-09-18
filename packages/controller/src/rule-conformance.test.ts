import { describe, expect, it } from "vitest";
import { assessRuleConformanceRate } from "./rule-conformance.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(ruleId: string, overrides: Record<string, unknown> = {}) {
  return {
    ruleId,
    independent: true,
    wellFormed: true,
    followed: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${ruleId}`),
    ...overrides,
  };
}

describe("assessRuleConformanceRate", () => {
  it("returns indeterminate with a null rate when declaredRules is empty", () => {
    const report = assessRuleConformanceRate({ asOf: AS_OF, declaredRules: [], observations: [] });
    expect(report).toMatchObject({
      metric: "rule conformance rate",
      state: "indeterminate",
      rate: null,
      evaluatedRules: 0,
      conformingRules: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-rules-empty");
  });

  it("returns indeterminate when declaredRules is missing, never a perfect rate", () => {
    const report = assessRuleConformanceRate({ asOf: AS_OF, observations: [observation("rule-one")] });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedRules).toBe(0);
    expect(report.conformingRules).toBe(0);
  });

  it("returns satisfied with rate 1 when every declared rule is independently observed well-formed and followed", () => {
    const report = assessRuleConformanceRate({
      asOf: AS_OF,
      declaredRules: [{ id: "rule-one" }, { id: "rule-two" }],
      observations: [observation("rule-one"), observation("rule-two")],
    });
    expect(report).toEqual({
      metric: "rule conformance rate",
      state: "satisfied",
      rate: 1,
      evaluatedRules: 2,
      conformingRules: 2,
      findings: [],
      proposedPositions: [],
    });
  });

  it("returns violated with a fractional rate when some evaluated rules are not conforming", () => {
    const report = assessRuleConformanceRate({
      asOf: AS_OF,
      declaredRules: [{ id: "rule-one" }, { id: "rule-two" }],
      observations: [
        observation("rule-one"),
        observation("rule-two", { wellFormed: true, followed: false }),
      ],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.evaluatedRules).toBe(2);
    expect(report.conformingRules).toBe(1);
    expect(report.metric).toBe("rule conformance rate");
    expect(report.proposedPositions).toEqual([]);
    expect(report.findings.map((item) => item.rule)).toContain("rule-not-conforming");
  });

  it("returns violated when a declared rule has no counting observation, even if the evaluated rate is 1", () => {
    const report = assessRuleConformanceRate({
      asOf: AS_OF,
      declaredRules: [{ id: "rule-one" }, { id: "rule-two" }],
      observations: [observation("rule-one")],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(1);
    expect(report.evaluatedRules).toBe(1);
    expect(report.conformingRules).toBe(1);
    expect(report.findings.map((item) => item.rule)).toContain("rule-unevaluated");
  });

  it("does not count a reserved self-observer and records a finding", () => {
    const report = assessRuleConformanceRate({
      asOf: AS_OF,
      declaredRules: [{ id: "rule-one" }],
      observations: [observation("rule-one", { observerRef: "Controller" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedRules).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });

  it("does not count @clossys/controller as an independent observer", () => {
    const report = assessRuleConformanceRate({
      asOf: AS_OF,
      declaredRules: [{ id: "rule-one" }],
      observations: [observation("rule-one", { observerRef: "@clossys/controller" })],
    });
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
    expect(report.evaluatedRules).toBe(0);
    expect(report.state).toBe("indeterminate");
  });

  it("returns indeterminate for unreadable input", () => {
    for (const value of [null, undefined, "text", 1, true, []]) {
      const report = assessRuleConformanceRate(value);
      expect(report.state, String(value)).toBe("indeterminate");
      expect(report.rate, String(value)).toBeNull();
      expect(report.evaluatedRules, String(value)).toBe(0);
      expect(report.conformingRules, String(value)).toBe(0);
      expect(report.metric, String(value)).toBe("rule conformance rate");
      expect(report.proposedPositions, String(value)).toEqual([]);
    }
  });

  it("does not count independent !== true, non-boolean flags, missing evidence, or unknown rule ids", () => {
    const report = assessRuleConformanceRate({
      asOf: AS_OF,
      declaredRules: [{ id: "rule-one" }],
      observations: [
        observation("rule-one", { independent: false }),
        observation("rule-one", { independent: "true" }),
        observation("rule-one", { wellFormed: "yes" }),
        observation("rule-one", { followed: "yes" }),
        observation("rule-one", { evidence: [] }),
        observation("rule-one", { evidence: undefined }),
        observation("unknown-rule"),
      ],
    });
    expect(report.evaluatedRules).toBe(0);
    expect(report.state).toBe("indeterminate");
    expect(report.findings.map((item) => item.rule)).toContain("unknown-rule");
  });

  it("treats duplicate declared ids as findings that cannot be satisfied", () => {
    const report = assessRuleConformanceRate({
      asOf: AS_OF,
      declaredRules: [{ id: "rule-one" }, { id: "rule-one" }],
      observations: [observation("rule-one")],
    });
    expect(report.findings.map((item) => item.rule)).toContain("duplicate-rule-id");
    expect(report.state).toBe("violated");
    expect(report.evaluatedRules).toBe(1);
    expect(report.conformingRules).toBe(1);
  });

  it("marks a rule non-conforming and records disagreement when counting observations conflict", () => {
    const report = assessRuleConformanceRate({
      asOf: AS_OF,
      declaredRules: [{ id: "rule-one" }],
      observations: [
        observation("rule-one", { observerRef: "observer-a" }),
        observation("rule-one", { observerRef: "observer-b", followed: false }),
      ],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0);
    expect(report.evaluatedRules).toBe(1);
    expect(report.conformingRules).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("observation-disagreement");
    expect(report.findings.map((item) => item.rule)).toContain("rule-not-conforming");
  });

  it("cannot be satisfied when asOf is missing or uninterpretable", () => {
    const missing = assessRuleConformanceRate({
      declaredRules: [{ id: "rule-one" }],
      observations: [observation("rule-one")],
    });
    expect(missing.findings.map((item) => item.rule)).toContain("assessment-as-of");
    expect(missing.state).toBe("violated");
    expect(missing.rate).toBe(1);

    const invalid = assessRuleConformanceRate({
      asOf: "not-a-timestamp",
      declaredRules: [{ id: "rule-one" }],
      observations: [observation("rule-one")],
    });
    expect(invalid.findings.map((item) => item.rule)).toContain("assessment-as-of");
    expect(invalid.state).toBe("violated");
  });
});
