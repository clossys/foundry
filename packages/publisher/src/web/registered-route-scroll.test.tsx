/** @vitest-environment jsdom */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyLibraryChange, libraryHash, loadBuildCatalog, resolve, runtimeAssemblyCells, runtimeHash } from "@clossys/designer/catalog";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { normalizeRepeatedSections } from "../core/instance-binding.js";
import type { InstanceBinding } from "../core/instance-binding.js";
import type { RegionPageRouteRegistration, RegionPageRouteRegistry } from "../core/route-registry.js";
import { createRegisteredPageSession, createRegisteredPublicationSession } from "./registered-route-query.js";
import { projectPageOutline } from "../content/taxonomy.js";
import { syntheticRoute } from "../core/__fixtures__/registered-route.js";
import { compileRegisteredRouteFixture, syntheticRegisteredRoute, type CompiledRegisteredRoute } from "./__fixtures__/registered-route-runtime.js";
import { syntheticSurface } from "../../../designer/dist/catalog-core/__fixtures__/surface-engine/synthetic.js";
import { flowStageStyleSheet } from "../core/flow-stage.js";
import { prepareRegisteredRoute } from "./registered-route-binding.js";
import type { RegisteredRouteRuntime } from "./registered-route-binding.js";
import { render, cleanup, act } from "@testing-library/react";
import { RegisteredRoutePage } from "./registered-route.js";

