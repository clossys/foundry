import { describe, expect, it } from "vitest";
import { checkOverrideTargetRanges } from "./override-target-range.js";

// No package.json in this repository declares an "overrides" block today
// (verified by inspection before writing this gate), so every fixture below
// is hand-written rather than lifted from a real manifest.

describe("checkOverrideTargetRanges — absent or empty", () => {
  it("returns no findings when overrides is undefined (field absent)", () => {
    expect(checkOverrideTargetRanges(undefined)).toEqual([]);
  });

  it("returns no findings for an empty overrides object", () => {
    expect(checkOverrideTargetRanges({})).toEqual([]);
  });
});

describe("checkOverrideTargetRanges — accepted, bounded ranges", () => {
  it.each([
    ["an explicit AND range", ">=1.2.3 <2.0.0"],
    ["an explicit AND range with an inclusive upper", ">1.2.3 <=2.0.0"],
    ["an AND range with the upper written first", "<2.0.0 >=1.2.3"],
    ["a tilde range", "~1.2.3"],
    ["a tilde range with a partial version", "~1.2"],
    ["a tilde range with a major-only version", "~1"],
    ["a caret range", "^1.2.3"],
    ["a caret range on a zero major", "^0.2.3"],
    ["an exact pin", "1.2.3"],
    ["an exact pin with a leading =", "=1.2.3"],
    ["an exact pin with a prerelease tag", "1.2.3-beta.1"],
    ["a hyphen range", "1.2.3 - 2.0.0"],
    ["an upper-only comparator", "<2.0.0"],
    ["an inclusive upper-only comparator", "<=2.0.0"],
    ["a range with surrounding whitespace", "  ^1.2.3  "],
  ])("accepts %s: %s", (_label, range) => {
    expect(checkOverrideTargetRanges({ foo: range })).toEqual([]);
  });

  it("accepts a nested overrides object using the \".\" key for the package's own range", () => {
    const findings = checkOverrideTargetRanges({
      foo: {
        ".": "^1.2.3",
        bar: "~2.0.0",
      },
    });
    expect(findings).toEqual([]);
  });

  it("accepts multiple independently-bounded entries", () => {
    const findings = checkOverrideTargetRanges({
      foo: "^1.2.3",
      bar: ">=2.0.0 <3.0.0",
      baz: "3.1.4",
    });
    expect(findings).toEqual([]);
  });
});

describe("checkOverrideTargetRanges — rejected: unbounded", () => {
  it("rejects a bare >= range with overrides/range-unbounded", () => {
    const findings = checkOverrideTargetRanges({ foo: ">=1.2.3" });
    expect(findings).toEqual([
      {
        rule: "overrides/range-unbounded",
        severity: "error",
        message: expect.stringContaining(">=1.2.3"),
        path: "overrides.foo",
      },
    ]);
  });

  it("rejects a bare > range", () => {
    const findings = checkOverrideTargetRanges({ foo: ">1.2.3" });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("overrides/range-unbounded");
  });

  it("the unbounded message explains why (major-boundary hoist), not just that it failed", () => {
    const findings = checkOverrideTargetRanges({ foo: ">=1.2.3" });
    expect(findings[0]?.message).toMatch(/major/i);
  });
});

describe("checkOverrideTargetRanges — rejected: unparseable", () => {
  it.each([
    ["an OR range", ">=1.0.0 <2.0.0 || >=3.0.0"],
    ["a wildcard", "*"],
    ["an x-range", "1.x"],
    ["a dist-tag", "latest"],
    ["a git URL", "git+https://example.invalid/pkg.git"],
    ["a file protocol", "file:../local-pkg"],
    ["a workspace protocol", "workspace:*"],
    ["three space-separated comparators", ">=1.0.0 <2.0.0 <3.0.0"],
    ["two lower comparators with no upper", ">=1.0.0 >2.0.0"],
    ["two upper comparators with no lower", "<1.0.0 <2.0.0"],
    ["garbage text", "not-a-version"],
  ])("rejects %s as unparseable, not silently as a pass", (_label, range) => {
    const findings = checkOverrideTargetRanges({ foo: range });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("overrides/range-unparseable");
    expect(findings[0]?.severity).toBe("error");
  });

  it("rejects an empty string range with overrides/range-empty, not overrides/range-unparseable", () => {
    const findings = checkOverrideTargetRanges({ foo: "" });
    expect(findings).toEqual([
      {
        rule: "overrides/range-empty",
        severity: "error",
        message: expect.any(String),
        path: "overrides.foo",
      },
    ]);
  });

  it("rejects a whitespace-only string range as empty", () => {
    const findings = checkOverrideTargetRanges({ foo: "   " });
    expect(findings[0]?.rule).toBe("overrides/range-empty");
  });
});

describe("checkOverrideTargetRanges — shape findings", () => {
  it("rejects a non-object, non-null overrides value", () => {
    const findings = checkOverrideTargetRanges("not-an-object");
    expect(findings).toEqual([
      {
        rule: "overrides/shape",
        severity: "error",
        message: expect.any(String),
        path: "overrides",
      },
    ]);
  });

  it("rejects a null overrides value", () => {
    const findings = checkOverrideTargetRanges(null);
    expect(findings[0]?.rule).toBe("overrides/shape");
    expect(findings[0]?.message).toContain("null");
  });

  it("rejects an array overrides value", () => {
    const findings = checkOverrideTargetRanges([]);
    expect(findings[0]?.rule).toBe("overrides/shape");
    expect(findings[0]?.message).toContain("array");
  });

  it("rejects a numeric entry value", () => {
    const findings = checkOverrideTargetRanges({ foo: 123 });
    expect(findings).toEqual([
      {
        rule: "overrides/shape",
        severity: "error",
        message: expect.any(String),
        path: "overrides.foo",
      },
    ]);
  });

  it("rejects a null nested entry value", () => {
    const findings = checkOverrideTargetRanges({ foo: null });
    expect(findings[0]?.rule).toBe("overrides/shape");
    expect(findings[0]?.message).toContain("null");
  });
});

describe("checkOverrideTargetRanges — nested overrides", () => {
  it("reports findings at the correct dotted path for a deeply nested unbounded range", () => {
    const findings = checkOverrideTargetRanges({
      foo: {
        ".": "^1.2.3",
        bar: {
          baz: ">=1.0.0",
        },
      },
    });
    expect(findings).toEqual([
      {
        rule: "overrides/range-unbounded",
        severity: "error",
        message: expect.any(String),
        path: "overrides.foo.bar.baz",
      },
    ]);
  });

  it("checks every leaf in a nested tree, not just the first", () => {
    const findings = checkOverrideTargetRanges({
      foo: {
        ".": ">=1.0.0",
        bar: ">=2.0.0",
      },
    });
    const rules = findings.map((f) => f.rule);
    expect(rules).toEqual(["overrides/range-unbounded", "overrides/range-unbounded"]);
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual(["overrides.foo", "overrides.foo.bar"]);
  });

  it("a nested object without a \".\" key checks only its own nested entries, not itself", () => {
    // "bar" here has no declared range of its own — only "baz" (a dependency
    // of "bar") is constrained. There is nothing to check about "bar" itself.
    const findings = checkOverrideTargetRanges({
      foo: {
        bar: {
          baz: "^1.0.0",
        },
      },
    });
    expect(findings).toEqual([]);
  });
});
