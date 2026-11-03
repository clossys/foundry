import { describe, expect, it } from "vitest";
import { applyLibraryChange, libraryHash, loadCatalog, resolve } from "../catalog-core/index.js";
import type { LibraryData } from "../catalog-core/types.js";
import { resolveHeroBackdrop } from "../blocks/hero/hero-backdrop.js";
import { PATTERN_BACKDROP_SLOT, patternBackdropFromResolved, patternBackdropMember } from "./pattern-backdrop.js";

function adopted() {
  const catalog = loadCatalog();
  const initial: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, fills: [], adoptedAt: "2026-11-02" };
  const library = applyLibraryChange(catalog, initial, { baseHash: libraryHash(initial), changes: [{ op: "adopt", slot: PATTERN_BACKDROP_SLOT, source: "foundry" }] });
  return resolve({ catalog, library });
}

describe("Hero graphic backdrop on assets.pattern", () => {
  it("names the default grid member or an explicit pattern member, and nothing else", () => {
    expect(patternBackdropMember("assets.pattern")).toBe("grid");
    expect(patternBackdropMember("assets.pattern.dots")).toBe("dots");
    expect(patternBackdropMember("assets.pattern.mesh")).toBeUndefined();
    expect(patternBackdropMember("assets.backdrop-graphic")).toBeUndefined();
    expect(patternBackdropMember("asset.backdrop.graphic")).toBeUndefined();
  });
  it("paints the consumer's resolved pattern recipe through the unchanged Hero graphic kind", () => {
    const resolved = adopted();
    const graphic = patternBackdropFromResolved("assets.pattern.dots", resolved)!;
    expect(graphic.style.backgroundImage).toContain("radial-gradient(circle, var(--color-line-strong)");
    expect(graphic.style.backgroundSize).toBe("calc(var(--spacing-xl) * 1) calc(var(--spacing-xl) * 1)");
    expect(resolveHeroBackdrop({ kind: "graphic", asset: "assets.pattern" }, resolved)).toMatchObject({ kind: "graphic", graphic: { format: "css", style: { backgroundRepeat: "repeat" } } });
  });
  it("shows a NEED instead of inventing paint when the consumer holds no pattern or names the dropped leaf", () => {
    expect(resolveHeroBackdrop({ kind: "graphic", asset: "assets.pattern" })).toEqual({ kind: "graphic", need: "NEED Assets leaf: assets.pattern" });
    expect(resolveHeroBackdrop({ kind: "graphic", asset: "assets.backdrop-graphic" }, adopted())).toEqual({ kind: "graphic", need: "NEED Assets leaf: assets.backdrop-graphic" });
  });
});