let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => {
  temporary = await realpath(await mkdtemp(join(tmpdir(), "SYNTHETIC-scroll-binding-")));
  const base = await compileRegisteredRouteFixture(temporary), engine = base.input, table = syntheticSurface({ leaf: "data-table" });
  for (const key of ["slots", "fills", "transforms", "materializations"] as const) engine.catalog.surfaces![key] = [...engine.catalog.surfaces![key], ...table.input.catalog.surfaces![key]] as never;
  engine.library = applyLibraryChange(engine.catalog, engine.library, { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces", change: { op: "adopt", slot: table.bundle.slot, source: "synthetic" } }], surfaceBundles: [table.bundle] }, { componentOptions: engine.componentOptions, surfaceOptions: engine.surfaceOptions! });
  const { surfaceOf } = createRequire(import.meta.url)("../../../designer/dist/catalog-core/surface-library.js") as typeof import("../../../designer/dist/catalog-core/surface-library.js");
  for (const leaf of ["band", "section-header", "table-of-contents"]) {
    const current = syntheticSurface({ leaf });
    for (const key of ["slots", "fills", "transforms", "materializations"] as const) engine.catalog.surfaces![key] = [...engine.catalog.surfaces![key], ...current.input.catalog.surfaces![key]] as never;
    engine.library = applyLibraryChange(engine.catalog, engine.library, { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces", change: { op: "adopt", slot: current.bundle.slot, source: "synthetic" } }], surfaceBundles: [current.bundle] }, { componentOptions: engine.componentOptions, surfaceOptions: engine.surfaceOptions! });
  }
  const selected = Object.values(resolve(engine).surfaces!.fills).find(row => surfaceOf(row.document).slot === "sections.data-table")!, { origin: _origin, ...fill } = surfaceOf(selected.document);
  const files = engine.library.surfaces!.files.filter(file => fill.outputSha256.some(owned => owned.path === file.path));
  engine.library = applyLibraryChange(engine.catalog, engine.library, { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces", change: { op: "author", slot: fill.slot, fill: { ...fill, slotMap: { rows: { export: "DataTable", path: ["rows"] } } } as never, files } }] }, { componentOptions: engine.componentOptions, surfaceOptions: engine.surfaceOptions! });
  Object.assign(engine.catalog.surfaces!.slots.find(slot => slot.id === "sections.data-table")!.contract, { slots: [{ name: "rows", type: "records", required: true }] });
  for (const [leaf, name, type] of [["sections.section-header", "heading", "copy"], ["sections.table-of-contents", "headings", "records"]] as const) {
    const row = Object.values(resolve(engine).surfaces!.fills).find(row => surfaceOf(row.document).slot === leaf)!, { origin: _origin, ...section } = surfaceOf(row.document);
    const files = engine.library.surfaces!.files.filter(file => section.outputSha256.some(owned => owned.path === file.path));
    engine.library = applyLibraryChange(engine.catalog, engine.library, { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces", change: { op: "author", slot: leaf, fill: { ...section, slotMap: { [name]: { export: section.impl.export, path: [name] } } } as never, files } }] }, { componentOptions: engine.componentOptions, surfaceOptions: engine.surfaceOptions! });
    Object.assign(engine.catalog.surfaces!.slots.find(slot => slot.id === leaf)!.contract, { slots: [{ name, type, required: true }] });
  }
  const frameRow = Object.values(resolve(engine).surfaces!.fills).find(row => surfaceOf(row.document).kind === "frame")!, { origin: _frameOrigin, ...frame } = surfaceOf(frameRow.document);
  if (frame.kind !== "frame") throw new TypeError("SYNTHETIC frame required");
  const frameFiles = engine.library.surfaces!.files.filter(file => frame.outputSha256.some(owned => owned.path === file.path));
  engine.library = applyLibraryChange(engine.catalog, engine.library, { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces", change: { op: "author", slot: frame.slot, fill: { ...frame, slots: { ...frame.slots, "page-module": { export: frame.impl.export, path: ["pageModule"] } } }, files: frameFiles } }] }, { componentOptions: engine.componentOptions, surfaceOptions: engine.surfaceOptions! });
  const frameContract = engine.catalog.surfaces!.slots.find(slot => slot.id === frame.slot)!.contract;
  if (frameContract.kind === "frame") Object.assign(frameContract, { slots: [...frameContract.slots, { id: "page-module", required: false, accepts: "sections.*" }] });
  const { saveSurfaceLibrary, compileSurfaceLibrary } = createRequire(import.meta.url)("../../../designer/dist/library-cli/__fixtures__/surface-library.js") as typeof import("../../../designer/dist/library-cli/__fixtures__/surface-library.js");
  await saveSurfaceLibrary(temporary, engine); compiled = await compileSurfaceLibrary(temporary, engine);
}, 60_000);
afterAll(async () => { cleanup(); await rm(temporary, { recursive: true, force: true }); });
/** Synthetic selected callbacks test only Publisher's closed port/binding path;
 * no consumer UI or rendered/source qualification is asserted. */
function liveFixture(table = false) {
  const f = syntheticRegisteredRoute(compiled), section = table ? f.fills.find(fill => fill.leaf === "sections.data-table")! : f.content;
  const body = { kind: "flow" as const, source: { kind: "static" as const }, sections: [{ slot: "body", index: 0 }] };
  Object.assign(f.route.composition.binding, { fills: { body: [{ section: section.leaf, content: table ? { rows: { kind: "records", ref: "rows" } } : {} }] }, body });
  if (table) Object.assign(f.route.composition.binding, { layout: { leaf: "layouts.stack", config: "stack.workspace" } });
  const configuration = table ? "stack.workspace" : "stack.focus";
  const sectionRenderer = vi.fn((input: any) => input.slots.children ?? null), frameRenderer = vi.fn((input: any) => input.slots.main);
  const registries = { ...f.registries, sections: [...f.registries.sections, ...f.engine.catalog.surfaces!.slots.filter(slot => slot.layer === "sections" && slot.id !== "sections.content").map(slot => ({ id: slot.id as `sections.${string}`, status: "draft" as const, contract: { surface: "both" as const, configs: [], slots: slot.contract.kind === "section" ? slot.contract.slots : [], substrates: ["flow" as const], substrateTests: [{ substrate: "flow" as const, file: "SYNTHETIC.tsx", name: "SYNTHETIC port delivery" }] } }))] };
  const runtime: RegisteredRouteRuntime = {
    assembly: { identity: { kind: "artifact", name: "SYNTHETIC scroll binding", sha256: runtimeHash(compiled.compiled) }, engine: f.engine,
      contracts: { ...loadBuildCatalog(), slots: f.engine.catalog.surfaces!.slots.map(slot => ({ ...slot, contract: slot.contract.kind === "frame" ? { ...slot.contract, stage: { accepts: ["flow"] as const, scroll: "region" as const } } : { ...slot.contract, ...(["sections.data-table", "sections.section-header"].includes(slot.id) ? { anatomy: { ...slot.contract.anatomy, band: "sections.band" as const } } : {}), substrates: ["flow"] as const, substrateTests: [{ substrate: "flow" as const, file: "SYNTHETIC.tsx", name: "SYNTHETIC port delivery" }] } })) },
      ports: { manifest: f.manifest, renderers: { ...Object.fromEntries(f.fills.filter(fill => fill.kind === "section").map(fill => [fill.renderer.id, sectionRenderer])), [f.frame.renderer.id]: frameRenderer }, resolveContent: reference => reference.ref === "rows" ? content({ kind: "records", ref: "rows" }, [{ id: "one" }]) : undefined, frameHost: { navigate: vi.fn() } },
      themes: ["light"], states: ["default"], css: [{ id: "publisher-flow-stage.css", contents: flowStageStyleSheet(f.profile, "layouts.stack", configuration) }], assets: [],
      stageMeasurements: { renderer: { id: "Stack", source: f.layoutSource, sourceHash: runtimeHash(f.layoutSource) }, environment: { kind: "SYNTHETIC width basis" }, cells: runtimeAssemblyCells(resolve(f.engine), ["light"], ["default"]).map(cell => ({ cell, width: cell.width - 80 })) } },
    instanceLibrary: { id: f.consumer, role: "consumer", resolveFill: (leaf, config) => leaf === "layouts.stack" && config === configuration ? { library: f.consumer, leaf, config, headings: [], states: ["default"], renderer: f.source } : undefined, resolveContent: reference => reference },
    registries, layoutRenderer: { id: "Stack", source: f.layoutSource, sourceHash: runtimeHash(f.layoutSource) }, cell: { theme: "light", state: "default", width: 320 },
    headerActions: { renderer: { id: "SYNTHETIC Actions", source: f.actionSource, sourceHash: runtimeHash(f.actionSource) }, state: { revision: 1 } },
  };
  return { ...f, runtime, sectionRenderer, frameRenderer };
}
function regionFixture(count = 2) {
  const f = liveFixture(true), template = f.route.composition.binding;
  const host = { bind: vi.fn(), setRegions: vi.fn(), setState: vi.fn(), setCommands: vi.fn(), setChunks: vi.fn() };
  const publication = createRegisteredPublicationSession({ id: "scroll", mainSlot: "body", frame: template.frame, layout: template.layout!, format: template.format, surface: template.surface, context: template.context, packIds: template.packIds }, host);
  const fills = Array.from({ length: count }, () => structuredClone(template.fills.body![0]!));
  const route: RegionPageRouteRegistration = { ...f.route, composition: { ...f.route.composition, binding: { instanceId: template.instanceId, label: template.label, path: f.route.path, publicationId: "scroll", regions: { main: fills } } } };
  const registry: RegionPageRouteRegistry = { version: 1, consumer: f.consumer, publication: publication.publication, routes: [route] };
  const half = Math.ceil(count / 2), nodes = ["first", "second"].map((id, group) => ({ id, label: id, count: group ? count - half : half, estimate: 200, section: { slot: "main", index: group ? half : 0 }, l1: Array.from({ length: group ? count - half : half }, (_, index) => ({ id: `band${index}`, label: `Band ${index}`, count: 1, estimate: 20, section: { slot: "main", index: index + (group ? half : 0) }, l2: [] })) }));
  const input = { ...options(), page: route.composition.binding, path: route.path, routeId: route.routeId, manifest: { l0: nodes }, publication };
  const page = createRegisteredPageSession(input); f.runtime.page = page;
  return { ...f, route, registry, host, publication, input, page };
}

const manifest = () => ({ l0: [
  { id: "records", label: "Records", count: 2, estimate: 200, section: { slot: "body", index: 0 }, l1: [
    { id: "names", label: "Names", count: 2, estimate: 100, section: { slot: "body", index: 0 }, l2: [
      { id: "primary", label: "Primary", count: 2, estimate: 100, section: { slot: "body", index: 0 } },
    ] },
  ] },
] });
function binding() { return structuredClone(syntheticRoute("example.scroll").composition.binding); }
const content = (reference: { kind: "records"; ref: string }, value: unknown) => ({ reference, value, hash: runtimeHash(value) });
function options() {
  return { page: binding(), query: { kind: "records" as const, ref: "query" }, path: "/agents/example", manifest: manifest(), loaders: {
    chunk: vi.fn(async () => []), search: vi.fn(async () => []), item: vi.fn(async () => undefined),
  }, navigation: { hash: () => "", scroll: vi.fn(), focus: vi.fn(), replaceState: vi.fn(), pushState: vi.fn() }, chat: { pin: vi.fn() } };
}

describe("consumed registered scroll-page capabilities", () => {
  it("prepares nested authored band Sections and an independent selected TOC before any main chunk request", async () => {
    const f = regionFixture(), heading = (name: string) => ({ kind: "copy" as const, ref: `heading/${name}` }), rows = { kind: "records" as const, ref: "rows/names", lazy: { loader: "chunk" as const, args: { l0: "first", l1: "names" } } };
    const raw = f.route.composition.binding;
    Object.assign(raw, { regions: { main: [
      { section: "sections.section-header", content: { heading: heading("first") } },
      { section: "sections.band", content: {}, children: [{ section: "sections.section-header", content: { heading: heading("names") } }, { section: "sections.data-table", content: { rows } }] },
    ], "page-module": [{ section: "sections.table-of-contents", content: { headings: { kind: "records", ref: "outline" } } }] } });
    f.runtime.assembly.ports.resolveContent = reference => reference.ref.startsWith("heading/") ? { reference, value: reference.ref, hash: runtimeHash(reference.ref) } : undefined;
    f.runtime.assembly.ports.frameOrder = ({ layout, slots }) => [...(slots["page-module"] ?? []), ...layout];
    const input = { ...f.input, page: raw, manifest: { l0: [{ id: "first", label: "First", count: 1, estimate: 200, section: { slot: "main", index: 0 }, l1: [{ id: "names", label: "Names", count: 1, estimate: 100, section: { slot: "main", index: 1, children: [0] }, l2: [{ id: "primary", label: "Primary", count: 1, estimate: 80, section: { slot: "main", index: 1, children: [1] } }] }] }] }, loaders: { ...f.input.loaders, chunk: vi.fn(async () => [content({ kind: "records", ref: rows.ref }, [{ id: "one" }])]) } };
    const page = createRegisteredPageSession(input); f.runtime.page = page;
    const before = prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null);
    expect(before.status, JSON.stringify(before)).toBe("stream"); if (before.status !== "stream") return;
    expect(before.chunks[0]!.result.status).toBe("pending"); expect(before.regionsAssembly?.status, JSON.stringify(before.regionsAssembly)).toBe("ready");
    expect(before.renderRegions!(f.runtime.cell).regions["page-module"]).toHaveLength(1);
    expect(input.loaders.chunk).not.toHaveBeenCalled();
    const toc = f.sectionRenderer.mock.calls.map(([input]) => input).find(input => input.fill.leaf === "sections.table-of-contents");
    expect(toc.content.headings.value).toEqual([{ id: "first", label: "First", level: 2 }, { id: "first--names", label: "Names", level: 3 }, { id: "first--names--primary", label: "Primary", level: 4 }]);
    await page.request(rows);
    const after = prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null);
    expect(after.status).toBe("stream"); if (after.status !== "stream") return;
    expect(after.chunks[0]!.result.status, JSON.stringify(after.chunks[0]!.result)).toBe("ready");
    const selected = after.chunks[0]!.result.input!.binding.sections.body![1]!;
    expect(selected.children!.map(fill => fill.leaf)).toEqual(["sections.section-header", "sections.data-table"]);
    expect(after.chunks[0]!.result.input!.ports.manifest.fills.map(fill => fill.leaf)).toEqual(expect.arrayContaining(["sections.band", "sections.section-header", "sections.data-table", "sections.table-of-contents"]));
  });
  it("prepares a >24 Section stream as two independently valid selected Layout assemblies", () => {
    const f = regionFixture(26), result = prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null);
    expect(result.status, JSON.stringify(result)).toBe("stream"); if (result.status !== "stream") return;
    expect(result.chunks.map(chunk => chunk.result.status)).toEqual(["ready", "ready"]);
    expect(result.chunks.map(chunk => chunk.result.input?.binding.sections.body?.length)).toEqual([13, 13]);
    expect("assembly" in result).toBe(false);
    f.publication.activate(f.route.routeId); f.publication.setPage(result.renderRegions!(f.runtime.cell), f.page);
    expect(f.host.setChunks.mock.calls[0]![0].map(chunk => chunk.status)).toEqual(["ready", "ready"]);
    expect(f.host.setRegions.mock.calls[0]![0]).not.toHaveProperty("main");
    expect(f.sectionRenderer).toHaveBeenCalled();
  });
  it("normalizes repeat and lazy records through prepareRegisteredRoute before delivering real selected Section inputs", async () => {
    const f = liveFixture(true), binding = f.route.composition.binding, over = { kind: "records" as const, ref: "bands" };
    const reference = (l0: string) => ({ kind: "records" as const, ref: `rows/${l0}`, lazy: { loader: "chunk" as const, args: { l0 } } });
    const rows = [{ id: "a", content: { rows: reference("a") } }, { id: "b", content: { rows: reference("b") } }];
    binding.fills = { body: [{ ...binding.fills.body![0]!, repeat: { over, key: "id" } }] };
    f.runtime.assembly.ports.resolveContent = ref => ref.ref === "bands" ? content(over, rows) : undefined;
    const input = { ...options(), page: binding, path: f.route.path, manifest: { l0: rows.map(row => ({ id: row.id, label: row.id, count: 1, estimate: 20, section: { slot: "body", index: 0, key: row.id }, l1: [] })) } };
    input.loaders.chunk = vi.fn(async ({ l0 }) => [content({ kind: "records", ref: `rows/${l0}` }, [{ id: "same", l0 }])]) as never;
    input.loaders.item = vi.fn(async (l0, id) => ({ record: { l0, id }, content: [] })) as never;
    const page = createRegisteredPageSession(input); f.runtime.page = page;
    expect(prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null).status).toBe("pending");
    expect(input.loaders.chunk).not.toHaveBeenCalled();
    await page.request(reference("a")); await page.request(reference("b"));
    const result = prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null);
    expect(result.status, JSON.stringify(result)).toBe("ready"); if (result.status !== "ready") return;
    result.assembly.render(f.runtime.cell);
    const inputs = f.sectionRenderer.mock.calls.map(call => call[0] as any);
    expect(inputs.map(input => input.content.rows.value[0].l0)).toEqual(["a", "b"]);
    expect(result.input!.binding.sections.body!.map(fill => fill.content.rows)).toEqual([{ kind: "records", ref: "rows/a" }, { kind: "records", ref: "rows/b" }]);
    await inputs[0]!.sectionHost.onSelectionChange(["same"]); await inputs[1]!.sectionHost.onSelectionChange(["same"]);
    expect(input.chat.pin.mock.calls.map(([context]) => context.l0)).toEqual(["a", "b"]);
  });
  it("publishes demand-ready chunks before asynchronous hash scrolling, and projects loader errors and item 404 through the frame", async () => {
    const f = regionFixture(), refs = ["first", "second"].map(l0 => ({ kind: "records" as const, ref: `rows/${l0}`, lazy: { loader: "chunk" as const, args: { l0 } } }));
    const raw = f.route.composition.binding;
    Object.assign(raw, { regions: { main: refs.map(rows => ({ section: "sections.data-table", content: { rows } })) } });
    let releaseScroll!: () => void;
    const input = { ...f.input, page: raw, navigation: { ...f.input.navigation, scroll: vi.fn(() => new Promise<void>(resolve => { releaseScroll = resolve; })) }, loaders: { ...f.input.loaders,
      chunk: vi.fn(async ({ l0 }: { l0: string }) => { if (l0 === "second") throw new Error("SYNTHETIC chunk failure"); return [content({ kind: "records", ref: `rows/${l0}` }, [{ id: "one" }])]; }) } };
    const page = createRegisteredPageSession(input); f.runtime.page = page;
    const view = render(<RegisteredRoutePage registry={f.registry} routeId={f.route.routeId} useRuntime={() => f.runtime} renderActions={() => null} />);
    expect(f.host.setChunks.mock.calls.at(-1)![0].map(chunk => chunk.status)).toEqual(["unrequested", "unrequested"]);
    expect(input.loaders.chunk).not.toHaveBeenCalled();
    let moving!: Promise<void>;
    await act(async () => { moving = page.navigate("#first"); await Promise.resolve(); await Promise.resolve(); });
    expect(f.host.setState.mock.calls.some(([state]) => state.main === "loading" && state.navigating)).toBe(true);
    expect(f.host.setChunks.mock.calls.at(-1)![0][0]!.status).toBe("ready");
    expect(f.host.setState.mock.calls.at(-1)![0]).toEqual({ main: "ready", navigating: true });
    expect(input.navigation.focus).not.toHaveBeenCalled();
    await act(async () => { releaseScroll(); await moving; });
    expect(input.navigation.focus).toHaveBeenCalledWith("first");
    await act(async () => { await expect(page.requestChunk({ l0: "second" })).rejects.toThrow("SYNTHETIC chunk failure"); });
    expect(f.host.setState.mock.calls.at(-1)![0]).toEqual({ main: "error", navigating: false });
    await act(async () => { expect(await page.loadItem(`${f.route.path}/first/unknown`)).toMatchObject({ code: 404 }); });
    expect(f.host.setState.mock.calls.at(-1)![0]).toEqual({ main: "not-found", navigating: false });
    view.unmount();
  });
  it("requests only the explicitly partitioned L1 chunk for its anchor", async () => {
    const f = regionFixture(3), raw = f.route.composition.binding;
    const rows = [undefined, "names", "values"].map(l1 => ({ kind: "records" as const, ref: `strings/${l1 ?? "header"}`, lazy: { loader: "chunk" as const, args: { l0: "strings", ...(l1 ? { l1 } : {}) } } }));
    Object.assign(raw, { regions: { main: rows.map(rows => ({ section: "sections.data-table", content: { rows } })) } });
    const input = { ...f.input, page: raw, manifest: { l0: [{ id: "strings", label: "Strings", count: 1198, estimate: 40, partition: "l1" as const, section: { slot: "main", index: 0 }, l1: ["names", "values"].map((id, index) => ({ id, label: id, count: 599, estimate: 400, section: { slot: "main", index: index + 1 }, l2: [] })) }] }, loaders: { ...f.input.loaders, chunk: vi.fn(async ({ l0, l1 }: { l0: string; l1?: string }) => [content({ kind: "records", ref: `${l0}/${l1 ?? "header"}` }, [{ id: "one" }])]) } };
    const page = createRegisteredPageSession(input); f.runtime.page = page;
    const before = prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null);
    expect(before.status).toBe("stream");
    await page.navigate("#strings--names");
    expect(input.loaders.chunk.mock.calls).toEqual([[{ l0: "strings", l1: "names" }]]);
    const result = prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null);
    expect(result.status).toBe("stream"); if (result.status !== "stream") return;
    expect(result.chunks.map(chunk => [chunk.id, chunk.result.status])).toEqual([["strings", "pending"], ["strings--names", "ready"], ["strings--values", "pending"]]);
    await page.navigate("#strings");
    expect(input.loaders.chunk.mock.calls[1]).toEqual([{ l0: "strings" }]);
  });
  it("refuses same-identity sessions with different page data or a different selected publication", () => {
    const f = regionFixture(), foreign = structuredClone(f.input.page);
    Object.assign(foreign, { regions: { main: [] } });
    f.runtime.page = createRegisteredPageSession({ ...f.input, page: foreign, manifest: { l0: [] } });
    expect(prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null).status).toBe("refused");
    const other = createRegisteredPublicationSession({ ...f.publication.publication, id: "foreign" }, { bind: vi.fn(), setRegions: vi.fn(), setState: vi.fn(), setCommands: vi.fn(), setChunks: vi.fn() });
    f.runtime.page = createRegisteredPageSession({ ...f.input, publication: other });
    expect(prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null).status).toBe("refused");
  });
  it("keeps one frame and command port across two registered pages, drops stale results, and recovers after no hits without replacing main", async () => {
    const f = regionFixture(), second: RegionPageRouteRegistration = structuredClone(f.route);
    Object.assign(second, { routeId: "second.page", path: "/agents/second" });
    Object.assign(second.composition.binding, { instanceId: "second.page", path: second.path });
    const registry = { ...f.registry, routes: [f.route, second] };
    let oldResult!: (hits: never[]) => void;
    const firstInput = { ...f.input, loaders: { ...f.input.loaders, search: vi.fn(() => new Promise<never[]>(resolve => { oldResult = resolve; })) } };
    const secondInput = { ...f.input, routeId: second.routeId, path: second.path, page: second.composition.binding,
      loaders: { ...f.input.loaders, search: vi.fn(async (query: string) => query === "none" ? [] : [{ l0: "second", anchor: "second", label: query, kind: "record" }]) } };
    const firstPage = createRegisteredPageSession(firstInput), secondPage = createRegisteredPageSession(secondInput);
    const firstRuntime = { ...f.runtime, page: firstPage }, secondRuntime = { ...f.runtime, page: secondPage };
    const useRuntime = (route: { routeId: string }) => route.routeId === f.route.routeId ? firstRuntime : secondRuntime;
    const view = render(<RegisteredRoutePage registry={registry} routeId={f.route.routeId} useRuntime={useRuntime} renderActions={() => null} />);
    const ports = f.host.bind.mock.calls[0]![1];
    await act(async () => { ports.onCommandQueryChange("old"); });
    view.rerender(<RegisteredRoutePage registry={registry} routeId={second.routeId} useRuntime={useRuntime} renderActions={() => null} />);
    const mainUpdates = f.host.setChunks.mock.calls.length, regionUpdates = f.host.setRegions.mock.calls.length;
    await act(async () => { ports.onCommandQueryChange("none"); });
    expect(f.host.setCommands.mock.calls.at(-1)![0]).toEqual([]);
    await act(async () => { oldResult([{ l0: "first", anchor: "first", label: "old", kind: "record" }] as never[]); await Promise.resolve(); ports.onCommandQueryChange("again"); await Promise.resolve(); });
    expect(secondInput.loaders.search.mock.calls.map(([query]) => query)).toEqual(["none", "again"]);
    expect(f.host.setCommands.mock.calls.at(-1)![0][0]!.items[0]!.label).toBe("again");
    expect(f.host.setChunks).toHaveBeenCalledTimes(mainUpdates); expect(f.host.setRegions).toHaveBeenCalledTimes(regionUpdates);
    expect(f.host.bind).toHaveBeenCalledTimes(1); expect(f.host.bind.mock.calls[0]![1]).toBe(ports);
    const states = f.host.setState.mock.calls.length;
    f.publication.setState({ main: "error", navigating: false }, firstPage);
    expect(f.host.setState).toHaveBeenCalledTimes(states);
    view.unmount();
  });
  it("replaces native item template refs on concrete param changes in one registered route, ignoring a late prior item", async () => {
    const f = regionFixture(), raw = f.route.composition.binding, pattern = `${f.route.path}/[l0]/[id]`;
    Object.assign(f.route, { path: pattern }); Object.assign(raw, { path: pattern });
    let late!: (item: any) => void;
    const input = { ...f.input, page: raw, path: pattern, loaders: { ...f.input.loaders,
      item: vi.fn(async (_l0: string, id: string) => id === "late" ? new Promise(resolve => { late = resolve; }) : { record: { id }, content: [content({ kind: "records", ref: "rows" }, [{ id }])] }) } };
    const page = createRegisteredPageSession(input as never), runtime = { ...f.runtime, page, itemPath: `${f.route.path.replace("/[l0]/[id]", "")}/first/a` };
    const view = render(<RegisteredRoutePage registry={f.registry} routeId={f.route.routeId} useRuntime={() => runtime} renderActions={() => null} />);
    await act(async () => { await Promise.resolve(); });
    expect(page.read({ kind: "records", ref: "rows" })).toMatchObject({ status: "ready", content: { value: [{ id: "a" }] } });
    const pending = page.loadItem(runtime.itemPath.replace("/a", "/late"));
    runtime.itemPath = runtime.itemPath.replace("/a", "/b");
    view.rerender(<RegisteredRoutePage registry={f.registry} routeId={f.route.routeId} useRuntime={() => runtime} renderActions={() => null} />);
    await act(async () => { await Promise.resolve(); late({ record: { id: "late" }, content: [content({ kind: "records", ref: "rows" }, [{ id: "late" }])] }); await pending; });
    expect(page.read({ kind: "records", ref: "rows" })).toMatchObject({ status: "ready", content: { value: [{ id: "b" }] } });
    expect(input.loaders.item.mock.calls.map(([, id]) => id)).toEqual(["a", "late", "b"]);
    view.unmount();
  });
  it("expands distinct consumer-owned repeat records and remaps every body reference, leaving static fills unchanged", () => {
    const page = binding(), over = { kind: "records" as const, ref: "bands" };
    const original = structuredClone(page.fills.body![0]!);
    page.fills = { body: [{ ...original, repeat: { over, key: "id" } }, original] };
    page.body = { kind: "flow", source: { kind: "static" }, sections: [{ slot: "body", index: 0 }, { slot: "body", index: 1 }] };
    const rows = [{ id: "one", content: { rows: { kind: "records", ref: "rows/one" } } }, { id: "two", content: { rows: { kind: "records", ref: "rows/two" } } }];
    const result = normalizeRepeatedSections(page, ref => ref.ref === over.ref ? content(over, rows) : undefined);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.binding.fills.body!.map(fill => fill.content.rows?.ref)).toEqual(["rows/one", "rows/two", undefined]);
    expect(result.binding.body).toMatchObject({ sections: [{ slot: "body", index: 0 }, { slot: "body", index: 1 }, { slot: "body", index: 2 }] });
    expect(result.binding.fills.body![2]).toEqual(original);
    expect(result.keys).toMatchObject({ "sections.body.0": "one", "sections.body.1": "two" });
    expect(normalizeRepeatedSections(binding(), () => undefined).status).toBe("ready");
  });
  it("refuses duplicate repeat keys and undeclared executable template fields", () => {
    const page = binding(), over = { kind: "records" as const, ref: "bands" };
    page.fills = { body: [{ ...page.fills.body![0]!, repeat: { over, key: "id" } }] };
    expect(normalizeRepeatedSections(page, () => content(over, [{ id: "same", content: {} }, { id: "same", content: {} }])).status).toBe("refused");
    expect(normalizeRepeatedSections({ ...page, fills: { body: [{ ...page.fills.body![0]!, repeat: { over, key: "id", execute: () => [] } }] } } as never, () => content(over, [])).status).toBe("refused");
  });
  it("scopes repeated band children through typed consumer references, never consumer-chosen Section implementations", () => {
    const page = binding(), refs = {
      bands: { kind: "records" as const, ref: "bands" },
      cardsA: { kind: "records" as const, ref: "cards/a" }, cardsB: { kind: "records" as const, ref: "cards/b" },
    };
    page.fills = { body: [{ section: "sections.band", content: {}, repeat: { over: refs.bands, key: "id" }, children: [
      { section: "sections.section-header", content: { heading: { kind: "copy", ref: "heading" } } },
      { section: "sections.data-table", content: { rows: { kind: "records", ref: "rows" } }, repeat: { over: { kind: "records", ref: "cards" }, key: "id" } },
    ] }] };
    const values = new Map<string, unknown>([
      ["bands", [{ id: "a", references: { cards: refs.cardsA, heading: { kind: "copy", ref: "heading/a" } } }, { id: "b", references: { cards: refs.cardsB, heading: { kind: "copy", ref: "heading/b" } } }]],
      ["cards/a", [{ id: "primary", references: { rows: { kind: "records", ref: "rows/a" } } }]],
      ["cards/b", [{ id: "primary", references: { rows: { kind: "records", ref: "rows/b" } } }]],
    ]);
    const normalized = normalizeRepeatedSections(page, ref => values.has(ref.ref) ? { reference: ref, value: values.get(ref.ref) as never, hash: runtimeHash(values.get(ref.ref)) } : undefined);
    expect(normalized.status).toBe("ready"); if (normalized.status !== "ready") return;
    expect(normalized.binding.fills.body!.map(fill => fill.children![1]!.content.rows!.ref)).toEqual(["rows/a", "rows/b"]);
    expect(normalized.binding.fills.body![0]!.children![0]!.content.heading!.ref).toBe("heading/a");
    expect(normalized.scopes["sections.body.1.children.1"]).toMatchObject({ keys: ["b", "primary"], placement: { slot: "body", index: 0, children: [1] } });
    expect(normalized.binding.fills.body!.every(fill => fill.section === "sections.band" && fill.children![1]!.section === "sections.data-table")).toBe(true);
  });
  it("retains an unrequested lazy repeat dependency even when it expands to zero children", () => {
    const page = binding(), over = { kind: "records" as const, ref: "cards", lazy: { loader: "chunk" as const, args: { l0: "records", l1: "names" } } };
    page.fills = { body: [{ section: "sections.band", content: {}, children: [{ section: "sections.data-table", content: {}, repeat: { over, key: "id" } }] }] };
    const result = normalizeRepeatedSections(page, () => undefined);
    expect(result.status).toBe("ready"); if (result.status !== "ready") return;
    expect(Object.values(result.lazy)).toEqual([over]);
    expect(result.scopes["sections.body.0.children.0"]).toBeUndefined();
  });
  it("never resolves a lazy ref until requested, then deduplicates pending requests and becomes ready", async () => {
    const input = options(), reference = { kind: "records" as const, ref: "rows", lazy: { loader: "chunk" as const, args: { l0: "records", l1: "names" } } };
    let finish!: (value: never[]) => void;
    input.loaders.chunk = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const session = createRegisteredPageSession(input);
    expect(session.read(reference).status).toBe("pending"); expect(input.loaders.chunk).not.toHaveBeenCalled();
    const first = session.request(reference), second = session.request(reference);
    expect(input.loaders.chunk).toHaveBeenCalledTimes(1); expect(session.read(reference).status).toBe("pending");
    finish([content({ kind: "records", ref: "rows" }, [{ id: "one" }])] as never[]);
    await Promise.all([first, second]);
    expect(session.read(reference)).toMatchObject({ status: "ready", content: { value: [{ id: "one" }] } });
  });
  it("uses the page record and exact manifest as the same three-level outline and rejects unknown placements", () => {
    const outline = projectPageOutline(binding(), manifest());
    expect(outline.headings).toEqual([{ id: "records", label: "Records", level: 2, children: [
      { id: "records--names", label: "Names", level: 3, children: [{ id: "records--names--primary", label: "Primary", level: 4 }] },
    ] }]);
    expect(outline.groups.map(group => group.id)).toEqual(manifest().l0.map(row => row.id));
    expect(outline.anchors).toEqual(["records", "records--names", "records--names--primary"]);
    expect(() => projectPageOutline(binding(), { l0: [{ ...manifest().l0[0]!, section: { slot: "missing", index: 0 } }] })).toThrow();
  });
  it("on a cold hash load ensures its chunk before scrolling/focusing, and scroll-spy replaces history", async () => {
    const input = options(), order: string[] = [];
    input.navigation.hash = () => "#records--names";
    input.loaders.chunk = vi.fn(async () => { order.push("load"); return []; });
    input.navigation.scroll = vi.fn(() => { order.push("scroll"); }); input.navigation.focus = vi.fn(() => { order.push("focus"); });
    const session = createRegisteredPageSession(input);
    await session.start(); expect(order).toEqual(["load", "scroll", "focus"]);
    session.scrollSpy("records--names--primary");
    expect(input.navigation.replaceState).toHaveBeenCalledWith("#records--names--primary");
    expect(input.navigation.pushState).not.toHaveBeenCalled();
    await expect(session.navigate("#unknown")).rejects.toThrow();
  });
  it("groups actual search-loader hits by L0 and exposes frame command content, including empty results", async () => {
    const input = options(); input.loaders.search = vi.fn(async () => [{ l0: "records", anchor: "records--names", label: "Names", kind: "band" }]);
    const session = createRegisteredPageSession(input);
    await session.search("name");
    expect(input.loaders.search).toHaveBeenCalledWith("name");
    expect(session.commandGroups()).toEqual([{ id: "records", label: "Records", count: 1, items: [{ id: "records--names", label: "Names", href: "#records--names" }] }]);
    input.loaders.search.mockResolvedValueOnce([]); await session.search("missing"); expect(session.commandGroups()).toEqual([]);
  });
  it("passes item route params to the item loader and returns 404 for an unknown id", async () => {
    const input = options(), row = { id: "one", text: "Record" }; input.loaders.item = vi.fn(async (_l0, id) => id === "one" ? { record: row, content: [] } : undefined);
    const session = createRegisteredPageSession(input);
    expect(await session.loadItem("/agents/example/records/one")).toEqual({ status: "ready", code: 200, l0: "records", id: "one", record: row });
    expect(input.loaders.item).toHaveBeenCalledWith("records", "one");
    expect(await session.loadItem("/agents/example/records/missing")).toMatchObject({ status: "not-found", code: 404 });
    expect(await session.loadItem("/agents/example/unknown/one")).toMatchObject({ status: "not-found", code: 404 });
  });
  it("does not let an item claim chunk content even when its first payload is identical", async () => {
    const input = options(), rows = content({ kind: "records", ref: "rows" }, [{ id: "one" }]);
    input.loaders.chunk = vi.fn(async () => [rows]) as never;
    input.loaders.item = vi.fn(async () => ({ record: { id: "one" }, content: [rows] })) as never;
    const page = createRegisteredPageSession(input);
    await page.requestChunk({ l0: "records" });
    await expect(page.loadItem("/agents/example/records/one")).rejects.toThrow("another scope");
    expect(page.read(rows.reference)).toMatchObject({ status: "ready", content: rows });
  });
  it("replaces item content as a set so an omitted B reference cannot retain A data", async () => {
    const f = liveFixture(true), input = { ...options(), page: f.route.composition.binding, path: f.route.path };
    input.loaders.item = vi.fn(async (_l0, id) => ({ record: { id }, content: id === "a" ? [content({ kind: "records", ref: "rows" }, [{ id }])] : [] })) as never;
    const page = createRegisteredPageSession(input); f.runtime.page = page;
    await page.loadItem(`${f.route.path}/records/a`);
    expect(prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null).status).toBe("ready");
    await page.loadItem(`${f.route.path}/records/b`);
    expect(page.read({ kind: "records", ref: "rows" })).toMatchObject({ status: "pending", owned: true });
    expect(prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime, () => null).status).toBe("pending");
  });
  it("scopes single selection to its repeated table L0 and pins the actual loaded record to chat", async () => {
    const input = options(); input.loaders.item = vi.fn(async (l0, id) => ({ record: { l0, id }, content: [] }));
    const session = createRegisteredPageSession(input), preview = vi.fn();
    const host = session.selectionHost("records", { renderPreview: preview });
    expect(host.renderPreview).toBe(preview);
    await host.onSelectionChange(["one"]);
    expect(input.chat.pin).toHaveBeenCalledWith({ l0: "records", id: "one", record: { l0: "records", id: "one" } });
    await expect(host.onSelectionChange(["one", "two"])).rejects.toThrow();
  });
  it("binds the publication frame once and forwards loading/error/not-found state without resetting persistent host ports", async () => {
    const template = binding(), host = { bind: vi.fn(), setRegions: vi.fn(), setState: vi.fn(), setCommands: vi.fn(), setChunks: vi.fn() };
    const publication = createRegisteredPublicationSession({ id: "example", mainSlot: "body", frame: template.frame, layout: template.layout!, format: template.format, surface: template.surface, context: template.context, packIds: template.packIds }, host);
    publication.setPage({ routeId: "one", trail: { title: "One" }, regions: { main: [] } });
    publication.activate("two");
    publication.setPage({ routeId: "two", trail: { title: "Two" }, regions: { main: [] } });
    expect(host.bind).toHaveBeenCalledTimes(1); expect(host.setRegions).toHaveBeenCalledTimes(2);
    publication.setState({ main: "loading", navigating: true }); publication.setState({ main: "error", navigating: false }); publication.setState({ main: "not-found", navigating: false });
    expect(host.setState.mock.calls.map(([state]) => state.main)).toEqual(["loading", "error", "not-found"]);
  });
});
