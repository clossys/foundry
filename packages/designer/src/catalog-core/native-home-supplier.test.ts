/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { applyLibraryChange, check, emit, libraryHash, loadCatalog, resolve } from "./index.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadComponentRegistry } from "./component-registry.js";
import { planComponentDefaults } from "./component-defaults.js";
import { applyDecisions } from "../library-cli/apply-decisions.js";
import { componentOf } from "./resolve-components.js";
import { syntheticSurface } from "./__fixtures__/surface-engine/synthetic.js";
import { flatten } from "./model.js";
import type { CompositeEngineInput, CompositeLibraryData, LibraryData } from "./types.js";

const source = { id: "example", kind: "consumer", author: "consumer", license: "MIT" } as const;
function home() {
  const values = loadCatalog(), bundles = loadCatalogBundles();
  const registry = loadComponentRegistry();
  const catalog = { values, components: { slots: registry.slots, fills: bundles.componentFills } };
  let library: LibraryData = { ...completedTokenLibrary(values, source, "2026-10-23"), complete: false };
  const glyphs = ["assets.icon-chevron-right", "assets.icon-info"];
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes: glyphs.map(slot => ({ op: "adopt" as const, slot, source: "lucide" })) });
  const profile = resolve({ catalog: values, library });
  const tokens = Object.fromEntries(Object.entries(profile.members).filter(([, member]) => member.emit).map(([id, member]) => [id, { property: member.emit!, light: member.css.light, ...(member.css.dark ? { dark: member.css.dark } : {}) }]));
  const usage = { requiredMembers: { "components.badge": ["tone.info"] }, requiredProps: { "components.badge": ["variant", "children"] } };
  const plan = planComponentDefaults({ catalog: catalog.components, slots: ["components.badge"], tokens, assets: glyphs, installedRac: { version: "1.19.0", instance: "react-aria-components" }, bundles: bundles.sourceBundles, preference: ["shadcn@aria", "foundry"], ...usage });
  const composite: CompositeLibraryData = { source, adoptedAt: library.adoptedAt, values: library, components: { fills: [], files: [] } };
  return { catalog, library, glyphs, tokens, usage, plan, composite };
}

