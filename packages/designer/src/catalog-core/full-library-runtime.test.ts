/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { fullLibraryRuntimeFindings, FULL_LIBRARY_RUNTIME_BUDGET_MS, runFullLibraryRuntime } from "./full-library-runtime.js";
import { standardM1FixtureEngine, standardM1Runtime } from "./__fixtures__/standard-m1-runtime.js";
import { runtimeHash } from "./runtime-ports.js";
import { loadBuildCatalog } from "./index.js";
import { syntheticSurfacePair } from "../library-cli/__fixtures__/surface-library.js";
import { syntheticSurface } from "./__fixtures__/surface-engine/synthetic.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { surfaceOf } from "./surface-library.js";
import { surfaceRuntimeIdentity } from "./surface-check.js";
import type { RuntimeFillDescriptor } from "./runtime-ports.js";
const source = { entry: "unit.ts", files: { "unit.ts": "// unit corpus; no actual qualification" }, dependencies: {} };
const descriptor = { id: "unit", source, sourceHash: runtimeHash(source) };
const fixture = () => standardM1Runtime({ engine: standardM1FixtureEngine(), identity: { kind: "artifact", name: "unit", sha256: runtimeHash(source) }, source, css: [{ id: "unit.css", contents: "body{}" }] });
describe("actual full-library runtime proof admission", () => {
  it("rejects the old synthetic tuple as whole-library proof before running a renderer", async () => {
    let called = false;
    const result = await runFullLibraryRuntime(fixture(), { descriptor, kind: "synthetic", run: async () => { called = true; throw new Error("must not run"); } }, { descriptor, render: () => { called = true; return "<div>fake</div>"; } });
    expect(result.status).toBe("pending"); expect(called).toBe(false);
    expect(result.budgetMs).toBe(5_000); expect(FULL_LIBRARY_RUNTIME_BUDGET_MS).toBe(5_000);
    expect(result.inventory.components).toBe(0); expect(result.pages).toEqual([]);
    expect(result.findings).toContain("actual component qualification missing: components.semantic-content");
    expect(result.findings).toContain("actual component qualification missing: components.native-action");
    expect(result.findings.filter(finding => finding.startsWith("actual component qualification missing:"))).toHaveLength(66);
    expect(result.findings).toContain("actual selected Sections/Frames library portion missing");
  });
  it("uses the actual frozen inventories, never a partial caller contract graph", () => {
    const input = fixture(); input.contracts = loadBuildCatalog();
    const findings = fullLibraryRuntimeFindings(input);
    expect(findings.filter(finding => finding.startsWith("whole-library component fill"))).toHaveLength(66);
    expect(findings.some(finding => finding.startsWith("whole-library value fill missing"))).toBe(true);
    expect(findings.some(finding => finding.startsWith("full graph contract missing"))).toBe(false);
    const tampered = structuredClone(input.contracts);
    const slot = tampered.slots.find(slot => slot.id === "tokens.blur")!;
    slot.contract = { ...slot.contract, valueKind: "fake" } as typeof slot.contract;
    expect(fullLibraryRuntimeFindings({ ...input, contracts: tampered })).toContain("full graph contract differs: tokens.blur");
    const broken = { ...input, contracts: { ...input.contracts, slots: input.contracts.slots.filter(slot => slot.id !== "assets.icon-close") } };
    expect(fullLibraryRuntimeFindings(broken)).toContain("full graph contract missing or duplicated: assets.icon-close");
  });
  it("names a broken selected surface link independently of missing qualification", () => {
    const input = fixture();
    const broken = { ...input, binding: { ...input.binding, frame: { ...input.binding.frame, fill: "broken-frame" } } };
    expect(fullLibraryRuntimeFindings(broken)).toContain(`selected surface ownership missing or duplicated: ${input.binding.frame.leaf}`);
    expect(fullLibraryRuntimeFindings(broken)).toContain(`selected surface runtime closure missing: ${input.binding.frame.leaf}`);
  });
});

