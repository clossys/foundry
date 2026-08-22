/**
 * The validation primitives, tested directly. Every one of these is asked
 * the same question twice: does it narrow what it should, and does it
 * RECORD a failure rather than substituting something for what it could not
 * read. The second half is the one that matters — a helper that quietly
 * returned a default would put the fail-open shape this package exists to
 * repay underneath every record in it.
 */
import { describe, expect, it } from "vitest";
import {
  describeValue,
  isOneOf,
  isPlainObject,
  pushIssue,
  requireArrayOf,
  requireNumber,
  requireString,
  requireTimestamp,
  summarizeIssues,
  type ValidationIssue,
} from "./validation.js";

describe("isPlainObject", () => {
  it("accepts a plain object and rejects everything shaped like one but not", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe("isOneOf", () => {
  it("decides membership by the caller's own literal list, never by shape", () => {
    expect(isOneOf("delivered", ["delivered", "failed"])).toBe(true);
    expect(isOneOf("Delivered", ["delivered", "failed"])).toBe(false);
    expect(isOneOf(1, ["delivered"])).toBe(false);
  });
});

describe("describeValue", () => {
  it("describes a value without ever printing its full contents", () => {
    expect(describeValue(undefined)).toBe("undefined");
    expect(describeValue(null)).toBe("null");
    expect(describeValue([1, 2, 3])).toBe("an array (3 item(s))");
    expect(describeValue({ secret: "x" })).toBe("an object");
    expect(describeValue("hello")).toBe('"hello"');
    expect(describeValue(7)).toBe("7");
  });
});

describe("requireString", () => {
  it("returns the string and records nothing when it is valid", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString("abc", "p", issues, { minLength: 1 })).toBe("abc");
    expect(issues).toEqual([]);
  });

  it("records a failure and returns undefined for a non-string", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString(7, "p", issues)).toBeUndefined();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("p");
  });

  it("counts non-whitespace characters, so a padded empty string is not a value", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString("   ", "p", issues, { minLength: 1 })).toBeUndefined();
    expect(issues).toHaveLength(1);
  });
});

describe("requireTimestamp", () => {
  it("accepts a parseable timestamp and returns it unchanged", () => {
    const issues: ValidationIssue[] = [];
    expect(requireTimestamp("2026-08-22T12:00:00.000Z", "p", issues)).toBe("2026-08-22T12:00:00.000Z");
    expect(issues).toEqual([]);
  });

  it("records a failure rather than silently treating an unparseable time as now", () => {
    const issues: ValidationIssue[] = [];
    expect(requireTimestamp("whenever", "p", issues)).toBeUndefined();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("parseable timestamp");
  });
});

describe("requireNumber", () => {
  it("enforces finiteness, integrality and bounds, recording each failure", () => {
    const issues: ValidationIssue[] = [];
    expect(requireNumber(5, "p", issues, { min: 0, integer: true })).toBe(5);
    expect(requireNumber(Number.NaN, "p", issues)).toBeUndefined();
    expect(requireNumber(1.5, "p", issues, { integer: true })).toBeUndefined();
    expect(requireNumber(-1, "p", issues, { min: 0 })).toBeUndefined();
    expect(requireNumber(2, "p", issues, { max: 1 })).toBeUndefined();
    expect(issues).toHaveLength(4);
  });
});

describe("requireArrayOf", () => {
  const reader = (item: unknown, path: string, issues: ValidationIssue[]) => requireString(item, path, issues, { minLength: 1 });

  it("returns every item when they all read", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf(["a", "b"], "list", issues, reader)).toEqual(["a", "b"]);
    expect(issues).toEqual([]);
  });

  it("returns undefined and reports every bad item's own index, not just the first", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf(["a", 1, 2], "list", issues, reader)).toBeUndefined();
    expect(issues.map((issue) => issue.path)).toEqual(["list[1]", "list[2]"]);
  });

  it("rejects a non-array outright", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf({}, "list", issues, reader)).toBeUndefined();
    expect(issues[0]?.message).toContain("must be an array");
  });

  it("accepts an empty array, because an empty record set is a real state a gate must be able to report on", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf([], "list", issues, reader)).toEqual([]);
    expect(issues).toEqual([]);
  });
});

describe("pushIssue and summarizeIssues", () => {
  it("round-trips into one printable line per issue", () => {
    const issues: ValidationIssue[] = [];
    pushIssue(issues, "a.b", "must be a string");
    pushIssue(issues, "a.c", "must be a number");
    expect(summarizeIssues(issues)).toBe("a.b: must be a string; a.c: must be a number");
  });

  it("summarizes an empty set to an empty string rather than to a reassuring sentence", () => {
    expect(summarizeIssues([])).toBe("");
  });
});
