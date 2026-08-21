import { describe, expect, it } from "vitest";
import { assignCategoricalColor, MAX_CATEGORICAL_SERIES, resolveSeriesColor } from "./chart-vars.js";

describe("assignCategoricalColor", () => {
  it("supports exactly 8 fixed-order slots", () => {
    expect(MAX_CATEGORICAL_SERIES).toBe(8);
  });

  it("returns a distinct var() read for every valid index, in fixed order", () => {
    const colors = Array.from({ length: MAX_CATEGORICAL_SERIES }, (_, i) => assignCategoricalColor(i));
    expect(new Set(colors).size).toBe(MAX_CATEGORICAL_SERIES);
    expect(colors[0]).toContain("--color-chart-categorical-1");
    expect(colors[7]).toContain("--color-chart-categorical-8");
  });

  it("throws — rather than silently wrapping/cycling — for the 9th (index 8) slot", () => {
    expect(() => assignCategoricalColor(8)).toThrow(RangeError);
    expect(() => assignCategoricalColor(8)).toThrow(/out of range/);
  });

  it("throws for a negative index", () => {
    expect(() => assignCategoricalColor(-1)).toThrow(RangeError);
  });

  it("every returned value is a var() read carrying a real hex fallback (never resolves to nothing if tokens.css isn't loaded)", () => {
    for (let i = 0; i < MAX_CATEGORICAL_SERIES; i++) {
      expect(assignCategoricalColor(i)).toMatch(/^var\(--color-chart-categorical-\d, #[0-9a-f]{6}\)$/);
    }
  });
});

describe("resolveSeriesColor", () => {
  it("an explicit color always wins", () => {
    expect(resolveSeriesColor("A", 0, undefined, "#123456")).toBe("#123456");
  });

  it("with no colorDomain, falls back to the positional index (today's array position)", () => {
    expect(resolveSeriesColor("A", 3, undefined, undefined)).toBe(assignCategoricalColor(3));
  });

  it("with a colorDomain, uses the NAME's position in the domain, not its position in the current render", () => {
    const domain = ["A", "B", "C"];
    // "C" sits at positional index 0 in THIS render (e.g. "A"/"B" were filtered out),
    // but its domain position is 2 — the domain position must win.
    expect(resolveSeriesColor("C", 0, domain, undefined)).toBe(assignCategoricalColor(2));
  });

  it("color follows the entity across a filtered render: an entity's resolved color is identical whether or not its neighbors are present, given the same colorDomain", () => {
    const domain = ["Revenue", "Cost", "Refunds"];
    const fullRenderColor = resolveSeriesColor("Refunds", 2, domain, undefined); // all three present, Refunds at position 2
    const filteredRenderColor = resolveSeriesColor("Refunds", 0, domain, undefined); // Revenue/Cost filtered out, Refunds now at position 0
    expect(filteredRenderColor).toBe(fullRenderColor);
  });

  it("falls back to the positional index if the name isn't found in colorDomain", () => {
    expect(resolveSeriesColor("Z", 1, ["A", "B"], undefined)).toBe(assignCategoricalColor(1));
  });
});
