import { describe, expect, it } from "vitest";
import * as Icons from "./index.js";

/**
 * Data-shape checks for the 32 shipped glyphs — this directory's own
 * concern is that the DATA is well-formed (see `atoms/Icon.test.tsx` for
 * rendering/accessibility/colour-contract coverage, which now lives with
 * the render contract rather than here, per this package's ladder: `icons`
 * is pure data below `atoms`, and never renders anything itself).
 */
const glyphEntries = Object.entries(Icons) as [string, unknown][];

describe("shipped icon glyph data", () => {
  it("ships exactly 32 glyphs — the evidence-picked core carried over from the pre-merge icons package (see README.md)", () => {
    expect(glyphEntries.length).toBe(32);
  });

  it("no exported name ends in \"Icon\" — these are data, not components (see README.md \"Naming convention\")", () => {
    for (const [name] of glyphEntries) {
      expect(name.endsWith("Icon")).toBe(false);
    }
  });

  it("every export is a non-empty array of [tag, attrs] tuples", () => {
    for (const [name, value] of glyphEntries) {
      expect(Array.isArray(value), `${name} should be an array`).toBe(true);
      const node = value as ReadonlyArray<unknown>;
      expect(node.length, `${name} should have at least one element`).toBeGreaterThan(0);
      for (const entry of node) {
        expect(Array.isArray(entry), `${name}'s entries should be [tag, attrs] tuples`).toBe(true);
        const [tag, attrs] = entry as [unknown, unknown];
        expect(typeof tag, `${name}'s tag should be a string`).toBe("string");
        expect(typeof attrs, `${name}'s attrs should be an object`).toBe("object");
        expect(attrs).not.toBeNull();
      }
    }
  });

  it("every export name is unique (sanity — a barrel re-exporting the same name twice would silently shadow one)", () => {
    const names = glyphEntries.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every export name is PascalCase with no separators (matches this directory's naming convention)", () => {
    for (const [name] of glyphEntries) {
      expect(name).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    }
  });
});
