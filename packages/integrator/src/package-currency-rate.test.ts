import { describe, expect, it } from "vitest";
import { assessPackageCurrencyRate } from "./package-currency-rate.js";

const AS_OF = "2026-09-18T12:00:00Z";

function evidence(id = "evidence-one") {
  return [{ id, description: "Independent observation evidence." }];
}

function observation(packageId: string, overrides: Record<string, unknown> = {}) {
  return {
    packageId,
    independent: true,
    current: true,
    observerRef: "observer-a",
    evidence: evidence(`evidence-${packageId}`),
    ...overrides,
  };
}

describe("assessPackageCurrencyRate", () => {
  it("returns indeterminate with a null rate when declaredPackages is empty, never 0", () => {
    const report = assessPackageCurrencyRate({ asOf: AS_OF, declaredPackages: [], observations: [] });
    expect(report).toMatchObject({
      metric: "package currency rate",
      state: "indeterminate",
      rate: null,
      evaluatedPackages: 0,
      currentPackages: 0,
      proposedPositions: [],
    });
    expect(report.findings.map((item) => item.rule)).toContain("declared-packages-empty");
  });

  it("returns satisfied with rate 1 when every declared package is independently current", () => {
    const report = assessPackageCurrencyRate({
      asOf: AS_OF,
      declaredPackages: [{ id: "pkg-one" }, { id: "pkg-two" }],
      observations: [observation("pkg-one"), observation("pkg-two")],
    });
    expect(report.state).toBe("satisfied");
    expect(report.rate).toBe(1);
    expect(report.evaluatedPackages).toBe(2);
  });

  it("returns violated when an entitled package is independently observed not current", () => {
    const report = assessPackageCurrencyRate({
      asOf: AS_OF,
      declaredPackages: [{ id: "pkg-one" }, { id: "pkg-two" }],
      observations: [observation("pkg-one"), observation("pkg-two", { current: false })],
    });
    expect(report.state).toBe("violated");
    expect(report.rate).toBe(0.5);
    expect(report.findings.map((item) => item.rule)).toContain("package-not-current");
  });

  it("rejects reserved self-observers", () => {
    const report = assessPackageCurrencyRate({
      asOf: AS_OF,
      declaredPackages: [{ id: "pkg-one" }],
      observations: [observation("pkg-one", { observerRef: "@clossys/integrator" })],
    });
    expect(report.state).toBe("indeterminate");
    expect(report.rate).toBeNull();
    expect(report.findings.map((item) => item.rule)).toContain("self-observation");
  });
});
