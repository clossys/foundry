/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { join, resolve as pathResolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createElement } from "react";
import { afterAll, beforeAll, expect, it } from "vitest";
import { libraryHash, loadBuildCatalog, resolve, runtimeAssemblyCells, runtimeHash } from "@clossys/designer/catalog";
import { registeredFlowRuntimeInputs } from "@clossys/publisher/web/registered-route";
import { registeredFlowLayoutSource } from "@clossys/publisher/web/registered-route-check";
import type { RegisteredRouteRuntime } from "@clossys/publisher/web/registered-route";
import type { FlowInstanceBinding } from "@clossys/publisher/core";
import { compileRegisteredRouteFixture, syntheticRegisteredRoute, type CompiledRegisteredRoute } from "./__fixtures__/registered-route-runtime.js";
let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => { temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-public-flow-"))); compiled = await compileRegisteredRouteFixture(join(temporary, "library")); }, 30000);
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
const generated = `import { registeredFlowRuntimeInputs, prepareRegisteredRoute } from "@clossys/publisher/web/registered-route";
import { registeredFlowLayoutSource } from "@clossys/publisher/web/registered-route-check";
export async function prepare(registry, routeId, runtime) {
  const binding = registry.routes.find(route => route.routeId === routeId).composition.binding;
  const layoutRenderer = await registeredFlowLayoutSource(binding.layout.leaf);
  const selected = registeredFlowRuntimeInputs({ binding, engine: runtime.assembly.engine, layoutRenderer, states: runtime.assembly.states, breakpointPixels: runtime.assembly.breakpointPixels });
  const original = runtime.instanceLibrary;
  const instanceLibrary = { ...original, resolveFill: (leaf, config) => leaf === selected.fill.leaf && config === selected.fill.config ? selected.fill : original.resolveFill(leaf, config) };
  const next = { ...runtime, instanceLibrary, layoutRenderer, assembly: { ...runtime.assembly, css: [...runtime.assembly.css, ...selected.css] } };
  return { selected, runtime: next, unassociated: prepareRegisteredRoute(registry, routeId, { ...next, instanceLibrary: original }), prepared: prepareRegisteredRoute(registry, routeId, next) };
}
`;
it("generated consumer runs the registered route binder with only public flow producer imports and deliberate selected fill association", async () => {
  await fs.symlink(pathResolve(import.meta.dirname, "../../../..", "node_modules"), join(temporary, "node_modules"), "dir");
  const file = join(temporary, "consumer.mjs"); await fs.writeFile(file, generated);
  expect(generated).not.toMatch(/dist\/|src\/|core\/flow-stage|layout-fill-source|registered-route-layout/);
  const consumer = await import(pathToFileURL(file).href);
  const f = syntheticRegisteredRoute(compiled), { route, registry, engine, manifest, registries, frame, content } = f;
  delete (route.composition.header as { actions?: unknown }).actions;
  const body = { kind: "flow" as const, source: { kind: "static" as const }, sections: [{ slot: "body", index: 0 }] };
  Object.assign(route.composition.binding, { body });
  const stageSource = { entry: "frames/FrameStage.tsx", files: { "frames/FrameStage.tsx": "// SYNTHETIC fixture: actual public Stage, no qualification" }, dependencies: {} };
  const stageRenderer = { id: "SYNTHETIC flow Stage", source: stageSource, sourceHash: runtimeHash(stageSource) };
  const stage = { package: "@clossys/designer/frames" as const, export: "FrameStage" as const, renderer: stageRenderer };
  const layoutRenderer = await registeredFlowLayoutSource("layouts.stack");
  const runtime: RegisteredRouteRuntime = {
    assembly: { identity: { kind: "artifact", name: "SYNTHETIC public flow consumer", sha256: runtimeHash(compiled.compiled) }, engine,
      contracts: { ...loadBuildCatalog(), slots: engine.catalog.surfaces!.slots.map(slot => ({ ...slot, contract: slot.contract.kind === "frame" ? { ...slot.contract, stage: { accepts: ["flow"] as const, scroll: "region" as const } } : { ...slot.contract, substrates: ["flow"] as const, substrateTests: [{ substrate: "flow" as const, file: "SYNTHETIC.tsx", name: "SYNTHETIC declared support" }] } })) },
      ports: { manifest: { ...manifest, fills: manifest.fills.map(fill => fill.kind === "frame" ? { ...fill, stageModule: stage } : fill) },
        renderers: { [content.renderer.id]: () => createElement("article", null, "SYNTHETIC body"), [frame.renderer.id]: input => createElement("main", null, createElement("h1", null, input.pageHeader!.data.title), input.slots.main) },
        resolveContent: reference => { const value = reference.ref === "stage.label" ? "Flow workspace" : "Selected content"; return { reference, value, hash: runtimeHash(value) }; } },
      themes: ["light"], states: ["default"], css: [], assets: [],
      stage: { module: stage, bodyDigest: runtimeHash(body), label: { kind: "copy", ref: "stage.label" }, labels: { "sections.body.0": { kind: "copy", ref: "stage.section" } }, controller: stageRenderer, state: {} },
      stageMeasurements: { renderer: layoutRenderer, environment: { kind: "SYNTHETIC independent Stage fixture" }, cells: runtimeAssemblyCells(resolve(engine), ["light"], ["default"]).map(cell => ({ cell, width: cell.width - 80 })) },
    },
    instanceLibrary: { id: engine.library.source.id, role: "consumer", resolveFill: () => undefined, resolveContent: ref => ref }, registries, cell: { theme: "light", state: "default", width: 320 },
  };
  const result = await consumer.prepare(registry, route.routeId, runtime);
  expect(result.prepared.status, JSON.stringify(result.prepared)).toBe("ready");
  expect(result.unassociated.status).not.toBe("ready");
  expect(JSON.stringify(result.unassociated)).toMatch(/Layout/);
  expect(result.prepared.input.layout.descriptor.config).toBe("stack.focus");
  expect(result.selected.fill.library).toBe(engine.library.source.id);
  expect(libraryHash(runtime.assembly.engine.library)).toBe(libraryHash(engine.library));
  expect(runtime.instanceLibrary.resolveFill("layouts.stack", "stack.focus")).toBeUndefined();
}, 30000);
it("reads shipped Layout sources through the public Node export under react-server conditions", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", 'import { registeredFlowLayoutSource } from "@clossys/publisher/web/registered-route-check"; const value = await registeredFlowLayoutSource("layouts.stack"); if (value.source.entry !== "web/layouts/Stack.tsx") throw new Error("wrong source");'], { cwd: pathResolve(import.meta.dirname, "../.."), encoding: "utf8" });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
it("refuses tampered authored source, foreign consumer, wrong selected source/config, and missing states", async () => {
  const f = syntheticRegisteredRoute(compiled), binding = f.route.composition.binding as FlowInstanceBinding;
  const renderer = await registeredFlowLayoutSource(binding.layout.leaf);
  const source = { ...renderer.source, files: { ...renderer.source.files, [renderer.source.entry]: renderer.source.files[renderer.source.entry] + "\n// changed" } };
  const tampered = { ...renderer, source, sourceHash: runtimeHash(source) };
  expect(() => registeredFlowRuntimeInputs({ binding, engine: f.engine, layoutRenderer: tampered, states: ["default"] })).toThrow(/pins/);
  expect(() => registeredFlowRuntimeInputs({ binding: { ...binding, context: { ...binding.context, consumer: "SYNTHETIC-foreign" } }, engine: f.engine, layoutRenderer: renderer, states: ["default"] })).toThrow(/consumer/);
  const split = await registeredFlowLayoutSource("layouts.split");
  const reflow = { ...binding, layout: { leaf: "layouts.split" as const, config: "split.default" } };
  expect(renderer.source.entry).toBe("web/layouts/Stack.tsx");
  expect(() => registeredFlowRuntimeInputs({ binding: reflow, engine: f.engine, layoutRenderer: split, states: [] })).toThrow(/states/);
  expect(() => registeredFlowRuntimeInputs({ binding, engine: f.engine, layoutRenderer: split, states: ["default"] })).toThrow(/pins/);
  expect(() => registeredFlowRuntimeInputs({ binding: { ...binding, layout: { ...binding.layout, config: "SYNTHETIC-missing-config" } }, engine: f.engine, layoutRenderer: renderer, states: ["default"] })).toThrow(/Unknown layout config/);
});
