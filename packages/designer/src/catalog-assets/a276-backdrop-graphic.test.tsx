import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadCatalog, applyLibraryChange, libraryHash, resolve, parseFill, assertIAPlacements, check } from "../catalog-core/index.js";
import type { DtcgToken, LibraryData, Resolved } from "../catalog-core/types.js";
import { BACKDROP_GRAPHIC_PATTERNS, BACKDROP_GRAPHIC_SLOT, backdropGraphic, backdropGraphicFromResolved, isBackdropGraphicRecipe } from "./backdrop-graphic.js";
import { a276BackdropGraphicFill, a276BackdropGraphicReference, withA276BackdropGraphic } from "./a276-backdrop-graphic.contribution.js";
import { A276BackdropGraphicSpecimen, type BackdropGraphicSpecimenLabels } from "../studio/a276-backdrop-graphic-specimen.js";

const labels: BackdropGraphicSpecimenLabels = { title: "ExampleCo", patterns: { mesh: "Mesh", grid: "Grid", dot: "Dot", noise: "Noise" }, modes: { light: "Light", dark: "Dark" } };
function nativeProfile(accent = "#2468ac", darkAccent = "#8ab4de") {
  const catalog = loadCatalog();
  const initial: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, fills: [], adoptedAt: "2026-10-30" };
  const color = (light: string, dark: string): DtcgToken => ({ $type: "color", $value: light, $extensions: { "com.clossys.modes": { dark } } });
  const library = applyLibraryChange(catalog, initial, { baseHash: libraryHash(initial), changes: [
    { op: "author", slot: "themes.primary", tokens: { default: color(accent, darkAccent) } },
    { op: "author", slot: "themes.background", tokens: { default: color("#f9fafb", "#121519") } },
    { op: "adopt", slot: BACKDROP_GRAPHIC_SLOT, source: "foundry" },
  ] });
  return { catalog, library, resolved: resolve({ catalog, library }) };
}

describe("backdrop graphic native draft contribution", () => {
  it("parses, places, adopts and resolves every rules member through the actual native catalog", () => {
    expect(parseFill(a276BackdropGraphicFill).findings).toEqual([]);
    const { catalog, library, resolved } = nativeProfile();
    expect(() => assertIAPlacements(catalog.placements, catalog.slots)).not.toThrow();
    expect(catalog.slots.find(slot => slot.id === BACKDROP_GRAPHIC_SLOT)?.status).toBe("draft");
    expect(a276BackdropGraphicReference).toEqual({ reference: "asset.backdrop.graphic", slot: "assets.backdrop-graphic", defaultMember: "mesh" });
    for (const pattern of BACKDROP_GRAPHIC_PATTERNS) {
      const member = resolved.members[`${BACKDROP_GRAPHIC_SLOT}.${pattern}`]!;
      expect(member.$type).toBe("rules");
      expect(member.via).toBe("adopted");
      expect(isBackdropGraphicRecipe(member.value.light)).toBe(true);
    }
    expect(check({ catalog, library }).findings.filter(f => f.severity === "error" && f.subject.includes(BACKDROP_GRAPHIC_SLOT))).toEqual([]);
  });
  it.each(BACKDROP_GRAPHIC_PATTERNS)("renders deterministic %s using only resolved consumer light/dark colors", pattern => {
    const { resolved } = nativeProfile();
    const light = backdropGraphicFromResolved(pattern, resolved, "light");
    const dark = backdropGraphicFromResolved(pattern, resolved, "dark");
    expect(light).toEqual(backdropGraphicFromResolved(pattern, resolved, "light"));
    expect(light.style.backgroundColor).toBe("#f9fafb");
    expect(dark.style.backgroundColor).toBe("#121519");
    expect(light.style.backgroundImage).toContain("#2468ac");
    expect(dark.style.backgroundImage).toContain("#8ab4de");
    expect(light.source).not.toEqual(dark.source);
    const colors = light.source.match(/#[a-f0-9]+/gi) ?? [];
    expect([...new Set(colors)].sort()).toEqual(["#2468ac", "#f9fafb"]);
    expect(light.source).not.toMatch(/url\(|https?:|filter|animation|@media/);
    const overridden = backdropGraphicFromResolved(pattern, nativeProfile("#ac6824").resolved, "light");
    expect(overridden.style.backgroundImage).toContain("#ac6824");
    expect(overridden.source).not.toContain("#2468ac");
    const inherited = backdropGraphic(pattern);
    expect(inherited.source).toContain("var(--color-accent)");
    expect(inherited.source).toContain("var(--color-surface-base)");
    expect(inherited.source).not.toMatch(/#[a-f0-9]+/i);
  });
  it("fails on missing consumer paint and invalid patterns instead of supplying brand defaults", () => {
    expect(() => backdropGraphicFromResolved("mesh", { members: {} } as Resolved, "light")).toThrow("themes.primary.default");
    expect(() => backdropGraphic("other" as "mesh")).toThrow("Unknown");
    expect(() => backdropGraphic("mesh", { accent: "red;background:red", surface: "var(--surface)" })).toThrow();
    expect(isBackdropGraphicRecipe({ pattern: "mesh", accent: "red", surface: "blue" })).toBe(false);
  });
  it("composes Designer leaf chrome with all four patterns in both actual resolved modes and required caller labels", () => {
    const html = renderToStaticMarkup(<A276BackdropGraphicSpecimen resolved={nativeProfile().resolved} labels={labels} />);
    expect(html).toContain('data-layer="assets"');
    expect(html).toContain('data-asset-specimen="backdrop-graphic"');
    expect(html.match(/data-backdrop-pattern=/g)).toHaveLength(8);
    expect(html.match(/data-specimen-theme="light"/g)).toHaveLength(4);
    expect(html.match(/data-specimen-theme="dark"/g)).toHaveLength(4);
    for (const pattern of BACKDROP_GRAPHIC_PATTERNS) expect(html).toContain(`data-backdrop-pattern="${pattern}"`);
    expect(html).toContain("ExampleCo");
    expect(html).toContain("#8ab4de");
    expect(html).toContain("#121519");
    expect(html).not.toContain("DEFAULT_LABELS");
  });
});
