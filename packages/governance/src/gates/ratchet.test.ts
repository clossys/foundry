import { describe, expect, it } from "vitest";
import { evaluateRatchet } from "./ratchet.js";

describe("evaluateRatchet — clean (current <= baseline)", () => {
  it("passes when current equals a positive baseline", () => {
    const result = evaluateRatchet(5, 5);
    expect(result).toEqual({
      ok: true,
      status: "clean",
      current: 5,
      baseline: 5,
      improved: false,
      findings: [],
    });
  });

  it("passes when current and baseline are both zero", () => {
    const result = evaluateRatchet(0, 0);
    expect(result).toEqual({
      ok: true,
      status: "clean",
      current: 0,
      baseline: 0,
      improved: false,
      findings: [],
    });
  });

  it("passes with no findings when there is no improvement to report", () => {
    const result = evaluateRatchet(10, 10);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe("evaluateRatchet — improved (current < baseline)", () => {
  it("passes but flags improved:true with a warning finding, by one", () => {
    const result = evaluateRatchet(4, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.status).toBe("clean");
    expect(result.improved).toBe(true);
    expect(result.findings).toEqual([
      {
        rule: "ratchet/baseline-stale",
        severity: "warning",
        message: expect.stringContaining("4"),
      },
    ]);
  });

  it("passes but flags improved:true by a large margin", () => {
    const result = evaluateRatchet(0, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.improved).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("ratchet/baseline-stale");
    expect(result.findings[0]?.severity).toBe("warning");
  });

  it("never treats improvement as a hard failure — ok stays true", () => {
    const result = evaluateRatchet(1, 2);
    expect(result.ok).toBe(true);
  });

  it("the baseline-stale message names both the current and baseline values", () => {
    const result = evaluateRatchet(3, 9);
    if (!result.ok) throw new Error("unreachable");
    expect(result.findings[0]?.message).toContain("3");
    expect(result.findings[0]?.message).toContain("9");
  });
});

describe("evaluateRatchet — regression (current > baseline)", () => {
  it("fails by one over baseline", () => {
    const result = evaluateRatchet(6, 5);
    expect(result).toEqual({
      ok: false,
      status: "regression",
      current: 6,
      baseline: 5,
      findings: [
        {
          rule: "ratchet/regression",
          severity: "error",
          message: expect.stringContaining("6"),
        },
      ],
    });
  });

  it("fails by a large margin over baseline", () => {
    const result = evaluateRatchet(100, 1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("regression");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("ratchet/regression");
    expect(result.findings[0]?.severity).toBe("error");
  });

  it("fails when baseline is zero and current is any positive number", () => {
    const result = evaluateRatchet(1, 0);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("regression");
  });

  it("the regression message names both the current and baseline values", () => {
    const result = evaluateRatchet(7, 4);
    if (result.ok) throw new Error("unreachable");
    if (result.status !== "regression") throw new Error("unreachable");
    expect(result.findings[0]?.message).toContain("7");
    expect(result.findings[0]?.message).toContain("4");
  });
});

describe("evaluateRatchet — invalid current (fails closed)", () => {
  it.each([
    ["negative", -1],
    ["a float", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a string", "5"],
    ["a boolean", true],
    ["an object", {}],
    ["an array", [1]],
    ["null", null],
    ["undefined", undefined],
  ])("rejects current when it is %s", (_label, badCurrent) => {
    const result = evaluateRatchet(badCurrent, 5);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("invalid");
    expect(result.findings.some((f) => f.rule === "ratchet/current-invalid")).toBe(true);
    expect(result.findings.every((f) => f.severity === "error")).toBe(true);
    // Invalid results never echo current/baseline back — nothing was trusted.
    expect("current" in result).toBe(false);
    expect("baseline" in result).toBe(false);
  });
});

describe("evaluateRatchet — invalid/missing baseline (fails closed)", () => {
  it("treats undefined baseline as missing, not zero", () => {
    const result = evaluateRatchet(0, undefined);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("invalid");
    expect(result.findings).toEqual([
      {
        rule: "ratchet/baseline-missing",
        severity: "error",
        message: expect.any(String),
        path: "baseline",
      },
    ]);
  });

  it("treats null baseline as missing, not zero", () => {
    const result = evaluateRatchet(0, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("invalid");
    expect(result.findings[0]?.rule).toBe("ratchet/baseline-missing");
  });

  it.each([
    ["negative", -1],
    ["a float", 2.25],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a string", "10"],
    ["a boolean", false],
    ["an object", {}],
  ])("rejects baseline when it is %s", (_label, badBaseline) => {
    const result = evaluateRatchet(1, badBaseline);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("invalid");
    expect(result.findings.some((f) => f.rule === "ratchet/baseline-invalid")).toBe(true);
  });
});

describe("evaluateRatchet — both invalid at once", () => {
  it("reports both current and baseline findings, not just the first", () => {
    const result = evaluateRatchet(-1, -2);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("invalid");
    const rules = result.findings.map((f) => f.rule).sort();
    expect(rules).toEqual(["ratchet/baseline-invalid", "ratchet/current-invalid"]);
  });

  it("reports both when current is invalid and baseline is missing", () => {
    const result = evaluateRatchet("nope", undefined);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const rules = result.findings.map((f) => f.rule).sort();
    expect(rules).toEqual(["ratchet/baseline-missing", "ratchet/current-invalid"]);
  });
});

describe("evaluateRatchet — boundary values", () => {
  it("accepts Number.MAX_SAFE_INTEGER as an equal current/baseline", () => {
    const result = evaluateRatchet(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.improved).toBe(false);
  });

  it("rejects a value one past Number.MAX_SAFE_INTEGER as baseline (loses integer precision)", () => {
    const result = evaluateRatchet(0, Number.MAX_SAFE_INTEGER + 2);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("invalid");
  });
});

describe("evaluateRatchet — purity", () => {
  it("is deterministic: the same inputs always produce the same result", () => {
    const first = evaluateRatchet(3, 7);
    const second = evaluateRatchet(3, 7);
    expect(first).toEqual(second);
  });

  it("never lowers or otherwise mutates its inputs", () => {
    const current = 2;
    const baseline = 8;
    evaluateRatchet(current, baseline);
    expect(current).toBe(2);
    expect(baseline).toBe(8);
  });
});
