import { describe, expect, it } from "vitest";
import { adaptLegacyCheckResult } from "./legacy-adapter.js";
import type { AdaptLegacyCheckResultOptions, LegacyCheckResult } from "./legacy-adapter.js";
import { isIndeterminate, isSatisfied, isViolated } from "./result.js";

type LowSeverity = "high" | "medium" | "low";
const lowOptions: AdaptLegacyCheckResultOptions<LowSeverity> = {
  severityMap: { error: "high", warning: "medium", info: "low" },
  defaultSeverity: "high",
  fallbackMessage: "The underlying legacy check reported violated with no findings.",
};

describe("adaptLegacyCheckResult — satisfied", () => {
  it("defaults evaluated to 1 when the legacy result did not track one", () => {
    const legacy: LegacyCheckResult<string> = { verdict: "satisfied" };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    expect(isSatisfied(result)).toBe(true);
    if (isSatisfied(result)) expect(result.evaluated).toBe(1);
  });

  it("preserves an explicit evaluated count", () => {
    const legacy: LegacyCheckResult<string> = { verdict: "satisfied", evaluated: 7 };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    expect(isSatisfied(result)).toBe(true);
    if (isSatisfied(result)) expect(result.evaluated).toBe(7);
  });
});

describe("adaptLegacyCheckResult — violated", () => {
  it("maps a legacy severity through the caller's severityMap", () => {
    const legacy: LegacyCheckResult<string> = {
      verdict: "violated",
      findings: [{ rule: "thing/broken", severity: "error", message: "it broke" }],
    };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    expect(isViolated(result)).toBe(true);
    if (isViolated(result)) {
      expect(result.findings).toEqual([{ rule: "thing/broken", severity: "high", message: "it broke" }]);
    }
  });

  it("falls back to defaultSeverity for an unmapped legacy severity", () => {
    const legacy: LegacyCheckResult<string> = {
      verdict: "violated",
      findings: [{ rule: "thing/broken", severity: "catastrophic", message: "it broke" }],
    };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    if (isViolated(result)) expect(result.findings[0]?.severity).toBe("high");
  });

  it("falls back to defaultSeverity when a legacy finding carries no severity at all", () => {
    const legacy: LegacyCheckResult<string> = {
      verdict: "violated",
      findings: [{ message: "it broke" }],
    };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    if (isViolated(result)) expect(result.findings[0]?.severity).toBe("high");
  });

  it("falls back to defaultRule when a legacy finding carries no rule", () => {
    const legacy: LegacyCheckResult<string> = {
      verdict: "violated",
      findings: [{ message: "it broke" }],
    };
    const result = adaptLegacyCheckResult(legacy, { ...lowOptions, defaultRule: "legacy/unnamed" });
    if (isViolated(result)) expect(result.findings[0]?.rule).toBe("legacy/unnamed");
  });

  it("folds a legacy path into the message", () => {
    const legacy: LegacyCheckResult<string> = {
      verdict: "violated",
      findings: [{ rule: "thing/broken", severity: "error", message: "it broke", path: "governance/routines.json" }],
    };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    if (isViolated(result)) {
      expect(result.findings[0]?.message).toBe("governance/routines.json: it broke");
    }
  });

  it("maps every finding in a multi-finding legacy result", () => {
    const legacy: LegacyCheckResult<string> = {
      verdict: "violated",
      findings: [
        { rule: "a", severity: "error", message: "one" },
        { rule: "b", severity: "warning", message: "two" },
        { rule: "c", severity: "info", message: "three" },
      ],
    };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    if (isViolated(result)) {
      expect(result.findings.map((f) => f.severity)).toEqual(["high", "medium", "low"]);
    }
  });

  it("uses fallbackMessage when the legacy result is violated with no findings", () => {
    const legacy: LegacyCheckResult<string> = { verdict: "violated" };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    expect(isViolated(result)).toBe(true);
    if (isViolated(result)) {
      expect(result.findings).toEqual([
        { rule: "legacy-check-violation", severity: "high", message: lowOptions.fallbackMessage },
      ]);
    }
  });

  it("uses fallbackMessage when the legacy result is violated with an explicit empty findings array", () => {
    const legacy: LegacyCheckResult<string> = { verdict: "violated", findings: [] };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    if (isViolated(result)) expect(result.findings).toHaveLength(1);
  });
});

describe("adaptLegacyCheckResult — indeterminate", () => {
  it("passes reason and detail straight through", () => {
    const legacy: LegacyCheckResult<"legacy-unreadable"> = {
      verdict: "indeterminate",
      reason: "legacy-unreadable",
      detail: "could not parse governance/routines.json",
    };
    const result = adaptLegacyCheckResult(legacy, lowOptions);
    expect(isIndeterminate(result)).toBe(true);
    if (isIndeterminate(result)) {
      expect(result.reason).toBe("legacy-unreadable");
      expect(result.detail).toBe("could not parse governance/routines.json");
    }
  });
});

describe("adaptLegacyCheckResult — different severity vocabularies stay caller-owned", () => {
  it("works just as well for a two-value error/warning severity vocabulary", () => {
    type ErrorWarning = "error" | "warning";
    const options: AdaptLegacyCheckResultOptions<ErrorWarning> = {
      severityMap: { high: "error", low: "warning" },
      defaultSeverity: "error",
      fallbackMessage: "violated with no findings",
    };
    const legacy: LegacyCheckResult<string> = {
      verdict: "violated",
      findings: [{ rule: "x", severity: "low", message: "minor" }],
    };
    const result = adaptLegacyCheckResult(legacy, options);
    if (isViolated(result)) expect(result.findings[0]?.severity).toBe("warning");
  });
});
