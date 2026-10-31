// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { loadCatalog, loadBuildCatalog, applyLibraryChange, libraryHash, resolve, check } from "../catalog-core/index.js";
import { malformed, cssText, flatten } from "../catalog-core/model.js";
import type { DtcgToken, DtcgValue, LibraryData } from "../catalog-core/types.js";
import { gradientColorAlias, gradientRoleColor, gradientStops, isFluidDimension } from "./expressive.js";
import tokenAmendments from "../catalog/ia/tokens.leaf-amendments.json" with { type: "json" };

const catalog = loadCatalog();
const empty = (): LibraryData => ({ source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-28", fills: [] });
function adopt(slot: string): LibraryData {
  const library = empty();
  return applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "adopt", slot, source: "foundry" }] });
}
const stops = (a = "{themes.background.default}", b = "{themes.card.default}"): DtcgValue => [{ color: a, position: 0 }, { color: b, position: 1 }];
function changedGradient(token: DtcgToken): LibraryData {
  const library = adopt("tokens.gradient");
  return applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "author", slot: "tokens.gradient", tokens: { wash: token } }] });
}
const relevant = (library: LibraryData) => check({ catalog, library }).findings.filter(row => row.severity === "error" && ["C1", "C2"].includes(row.code) && (row.subject.includes("gradient") || row.message.includes("gradient")));

describe("typed gradient colour roles", () => {
  it("offers the four draft roles and resolves their colour aliases independently in both modes", () => {
    const slot = catalog.slots.find(row => row.id === "tokens.gradient")!;
    expect(slot).toMatchObject({ status: "draft", contract: { $type: "gradient", tier: "role", modes: ["light", "dark"], members: { mode: "closed", names: ["border-shine", "glow", "media-scrim", "wash"] } } });
    const library = adopt(slot.id);
    expect(relevant(library)).toEqual([]);
    const profile = resolve({ catalog, library });
    for (const name of ["wash", "glow", "media-scrim", "border-shine"]) {
      const member = profile.members[`tokens.gradient.${name}`]!;
      expect(member.$type).toBe("gradient");
      expect(member.css.light).toMatch(/^linear-gradient\(180deg, var\(--/);
      expect(member.css.dark).toMatch(/^linear-gradient\(180deg, var\(--/);
      expect(member.value.light).not.toEqual(member.value.dark);
      expect(member.css.light).not.toContain("{tokens.");
      expect(member.css.dark).not.toContain("{tokens.");
      for (const value of [member.value.light, member.value.dark!]) expect(malformed("gradient", value)).toBe(false);
    }
  });
  it("follows the selected colour-role value in each mode", () => {
    const library = adopt("tokens.gradient");
    const red = { colorSpace: "srgb", components: [1, 0, 0] }, blue = { colorSpace: "srgb", components: [0, 0, 1] };
    const custom = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "author", slot: "themes.background", tokens: { default: { $type: "color", $value: red, $extensions: { "com.clossys.modes": { dark: blue } } } } }] });
    const member = resolve({ catalog, library: custom }).members["tokens.gradient.wash"]!;
    expect((member.value.light as { color: unknown }[])[0]!.color).toEqual(red);
    expect((member.value.dark as { color: unknown }[])[1]!.color).toEqual(blue);
    expect(member.css.light).toContain("var(--color-surface-base, color(srgb 1 0 0))");
    expect(member.css.dark).toContain("var(--color-surface-base, color(srgb 0 0 1))");
  });
  it("reports a missing role and rejects non-colour aliases, malformed stops and unsafe nested fields", () => {
    const missing = changedGradient({ $type: "gradient", $value: stops("{themes.background.default}") });
    expect(resolve({ catalog, library: missing }).members["tokens.gradient.wash"]).toBeUndefined();
    expect(relevant(missing).some(row => row.code === "C2")).toBe(true);
    const invalid: DtcgValue[] = [
      stops("{themes.spacing.default}"), [{ color: "{themes.background.default}", position: -1 }, { color: "{themes.card.default}", position: 1 }],
      [{ color: "{themes.background.default}", position: 1 }, { color: "{themes.card.default}", position: 0 }],
      [{ color: "{themes.background.default}", position: 0 }],
      [{ color: "{themes.background.default}", position: 0, extra: "red; display:none" }, { color: "{themes.card.default}", position: 1 }],
      [{ color: "{themes.background.default};display:none", position: 0 }, { color: "{themes.card.default}", position: 1 }],
    ];
    for (const value of invalid) {
      expect(malformed("gradient", value)).toBe(true);
      expect(relevant(changedGradient({ $type: "gradient", $value: value })).some(row => row.code === "C1")).toBe(true);
    }
  });
  it("rejects cycles and a colour-shaped alias whose declared target type is different", () => {
    for (const type of ["dimension", "color"] as const) {
      const library = adopt("tokens.gradient");
      const owner = library.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "themes.background")!;
      const value = flatten(owner)["themes.background.default"]!;
      value.$type = type;
      value.$value = type === "color" ? "{tokens.gradient.wash}" : { unit: "px", value: 1 };
      expect(resolve({ catalog, library }).members["tokens.gradient.wash"]).toBeUndefined();
      expect(check({ catalog, library }).findings).toEqual(expect.arrayContaining([expect.objectContaining({
        code: type === "color" ? "C2" : "C1", rule: type === "color" ? "reads" : "contract",
        message: expect.stringContaining(type === "color" ? "cycle tokens.gradient.wash" : "member themes.background.default has $type dimension"),
      })]));
    }
  });
  it("never admits or serializes a gradient raw CSS override", () => {
    const raw = "linear-gradient(red, blue)";
    const token: DtcgToken = { $type: "gradient", $value: stops(), $extensions: { "com.clossys.css": { raw } } };
    expect(malformed("gradient", token.$value, raw)).toBe(true);
    expect(cssText("gradient", [{ color: { colorSpace: "srgb", components: [1, 0, 0] }, position: 0 }, { color: { colorSpace: "srgb", components: [0, 0, 1] }, position: 1 }], token)).toBe("linear-gradient(180deg, color(srgb 1 0 0) 0%, color(srgb 0 0 1) 100%)");
    expect(relevant(changedGradient(token)).some(row => row.code === "C1")).toBe(true);
    expect(gradientColorAlias("{themes.background.default}")).toBe("themes.background.default");
    expect(gradientColorAlias("{themes.spacing.default}")).toBeUndefined();
    expect(gradientStops(stops())).toBe(true);
  });
  it("normalizes legacy border-role dark colours without admitting CSS strings as stops", () => {
    const member = resolve({ catalog, library: adopt("tokens.gradient") }).members["tokens.gradient.border-shine"]!;
    expect(member.value.dark).toEqual([
      { color: { colorSpace: "oklch", components: [0.4, 0, 0] }, position: 0 },
      { color: { colorSpace: "oklch", components: [0.3, 0, 0] }, position: 1 },
    ]);
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
  it("loads the added type, reveal-distance and open animation members through real adoption", () => {
    for (const leaf of ["display-size", "heading-size"]) {
      const library = adopt(`themes.${leaf}`);
      const value = resolve({ catalog, library }).members[`themes.${leaf}.2xl`]!;
      expect(isFluidDimension(value.value.light)).toBe(true);
      expect(check({ catalog, library }).findings.filter(row => row.severity === "error" && row.subject.includes(leaf))).toEqual([]);
    }
    const face = resolve({ catalog, library: adopt("themes.font-heading") }).members["themes.font-heading.default"]!;
    expect(face).toMatchObject({ $type: "number", value: { light: 72 } });
    expect(resolve({ catalog, library: adopt("tokens.shift-distance") }).members["tokens.shift-distance.reveal"]!.value.light).toEqual({ unit: "px", value: 24 });
    const animation = catalog.slots.find(row => row.id === "themes.animate-marquee")!;
    expect(animation.contract.members.mode).toBe("open");
    const motion = resolve({ catalog, library: adopt("themes.animate-marquee") });
    expect(Object.keys(motion.members).filter(id => id.startsWith("themes.animate-marquee.")).sort()).toEqual(["count", "marquee", "reveal", "scroll-reveal", "scroll-sticky", "stagger"].map(name => `themes.animate-marquee.${name}`));
  });
  it("allows only motion-read additions to existing section contracts", () => {
    const sections = loadBuildCatalog().slots.filter(slot => slot.layer === "sections");
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) expect((section.contract as { allowedReads: { themes: readonly string[] } }).allowedReads.themes).toEqual(expect.arrayContaining(["themes.animate-marquee", "tokens.shift-distance"]));
  });
});

