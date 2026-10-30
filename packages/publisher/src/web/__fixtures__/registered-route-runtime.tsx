import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { applyLibraryChange, libraryHash, resolve, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeFillDescriptor, ConsumerRuntimeManifest } from "@clossys/designer/catalog";
import { surfaceOf } from "../../../../designer/dist/catalog-core/surface-library.js";
import { surfaceRuntimeIdentity } from "../../../../designer/dist/catalog-core/surface-check.js";
import { syntheticSurface } from "../../../../designer/dist/catalog-core/__fixtures__/surface-engine/synthetic.js";
import type { compileSurfaceLibrary } from "../../../../designer/dist/library-cli/__fixtures__/surface-library.js";
import type { RouteRegistry } from "../../core/route-registry.js";
import type { InstanceRegistries } from "../../core/instance-binding.js";
import { syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../../core/__fixtures__/registered-route.js";
import { registeredLayoutSourcePin } from "../../core/layout-fill-source.js";
export type CompiledRegisteredRoute = Awaited<ReturnType<typeof compileSurfaceLibrary>>;
/** SYNTHETIC compiled selections only. Each suite owns its runtime callbacks. */
export async function compileRegisteredRouteFixture(temporary: string, hostContent = false): Promise<CompiledRegisteredRoute> {
  const { syntheticSurfacePair, saveSurfaceLibrary, compileSurfaceLibrary } = createRequire(import.meta.url)("../../../../designer/dist/library-cli/__fixtures__/surface-library.js") as typeof import("../../../../designer/dist/library-cli/__fixtures__/surface-library.js");
  const engine = syntheticSurfacePair(), content = syntheticSurface({ leaf: "content" });
  const surfaceOptions = engine.surfaceOptions;
  if (!surfaceOptions) throw new Error("SYNTHETIC fixture materialization options unavailable");
  for (const key of ["slots", "fills", "transforms", "materializations"] as const) engine.catalog.surfaces![key] = [...engine.catalog.surfaces![key], ...content.input.catalog.surfaces![key]] as never;
  engine.library = applyLibraryChange(engine.catalog, engine.library, { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces", change: { op: "adopt", slot: content.bundle.slot, source: "synthetic" } }], surfaceBundles: [content.bundle] }, { componentOptions: engine.componentOptions, surfaceOptions });
  if (hostContent) {
    // Compile a distinct synthetic selection; never mutate a measured descriptor afterward.
    const selected = Object.values(resolve(engine).surfaces!.fills).find(row => surfaceOf(row.document).kind === "frame")!;
    const { origin: _origin, ...frame } = surfaceOf(selected.document);
    if (frame.kind !== "frame") throw new Error("Synthetic frame unavailable");
    const slot = engine.catalog.surfaces!.slots.find(row => row.id === frame.slot)!;
    if (slot.contract.kind !== "frame") throw new Error("Synthetic frame contract unavailable");
    const files = engine.library.surfaces!.files.filter(file => frame.outputSha256.some(owned => owned.path === file.path));
    engine.library = applyLibraryChange(engine.catalog, engine.library, { baseHash: libraryHash(engine.library), changes: [{ portion: "surfaces", change: { op: "author", slot: frame.slot, fill: { ...frame, slots: { ...frame.slots, "skip-link": { export: frame.impl.export, path: ["skipLabel"] } } }, files } }] }, { componentOptions: engine.componentOptions, surfaceOptions });
    Object.assign(slot.contract, { slots: [...slot.contract.slots, { id: "skip-link", required: true, accepts: "host-node" }] });
  }
  await saveSurfaceLibrary(temporary, engine); return compileSurfaceLibrary(temporary, engine);
}
export function syntheticRegisteredRoute(compiled: CompiledRegisteredRoute) {
  const stackPin = registeredLayoutSourcePin("layouts.stack")!;
  const route = structuredClone(syntheticRoute("example.throwaway")), engine = compiled.input, profile = resolve(engine), consumer = engine.library.source.id;
  const headerSource = { entry: "SYNTHETIC-header.tsx", files: { "SYNTHETIC-header.tsx": "// SYNTHETIC bounded lease descriptor" }, dependencies: {} };
  const module = { package: "@clossys/designer/shell" as const, export: "PageHeaderModule" as const, renderer: { id: "SYNTHETIC header", source: headerSource, sourceHash: runtimeHash(headerSource) } };
  const fills: RuntimeFillDescriptor[] = Object.values(profile.surfaces!.fills).map(row => { const fill = surfaceOf(row.document); return { kind: fill.kind, library: consumer, leaf: fill.slot, fill: row.document.$extensions["com.clossys.fill"].id, config: null, slots: Object.keys(fill.kind === "section" ? fill.slotMap : fill.slots), states: fill.states, members: fill.members, surface: surfaceRuntimeIdentity(row), renderer: compiled.measurements.find(measurement => measurement.slot === fill.slot)!.runtime!.renderer, ...(fill.kind === "frame" ? { headerModule: module } : {}) }; });
  const frame = fills.find(fill => fill.kind === "frame")!, content = fills.find(fill => fill.leaf === "sections.content")!;
  Object.assign(route.composition.binding, { context: { consumer, medium: "web" }, frame: { leaf: frame.leaf }, fills: { body: [{ section: content.leaf, content: {} }] } });
  Object.assign(route.composition.header, { actions: { file: "actions.tsx", export: "Actions" } });
  const source = { entry: stackPin.entry, files: Object.fromEntries(Object.keys(stackPin.files).map(file => [file, readFileSync(resolvePath(dirname(fileURLToPath(import.meta.url)), "../..", file), "utf8")])) };
  const layoutSource = { ...source, dependencies: {} }, actionSource = { entry: "actions.tsx", files: { "actions.tsx": "// SYNTHETIC action descriptor" }, dependencies: {} };
  const registries: InstanceRegistries = { ...SYNTHETIC_ROUTE_REGISTRIES, frames: [{ id: frame.leaf as `frames.${string}`, status: "draft", contract: { surface: "app", configs: [], stage: { accepts: ["flow"], scroll: "region" } } }], sections: [{ id: "sections.content", status: "draft", contract: { surface: "both", configs: [], slots: [], substrates: ["flow"], substrateTests: [{ substrate: "flow", file: "SYNTHETIC.tsx", name: "SYNTHETIC only" }] } }] };
  const registry: RouteRegistry = { version: 1, consumer, routes: [route] };
  const manifest: ConsumerRuntimeManifest = { version: 1, consumer, libraryHash: libraryHash(engine.library) as `sha256:${string}`, selectionHash: profile.selectionHash as `sha256:${string}`, fills, assetClosure: { complete: true, ids: [] } };
  return { route, registry, engine, profile, module, fills, frame, content, source, layoutSource, actionSource, registries, consumer, manifest };
}
