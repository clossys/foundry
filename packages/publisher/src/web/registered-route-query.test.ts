/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { libraryHash, loadBuildCatalog, resolve, runtimeHash } from "@clossys/designer/catalog";
import type { LayerId, PlacementNode } from "@clossys/designer/catalog";
import { DESIGNER_LAYER_BOARDS_QUERY } from "@clossys/designer/studio/queries";
import type { DesignerLayerBoardsInput } from "@clossys/designer/studio/queries";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileRegisteredRouteFixture, type CompiledRegisteredRoute } from "./__fixtures__/registered-route-runtime.js";
let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => { temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-materializer-"))); compiled = await compileRegisteredRouteFixture(temporary); }, 30000);
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
import { syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import { currentRouteRuntimeMaterialization, deriveRouteRuntimeBinding } from "../core/route-runtime.js";
import { isCurrentRegisteredRouteSourceEvidence, recordRegisteredRouteSourceEvidence } from "../core/route-source-evidence.js";
import { materializeRegisteredDesignerRoute } from "./registered-route-query.js";
import { registeredDesignerQuerySources } from "./registered-route-query-source.js";

const leaves = (node: PlacementNode): readonly string[] => "leaves" in node ? node.leaves : node.children.flatMap(leaves);
/** Actual shipped placement inventory; synthetic unavailable records and source
 * descriptors exercise joins only, never selected runtime qualification. */
function fixture(layer: LayerId = "tokens") {
  const engine = compiled.input, profile = resolve(engine), catalog = loadBuildCatalog();
  const route = syntheticRoute(), registered = { ...route.composition.binding, context: { consumer: profile.consumer, medium: "web" as const }, body: { kind: "canvas" as const, source: { kind: "derived" as const, query: DESIGNER_LAYER_BOARDS_QUERY }, boards: [], arrangement: { kind: "grid" as const, columns: 1, gap: { x: 0, y: 0 } }, collapseBelow: "tokens.breakpoint.tablet" as const } };
  const { layout: _layout, ...binding } = registered;
  const placement = catalog.placements.find(value => value.layer === layer)!;
  const boards = placement.nodes.flatMap(domain => ("children" in domain ? domain.children : [domain]).map(group => ({ id: `${layer}/${group.id}`, label: group.label, leaves: leaves(group) })));
  const hash = libraryHash(engine.library), selectionHash = profile.selectionHash;
  const projection = { phase: "ready" as const, layer, consumer: profile.consumer, libraryHash: hash, selectionHash, session: { id: "SYNTHETIC-original-session", revision: 1, status: "saved", edits: [], history: null }, activeLeaf: boards[0]?.leaves[0] ?? "", placements: [placement], slots: catalog.slots.filter(slot => slot.layer === layer).map(({ id, layer }) => ({ id, layer })), boards };
  const input: DesignerLayerBoardsInput = { query: DESIGNER_LAYER_BOARDS_QUERY, projection, projectionHash: runtimeHash(projection), arrangement: { kind: "lanes", groupKey: "domain", gap: { x: 12, y: 8 }, laneGap: 20 }, stateSections: {}, records: boards.map(board => ({ sessionId: projection.session.id, consumer: projection.consumer, libraryHash: hash, selectionHash, records: { columns: { version: 1, items: [] }, controls: { version: 1, mode: "view", canSave: false, pending: false }, rows: { version: 1, layer, boardId: board.id, label: board.label, items: board.leaves.map(id => ({ id, label: id, scope: "slot", selectedSource: null, candidates: [], prompt: { consumer: projection.consumer, board: { id: board.id, label: board.label }, slot: { id, label: id }, variants: [], tokens: [], siblings: [], returnStep: "SYNTHETIC" } })) } } })) };
  const descriptor = (entry: string) => { const source = { entry, files: { [entry]: "// SYNTHETIC source declaration only" }, dependencies: {} }; return { id: entry, source, sourceHash: runtimeHash(source) }; };
  const query = { input, implementation: descriptor("studio/designer-layer-boards.js"), provider: descriptor("studio/WholeStudioProvider.js") };
  const registries = { ...SYNTHETIC_ROUTE_REGISTRIES, sections: catalog.slots.filter(slot => slot.contract.kind === "section").map(slot => ({ id: slot.id as `sections.${string}`, status: "draft" as const, contract: slot.contract as never })) };
  const library = { id: profile.consumer, role: "consumer" as const, resolveFill: (leaf: string, config?: string) => ({ library: profile.consumer, leaf, config, headings: [], states: ["default"] }), resolveContent: (ref: never) => ref };
  const run = (value = query) => materializeRegisteredDesignerRoute(binding, engine, registries, library, value);
  return { engine, binding, query, run, registries, library, route };
}
function ready(result: ReturnType<ReturnType<typeof fixture>["run"]>) {
  expect(result.status, JSON.stringify(result)).toBe("materialized");
  if (result.status !== "materialized") throw new Error(result.findings.join("; "));
  return result;
}
describe("one stateless fixed Designer materializer", () => {
  it.each(["tokens", "assets", "components", "sections", "frames"] as const)("executes the fixed query for actual %s placements and binds actual Stage labels", layer => {
    const f = fixture(layer), before = runtimeHash(f.binding), result = ready(f.run());
    expect(result.materialization.binding.layout).toBeUndefined();
    const body = result.materialization.binding.body!;
    expect(body.kind === "canvas" && body.boards.map(board => board.id)).toEqual(f.query.input.projection.boards.map(board => board.id));
    expect(Object.keys(result.labels)).toHaveLength(f.query.input.projection.boards.length);
    expect(result.contents.filter(content => content.reference.kind === "copy").map(content => content.value)).toEqual(f.query.input.projection.boards.map(board => board.label));
    expect(runtimeHash(f.binding)).toBe(before);
    expect(currentRouteRuntimeMaterialization(result.materialization, f.binding, f.engine)).toBe(true);
    expect(currentRouteRuntimeMaterialization(structuredClone(result.materialization), f.binding, f.engine)).toBe(false);
  });
  it("reexecutes after input/Edit changes without a second retained result and invalidates stale source receipts", () => {
    const f = fixture(), first = ready(f.run());
    const projection = { ...f.query.input.projection, session: { ...f.query.input.projection.session, revision: 2, edits: [{ operationsHash: runtimeHash("actual edit") }] } };
    const changed = { ...f.query, input: { ...f.query.input, projection, projectionHash: runtimeHash(projection), arrangement: { kind: "grid" as const, columns: 2, gap: { x: 12, y: 8 } } } };
    const next = ready(f.run(changed));
    expect(next.materialization.digest).not.toBe(first.materialization.digest);
    expect(ready(f.run()).materialization).toEqual(first.materialization);
    const route = { ...f.route, composition: { ...f.route.composition, binding: f.binding } }, registry = { version: 1 as const, consumer: f.engine.library.source.id, routes: [route] };
    const source = recordRegisteredRouteSourceEvidence(registry, route, { kind: "git", head: "1".repeat(40), tree: "2".repeat(40) }, {}, undefined, undefined, first.materialization.digest);
    expect(isCurrentRegisteredRouteSourceEvidence(source, registry, route, first.materialization.digest)).toBe(true);
    expect(isCurrentRegisteredRouteSourceEvidence(source, registry, route, next.materialization.digest)).toBe(false);
    expect(isCurrentRegisteredRouteSourceEvidence(source, registry, route)).toBe(false);
  });
  it("seals source, phase, placement labels, Layout and state content into the same current receipt", () => {
    const f = fixture(), first = ready(f.run());
    const route = { ...f.route, composition: { ...f.route.composition, binding: f.binding } }, registry = { version: 1 as const, consumer: f.engine.library.source.id, routes: [route] };
    const source = recordRegisteredRouteSourceEvidence(registry, route, { kind: "git", head: "1".repeat(40), tree: "2".repeat(40) }, {}, undefined, undefined, first.materialization.digest);
    const changedSource = (key: "implementation" | "provider") => { const descriptor = f.query[key], file = descriptor.source.entry, source = { ...descriptor.source, files: { ...descriptor.source.files, [file]: descriptor.source.files[file] + "\n// changed current bytes" } }; return { ...f.query, [key]: { ...descriptor, source, sourceHash: runtimeHash(source) } }; };
    for (const key of ["implementation", "provider"] as const) {
      const changed = ready(f.run(changedSource(key)));
      expect(isCurrentRegisteredRouteSourceEvidence(source, registry, route, changed.materialization.digest)).toBe(false);
    }
    const projection = { ...f.query.input.projection, phase: "error" as const }, ref = { kind: "copy" as const, ref: "SYNTHETIC.actual-error" };
    const state = { sessionId: projection.session.id, fill: { section: "sections.error-state" as const, content: { code: ref } }, content: [{ reference: ref, value: "Actual failure", hash: runtimeHash("Actual failure") }], layout: { leaf: "layouts.stack" as const, config: "stack.workspace", slot: "body" } };
    const query = { ...f.query, input: { ...f.query.input, projection, projectionHash: runtimeHash(projection), records: [], stateSections: { error: state } } };
    const flow = ready(f.run(query));
    expect(flow.materialization.binding.body!.kind).toBe("flow");
    expect(isCurrentRegisteredRouteSourceEvidence(source, registry, route, flow.materialization.digest)).toBe(false);
    for (const changedState of [{ ...state, layout: { ...state.layout, config: "stack.focus" } }, { ...state, content: [{ reference: ref, value: "Current changed failure", hash: runtimeHash("Current changed failure") }] }]) {
      expect(ready(f.run({ ...query, input: { ...query.input, stateSections: { error: changedState } } })).materialization.digest).not.toBe(flow.materialization.digest);
    }
    expect(ready(f.run()).materialization.digest).toBe(first.materialization.digest);
    expect(first.materialization.binding.body!.kind).toBe("canvas");
  });
  it("rejects caller results/executors, foreign selections and stale query/provider identity", () => {
    const f = fixture();
    for (const extra of [{ result: ready(f.run()) }, { execute: () => ({}) }, { body: f.binding.body }]) expect(f.run({ ...f.query, ...extra } as never).status).toBe("refused");
    const projection = { ...f.query.input.projection, libraryHash: runtimeHash("foreign library") };
    expect(f.run({ ...f.query, input: { ...f.query.input, projection, projectionHash: runtimeHash(projection), records: f.query.input.records.map(record => ({ ...record, libraryHash: projection.libraryHash })) } }).status).toBe("refused");
    expect(f.run({ ...f.query, implementation: { ...f.query.implementation, sourceHash: runtimeHash("stale source") } }).status).toBe("refused");
    expect(f.run({ ...f.query, provider: { ...f.query.provider, sourceHash: runtimeHash("stale provider") } }).status).toBe("refused");
    expect(f.run({ ...f.query, input: { ...f.query.input, query: { id: "host-query", version: 1 } } }).status).toBe("refused");
    const result = ready(f.run());
    expect(deriveRouteRuntimeBinding(f.binding, f.engine, {} as never, structuredClone(result.materialization)).status).toBe("refused");
  });
  it.each(["loading", "error", "empty"] as const)("materializes %s as selected state Flow, never a sample canvas or dummy Layout", phase => {
    const f = fixture(), projection = { ...f.query.input.projection, phase: phase === "empty" ? "ready" as const : phase, ...(phase === "empty" ? { placements: [], slots: [], boards: [] } : {}) };
    const ref = { kind: phase === "loading" ? "records" as const : phase === "error" ? "copy" as const : "action" as const, ref: `SYNTHETIC.${phase}` }, value = phase === "loading" ? [{ id: "loading", tone: "info", message: "Actual loading state" }] : phase === "error" ? "Actual registered error" : { command: "return" };
    const section = phase === "loading" ? "sections.notices" as const : phase === "error" ? "sections.error-state" as const : "sections.empty-state" as const;
    const state = { sessionId: projection.session.id, fill: { section, content: { [phase === "loading" ? "notices" : phase === "error" ? "code" : "actions"]: ref } }, content: [{ reference: ref, value, hash: runtimeHash(value) }], layout: { leaf: "layouts.stack" as const, config: "stack.workspace", slot: "body" } };
    const query = { ...f.query, input: { ...f.query.input, projection, projectionHash: runtimeHash(projection), records: [], stateSections: { [phase]: state } } };
    const result = ready(f.run(query));
    expect(result.materialization.binding.body!.kind).toBe("flow");
    expect(result.materialization.binding.layout).toEqual({ leaf: "layouts.stack", config: "stack.workspace" });
    expect(result.materialization.binding.fills.body?.[0]?.section).toBe(section);
    expect(f.run({ ...query, input: { ...query.input, stateSections: { [phase]: { ...state, layout: undefined } } } }).status).toBe("pending");
    expect(materializeRegisteredDesignerRoute(f.binding, f.engine, f.registries, { ...f.library, resolveFill: () => undefined }, query).status).toBe("pending");
    expect(f.run({ ...query, input: { ...query.input, stateSections: { [phase]: { ...state, sessionId: "foreign-original-session" } } } }).status).toBe("refused");
    expect(f.run({ ...query, input: { ...query.input, stateSections: { [phase]: { ...state, layout: { ...state.layout, slot: "unknown" } } } } }).status).toBe("pending");
  });
  it("reads the actual fixed Node query and original provider graphs, never a caller source map", async () => {
    const sources = await registeredDesignerQuerySources();
    expect(sources.implementation.source.entry).toBe("studio/designer-layer-boards.js");
    expect(Object.keys(sources.implementation.source.files)).toHaveLength(6);
    expect(Object.keys(sources.implementation.source.files).some(file => /WholeStudio|react/.test(file))).toBe(false);
    expect(sources.provider.source.files["studio/WholeStudioProvider.js"]).toContain("useDesignerLayerBoardProjection");
    expect(sources.implementation.sourceHash).toBe(runtimeHash(sources.implementation.source));
  });
});
