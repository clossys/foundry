/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { applyLibraryChange, check, emit, libraryHash, loadCatalog, resolve } from "./index.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { syntheticSurface } from "./__fixtures__/surface-engine/synthetic.js";
import { flatten } from "./model.js";
import type { CompositeEngineInput, CompositeLibraryData, LibraryData } from "./types.js";

const source = { id: "example", kind: "consumer", author: "consumer", license: "MIT" } as const;
/** Real adopted token/glyph bytes; no Badge or transparent-ground prerequisite. */
function home() {
  const values = loadCatalog();
  let library: LibraryData = { ...completedTokenLibrary(values, source, "2026-10-23"), complete: false };
  const glyphs = ["assets.icon-chevron-right", "assets.icon-info"];
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes: glyphs.map(slot => ({ op: "adopt" as const, slot, source: "lucide" })) });
  const catalog = { values, components: { slots: [], fills: [] } };
  const composite: CompositeLibraryData = { source, adoptedAt: library.adoptedAt, values: library, components: { fills: [], files: [] } };
  return { catalog, library, glyphs, composite };
}

describe("native Home adopted asset supplier through the public facade", () => {
  it("materializes exactly the actual adopted glyphs and rechecks scope on the same objects", () => {
    const state = home();
    const input: CompositeEngineInput = { catalog: state.catalog, library: state.composite, valueOptions: { assetScope: "adopted" } };
    const profile = resolve(input);
    expect(check(input).ok).toBe(true);
    expect(profile.check.ok).toBe(true);
    expect(Object.keys(profile.values.members).filter(id => id.startsWith("assets."))).toEqual(state.glyphs.map(slot => `${slot}.default`).sort());
    expect(emit(profile, ["css-brand"]).some(file => file.path === "brand.css")).toBe(true);
    expect(profile.check.findings.some(finding => finding.code === "A6" || finding.code === "A12" && finding.subject === "assets.favicon")).toBe(false);
    input.valueOptions!.assetScope = "catalog";
    expect(resolve(input).check.ok).toBe(false);
    input.valueOptions!.assetScope = "adopted";
    expect(resolve(input).check.ok).toBe(true);
  });

  it("carries asset context through public surface apply while runtime qualification stays pending", () => {
    const state = home(), fixture = syntheticSurface();
    const catalog = { ...state.catalog, surfaces: fixture.input.catalog.surfaces };
    const options = { valueOptions: { assetScope: "adopted" as const }, surfaceOptions: { packages: [], measurements: [] } };
    const next = applyLibraryChange(catalog, state.composite, { baseHash: libraryHash(state.composite), changes: [{ portion: "surfaces", change: { op: "adopt", slot: "sections.synthetic", source: "synthetic" } }], surfaceBundles: [fixture.bundle] }, options);
    const profile = resolve({ catalog, library: next, ...options });
    expect(next.surfaces!.fills).toHaveLength(1);
    expect(profile.check.findings.filter(finding => ["A6", "A12"].includes(finding.code) && finding.severity === "error")).toEqual([]);
    expect(profile.surfaces!.check.findings.some(finding => finding.code === "S8")).toBe(true);
    expect(() => emit(profile, ["surface-index"])).toThrow();
  });

  it("keeps full catalog coverage, missing adopted members and forged evidence strict", () => {
    const { catalog, library } = home();
    expect(check({ catalog: catalog.values, library }).findings.some(finding => finding.code === "A6" && finding.severity === "error")).toBe(true);
    const damaged = structuredClone(library);
    const fill = damaged.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "assets.icon-info")!;
    delete (fill.assets!["icon-info"] as Record<string, unknown>).default;
    const findings = check({ catalog: catalog.values, library: damaged, valueOptions: { assetScope: "adopted" } }).findings;
    expect(findings.some(finding => finding.severity === "error" && finding.subject === "assets.icon-info")).toBe(true);
    const forged = resolve({ catalog: catalog.values, library });
    delete forged.members["assets.icon-info.default"];
    expect(check({ catalog: catalog.values, library, resolved: forged, valueOptions: { assetScope: "adopted" } }).findings.some(finding => finding.code === "C5")).toBe(true);
    const token = Object.values(flatten(library.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "assets.icon-info")!))[0]!;
    token.$value = [];
    const refused = check({ catalog: catalog.values, library, valueOptions: { assetScope: "adopted" } }).findings;
    expect(refused.some(finding => finding.code === "C10" && finding.severity === "error")).toBe(true);
    expect(refused.some(finding => finding.code === "A3" && finding.severity === "error")).toBe(true);
  });
});
