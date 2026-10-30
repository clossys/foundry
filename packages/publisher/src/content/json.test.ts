import { describe, expect, it } from "vitest";
import { isContentJson, isSourceAnswer } from "./json.js";

describe("stored source answers", () => {
  it("accepts readonly JSON object entries and repeated acyclic objects", () => {
    const answer = { question: "audience", answer: ["readers", null, true, 3] };
    expect(isSourceAnswer(answer)).toBe(true);
    expect(isContentJson([answer, answer])).toBe(true);
  });
  it.each([[], "answer", 3, null])("requires each answer to be an object: %s", value => {
    expect(isSourceAnswer(value)).toBe(false);
  });
  it.each([NaN, Infinity, undefined, () => null, new Date(), { missing: undefined }, new Array(1)])("refuses values JSON would silently change: %s", value => {
    expect(isContentJson(value)).toBe(false);
  });
  it("rejects cycles without recursing forever", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(isContentJson(cyclic)).toBe(false);
  });
});