describe("native Home supplier through public selection and materialization", () => {
  it("selects actual adopted glyphs and the first eligible info Badge without a forced source", () => {
    const state = home();
    expect(state.plan.rows).toMatchObject([{ slot: "components.badge", source: "foundry", basis: "preference" }]);
    const selected = applyDecisions(state.catalog, state.composite, state.plan.decisions, { bundles: [] });
    const input: CompositeEngineInput = { catalog: state.catalog, library: selected, valueOptions: { assetScope: "adopted" }, componentOptions: { ...state.usage, evidence: { installedRac: { version: "1.19.0", instance: "react-aria-components" }, observations: {} } } };
    const profile = resolve(input);
    expect(check(input).ok).toBe(true);
    expect(profile.components.components["components.badge"]!.propMap["tone.info"]).toBe("./components#Badge.variant=info");
    expect(Object.keys(profile.values.members).filter(id => id.startsWith("assets."))).toEqual(state.glyphs.map(slot => `${slot}.default`).sort());
    expect(emit(profile, ["component-index"]).some(file => file.contents.includes("Badge"))).toBe(true);
    expect(profile.check.findings.some(finding => finding.code === "A6" || finding.code === "A12" && finding.subject === "assets.favicon")).toBe(false);
    // Same objects: neither scope nor usage changes may reuse a permissive cached check.
    input.valueOptions!.assetScope = "catalog";
    expect(resolve(input).check.ok).toBe(false);
    input.valueOptions!.assetScope = "adopted";
    expect(resolve(input).check.ok).toBe(true);
    input.componentOptions!.requiredMembers = { "components.badge": ["tone.invented"] };
    expect(resolve(input).check.ok).toBe(false);
  });

  it("retains explicit value context through public surface apply without claiming runtime qualification", () => {
    const state = home(), fixture = syntheticSurface();
    const library = applyDecisions(state.catalog, state.composite, state.plan.decisions);
    const catalog = { ...state.catalog, surfaces: fixture.input.catalog.surfaces };
    const options = { valueOptions: { assetScope: "adopted" as const }, componentOptions: { ...state.usage }, surfaceOptions: { packages: [], measurements: [] } };
    const next = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ portion: "surfaces", change: { op: "adopt", slot: "sections.synthetic", source: "synthetic" } }], surfaceBundles: [fixture.bundle] }, options);
    const profile = resolve({ catalog, library: next, ...options });
    expect(next.surfaces!.fills).toHaveLength(1);
    expect(profile.check.findings.filter(finding => ["A6", "A12", "C9"].includes(finding.code) && finding.severity === "error")).toEqual([]);
    expect(profile.surfaces!.check.findings.some(finding => finding.code === "S8")).toBe(true);
    expect(() => emit(profile, ["surface-index"])).toThrow();
  });

  it("keeps full catalog coverage and missing adopted members strict", () => {
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
  });

  it("does not grant stock shadcn info, ignore unknown props, or forgive dependencies", () => {
    const state = home();
    const input = { catalog: state.catalog.components, slots: ["components.badge"], tokens: state.tokens, assets: state.glyphs, installedRac: { version: "1.19.0", instance: "react-aria-components" }, bundles: loadCatalogBundles().sourceBundles, preference: ["shadcn@aria"], ...state.usage };
    expect(planComponentDefaults(input).rows[0]!.status).toBe("not-chosen");
    expect(planComponentDefaults({ ...input, preference: ["foundry"], requiredProps: { "components.badge": ["invented"] } }).rows[0]!.status).toBe("not-chosen");
    const foundry = structuredClone(state.catalog.components);
    componentOf(foundry.fills.find(doc => doc.$extensions["com.clossys.fill"].id === "foundry/components.badge")!).reads.assets = ["assets.icon-unavailable"];
    expect(planComponentDefaults({ ...input, catalog: foundry, preference: ["foundry"] }).rows[0]!.status).toBe("not-chosen");
  });

  it("measures a transparent native recipe only over an explicit real ground", () => {
    const { catalog, library } = home();
    // Authored public fixture: preserve the recipe in emitted CSS rather than flattening it.
    const authored = applyLibraryChange(catalog.values, library, { baseHash: libraryHash(library), changes: [{ op: "author", slot: "themes.card", tokens: { default: { $type: "color", $value: "#ffffff", $extensions: { "com.clossys.css": { raw: "color-mix(in oklab, var(--background) 90%, transparent)" }, "com.clossys.modes": { dark: "color-mix(in oklab, var(--background) 90%, transparent)" } } } } }] });
    const input = { catalog: catalog.values, library: authored, valueOptions: { assetScope: "adopted" as const, contrastGrounds: { "--card": "--background" } } };
    const composite: CompositeEngineInput = { catalog, library: { source, adoptedAt: authored.adoptedAt, values: authored, components: { fills: [], files: [] } }, valueOptions: input.valueOptions };
    expect(check(input).findings.filter(finding => finding.code === "C9")).toEqual([]);
    expect(resolve(composite).check.findings.filter(finding => finding.code === "C9")).toEqual([]);
    expect(emit(resolve(input), ["css-brand"]).map(file => file.contents).join("\n")).toContain("color-mix(in oklab, var(--background) 90%, transparent)");
    delete (input.valueOptions.contrastGrounds as Record<string, string>)["--card"];
    expect(check(input).findings.some(finding => finding.code === "C9" && finding.subject === "--card-foreground")).toBe(true);
    expect(resolve(composite).check.findings.some(finding => finding.code === "C9")).toBe(true);
    input.valueOptions.contrastGrounds["--card"] = "--background";
    expect(resolve(composite).check.findings.filter(finding => finding.code === "C9")).toEqual([]);
    input.valueOptions.contrastGrounds["--card"] = "--invented";
    expect(check(input).ok).toBe(false);
    input.valueOptions.contrastGrounds["--card"] = "--card";
    expect(check(input).ok).toBe(false);
    // Provenance is independent of adopted asset scope.
    const token = Object.values(flatten(authored.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "assets.icon-info")!))[0]!;
    token.$extensions!["com.clossys.origin"] = { kind: "authored", license: "" };
    expect(check(input).findings.some(finding => finding.code === "A1" && finding.severity === "error")).toBe(true);
  });
});
