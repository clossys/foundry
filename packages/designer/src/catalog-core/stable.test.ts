import { describe, expect, it } from "vitest";
import { stableStringify } from "./stable.js";
import { EXAMPLE_FILLS } from "./__fixtures__/example-library.js";

describe("stableStringify", () => {
  it("writes recursive JSON with sorted object keys, preserved arrays and a newline", () => {
    expect(stableStringify({ b: 1, a: [1, { d: null, c: "x" }], e: {} })).toBe('{\n  "a": [\n    1,\n    {\n      "c": "x",\n      "d": null\n    }\n  ],\n  "b": 1,\n  "e": {}\n}\n');
  });
  it.each([
    [{ "500": 1, "50": 2, "100": 3 }, '{\n  "100": 3,\n  "50": 2,\n  "500": 1\n}\n'],
    [{ a: 1, B: 2 }, '{\n  "B": 2,\n  "a": 1\n}\n'],
    [{ "é": 1, z: 2 }, '{\n  "z": 2,\n  "é": 1\n}\n'],
    [{ "😀": 1, "ｚ": 2 }, '{\n  "😀": 1,\n  "ｚ": 2\n}\n'],
  ])("sorts by UTF-16 code units: %j", (value, text) => expect(stableStringify(value)).toBe(text));
  it("omits undefined object values and retains empty arrays", () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{\n  "b": 1\n}\n');
    expect(stableStringify([])).toBe("[]\n");
  });
  it.each([undefined, NaN, Infinity, () => 1, 1n, Symbol("x")])("rejects unsupported value %s", value => {
    expect(() => stableStringify(value)).toThrow(new TypeError("stableStringify: unsupported value"));
  });
  it("is idempotent for example fills", () => {
    for (const fill of EXAMPLE_FILLS) {
      const text = stableStringify(fill);
      expect(stableStringify(JSON.parse(text))).toBe(text);
    }
  });
});
