// @vitest-environment node
import { describe, expect, it } from "vitest";
import { malformed, cssText } from "../catalog-core/model.js";
import type { DtcgToken, DtcgValue } from "../catalog-core/types.js";
import { gradientColorAlias, gradientRoleColor, gradientStops, isFluidDimension } from "./expressive.js";

const stops = (a = "{themes.background.default}", b = "{themes.card.default}"): DtcgValue => [{ color: a, position: 0 }, { color: b, position: 1 }];

describe("gradient value helpers", () => {
  it("never admits or serializes a gradient raw CSS override", () => {
    const raw = "linear-gradient(red, blue)";
    const token: DtcgToken = { $type: "gradient", $value: stops(), $extensions: { "com.clossys.css": { raw } } };
    expect(malformed("gradient", token.$value, raw)).toBe(true);
    expect(cssText("gradient", [{ color: { colorSpace: "srgb", components: [1, 0, 0] }, position: 0 }, { color: { colorSpace: "srgb", components: [0, 0, 1] }, position: 1 }], token)).toBe("linear-gradient(180deg, color(srgb 1 0 0) 0%, color(srgb 0 0 1) 100%)");
    expect(gradientColorAlias("{themes.background.default}")).toBe("themes.background.default");
    expect(gradientStops(stops())).toBe(true);
  });
  it("rejects malformed stops and CSS strings as stops", () => {
    const invalid: DtcgValue[] = [
      [{ color: "{themes.background.default}", position: -1 }, { color: "{themes.card.default}", position: 1 }],
      [{ color: "{themes.background.default}", position: 1 }, { color: "{themes.card.default}", position: 0 }],
      [{ color: "{themes.background.default}", position: 0 }],
      [{ color: "{themes.background.default}", position: 0, extra: "red; display:none" }, { color: "{themes.card.default}", position: 1 }],
      [{ color: "{themes.background.default};display:none", position: 0 }, { color: "{themes.card.default}", position: 1 }],
    ];
    for (const value of invalid) expect(malformed("gradient", value)).toBe(true);
    expect(gradientRoleColor("#123")).toEqual({ colorSpace: "srgb", components: [17 / 255, 34 / 255, 51 / 255], hex: "#112233" });
    expect(gradientRoleColor("oklch(.4 0 0 / .5)")).toEqual({ colorSpace: "oklch", components: [.4, 0, 0], alpha: .5 });
    for (const input of ["oklch(2 0 0)", "oklch(.4 -1 0)", "oklch(.4 0 999)", "oklch(.4 0 0 / 2)", "oklch(.4 0 0);display:none", "oklch(.4 0 0) red", "url(x)", "var(--color)", "#12", "#000000;display:none"]) expect(gradientRoleColor(input), input).toBeUndefined();
    expect(gradientStops([{ color: "oklch(.4 0 0)", position: 0 }, { color: "#000000", position: 1 }])).toBe(false);
  });
});

describe("bounded fluid dimensions and expressive members", () => {
  it.each(["clamp(3rem, 6vw, 5rem)", "clamp(48px, 10vmin, 120px)", "clamp(.5rem, 2vh, 2rem)"])("accepts %s with and without raw metadata", value => {
    expect(isFluidDimension(value)).toBe(true);
    expect(malformed("dimension", value)).toBe(false);
    expect(malformed("dimension", value, value)).toBe(false);
  });
  it.each(["clamp(5rem, 6vw, 3rem)", "clamp(3rem, 6vw)", "clamp(3rem, 6vw, 5rem, 7rem)", "clamp(0rem, 6vw, 5rem)", "clamp(3rem, -6vw, 5rem)", "clamp(3px, 6vw, 5rem)", "clamp(3rem, 6s, 5rem)", "clamp(3rem, var(--size), 5rem)", "clamp(3rem, url(x), 5rem)", "clamp(3rem, 6vw, 5rem);display:none", "clamp(3rem, calc(1rem + 6vw), 5rem)"])("refuses %s even through raw metadata", value => {
    expect(isFluidDimension(value)).toBe(false);
    expect(malformed("dimension", value)).toBe(true);
    expect(malformed("dimension", value, value)).toBe(true);
  });
});
