/**
 * The validation primitives, tested for the one property they all share:
 * nothing here ever substitutes a value it could not read.
 *
 * That is the whole reason this file exists rather than a schema library —
 * every failure below has to be recorded as an issue, at a named path, and
 * has to return `undefined` rather than a plausible default. A helper that
 * quietly filled in `false`, `0` or `Date.now()` would turn every downstream
 * gate finding into a clean pass.
 */
import { describe, expect, it } from "vitest";
import {
  describeValue,
  isOneOf,
  isPlainObject,
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
  it("accepts an object and rejects everything an object is commonly confused with", () => {
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
    expect(isOneOf("erased", ["erased", "failed", "unknown"])).toBe(true);
    expect(isOneOf("ERASED", ["erased", "failed", "unknown"])).toBe(false);
    expect(isOneOf(0, ["erased"])).toBe(false);
    expect(isOneOf(undefined, ["erased"])).toBe(false);
  });
});

describe("describeValue", () => {
  it("names a shape rather than printing an object's or an array's contents", () => {
    // A validation message from this package can end up in a CI log, and a
    // held item is by definition about a person. Only the shape is named.
    expect(describeValue({ subjectId: "sub_1" })).toBe("an object");
    expect(describeValue([1, 2, 3])).toBe("an array (3 item(s))");
    expect(describeValue(undefined)).toBe("undefined");
    expect(describeValue(null)).toBe("null");
    expect(describeValue(7)).toBe("7");
    expect(describeValue("x")).toBe('"x"');
  });
});

describe("requireString", () => {
  it("returns the value and records nothing when it is a string", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString("item_1", "items[0].itemId", issues)).toBe("item_1");
    expect(issues).toEqual([]);
  });

  it("records an issue at the named path and returns undefined for a non-string", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString(7, "items[0].itemId", issues)).toBeUndefined();
    expect(issues).toEqual([{ path: "items[0].itemId", message: "must be a string, got 7" }]);
  });

  it("rejects a whitespace-only value against a minimum length rather than trimming it into acceptance", () => {
    const issues: ValidationIssue[] = [];
    expect(requireString("   ", "items[0].holdingClass", issues, { minLength: 1 })).toBeUndefined();
    expect(issues).toHaveLength(1);
  });
});

describe("requireTimestamp", () => {
  it("accepts a parseable instant", () => {
    const issues: ValidationIssue[] = [];
    expect(requireTimestamp("2026-08-22T12:00:00.000Z", "items[0].heldSince", issues)).toBe("2026-08-22T12:00:00.000Z");
    expect(issues).toEqual([]);
  });

  it("records a failure rather than substituting the current instant", () => {
    // The disposal gate is arithmetic on these values. A fabricated one would
    // turn a record 400 days into a 90-day schedule into a record held since
    // this morning.
    const issues: ValidationIssue[] = [];
    expect(requireTimestamp("a while ago", "items[0].heldSince", issues)).toBeUndefined();
    expect(issues[0]?.message).toContain("parseable timestamp");
  });
});

describe("requireNumber", () => {
  it("enforces finiteness, wholeness and bounds, each with its own message", () => {
    const issues: ValidationIssue[] = [];
    expect(requireNumber(90, "schedule[0].days", issues, { min: 0, integer: true })).toBe(90);
    expect(requireNumber(Number.NaN, "a", issues)).toBeUndefined();
    expect(requireNumber(1.5, "b", issues, { integer: true })).toBeUndefined();
    expect(requireNumber(-1, "c", issues, { min: 0 })).toBeUndefined();
    expect(requireNumber(11, "d", issues, { max: 10 })).toBeUndefined();
    expect(issues.map((issue) => issue.path)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("requireBoolean", () => {
  it("accepts both booleans", () => {
    const issues: ValidationIssue[] = [];
    expect(requireBoolean(true, "disclosures[0].correctable", issues)).toBe(true);
    expect(requireBoolean(false, "disclosures[0].correctable", issues)).toBe(false);
    expect(issues).toEqual([]);
  });

  it("refuses an absent value rather than defaulting it in either direction", () => {
    // "They can read this but not change it" and "nobody recorded whether
    // they can change it" are different facts. A defaulted `false` makes the
    // second look like the first; a defaulted `true` makes an uncorrectable
    // holding look fine.
    const issues: ValidationIssue[] = [];
    expect(requireBoolean(undefined, "disclosures[0].correctable", issues)).toBeUndefined();
    expect(requireBoolean("true", "disclosures[1].correctable", issues)).toBeUndefined();
    expect(issues).toHaveLength(2);
  });
});

describe("requireArrayOf", () => {
  const readId = (item: unknown, path: string, issues: ValidationIssue[]) => requireString(item, path, issues, { minLength: 1 });

  it("reads every item and reports each failure at its own index", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf(["a", "b"], "ids", issues, readId)).toEqual(["a", "b"]);
    expect(requireArrayOf(["a", 2, "c", 4], "ids", issues, readId)).toBeUndefined();
    expect(issues.map((issue) => issue.path)).toEqual(["ids[1]", "ids[3]"]);
  });

  it("accepts an empty array — an empty record set is a real state a gate must be able to report on", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf([], "ids", issues, readId)).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("rejects a non-array", () => {
    const issues: ValidationIssue[] = [];
    expect(requireArrayOf({ 0: "a" }, "ids", issues, readId)).toBeUndefined();
    expect(issues[0]?.message).toContain("must be an array");
  });
});

describe("summarizeIssues and pushIssue", () => {
  it("joins issues one per line, path first, for a CLI to print directly", () => {
    const issues: ValidationIssue[] = [];
    pushIssue(issues, "items[0].origin", "must be one of authored, saved, observed, inferred");
    pushIssue(issues, "items[1].belief", "is required on an item whose origin is inferred");
    expect(summarizeIssues(issues)).toBe(
      "items[0].origin: must be one of authored, saved, observed, inferred; items[1].belief: is required on an item whose origin is inferred",
    );
  });
});
