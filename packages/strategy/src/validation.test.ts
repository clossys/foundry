import { describe, expect, it } from "vitest";
import {
  describeValue,
  isOneOf,
  isPlainObject,
  optionalString,
  optionalStringArray,
  pushIssue,
  requireArrayOf,
  requireBoolean,
  requireNumber,
  requirePattern,
  requireString,
  requireStringArray,
  summarizeIssues,
  type ValidationIssue,
} from "./validation.js";

describe("isPlainObject", () => {
  it("is true only for a plain object", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("is false for an array, null, and primitives", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(1)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe("isOneOf", () => {
  it("matches a member of the list", () => {
    expect(isOneOf("now", ["now", "next"] as const)).toBe(true);
  });

  it("rejects a non-member or a non-string", () => {
    expect(isOneOf("someday", ["now", "next"] as const)).toBe(false);
    expect(isOneOf(1, ["now", "next"] as const)).toBe(false);
  });
});

describe("describeValue", () => {
  it("describes common shapes without dumping full content", () => {
    expect(describeValue(undefined)).toBe("undefined");
    expect(describeValue(null)).toBe("null");
    expect(describeValue([1, 2])).toBe("an array (2 item(s))");
    expect(describeValue({ a: 1 })).toBe("an object");
    expect(describeValue("hi")).toBe('"hi"');
    expect(describeValue(42)).toBe("42");
  });
});

describe("requireString / optionalString", () => {
  it("accepts a string meeting minLength", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString("hello", "field", issues, { minLength: 3 })).toBe("hello");
    expect(issues).toEqual([]);
  });

  it("records an issue for a non-string", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString(42, "field", issues)).toBeUndefined();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("field");
  });

  it("records an issue for a too-short string", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString("hi", "field", issues, { minLength: 5 })).toBeUndefined();
    expect(issues).toHaveLength(1);
  });

  it("optionalString passes undefined through with no issue", () => {
    const issues: ValidationIssue[] = [];
    expect(optionalString(undefined, "field", issues)).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("optionalString still validates a present value", () => {
    const issues: ValidationIssue[] = [];
    expect(optionalString(42, "field", issues)).toBeUndefined();
    expect(issues).toHaveLength(1);
  });
});

describe("requireNumber / requireBoolean", () => {
  it("accepts a real number, rejects NaN and non-numbers", () => {
    const issues: ValidationIssue[] = [];
    expect(requireNumber(42, "field", issues)).toBe(42);
    expect(requireNumber(Number.NaN, "field", issues)).toBeUndefined();
    expect(requireNumber("42", "field", issues)).toBeUndefined();
    expect(issues).toHaveLength(2);
  });

  it("accepts only real booleans", () => {
    const issues: ValidationIssue[] = [];
    expect(requireBoolean(true, "field", issues)).toBe(true);
    expect(requireBoolean("true", "field", issues)).toBeUndefined();
    expect(issues).toHaveLength(1);
  });
});

describe("requirePattern", () => {
  it("returns true/false and records an issue on mismatch", () => {
    const issues: ValidationIssue[] = [];
    expect(requirePattern("abc", "field", issues, /^[a-z]+$/, "must be lowercase letters")).toBe(true);
    expect(requirePattern("ABC", "field", issues, /^[a-z]+$/, "must be lowercase letters")).toBe(false);
    expect(issues).toEqual([{ path: "field", message: "must be lowercase letters" }]);
  });
});

describe("requireStringArray / optionalStringArray", () => {
  it("accepts an array of strings meeting itemMinLength", () => {
    const issues: ValidationIssue[] = [];
    expect(requireStringArray(["a", "bb"], "field", issues, { itemMinLength: 1 })).toEqual(["a", "bb"]);
    expect(issues).toEqual([]);
  });

  it("rejects a non-array", () => {
    const issues: ValidationIssue[] = [];
    expect(requireStringArray("nope", "field", issues)).toBeUndefined();
    expect(issues).toHaveLength(1);
  });

  it("reports one issue per bad item, indexed", () => {
    const issues: ValidationIssue[] = [];
    expect(requireStringArray(["ok", 42, "also ok", null], "field", issues)).toBeUndefined();
    expect(issues.map((i) => i.path)).toEqual(["field[1]", "field[3]"]);
  });

  it("optionalStringArray passes undefined through with no issue", () => {
    const issues: ValidationIssue[] = [];
    expect(optionalStringArray(undefined, "field", issues)).toBeUndefined();
    expect(issues).toEqual([]);
  });
});

describe("requireArrayOf", () => {
  const readEven = (item: unknown, path: string, issues: ValidationIssue[]): number | undefined => {
    if (typeof item === "number" && item % 2 === 0) return item;
    pushIssue(issues, path, "must be an even number");
    return undefined;
  };

  it("collects every item's parsed value when all succeed", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf([2, 4, 6], "field", issues, readEven)).toEqual([2, 4, 6]);
    expect(issues).toEqual([]);
  });

  it("returns undefined and records every failing item's issue when any fail", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf([2, 3, 4, 5], "field", issues, readEven)).toBeUndefined();
    expect(issues).toEqual([
      { path: "field[1]", message: "must be an even number" },
      { path: "field[3]", message: "must be an even number" },
    ]);
  });

  it("enforces minLength before reading any item", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf([], "field", issues, readEven, { minLength: 1 })).toBeUndefined();
    expect(issues).toHaveLength(1);
  });
});

describe("summarizeIssues", () => {
  it("joins path: message pairs with '; '", () => {
    expect(
      summarizeIssues([
        { path: "a", message: "bad" },
        { path: "b", message: "also bad" },
      ]),
    ).toBe("a: bad; b: also bad");
  });

  it("returns an empty string for no issues", () => {
    expect(summarizeIssues([])).toBe("");
  });
});
