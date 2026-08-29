import { describe, expect, it } from "vitest";
import { parseOklch } from "./color.js";

describe("parseOklch", () => {
  it("preserves the first complete function and optional-alpha semantics", () => {
    expect(parseOklch("linear-gradient(oklch(0.6 0.2 120 / 0.4), white)")).toEqual({
      L: 0.6,
      C: 0.2,
      H: 120,
      A: 0.4,
    });
    expect(parseOklch("prefix oklch(0.5 0 0) suffix").A).toBe(1);
  });

  it("skips an invalid near-match and finds the next complete function", () => {
    expect(parseOklch("oklch(0.5 nope) then oklch(0.7 0.1 90)")).toEqual({
      L: 0.7,
      C: 0.1,
      H: 90,
      A: 1,
    });
  });

  it("rejects attacker-sized whitespace after a near-match in linear time", () => {
    const hostile = `oklch(. . .${" ".repeat(200_000)}not-a-close`;
    expect(() => parseOklch(hostile)).toThrow(/no oklch/);
  });
});
