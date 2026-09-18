import { describe, expect, it } from "vitest";
import { assessUnreconciledGrantRate } from "./unreconciled-grant-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(grantId: string, overrides: Record<string, unknown> = {}) {
  return {
    grantId,
    independent: true,
    backed: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${grantId}`),
    ...overrides,
  };
}

describe("assessUnreconciledGrantRate", () => {
  it("returns indeterminate with a null rate when declaredGrants is empty, never a perfect 0", () => {
    const report = assessUnreconciledGrantRate({ asOf: AS_OF, declaredGrants: [], observations: [] });
    expect(report).toMatchObject({
      metric: "unreconciled grant rate",
      state: "indeterminate",
      rate: null,
      evaluatedGrants: 0,
      unreconciledGrants: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-grants-empty");
  });

  it("returns indeterminate when declaredGrants is missing, never a perfect rate", () => {
    const report = assessUnreconciledGrantRate({ asOf: AS_OF, observations: [observation("grant-one")] });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedGrants).toBe(0);
    expect(report.unreconciledGrants).toBe(0);
  });

  it("returns satisfied with rate 0 when every declared grant is independently backed", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }, { id: "grant-two" }],
      observations: [observation("grant-one"), observation("grant-two")],
    });
    expect(report).toEqual({
      metric: "unreconciled grant rate",
      state: "satisfied",
      rate: 0,
      evaluatedGrants: 2,
      unreconciledGrants: 0,
      findings: [],
      proposedPositions: [],
    });
  });

  it("returns violated with a fractional rate when one evaluated grant is not backed", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }, { id: "grant-two" }],
      observations: [observation("grant-one"), observation("grant-two", { backed: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.evaluatedGrants).toBe(2);
    expect(report.unreconciledGrants).toBe(1);
    expect(report.metric).toBe("unreconciled grant rate");
    expect(report.proposedPositions).toEqual([]);
    expect(report.findings.map((item) => item.rule)).toContain("grant-unreconciled");
  });

  it("returns indeterminate when the only declared grant has no counting observation", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }],
      observations: [],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedGrants).toBe(0);
    expect(report.unreconciledGrants).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("grant-unevaluated");
  });

  it("returns violated when a declared grant has no counting observation among a partial evaluated set", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }, { id: "grant-two" }],
      observations: [observation("grant-one")],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0);
    expect(report.evaluatedGrants).toBe(1);
    expect(report.unreconciledGrants).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("grant-unevaluated");
  });

  it("does not count a reserved self-observer and records a finding", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }],
      observations: [observation("grant-one", { observerRef: "Bouncer" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedGrants).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });

  it("does not count @clossys/bouncer as an independent observer", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }],
      observations: [observation("grant-one", { observerRef: "@clossys/bouncer" })],
    });
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
    expect(report.evaluatedGrants).toBe(0);
    expect(report.state).toBe("indeterminate");
  });

  it("leaves unverifiable observations unevaluated instead of folding them into the rate", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }],
      observations: [observation("grant-one", { backed: false, unverifiable: true })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedGrants).toBe(0);
    expect(report.unreconciledGrants).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("grant-unevaluated");
  });

  it("leaves an unreachable provider observation unevaluated", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }],
      observations: [observation("grant-one", { backed: false, reachability: "unreachable" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedGrants).toBe(0);
    expect(report.unreconciledGrants).toBe(0);
  });

  it("does not treat expired as this rate; expiry without backed is unevaluated", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }],
      observations: [observation("grant-one", { backed: undefined, expired: true })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.evaluatedGrants).toBe(0);
    expect(report.findings.map((item) => item.rule)).toContain("grant-unevaluated");
  });

  it("returns indeterminate for unreadable input", () => {
    for (const value of [null, undefined, "text", 1, true, []]) {
      const report = assessUnreconciledGrantRate(value);
      expect(report.state, String(value)).toBe("indeterminate");
      expect(report.rate, String(value)).toBeNull();
      expect(report.evaluatedGrants, String(value)).toBe(0);
      expect(report.unreconciledGrants, String(value)).toBe(0);
      expect(report.metric, String(value)).toBe("unreconciled grant rate");
      expect(report.proposedPositions, String(value)).toEqual([]);
    }
  });

  it("does not count independent !== true, missing evidence, or unknown grant ids", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }],
      observations: [
        observation("grant-one", { independent: false }),
        observation("grant-one", { independent: "true" }),
        observation("grant-one", { evidence: [] }),
        observation("grant-one", { evidence: undefined }),
        observation("unknown-grant"),
      ],
    });
    expect(report.evaluatedGrants).toBe(0);
    expect(report.state).toBe("indeterminate");
    expect(report.findings.map((item) => item.rule)).toContain("unknown-grant");
  });

  it("treats duplicate declared ids as findings that cannot be satisfied", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }, { id: "grant-one" }],
      observations: [observation("grant-one")],
    });
    expect(report.findings.map((item) => item.rule)).toContain("duplicate-grant-id");
    expect(report.state).toBe("violated");
    expect(report.evaluatedGrants).toBe(1);
    expect(report.unreconciledGrants).toBe(0);
  });

  it("records disagreement when counting observations disagree on backed", () => {
    const report = assessUnreconciledGrantRate({
      asOf: AS_OF,
      declaredGrants: [{ id: "grant-one" }],
      observations: [
        observation("grant-one", { observerRef: "observer-a" }),
        observation("grant-one", { observerRef: "observer-b", backed: false }),
      ],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(1);
    expect(report.evaluatedGrants).toBe(1);
    expect(report.unreconciledGrants).toBe(1);
    expect(report.findings.map((item) => item.rule)).toContain("observation-disagreement");
    expect(report.findings.map((item) => item.rule)).toContain("grant-unreconciled");
  });

  it("cannot be satisfied when asOf is missing or uninterpretable", () => {
    const missing = assessUnreconciledGrantRate({
      declaredGrants: [{ id: "grant-one" }],
      observations: [observation("grant-one")],
    });
    expect(missing.findings.map((item) => item.rule)).toContain("assessment-as-of");
    expect(missing.state).toBe("violated");
    expect(missing.rate).toBe(0);

    const invalid = assessUnreconciledGrantRate({
      asOf: "not-a-timestamp",
      declaredGrants: [{ id: "grant-one" }],
      observations: [observation("grant-one")],
    });
    expect(invalid.findings.map((item) => item.rule)).toContain("assessment-as-of");
    expect(invalid.state).toBe("violated");
  });
});