/** Selection-scope unit corpus only: no compiler/browser or actual qualification. */
function syntheticSelectedClosure() {
  const input = fixture();
  input.engine = syntheticSurfacePair();
  // No component observation in this unit corpus qualifies a real library leaf.
  input.engine.componentOptions = undefined;
  const rows = Object.values(resolve(input.engine).surfaces!.fills);
  const descriptors: RuntimeFillDescriptor[] = rows.map(row => {
    const fill = surfaceOf(row.document);
    return { kind: fill.kind, leaf: fill.slot, fill: row.document.$extensions["com.clossys.fill"].id, library: input.engine.library.source.id, config: null, slots: Object.keys(fill.kind === "section" ? fill.slotMap : fill.slots), members: fill.members, states: fill.states, surface: surfaceRuntimeIdentity(row), renderer: descriptor };
  });
  const select = (fill: RuntimeFillDescriptor) => ({ leaf: fill.leaf, fill: fill.fill, config: null, members: [], content: {} });
  input.binding = { id: "SYNTHETIC selection scope", frame: select(descriptors.find(fill => fill.kind === "frame")!), sections: { body: [select(descriptors.find(fill => fill.kind === "section")!)] }, frameSlots: {} };
  input.ports = { ...input.ports, manifest: { ...input.ports.manifest, fills: descriptors } };
  return input;
}
function addSyntheticOtherPage(input: ReturnType<typeof syntheticSelectedClosure>) {
  const extras = [syntheticSurface({ leaf: "other-page" }), syntheticSurface({ layer: "frames", leaf: "other-shell" })];
  for (const extra of extras) for (const key of ["slots", "fills", "transforms", "materializations"] as const) input.engine.catalog.surfaces![key] = [...input.engine.catalog.surfaces![key], ...extra.input.catalog.surfaces![key]] as never;
  input.engine.library = applyLibraryChange(input.engine.catalog, input.engine.library, { baseHash: libraryHash(input.engine.library), changes: extras.map(extra => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: extra.bundle.slot, source: "synthetic" } })), surfaceBundles: extras.map(extra => extra.bundle) }, { surfaceOptions: input.engine.surfaceOptions! });
}
describe("SYNTHETIC selected-page scope; never actual full-library proof", () => {
  it("permits unrelated owned surfaces without changing findings or selected inventory", async () => {
    const input = syntheticSelectedClosure(), before = fullLibraryRuntimeFindings(input);
    expect(before.some(finding => finding.startsWith("selected surface"))).toBe(false);
    expect(before.filter(finding => finding.startsWith("actual component qualification missing:"))).toHaveLength(66);
    addSyntheticOtherPage(input);
    expect(input.engine.library.surfaces!.fills).toHaveLength(4);
    expect(fullLibraryRuntimeFindings(input)).toEqual(before);
    // Reusing one selected fill in another page slot does not add an owned leaf.
    input.binding = { ...input.binding, frameSlots: { context: input.binding.sections.body! } };
    let called = false;
    const result = await runFullLibraryRuntime(input, { descriptor, kind: "synthetic", run: async () => { called = true; throw new Error("unit admission must stop"); } }, { descriptor, render: () => { called = true; return "<div>SYNTHETIC</div>"; } });
    expect(result.status).toBe("pending"); expect(called).toBe(false);
    expect(result.inventory).toMatchObject({ sections: 1, frames: 1 });
    expect(result.findings.filter(finding => finding.startsWith("actual component qualification missing:"))).toHaveLength(66);
  });
  it("requires an exact runtime descriptor when an owned other-page fill is selected", () => {
    const input = syntheticSelectedClosure(); addSyntheticOtherPage(input);
    const doc = input.engine.library.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "sections.other-page")!;
    input.binding = { ...input.binding, sections: { ...input.binding.sections, other: [{ leaf: "sections.other-page", fill: doc.$extensions["com.clossys.fill"].id, config: null, members: [], content: {} }] } };
    const findings = fullLibraryRuntimeFindings(input);
    expect(findings).toContain("selected surface runtime closure missing: sections.other-page");
    expect(findings).not.toContain("selected surface ownership missing or duplicated: sections.other-page");
    expect(findings.filter(finding => finding.startsWith("actual component qualification missing:"))).toHaveLength(66);
  });
  it.each(["missing", "duplicated"] as const)("still refuses %s selected ownership", mode => {
    const input = syntheticSelectedClosure(), section = input.binding.sections.body![0]!;
    const surfaces = input.engine.library.surfaces!, selected = surfaces.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === section.leaf)!;
    input.engine.library = { ...input.engine.library, surfaces: { ...surfaces, fills: mode === "missing" ? surfaces.fills.filter(doc => doc !== selected) : [...surfaces.fills, selected] } };
    const findings = fullLibraryRuntimeFindings(input);
    expect(findings).toContain(`selected surface ownership missing or duplicated: ${section.leaf}`);
    expect(findings.filter(finding => finding.startsWith("actual component qualification missing:"))).toHaveLength(66);
  });
});
