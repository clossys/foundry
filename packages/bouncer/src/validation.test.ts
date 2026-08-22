/**
 * The validation primitives, and the one property that matters across all of
 * them: nothing is ever coerced. A value this cannot read produces an issue
 * and `undefined`, never a substituted default — because every substitution
 * here is a chance for authority nobody can account for to validate cleanly.
 */
import { describe, expect, it } from "vitest";
import {
  describeValue,
  isOneOf,
  isPlainObject,
  optionalString,
  optionalTimestamp,
  requireArrayOf,
  requireBoolean,
  requireNumber,
  requireNumberOrNull,
  requireString,
  requireStringArray,
  requireTimestamp,
  summarizeIssues,
  type ValidationIssue,
} from "./validation.js";

function issues(): ValidationIssue[] {
  return [];
}

describe("isPlainObject", () => {
  it("accepts only a plain object — never an array, and never null", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
  });
});

describe("isOneOf", () => {
  it("decides membership by the caller's own literal list, never by shape", () => {
    expect(isOneOf("reachable", ["reachable", "unreachable"])).toBe(true);
    expect(isOneOf("REACHABLE", ["reachable", "unreachable"])).toBe(false);
    expect(isOneOf(1, ["reachable"])).toBe(false);
  });
});

describe("describeValue", () => {
  it("summarises rather than reproducing, so a record's contents never reach an error message", () => {
    expect(describeValue({ subjectId: "person-1" })).toBe("an object");
    expect(describeValue([1, 2, 3])).toBe("an array (3 item(s))");
    expect(describeValue(undefined)).toBe("undefined");
    expect(describeValue(null)).toBe("null");
    expect(describeValue("person-1")).toBe('"person-1"');
  });
});

describe("requireString", () => {
  it("records an issue and returns undefined rather than coercing", () => {
    const found = issues();
    expect(requireString(42, "grants[0].actorId", found)).toBeUndefined();
    expect(found).toEqual([{ path: "grants[0].actorId", message: "must be a string, got 42" }]);
  });

  it("counts non-whitespace characters, so a padded empty string is still empty", () => {
    const found = issues();
    expect(requireString("   ", "a", found, { minLength: 1 })).toBeUndefined();
    expect(found).toHaveLength(1);
  });

  it("leaves an absent optional field alone, with no issue", () => {
    const found = issues();
    expect(optionalString(undefined, "a", found)).toBeUndefined();
    expect(found).toHaveLength(0);
  });
});

describe("requireTimestamp", () => {
  it("refuses a time it cannot order rather than treating it as now", () => {
    const found = issues();
    expect(requireTimestamp("whenever", "grants[0].grantedAt", found)).toBeUndefined();
    expect(found[0]?.message).toMatch(/parseable timestamp/);
  });

  it("accepts a real instant and returns it unchanged, never a reformatted one", () => {
    const found = issues();
    expect(requireTimestamp("2026-08-22T00:00:00.000Z", "a", found)).toBe("2026-08-22T00:00:00.000Z");
    expect(found).toHaveLength(0);
  });

  it("leaves an absent optional timestamp alone", () => {
    const found = issues();
    expect(optionalTimestamp(undefined, "a", found)).toBeUndefined();
    expect(found).toHaveLength(0);
  });
});

describe("requireNumber", () => {
  it("rejects a non-finite number, which no bound can be checked against", () => {
    const found = issues();
    expect(requireNumber(Number.NaN, "a", found)).toBeUndefined();
    expect(requireNumber(Number.POSITIVE_INFINITY, "b", found)).toBeUndefined();
    expect(found).toHaveLength(2);
  });

  it("enforces min, max and integrality when asked", () => {
    const found = issues();
    expect(requireNumber(-1, "a", found, { min: 0 })).toBeUndefined();
    expect(requireNumber(2, "b", found, { max: 1 })).toBeUndefined();
    expect(requireNumber(1.5, "c", found, { integer: true })).toBeUndefined();
    expect(requireNumber(1, "d", found, { min: 0, max: 1, integer: true })).toBe(1);
    expect(found).toHaveLength(3);
  });
});

describe("requireNumberOrNull", () => {
  it("keeps an explicit null apart from a number, which is the whole delegation-ceiling distinction", () => {
    const found = issues();
    expect(requireNumberOrNull(null, "a", found)).toBeNull();
    expect(requireNumberOrNull(250, "b", found)).toBe(250);
    expect(found).toHaveLength(0);
  });

  it("still refuses a value that is neither", () => {
    const found = issues();
    expect(requireNumberOrNull("unlimited", "a", found)).toBeUndefined();
    expect(found).toHaveLength(1);
  });
});

describe("requireBoolean", () => {
  it("refuses a truthy string or number — \"false\" is a string, and a string is not an answer", () => {
    const found = issues();
    expect(requireBoolean("false", "a", found)).toBeUndefined();
    expect(requireBoolean(0, "b", found)).toBeUndefined();
    expect(requireBoolean(false, "c", found)).toBe(false);
    expect(found).toHaveLength(2);
  });
});

describe("requireArrayOf", () => {
  it("fails the whole array when any item fails, and records every failing item's own path", () => {
    const found = issues();
    const read = (item: unknown, path: string, into: ValidationIssue[]) => requireString(item, path, into, { minLength: 1 });
    expect(requireArrayOf(["a", 2, "", "d"], "list", found, read)).toBeUndefined();
    expect(found.map((issue) => issue.path)).toEqual(["list[1]", "list[2]"]);
  });

  it("accepts an empty array — empty is a shape question, not a content question", () => {
    const found = issues();
    expect(requireArrayOf([], "list", found, () => undefined)).toEqual([]);
    expect(found).toHaveLength(0);
  });

  it("refuses a non-array outright", () => {
    const found = issues();
    expect(requireArrayOf({ length: 0 }, "list", found, () => "x")).toBeUndefined();
    expect(found[0]?.message).toMatch(/must be an array/);
  });
});

describe("requireStringArray", () => {
  it("refuses an empty string inside an otherwise valid list", () => {
    const found = issues();
    expect(requireStringArray(["records.read", ""], "toolScope", found)).toBeUndefined();
    expect(found).toHaveLength(1);
  });
});

describe("summarizeIssues", () => {
  it("joins into one printable line per issue", () => {
    expect(summarizeIssues([{ path: "a", message: "bad" }, { path: "b", message: "worse" }])).toBe("a: bad; b: worse");
  });
});
