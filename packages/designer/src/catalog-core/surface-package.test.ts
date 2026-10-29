/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import { importFoundrySections } from "../importers/foundry-sections.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { importFoundryComponents } from "../importers/foundry-components.js";
import { loadSectionRegistry } from "./sections-contract.js";
import { loadCatalog } from "./index.js";
import { loadComponentRegistry } from "./component-registry.js";
import { applyLibraryChange, libraryHash } from "./api.js";
import { emitComposite, resolveComposite } from "./library-components.js";
import { emitSurfaces } from "./surface-emit.js";
import { sha256 } from "./digest.js";
import { planSurfaceDefaults, type SurfaceDefaultCandidateDocument } from "./surface-defaults.js";
import { surfaceEntryOf, surfaceSelection } from "./surface-library.js";
import { selectedPackageClosure, selectedPackageComponentOptions } from "./__fixtures__/surface-engine/selected-package-closure.js";
import type { SurfaceCandidateDocument, SurfacePackageEvidence } from "./surface-types.js";
import type { CompositeCatalogData, CompositeLibraryData, FrameSlot } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
/** Independent export inventory, read from the package barrels themselves (not from the catalog). */
function barrel(module: string, version: string, file: string): SurfacePackageEvidence {
  const text = readFileSync(resolve(here, file), "utf8");
  const values = [...new Set([...text.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(match => match[1]!.split(",").map(binding => binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)!).filter(name => /^[A-Za-z_$][\w$]*$/.test(name))))].sort();
  return { module, version, artifactSha256: sha256(text), values, types: [] };
}
const PACKAGES: SurfacePackageEvidence[] = [
  barrel("@clossys/designer/blocks", "0.12.0", "../blocks/index.ts"),
  barrel("@clossys/designer/frames", "0.12.0", "../frames/index.ts"),
  barrel("@clossys/designer/shell/server", "0.12.0", "../shell/server.ts"),
  barrel("@clossys/publisher/web", "0.13.0", "../../../publisher/src/web/index.ts"),
];
const options = (packages: SurfacePackageEvidence[] = PACKAGES) => ({ componentOptions: selectedPackageComponentOptions(), surfaceOptions: { packages, measurements: [] } });

function setup(edit?: (doc: SurfaceDefaultCandidateDocument) => void) {
  const slots = [...loadSectionRegistry().slots, ...structuredClone(frameSlots) as unknown as FrameSlot[]];
  const fills = structuredClone([...importFoundrySections().fills, ...importFoundryFrames().fills]) as unknown as SurfaceDefaultCandidateDocument[];
  const registry = loadComponentRegistry();
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: registry.slots, fills: importFoundryComponents().fills }, surfaces: { slots, fills: fills as unknown as SurfaceCandidateDocument[], transforms: [], rules: [], materializations: [] } };
  const { library: empty } = selectedPackageClosure(catalog);
  if (edit) fills.forEach(edit);
  const plan = planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] });
  return { catalog, plan, empty, slots };
}
const adopt = (catalog: CompositeCatalogData, library: CompositeLibraryData, slots: readonly { slot: string; source: string }[], opts = options()) =>
  applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: slots.map(row => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: row.slot as `sections.${string}`, source: row.source } })) }, opts);
const entry = (library: CompositeLibraryData, slot: string) => {
  const doc = library.surfaces!.fills.find(row => row.$extensions["com.clossys.fill"].slot === slot)!;
  return Object.values((doc as unknown as { sections?: object; frames?: object }).sections ?? (doc as unknown as { frames: object }).frames)[0] as Record<string, unknown>;
};
/** Check findings, or the structural fault the engine raises (a fault is a refusal, never a pass). */
const surfaceErrors = (library: CompositeLibraryData, catalog: CompositeCatalogData, packages = PACKAGES): { code: string; subject: string; message: string }[] => {
  try { return resolveComposite({ catalog, library, ...options(packages) }).check.findings.filter(row => row.rule === "surfaces" && row.severity === "error"); }
  catch (error) { return [{ code: "fault", subject: "", message: (error as Error).message }]; }
};

