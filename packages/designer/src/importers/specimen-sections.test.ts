import { expect, it } from "vitest";
import ts from "typescript";
import { loadCatalog, loadComponentRegistry, loadSectionRegistry, planSurfaceDefaults, applyLibraryChange, libraryHash, resolve, emit } from "../catalog-core/index.js";
import type { CompositeEngineInput } from "../catalog-core/types.js";
import { surfaceOf, verifySurfaceProvenance, verifySurfaceFiles } from "../catalog-core/surface-library.js";
import { parseSurfaceModule } from "../catalog-core/surface-source-analysis.js";
import { emitSurfaces } from "../catalog-core/surface-emit.js";
import { specimenSectionSourceCatalog, SPECIMEN_SECTION_EXPORTS } from "./specimen-sections.js";
import { prepareSpecimenSurfaceSources } from "../library-cli/specimen-surface-sources.js";
import { foundrySurfaceCatalog } from "../library-cli/surface-catalog.js";
import { studioSpecimenLeaves } from "../studio/specimen-registry.js";

function input(): CompositeEngineInput {
  return { catalog: { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: [] }, surfaces: foundrySurfaceCatalog() }, library: { source: { id: "specimen-native-consumer", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-30", values: { fills: [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } }, surfaceOptions: { packages: [], measurements: [] } };
}
it("registers all14 real section contracts, IA placements, native source candidates and eligible bindings", () => {
  const registry = loadSectionRegistry(), source = specimenSectionSourceCatalog();
  expect(SPECIMEN_SECTION_EXPORTS).toHaveLength(14);
  expect(source.fills).toHaveLength(14);
  const slots = SPECIMEN_SECTION_EXPORTS.map(row => row.id);
  expect([...slots].sort()).toEqual(studioSpecimenLeaves.map(leaf => leaf.id).sort());
  expect(registry.slots.filter(slot => slots.includes(slot.id as typeof slots[number]))).toHaveLength(14);
  const plan = planSurfaceDefaults({ catalog: { slots: registry.slots, fills: source.fills }, slots, preference: ["foundry"] });
  expect(plan.rows.every(row => row.status === "default")).toBe(true);
  for (const document of source.fills) {
    const candidate = surfaceOf(document);
    const file = source.upstream.find(file => file.path === candidate.impl.entry)!;
    const parsed = parseSurfaceModule(file.content);
    expect(parsed.functions).toContain(candidate.impl.export);
    expect(file.content).toContain(`studioSpecimenLeaves.find(leaf => leaf.id === ${JSON.stringify(candidate.slot)})`);
    expect(parsed.functions).toContain("SpecimenLeaf");
    expect(file.content).toContain(`return { ...definition, render: ${candidate.impl.export} };`);
    expect(candidate.api.exports).toContainEqual({ name: "SpecimenLeaf", export: "SpecimenLeaf" });
    expect(parsed.imports.filter(row => row.module.startsWith("../../components/"))).toHaveLength(candidate.bindings.length);
    expect(parsed.imports.some(row => row.module === "@clossys/designer/components")).toBe(false);
    if (candidate.slot === "sections.specimen-page-viewports") {
      expect(file.content).toContain("../../components/button/index.js");
      expect(file.content).toContain("../../components/badge/index.js");
      const contract = registry.slots.find(slot => slot.id === candidate.slot)!.contract;
      expect(contract.allowedComposes).toContain("components.button");
      expect(contract.allowedComposes).toContain("components.badge");
      const allowed = new Set<string>(contract.allowedComposes);
      expect(candidate.composes.every(id => allowed.has(id))).toBe(true);
    }
    expect(candidate.blockers).toEqual([]);
    const actual = studioSpecimenLeaves.find(leaf => leaf.id === candidate.slot)!;
    const compiled = ts.transpileModule(file.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
    const module = { exports: {} };
    new Function("require", "module", "exports", compiled.outputText)(
      (specifier: string) => specifier === "@clossys/designer/studio" ? { [candidate.impl.export]: actual.render, studioSpecimenLeaves } : {}, module, module.exports,
    );
    const native = (module.exports as { SpecimenLeaf(): typeof actual }).SpecimenLeaf();
    expect(native).toMatchObject({ ...actual, render: expect.any(Function) });
    expect(native.render.name).toBe(candidate.impl.export);
  }
});
it("materializes and replays all14 retained native sources with immutable receipts; missing runtime evidence remains FAIL", async () => {
  const prepared = await prepareSpecimenSurfaceSources(input());
  expect(prepared.bundles).toHaveLength(14);
  expect(prepared.input.catalog.surfaces!.materializations).toHaveLength(14);
  let library = prepared.input.library;
  for (const bundle of prepared.bundles) {
    const fill = surfaceOf(bundle.document);
    verifySurfaceFiles(fill, bundle.files);
    verifySurfaceProvenance(prepared.input.catalog, { ...library, surfaces: { version: 1, fills: [bundle.document], files: bundle.files } }, fill);
    library = applyLibraryChange(prepared.input.catalog, library, { baseHash: libraryHash(library), changes: [{ portion: "surfaces", change: { op: "adopt", slot: bundle.slot, source: "foundry" } }], surfaceBundles: [bundle] }, { surfaceOptions: prepared.input.surfaceOptions! });
  }
  const resolved = resolve({ ...prepared.input, library });
  expect(Object.keys(resolved.surfaces!.fills)).toHaveLength(14);
  expect(resolved.surfaces!.check.findings).toContainEqual(expect.objectContaining({ code: "S8", message: "independent current type/closure measurement missing" }));
  expect(() => emitSurfaces(resolved.surfaces!, ["surface-index"])).toThrow("S8 source emission requires current complete evidence");
  const bundle = prepared.bundles[0]!, fill = surfaceOf(bundle.document);
  expect(() => verifySurfaceFiles(fill, bundle.files.map(file => file.path === fill.impl.entry ? { ...file, content: file.content + "\n" } : file))).toThrow("S2 output hash differs");
});
