import { describe, expect, it } from "vitest";
import { assessControlledKeyRate } from "./controlled-key-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(keyId: string, overrides: Record<string, unknown> = {}) {
  return {
    keyId,
    independent: true,
    owned: true,
    current: true,
    correctlyDistributed: true,
    revocable: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${keyId}`),
    ...overrides,
  };
}

describe("assessControlledKeyRate", () => {
  it("returns indeterminate with a null rate when declaredKeys is empty", () => {
    const report = assessControlledKeyRate({ asOf: AS_OF, declaredKeys: [], observations: [] });
    expect(report).toMatchObject({
      metric: "controlled key rate",
      state: "indeterminate",
      rate: null,
      evaluatedKeys: 0,
      controlledKeys: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-keys-empty");
  });

  it("returns satisfied with rate 1 when every declared key is independently controlled", () => {
    const report = assessControlledKeyRate({
      asOf: AS_OF,
      declaredKeys: [{ id: "key-one" }, { id: "key-two" }],
      observations: [observation("key-one"), observation("key-two")],
    });
    expect(report).toEqual({
      metric: "controlled key rate",
      state: "satisfied",
      rate: 1,
      evaluatedKeys: 2,
      controlledKeys: 2,
      findings: [],
      proposedPositions: [],
    });
  });

  it("returns violated when a key is independently observed not current", () => {
    const report = assessControlledKeyRate({
      asOf: AS_OF,
      declaredKeys: [{ id: "key-one" }, { id: "key-two" }],
      observations: [observation("key-one"), observation("key-two", { current: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("key-not-controlled");
  });

  it("rejects reserved self-observers and does not relabel summarizeRotationMetric", () => {
    const report = assessControlledKeyRate({
      asOf: AS_OF,
      declaredKeys: [{ id: "key-one" }],
      observations: [observation("key-one", { observerRef: "locksmith" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
    expect(report.metric).toBe("controlled key rate");
  });
});
