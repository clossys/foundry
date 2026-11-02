import { describe, expect, it } from "vitest";
import { colorAlpha, contrastRatio, contrastRatioEncodedBlend, luminanceOf, parseOklch } from "./color.js";

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

describe("whole-expression transparent color recipes", () => {
  it("mixes in the declared space, including premultiplied alpha and normalized weights", () => {
    const encodedHalf = ((.5 + .055) / 1.055) ** 2.4;
    expect(luminanceOf("color-mix(in srgb, #000000, #ffffff)")).toBeCloseTo(encodedHalf, 8);
    expect(luminanceOf("color-mix(in srgb-linear, #000000, #ffffff)")).toBeCloseTo(.5, 8);
    expect(luminanceOf("color-mix(in oklab, #000000, #ffffff)")).toBeCloseTo(.125, 6);
    expect(colorAlpha("color-mix(in oklab, #ffffff 25%, transparent)")).toBe(.25);
    expect(luminanceOf("color-mix(in oklab, #ffffff 25%, transparent)", "#000000")).toBeCloseTo(.25, 6);
    expect(colorAlpha("color-mix(in srgb, #ffffff 20%, #000000 20%)")).toBe(.4);
    expect(colorAlpha("color-mix(in srgb, #ffffff 80%, #000000 80%)")).toBe(1);
    expect(luminanceOf("color-mix(in srgb-linear, #ffffff 80%, #000000 80%)")).toBeCloseTo(.5);
    expect(colorAlpha("color-mix(in srgb, transparent, transparent)")).toBe(0);
  });

  it("paints translucent ink over the actual painted background, not independently over the ground", () => {
    const ink = "oklch(1 0 0 / 0.5)", plate = "oklch(1 0 0 / 0.5)";
    expect(contrastRatio(ink, plate, "#000000")).toBeCloseTo((.75 + .05) / (.5 + .05), 6);
    const linear = (encoded: number) => ((encoded + .055) / 1.055) ** 2.4;
    expect(contrastRatioEncodedBlend(ink, plate, "#000000")).toBeCloseTo((linear(.75) + .05) / (linear(.5) + .05), 6);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
  });

  it("retains chromatic out-of-gamut channels until paint, including nested mixes", () => {
    // Independent OKLab matrix oracle: half of (.5,.5,0) is (.25,.25,0),
    // with linear RGB (.139163628,-.028805230,.012097339) before paint clipping.
    const expected = .030459615161014423;
    expect(luminanceOf("color-mix(in oklab, oklch(0.5 0.5 0), #000000)")).toBeCloseTo(expected, 7);
    expect(luminanceOf("color-mix(in srgb-linear, oklch(0.5 0.5 0), #000000)")).toBeCloseTo(4*expected, 7);
    expect(luminanceOf("color-mix(in oklab, color-mix(in oklab, oklch(0.5 0.5 0) 100%, transparent 0%), #000000)")).toBeCloseTo(expected, 7);
  });

  it.each([
    "color-mix(in lab, #ffffff, #000000)",
    "color-mix(in srgb, #ffffff -1%, #000000)",
    "color-mix(in srgb, #ffffff 101%, #000000)",
    "color-mix(in srgb, #ffffff 0%, #000000 0%)",
    "color-mix(in srgb, ffffff, 000000)",
    "color-mix(in srgb, #ffffff, #000000, transparent)",
    "color-mix(in srgb, unknown(#ffffff), #000000)",
    "color-mix(in srgb, #ffffff, oklch(1 0 0)) trailing",
    "linear-gradient(oklch(1 0 0), #000000)",
    "var(--missing, oklch(1 0 0))", "oklch(1 0 0 / 2)",
  ])("refuses unsupported or invalid complete expressions: %s", value => {
    expect(colorAlpha(value)).toBeUndefined();
    expect(() => contrastRatio(value, "#000000", "#ffffff")).toThrow();
  });

  it("refuses missing or translucent grounds and bounded-expression overflow", () => {
    const recipe = "color-mix(in srgb, #ffffff 50%, transparent)";
    expect(() => contrastRatio("#000000", recipe)).toThrow(/ground/);
    expect(() => contrastRatio("#000000", recipe, "transparent")).toThrow(/opaque/);
    expect(() => luminanceOf(recipe, "oklch(1 0 0 / 0.5)")).toThrow(/opaque/);
    const nested = Array.from({ length: 10 }).reduce<string>(value => `color-mix(in srgb, ${value}, transparent)`, "#ffffff");
    expect(colorAlpha(nested)).toBeUndefined();
  });
});
