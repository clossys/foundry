/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import { syntheticSurfacePair, saveSurfaceLibrary, compileSurfaceLibrary } from "../library-cli/__fixtures__/surface-library.js";
import { checkLibrary, libraryFiles, readLibrary, writeCompositeLibrary, emitLibrary, LibraryConflictError } from "../library-cli/fs-library.js";
import { applyLibraryChange, libraryHash, resolve, emit } from "./api.js";
import { surfaceOf } from "./surface-library.js";
import { surfaceRuntimeIdentity } from "./surface-check.js";
import { prepareRuntimeAssembly } from "./runtime-assembly.js";
import { runtimeHash } from "./runtime-ports.js";
import { loadBuildCatalog } from "./index.js";
import type { RuntimeAssemblyInput } from "./runtime-assembly.js";
import type { RuntimeFillDescriptor } from "./runtime-ports.js";
import type { CompositeEngineInput } from "./types.js";
vi.mock("node:fs/promises", async (original) => { const actual = await original<typeof import("node:fs/promises")>(); return { ...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename) }; });
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let temporary: string, root: string, engine: CompositeEngineInput, compiled: Awaited<ReturnType<typeof compileSurfaceLibrary>>;
beforeAll(async () => { temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "surface-SYNTHETIC-"))); const source = join(temporary, "source"); engine = syntheticSurfacePair(); await saveSurfaceLibrary(source, engine); compiled = await compileSurfaceLibrary(source, engine); engine = compiled.input; }, 30000);
beforeEach(async () => { vi.mocked(fs.writeFile).mockImplementation(actualFs.writeFile); vi.mocked(fs.rename).mockImplementation(actualFs.rename); root = join(temporary, "library"); await fs.rm(root, { recursive: true, force: true }); await saveSurfaceLibrary(root, engine); });
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
function assembly(): RuntimeAssemblyInput<string> {
    const profile = resolve(engine);
    const fills: RuntimeFillDescriptor[] = Object.values(profile.surfaces!.fills).map(row => { const fill = surfaceOf(row.document); return { kind: fill.kind, leaf: fill.slot, fill: row.document.$extensions["com.clossys.fill"].id, library: engine.library.source.id, config: null, slots: Object.keys(fill.kind === "section" ? fill.slotMap : fill.slots), members: fill.members, states: fill.states, surface: surfaceRuntimeIdentity(row), renderer: compiled.measurements.find(m => m.slot === fill.slot)!.runtime!.renderer }; });
    const frame = fills.find(fill => fill.kind === "frame")!, section = fills.find(fill => fill.kind === "section")!, select = (fill: RuntimeFillDescriptor) => ({ leaf: fill.leaf, fill: fill.fill, config: null, members: [], content: {} });
    const renderers = Object.fromEntries(fills.map(fill => [fill.renderer.id, () => compiled.module[fill.kind === "frame" ? "SyntheticShell" : "Synthetic"]!()]));
    return { identity: { kind: "artifact", name: "SYNTHETIC disk compiler fixture", sha256: runtimeHash(compiled.compiled) }, engine, contracts: { ...loadBuildCatalog(), slots: [...engine.catalog.surfaces!.slots] }, ports: { manifest: { version: 1, consumer: engine.library.source.id, libraryHash: libraryHash(engine.library) as `sha256:${string}`, selectionHash: profile.selectionHash as `sha256:${string}`, fills, assetClosure: { complete: true, ids: [] } }, renderers, resolveContent: () => undefined }, binding: { id: "SYNTHETIC", frame: select(frame), frameSlots: {}, sections: { body: [select(section)] } }, layout: { descriptor: { library: engine.library.source.id, fill: "SYNTHETIC/layout", leaf: "layouts.stack", config: "synthetic", members: {}, slots: [{ id: "body", min: 1, max: 1, accepts: [section.leaf as `sections.${string}`] }], breakpoints: [], states: ["default"], renderer: frame.renderer }, render: ({ slots }) => slots.body!.join(""), expectedOrder: (_cell, paths) => paths.body! }, themes: ["light"], states: ["default"], css: [{ id: "SYNTHETIC explicitly supplied", contents: "/* SYNTHETIC: no visual qualification */" }], assets: [] };
}
it("SYNTHETIC disk-owned graph compiles, exposes leaf secondary only, and executes the exact runtime module", async () => {
    expect(compiled.observed).toEqual({ primary: "SYNTHETIC", frame: "SYNTHETIC", secondary: "CAPTION", samePrimary: true, root: ["Synthetic", "SyntheticShell"] });
    const leaf = compiled.emitted.find(file => file.path === "sections/synthetic/index.ts")!.contents;
    expect(leaf).toContain("Caption as SyntheticCaption");
    expect(compiled.emitted.find(file => file.path === "surface-index.ts")!.contents).not.toContain("Caption");
    expect((await checkLibrary(root, engine.catalog, engine.componentOptions, engine.surfaceOptions)).ok).toBe(true);
    expect(libraryHash(await readLibrary(root, engine.catalog))).toBe(libraryHash(engine.library));
    await emitLibrary(root, engine.catalog, { componentOptions: engine.componentOptions, surfaceOptions: engine.surfaceOptions });
    expect(await emitLibrary(root, engine.catalog, { check: true, componentOptions: engine.componentOptions, surfaceOptions: engine.surfaceOptions })).toEqual({ ok: true, drift: [] });
    const result = prepareRuntimeAssembly(assembly());
    expect(result.status, JSON.stringify(result)).toBe("ready");
    if (result.status === "ready")
        expect(result.assembly.render(result.assembly.snapshot.cells[0]!)).toBe("SYNTHETIC");
    expect(resolve(engine).surfaces!.check.findings.some(f => f.message.includes("SYNTHETIC"))).toBe(true);
});
it.each(["outputHash", "apiHash", "descriptorHash", "inputsHash"] as const)("SYNTHETIC runtime join refuses stale %s before callbacks", field => {
    const input = assembly(), callback = vi.fn(() => "unexpected");
    input.ports = { ...input.ports, renderers: Object.fromEntries(input.ports.manifest.fills.map(fill => [fill.renderer.id, callback])), manifest: { ...input.ports.manifest, fills: input.ports.manifest.fills.map((fill, index) => index ? fill : { ...fill, surface: { ...fill.surface!, [field]: `sha256:${"0".repeat(64)}` } }) } };
    expect(prepareRuntimeAssembly(input).status).toBe("refused");
    expect(callback).not.toHaveBeenCalled();
});
it("SYNTHETIC legacy opt-out rejects orphan surface extensions, while true legacy path remains covered", () => {
    const input = assembly();
    const { surfaces: _absent, ...library } = engine.library;
    input.engine = { ...engine, library };
    const profile = resolve(input.engine), hash = libraryHash(library) as `sha256:${string}`;
    input.ports = { ...input.ports, manifest: { ...input.ports.manifest, libraryHash: hash, selectionHash: profile.selectionHash as `sha256:${string}` } };
    expect(prepareRuntimeAssembly(input)).toMatchObject({ status: "refused", findings: [expect.stringContaining("without an owned")] });
});
it("SYNTHETIC same-leaf foreign fill IDs and changed compiled closure refuse before callbacks", () => {
    const input = assembly(), frame = input.ports.manifest.fills.find(fill => fill.kind === "frame")!;
    input.ports = { ...input.ports, manifest: { ...input.ports.manifest, fills: input.ports.manifest.fills.map(fill => fill === frame ? { ...fill, fill: "foreign/fill" } : fill) } };
    input.binding = { ...input.binding, frame: { ...input.binding.frame, fill: "foreign/fill" } };
    expect(prepareRuntimeAssembly(input)).toMatchObject({ status: "refused", findings: [expect.stringContaining("foreign surface")] });
    const changed = assembly();
    changed.ports = { ...changed.ports, manifest: { ...changed.ports.manifest, fills: changed.ports.manifest.fills.map(fill => { const source = { ...fill.renderer.source, files: { ...fill.renderer.source.files, "surface-index.js": "changed compiled bytes" } }; return { ...fill, renderer: { ...fill.renderer, source, sourceHash: runtimeHash(source) } }; }) } };
    expect(prepareRuntimeAssembly(changed)).toMatchObject({ status: "refused", findings: [expect.stringContaining("compiled closure")] });
    const missing = assembly();
    missing.engine = { ...engine, surfaceOptions: { packages: [], measurements: compiled.measurements.map(measurement => ({ ...measurement, runtime: null })) } };
    expect(prepareRuntimeAssembly(missing)).toMatchObject({ status: "pending", findings: [expect.stringContaining("runtime evidence missing")] });
});
it("SYNTHETIC disk projection removes old managed source/facades together and preserves host content", async () => {
    await emitLibrary(root, engine.catalog, { componentOptions: engine.componentOptions, surfaceOptions: engine.surfaceOptions });
    await fs.writeFile(join(root, "host.txt"), "host");
    const removed = await writeCompositeLibrary(root, engine.catalog, { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces", change: { op: "remove", slot: "sections.synthetic" } }] }, engine.componentOptions, engine.surfaceOptions);
    expect(libraryHash(await readLibrary(root, engine.catalog))).toBe(libraryHash(removed));
    await expect(fs.stat(join(root, "sections/synthetic/Synthetic.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(join(root, "sections/synthetic/index.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(join(root, "host.txt"), "utf8")).toBe("host");
});
it("SYNTHETIC projection refuses unmanaged collision before staging and late failure preserves all old bytes", async () => {
    const empty = { ...engine.library, surfaces: { version: 1 as const, fills: [], files: [] } };
    await fs.rm(root, { recursive: true, force: true });
    await saveSurfaceLibrary(root, { ...engine, library: empty });
    await fs.mkdir(join(root, "sections/synthetic"), { recursive: true });
    await fs.writeFile(join(root, "sections/synthetic/Synthetic.ts"), "host owned");
    const original = await fs.readFile(join(root, "metadata.json"), "utf8");
    // Exact authored source is unavailable for an absent leaf; adoption is explicit and authenticated.
    const source = syntheticSurfacePair();
    const fixtureChanges = { baseHash: libraryHash(empty), changes: source.library.surfaces!.fills.map(doc => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: surfaceOf(doc).slot, source: "synthetic" } })), surfaceBundles: [] };
    // Obtain registered bundles through the original pure fixture without any disk candidate fallback.
    const { syntheticSurface } = await import("./__fixtures__/surface-engine/synthetic.js");
    fixtureChanges.surfaceBundles = [syntheticSurface({ secondary: true }).bundle, syntheticSurface({ layer: "frames", leaf: "synthetic-shell" }).bundle] as never;
    await expect(writeCompositeLibrary(root, engine.catalog, fixtureChanges, engine.componentOptions, engine.surfaceOptions)).rejects.toThrow(/unowned host/);
    expect(await fs.readFile(join(root, "metadata.json"), "utf8")).toBe(original);
    expect(await fs.readdir(temporary)).not.toContain(".library-staging");
    await fs.rm(root, { recursive: true, force: true });
    await saveSurfaceLibrary(root, engine);
    const before = await fs.readFile(join(root, "metadata.json"), "utf8");
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
        if (String(from).endsWith(".library-staging") && String(to) === root)
            throw new Error("SYNTHETIC late surface swap failure");
        return actualFs.rename(from, to);
    });
    await expect(writeCompositeLibrary(root, engine.catalog, { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces", change: { op: "remove", slot: "sections.synthetic" } }] }, engine.componentOptions, engine.surfaceOptions)).rejects.toThrow(/late surface swap/);
    expect(await fs.readFile(join(root, "metadata.json"), "utf8")).toBe(before);
    expect(libraryHash(await readLibrary(root, engine.catalog))).toBe(libraryHash(engine.library));
});
it("SYNTHETIC concurrent surface CAS has exactly one whole winner", async () => {
    const changes = { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces" as const, change: { op: "remove" as const, slot: "sections.synthetic" as const } }] };
    const results = await Promise.allSettled([writeCompositeLibrary(root, engine.catalog, changes, engine.componentOptions, engine.surfaceOptions), writeCompositeLibrary(root, engine.catalog, changes, engine.componentOptions, engine.surfaceOptions)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: expect.any(LibraryConflictError) });
});
it("SYNTHETIC remove-all projects a valid empty next graph without old type/runtime measurements",async()=>{
    const removed=await writeCompositeLibrary(root,engine.catalog,{baseHash:libraryHash(engine.library),changes:[{portion:"surfaces",change:{op:"remove",slot:"sections.synthetic"}},{portion:"surfaces",change:{op:"remove",slot:"frames.synthetic-shell"}}]},engine.componentOptions,{packages:[],measurements:[]});
    expect(removed.surfaces).toEqual({version:1,fills:[],files:[]});expect(libraryHash(await readLibrary(root,engine.catalog))).toBe(libraryHash(removed));
    for(const path of engine.library.surfaces!.files.map(file=>file.path))await expect(fs.stat(join(root,path))).rejects.toMatchObject({code:"ENOENT"});
    expect(await fs.readFile(join(root,"surface-index.ts"),"utf8")).toBe("");
});
it("SYNTHETIC noncanonical fills, selection drift and missing owned files refuse", async () => {
    const path = join(root, "fills/sections.synthetic.json"), bytes = await fs.readFile(path, "utf8");
    await fs.writeFile(path, JSON.stringify(JSON.parse(bytes)));
    await expect(readLibrary(root, engine.catalog)).rejects.toThrow(/Noncanonical/);
    await fs.writeFile(path, bytes);
    await fs.writeFile(join(root, "surface-selection.json"), "{}");
    await expect(readLibrary(root, engine.catalog)).rejects.toThrow(/selection drift/);
});
