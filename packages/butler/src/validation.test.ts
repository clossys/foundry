import { describe, expect, it } from "vitest";
import {
  describeValue,
  isOneOf,
  isPlainObject,
  optionalTimestamp,
  pushIssue,
  requireArrayOf,
  requireBoolean,
  requireNumber,
  requireString,
  requireTimestamp,
  summarizeIssues,
  type ValidationIssue,
} from "./validation.js";

describe("isPlainObject", () => {
  it("accepts a plain object and rejects arrays and null", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
  });
});

describe("isOneOf", () => {
  it("decides membership against the caller's own list, not a shape heuristic", () => {
    expect(isOneOf("acted", ["acted", "handed-off"] as const)).toBe(true);
    expect(isOneOf("ACTED", ["acted", "handed-off"] as const)).toBe(false);
    expect(isOneOf(1, ["acted"] as const)).toBe(false);
  });
});

describe("describeValue", () => {
  it("never reproduces an object's contents", () => {
    expect(describeValue({ subjectId: "sub_1" })).toBe("an object");
    expect(describeValue([1, 2])).toBe("an array (2 item(s))");
    expect(describeValue(undefined)).toBe("undefined");
    expect(describeValue(null)).toBe("null");
    expect(describeValue(3)).toBe("3");
  });
});

describe("requireString", () => {
  it("records an issue rather than throwing", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString(7, "a.b", issues)).toBeUndefined();
    expect(issues).toEqual([{ path: "a.b", message: "must be a string, got 7" }]);
  });

  it("treats an all-whitespace string as failing a minimum length", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString("   ", "a", issues, { minLength: 1 })).toBeUndefined();
    expect(issues).toHaveLength(1);
  });
});

describe("requireTimestamp", () => {
  it("accepts a parseable timestamp and refuses anything it cannot order", () => {
    const issues: ValidationIssue[] = [];
    expect(requireTimestamp("2026-08-21T00:00:00.000Z", "t", issues)).toBe("2026-08-21T00:00:00.000Z");
    expect(issues).toHaveLength(0);
    expect(requireTimestamp("not-a-date", "t", issues)).toBeUndefined();
    expect(issues).toHaveLength(1);
  });

  it("is optional only through optionalTimestamp, which passes undefined without an issue", () => {
    const issues: ValidationIssue[] = [];
    expect(optionalTimestamp(undefined, "t", issues)).toBeUndefined();
    expect(issues).toHaveLength(0);
  });
});

describe("requireNumber", () => {
  it("rejects NaN, Infinity, and out-of-bound values", () => {
    const issues: ValidationIssue[] = [];
    expect(requireNumber(Number.NaN, "n", issues)).toBeUndefined();
    expect(requireNumber(Number.POSITIVE_INFINITY, "n", issues)).toBeUndefined();
    expect(requireNumber(1.5, "n", issues, { max: 1 })).toBeUndefined();
    expect(requireNumber(-1, "n", issues, { min: 0 })).toBeUndefined();
    expect(requireNumber(1.5, "n", issues, { integer: true })).toBeUndefined();
    expect(issues).toHaveLength(5);
  });

  it("accepts a value inside its bounds", () => {
    const issues: ValidationIssue[] = [];
    expect(requireNumber(0.8, "n", issues, { min: 0, max: 1 })).toBe(0.8);
    expect(issues).toHaveLength(0);
  });
});

describe("requireBoolean", () => {
  it("refuses a truthy string or number, never coercing it", () => {
    const issues: ValidationIssue[] = [];
    expect(requireBoolean("true", "b", issues)).toBeUndefined();
    expect(requireBoolean(1, "b", issues)).toBeUndefined();
    expect(requireBoolean(false, "b", issues)).toBe(false);
    expect(issues).toHaveLength(2);
  });
});

describe("requireArrayOf", () => {
  it("reports every failing item, with its own index in the path", () => {
    const issues: ValidationIssue[] = [];
    const read = (item: unknown, path: string, into: ValidationIssue[]) => requireString(item, path, into);
    expect(requireArrayOf(["a", 2, 3], "list", issues, read)).toBeUndefined();
    expect(issues.map((i) => i.path)).toEqual(["list[1]", "list[2]"]);
  });

  it("returns the narrowed array when every item reads cleanly", () => {
    const issues: ValidationIssue[] = [];
    const read = (item: unknown, path: string, into: ValidationIssue[]) => requireString(item, path, into);
    expect(requireArrayOf(["a", "b"], "list", issues, read)).toEqual(["a", "b"]);
    expect(issues).toHaveLength(0);
  });
});

describe("summarizeIssues", () => {
  it("joins one line per issue", () => {
    const issues: ValidationIssue[] = [];
    pushIssue(issues, "a", "first");
    pushIssue(issues, "b", "second");
    expect(summarizeIssues(issues)).toBe("a: first; b: second");
  });
});