describe("pending expressive leaf amendment", () => {
  it("preserves original signatures and records exactly the new draft leaf as pending", () => {
    expect(tokenAmendments.status).toBe("owner-signed");
    expect(tokenAmendments.addedLeaves.map(row => row.id)).toEqual(["tokens.container-width", "themes.animate-marquee"]);
    expect(tokenAmendments.pending).toMatchObject({ status: "pending-owner-ratification", source: "workspace#45 A131/A132 AUTO-DECIDED 2026-10-28", addedLeafIds: ["tokens.gradient"] });
  });
  it.each(["source", "status", "extra", "duplicate", "missing"])("refuses a changed pending %s", async edit => {
    const value = structuredClone(tokenAmendments);
    if (edit === "source") value.pending.source = "unapproved";
    if (edit === "status") value.pending.status = "owner-signed";
    if (edit === "extra") value.pending.addedLeafIds.push("tokens.unsupported");
    if (edit === "duplicate") value.pending.addedLeafIds.push("tokens.gradient");
    if (edit === "missing") value.pending.addedLeafIds = [];
    vi.resetModules();
    vi.doMock("../catalog/ia/tokens.leaf-amendments.json", () => ({ default: value }));
    try { await expect(import("../catalog-core/leaf-freeze.js")).rejects.toThrow("LEAF_FREEZE"); }
    finally { vi.doUnmock("../catalog/ia/tokens.leaf-amendments.json"); vi.resetModules(); }
  });
});
