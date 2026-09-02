import { describe, expect, it } from "vitest";
import { canonicalJson, nonEmptyString, sameCanonicalJson, sameSet, sorted } from "./canonical.js";

describe("sorted", () => {
  it("returns a sorted shallow copy", () => {
    expect(sorted(["b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const input = ["b", "a"];
    sorted(input);
    expect(input).toEqual(["b", "a"]);
  });

  it("treats null and undefined as empty", () => {
    expect(sorted(null)).toEqual([]);
    expect(sorted(undefined)).toEqual([]);
  });

  it("uses default lexicographic ordering, not numeric ordering", () => {
    expect(sorted([10, 2, 1])).toEqual([1, 10, 2]);
  });
});

describe("sameSet", () => {
  it("is true for the same members in different order", () => {
    expect(sameSet(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("is true for two empty arrays", () => {
    expect(sameSet([], [])).toBe(true);
  });

  it("is false when a member is missing", () => {
    expect(sameSet(["a", "b"], ["a"])).toBe(false);
  });

  it("is false when a member is added", () => {
    expect(sameSet(["a", "b"], ["a", "b", "c"])).toBe(false);
  });

  it("does not deduplicate: a duplicate-count mismatch is a real difference", () => {
    expect(sameSet(["a", "a", "b"], ["a", "b"])).toBe(false);
  });

  it("is true when both sides carry the same duplicate exactly once each", () => {
    expect(sameSet(["a", "a", "b"], ["a", "b", "a"])).toBe(true);
  });

  it("is false for a non-array input on either side", () => {
    expect(sameSet("a,b", ["a", "b"])).toBe(false);
    expect(sameSet(["a", "b"], null)).toBe(false);
    expect(sameSet(undefined, undefined)).toBe(false);
  });
});

describe("nonEmptyString", () => {
  it("accepts a real string", () => {
    expect(nonEmptyString("hello")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(nonEmptyString("")).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(nonEmptyString("   \n\t")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(nonEmptyString(0)).toBe(false);
    expect(nonEmptyString(null)).toBe(false);
    expect(nonEmptyString(undefined)).toBe(false);
    expect(nonEmptyString({})).toBe(false);
    expect(nonEmptyString([])).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
    expect(JSON.stringify(canonicalJson({ b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
  });

  it("sorts keys recursively, at every depth", () => {
    const input = { z: { d: 1, c: 2 }, a: 1 };
    expect(JSON.stringify(canonicalJson(input))).toBe('{"a":1,"z":{"c":2,"d":1}}');
  });

  it("keeps array element order — only object key order is normalized", () => {
    expect(canonicalJson([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it("canonicalizes objects nested inside arrays", () => {
    const input = [{ b: 1, a: 2 }, { d: 3, c: 4 }];
    expect(JSON.stringify(canonicalJson(input))).toBe('[{"a":2,"b":1},{"c":4,"d":3}]');
  });

  it("canonicalizes arrays nested inside objects", () => {
    const input = { list: [{ b: 1, a: 2 }] };
    expect(JSON.stringify(canonicalJson(input))).toBe('{"list":[{"a":2,"b":1}]}');
  });

  it("passes null through unchanged", () => {
    expect(canonicalJson(null)).toBeNull();
    expect(canonicalJson({ a: null })).toEqual({ a: null });
  });

  it("passes primitives through unchanged", () => {
    expect(canonicalJson("x")).toBe("x");
    expect(canonicalJson(1)).toBe(1);
    expect(canonicalJson(true)).toBe(true);
    expect(canonicalJson(undefined)).toBeUndefined();
  });

  it("handles an empty object and an empty array", () => {
    expect(canonicalJson({})).toEqual({});
    expect(canonicalJson([])).toEqual([]);
  });
});

describe("sameCanonicalJson", () => {
  it("is true for the same object with different key order", () => {
    expect(sameCanonicalJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("is true for deeply nested objects with different key order at every depth", () => {
    const left = { top: { z: 1, a: { y: 2, b: 3 } } };
    const right = { top: { a: { b: 3, y: 2 }, z: 1 } };
    expect(sameCanonicalJson(left, right)).toBe(true);
  });

  it("is false when a nested value differs", () => {
    expect(sameCanonicalJson({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("is sensitive to array order — arrays are data, not sets", () => {
    expect(sameCanonicalJson([1, 2], [2, 1])).toBe(false);
  });

  it("is true for two nulls and false for null vs an empty object", () => {
    expect(sameCanonicalJson(null, null)).toBe(true);
    expect(sameCanonicalJson(null, {})).toBe(false);
  });

  it("is false when key sets differ", () => {
    expect(sameCanonicalJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("is true for two structurally identical documents built independently", () => {
    const reviewed = JSON.parse('{"version":1,"rules":["a","b"],"note":"x"}');
    const candidate = JSON.parse('{"note":"x","rules":["a","b"],"version":1}');
    expect(sameCanonicalJson(reviewed, candidate)).toBe(true);
  });
});