describe("package-pointer surface origin", () => {
  // FINDING perf: Real 63-surface adoption exceeds 5s; allow completion before deferred snapshot-copy optimization.
  it("adopts every planned Section and Frame default without a bundle, from the real catalog", () => {
    const { catalog, plan, empty } = setup();
    expect(plan.decisions).toHaveLength(63);
    const library = adopt(catalog, empty, plan.decisions);
    expect(library.surfaces!.fills).toHaveLength(63);
    expect(library.surfaces!.files).toEqual([]);
    const selection = surfaceSelection(library);
    expect(selection.slots.map(row => row.slot)).toEqual(plan.decisions.map(row => row.slot).sort());
    expect(selection.slots.every(row => row.originKind === "package" && row.source === "foundry")).toBe(true);
    const faq = surfaceEntryOf(library.surfaces!.fills.find(row => row.$extensions["com.clossys.fill"].slot === "sections.faq")!);
    expect(faq.origin).toMatchObject({ kind: "package", source: "foundry", fill: "foundry/sections.faq", pin: { package: "@clossys/designer", version: "0.12.0", export: "./blocks#Faq" }, license: "MIT", adoptedAt: "2026-10-26" });
  }, 20000);

  // FINDING perf: Real 63-surface adoption exceeds 5s; allow completion before deferred snapshot-copy optimization.
  it("emits all 63 package surfaces with proven private site-shell imports", () => {
    const { catalog, plan, empty } = setup();
    const all = adopt(catalog, empty, plan.decisions);
    const allProfile = resolveComposite({ catalog, library: all, ...options() });
    expect(Object.keys(allProfile.surfaces!.fills)).toHaveLength(63);
    expect(surfaceErrors(all, catalog)).toEqual([]);
    expect(allProfile.check.findings.filter(row => row.severity === "error")).toEqual([]);
    const compositeFiles = emitComposite(allProfile, ["surface-index"]);
    expect(compositeFiles.find(row => row.path === "frames/site-shell/index.ts")?.contents).toBe('export { SiteFrame as SiteShell } from "@clossys/designer/frames";\n');
    expect(compositeFiles.find(row => row.path === "surface-index.ts")!.contents.split("\n").filter(Boolean)).toHaveLength(63);
    const allReport = emitComposite(allProfile, ["surfaces-consumption"]);
    expect(JSON.parse(allReport.find(row => row.path === "surfaces-consumption.json")!.contents).fills).toHaveLength(63);
    const profile = allProfile;
    // This checks the surface emitter against the real resolved surface profile;
    // component runtime qualification remains a separate set of findings.
    const files = emitSurfaces(profile.surfaces!, ["surface-index", "surfaces-consumption"]);
    const file = (path: string) => files.find(row => row.path === path)?.contents;
    expect(file("frames/sheet/index.ts")).toBe('export { Drawer as Sheet } from "@clossys/designer/blocks";\n');
    expect(file("frames/site-shell/index.ts")).toBe('export { SiteFrame as SiteShell } from "@clossys/designer/frames";\n');
    expect(surfaceEntryOf(allProfile.surfaces!.fills["frames.site-shell"]!.document).impl).toEqual({ kind: "package", module: "@clossys/designer/frames", export: "SiteFrame" });
    expect(file("frames/app-sidebar/index.ts")).toBe('export { AppNavigation as AppSidebar } from "@clossys/designer/blocks";\n');
    expect(file("frames/inspector/index.ts")).toBe('export { InspectorFrame as Inspector } from "@clossys/designer/frames";\n');
    expect(file("sections/filter-builder/index.ts")).toBe('export { FilterBuilder } from "@clossys/designer/blocks";\n');
    expect(file("sections/settings/index.ts")).toBe('export { SettingsSection as Settings } from "@clossys/designer/blocks";\n');
    expect(file("sections/wizard/index.ts")).toBe('export { FormWizard as Wizard } from "@clossys/designer/blocks";\n');
    expect(file("sections/faq/index.ts")).toBe('export { Faq } from "@clossys/designer/blocks";\n');
    expect(file("sections/stats/index.ts")).toBe('export { StatGroup as Stats } from "@clossys/designer/blocks";\n');
    expect(file("sections/consent/index.ts")).toBe('export { ConsentBanner as Consent } from "@clossys/designer/blocks";\n');
    expect(file("surface-index.ts")).toContain('export { Faq } from "./sections/faq/index.js";\n');
    expect(file("surface-index.ts")!.split("\n").filter(Boolean)).toHaveLength(63);
    expect(JSON.parse(file("surfaces-consumption.json")!).fills).toHaveLength(63);
  }, 20000);

  it("emits a satisfiable genuine package selection through the public composite engine", () => {
    const catalog = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills }, surfaces: {
      slots: loadSectionRegistry().slots.filter(slot => slot.id === "sections.call-to-action"),
      fills: importFoundrySections().fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === "sections.call-to-action"),
      transforms: [], rules: [], materializations: [],
    } };
    const { library: empty, componentOptions } = selectedPackageClosure(catalog);
    const library = adopt(catalog, empty, [{ slot: "sections.call-to-action", source: "foundry" }]);
    const profile = resolveComposite({ catalog, library, componentOptions, surfaceOptions: options().surfaceOptions });
    expect(profile.check.findings.filter(row => row.severity === "error")).toEqual([]);
    expect(emitComposite(profile, ["surface-index"]).find(row => row.path === "sections/call-to-action/index.ts")?.contents).toBe('export { CallToAction } from "@clossys/designer/blocks";\n');
  });

  // FINDING perf: Real 63-surface adoption exceeds 5s; allow completion before deferred snapshot-copy optimization.
  it("refuses a missing or differing package export, version or module in the evidence", () => {
    const { catalog, plan, empty } = setup();
    const library = adopt(catalog, empty, plan.decisions);
    const noBlocks = PACKAGES.filter(row => row.module !== "@clossys/designer/blocks");
    expect(surfaceErrors(library, catalog, noBlocks).map(row => `${row.code} ${row.subject}`)).toContain("S4 sections.faq");
    const wrongVersion = PACKAGES.map(row => row.module === "@clossys/designer/blocks" ? { ...row, version: "0.11.0" } : row);
    expect(surfaceErrors(library, catalog, wrongVersion).find(row => row.subject === "frames.sheet")?.message).toBe("package export evidence missing or differs");
    const noFaq = PACKAGES.map(row => row.module === "@clossys/designer/blocks" ? { ...row, values: row.values.filter(name => name !== "Faq") } : row);
    const errors = surfaceErrors(library, catalog, noFaq);
    expect(errors.map(row => row.subject)).toEqual(["sections.faq"]);
    expect(() => emitComposite(resolveComposite({ catalog, library, ...options(noFaq) }), ["surface-index"])).toThrow(/composite: checked observations|S8/);
  }, 20000);

  it("refuses an inexact pin or a pin whose export differs from the implementation", () => {
    const at = (slot: string, change: (meta: Record<string, unknown>, fill: Record<string, unknown>) => void) => (doc: SurfaceDefaultCandidateDocument) => {
      if (doc.$extensions["com.clossys.fill"].slot !== slot) return;
      change(doc.$extensions["com.clossys.fill"] as unknown as Record<string, unknown>, Object.values(doc.sections ?? doc.frames ?? {})[0] as unknown as Record<string, unknown>);
    };
    const inexact = setup(at("frames.sheet", meta => { meta.pin = { ...(meta.pin as object), version: "^0.12.0" }; }));
    expect(() => adopt(inexact.catalog, inexact.empty, [{ slot: "frames.sheet", source: "foundry" }])).toThrow(/S2 exact package pin required/);
    const otherExport = setup(at("frames.sheet", meta => { meta.pin = { ...(meta.pin as object), export: "./blocks#Dialog" }; }));
    expect(() => adopt(otherExport.catalog, otherExport.empty, [{ slot: "frames.sheet", source: "foundry" }])).toThrow(/S2 package export differs from pin/);
    const otherModule = setup(at("sections.faq", (_meta, fill) => { fill.impl = { ...(fill.impl as object), module: "@clossys/designer/frames" }; }));
    expect(() => adopt(otherModule.catalog, otherModule.empty, [{ slot: "sections.faq", source: "foundry" }])).toThrow(/S2 package export differs from pin/);
    const entryPin = setup(at("sections.faq", (_meta, fill) => { fill.pin = { ...(fill.pin as object), version: "0.12.1" }; }));
    expect(() => adopt(entryPin.catalog, entryPin.empty, [{ slot: "sections.faq", source: "foundry" }])).toThrow(/S2 package pin differs/);
  });

  it("is not self-certifying: a hand-edited installed pin, export or descriptor fails the catalog join", () => {
    const { catalog, empty } = setup();
    const library = adopt(catalog, empty, [{ slot: "sections.faq", source: "foundry" }, { slot: "frames.sheet", source: "foundry" }]);
    expect(surfaceErrors(library, catalog)).toEqual([]);
    const tamper = (change: (fill: Record<string, unknown>) => void) => { const copy = structuredClone(library); change(entry(copy, "sections.faq")); return copy; };
    // Pin moved to another version, with a matching (self-consistent) origin.
    const moved = tamper(fill => { fill.pin = { ...(fill.pin as object), version: "0.13.0" }; const origin = fill.origin as Record<string, unknown>; origin.pin = fill.pin; });
    expect(surfaceErrors(moved, catalog).map(row => row.message).join(" ")).toMatch(/S6 descriptor hand edit requires author|S2 upstream candidate identity differs/);
    // Mapping widened and origin digest recomputed by the library itself: the catalog candidate disagrees.
    const widened = tamper(fill => { (fill.slotMap as Record<string, string>).items = "./blocks#Faq.other"; });
    expect(surfaceErrors(widened, catalog).map(row => row.message).join(" ")).toMatch(/S6 descriptor hand edit requires author/);
    // The candidate is gone from the catalog.
    const { catalog: without } = setup(doc => { if (doc.$extensions["com.clossys.fill"].slot === "sections.faq") doc.$extensions["com.clossys.fill"].slot = "sections.faq-gone"; });
    expect(surfaceErrors(library, without).map(row => row.message).join(" ")).toMatch(/S2 upstream candidate identity differs/);
    // A package pointer never copies bytes.
    const bytes = structuredClone(library); (bytes.surfaces!.files as unknown as { path: string; content: string }[]).push({ path: "sections/faq/Faq.tsx", content: "x" });
    expect(surfaceErrors(bytes, catalog).length).toBeGreaterThan(0);
  });

  it("keeps the static contract rule: an ineligible candidate adopts only with an S5 finding, and the source path is unchanged", () => {
    // An importer that left the hero header region unmapped: the catalog candidate is ineligible and adopts only with S5.
    const { catalog, empty } = setup(doc => { if (doc.$extensions["com.clossys.fill"].slot === "sections.hero") delete (doc.sections!.hero!.slotMap as Record<string, unknown>).header; });
    const hero = adopt(catalog, empty, [{ slot: "sections.hero", source: "foundry" }]);
    expect(surfaceErrors(hero, catalog).map(row => `${row.code} ${row.message}`)).toEqual(["S5 content/member mapping differs: required slot header is not mapped"]);
    // A gallery fill that is not an implementation candidate: with no package candidate and no bundle, adoption requires a unique bundle (S2).
    const noCandidate = setup(doc => { if (doc.$extensions["com.clossys.fill"].slot === "sections.gallery") doc.$extensions["com.clossys.fill"].mode = "reference"; });
    expect(() => adopt(noCandidate.catalog, noCandidate.empty, [{ slot: "sections.gallery", source: "foundry" }])).toThrow(/S2 unique bundle required/);
  });
});
