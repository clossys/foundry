/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { libraryHash, loadBuildCatalog, runtimeHash, type PlacementNode } from "@clossys/designer/catalog";
import { WholeStudioProvider, useWholeStudio, useStudioSession, useDesignerLayerBoardProjection, valueLibraryBoardRecords, valueLibraryBoardPreviews } from "@clossys/designer/studio";
import { DESIGNER_LAYER_BOARDS_QUERY } from "@clossys/designer/studio/queries";
import { labels } from "../../../designer/dist/studio/__fixtures__/studio.js";
import { compileRegisteredRouteFixture, type CompiledRegisteredRoute } from "./__fixtures__/registered-route-runtime.js";
import { syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import { materializeRegisteredDesignerRoute } from "./registered-route-query.js";
let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => { temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-provider-join-"))); compiled = await compileRegisteredRouteFixture(temporary); }, 30000);
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("materializes original provider checked records from the read-only committed state, with no edit session or save", async () => {
  const save = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));
  // The compiled surface fixture bounds value slots; give the real provider the
  // matching catalog slice, rather than full-catalog placements with missing slots.
  const selected = new Set(compiled.input.catalog.values.slots.map(slot => slot.id));
  const prune = (node: PlacementNode): PlacementNode[] => {
    if ("children" in node) { const children = node.children.flatMap(prune); return children.length ? [{ ...node, children }] : []; }
    const leaves = node.leaves.filter(id => selected.has(id)); return leaves.length ? [{ ...node, leaves }] : [];
  };
  const values = { ...compiled.input.catalog.values, placements: compiled.input.catalog.values.placements.map(placement => ({ ...placement, nodes: placement.nodes.flatMap(prune) })).filter(placement => placement.nodes.length) };
  const engine = { ...compiled.input, catalog: { ...compiled.input.catalog, values } }, adapter = { kind: "composite" as const, catalog: engine.catalog, load: async () => ({ library: engine.library, componentOptions: engine.componentOptions, surfaceOptions: engine.surfaceOptions }), save };
  let current!: { whole: NonNullable<ReturnType<typeof useWholeStudio>>; values: ReturnType<typeof useStudioSession>; projected: ReturnType<typeof useDesignerLayerBoardProjection> };
  function Probe() { current = { whole: useWholeStudio()!, values: useStudioSession(), projected: useDesignerLayerBoardProjection() }; return <output>{current.projected.projection.phase}</output>; }
  const wholeLabels = { ...labels, whole: { signoff: "Signoff", proposed: "Proposed", contract: "Contract", contentSlots: "Slots", configurations: "Configurations", unresolved: "Unresolved", unassessed: "Unassessed" } };
  render(<WholeStudioProvider adapter={adapter} labels={wholeLabels} initialSlotId="assets.icon-close"><Probe /></WholeStudioProvider>);
  await screen.findByText("ready");
  act(() => current.values.requestRow("assets.icon-close"));
  const prepared = current.values.boards.map(board => {
    const { projection } = current.projected;
    const input = { layer: "assets" as const, board, sources: current.values.catalog.sources, consumerSource: projection.consumer!, selectionHash: projection.selectionHash!, sourceHashes: Object.fromEntries(board.rows.flatMap(row => row.candidates.map(candidate => [candidate.source, runtimeHash(candidate.fill)]))), mode: "edit" as const, canSave: true, pending: false,
      prompt: (row: typeof board.rows[number]) => ({ consumer: projection.consumer!, board: { id: board.id, label: board.label }, slot: { id: row.id, label: row.id }, variants: [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
    return { records: valueLibraryBoardRecords(input), previews: valueLibraryBoardPreviews(input, labels) };
  });
  const { projection, projectionHash } = current.projected;
  const projectedLeaves = (node: PlacementNode): readonly string[] => "leaves" in node ? node.leaves : node.children.flatMap(projectedLeaves);
  expect(projection.placements.flatMap(placement => placement.nodes.flatMap(projectedLeaves)).sort()).toEqual(projection.slots.map(slot => slot.id).sort());
  expect(current.values.activeCatalog.slots.every(slot => selected.has(slot.id))).toBe(true);
  const input = { query: DESIGNER_LAYER_BOARDS_QUERY, projection, projectionHash, records: prepared.map(value => ({ sessionId: projection.session.id, consumer: projection.consumer!, libraryHash: projection.libraryHash!, selectionHash: projection.selectionHash!, records: value.records })), arrangement: { kind: "lanes" as const, groupKey: "domain", gap: { x: 12, y: 8 }, laneGap: 20 }, stateSections: {} };
  const descriptor = (entry: string) => { const source = { entry, files: { [entry]: "// SYNTHETIC declared source; no runtime/source clearance" }, dependencies: {} }; return { id: entry, source, sourceHash: runtimeHash(source) }; };
  const query = { input, implementation: descriptor("studio/designer-layer-boards.js"), provider: descriptor("studio/WholeStudioProvider.js") };
  const { layout: _layout, ...base } = syntheticRoute().composition.binding;
  const binding = { ...base, context: { consumer: projection.consumer!, medium: "web" as const }, body: { kind: "canvas" as const, source: { kind: "derived" as const, query: DESIGNER_LAYER_BOARDS_QUERY }, boards: [], arrangement: input.arrangement, collapseBelow: "tokens.breakpoint.tablet" as const } };
  const catalog = loadBuildCatalog(), registries = { ...SYNTHETIC_ROUTE_REGISTRIES, sections: catalog.slots.filter(slot => slot.contract.kind === "section").map(slot => ({ id: slot.id as `sections.${string}`, status: "draft" as const, contract: slot.contract as never })) };
  const library = { id: projection.consumer!, role: "consumer" as const, resolveFill: () => undefined, resolveContent: (ref: never) => ref };
  const result = materializeRegisteredDesignerRoute(binding, current.whole.input!, registries, library, query);
  expect(result.status, JSON.stringify(result)).toBe("materialized");
  if (result.status !== "materialized") return;
  expect(result.materialization.binding.body!.kind === "canvas" && result.materialization.binding.body!.boards.map(board => board.id)).toEqual(projection.boards.map(board => board.id));
  expect(result.contents.filter(content => content.reference.ref.endsWith("/rows")).map(content => content.value)).toEqual(prepared.map(value => value.records.rows));
  const owner = prepared.find(value => value.records.rows.items.some(row => row.candidates.some(candidate => candidate.usable && candidate.previewIdentity)));
  expect(owner).toBeDefined();
  const identity = owner!.records.rows.items.flatMap(row => row.candidates).find(candidate => candidate.usable && candidate.previewIdentity)!.previewIdentity!;
  expect(owner!.previews.render(identity)).toBeDefined();
  expect(owner!.previews.render({ ...identity, selectionHash: runtimeHash("stale") })).toBeUndefined();
  expect(result.materialization.binding.fills["sections.comparison"]).toHaveLength(projection.boards.length);
  expect(document.querySelector("[data-studio-canvas]")).toBeNull();
  // The read-only Designer holds no edit session: no edit, nothing blocks a layer move, the committed identity stays put.
  const before = projection.session, sessionIdentity = current.whole.sessionIdentity;
  expect("session" in current.whole).toBe(false); expect("edit" in current.whole).toBe(false);
  let moved: boolean | undefined;
  await act(async () => { moved = await current.whole.setLayer("components"); });
  expect(moved).toBe(true); expect(current.whole.layer).toBe("components"); expect(current.whole.sessionIdentity).toBe(sessionIdentity);
  expect(current.projected.projection.session).toMatchObject({ id: before.id, revision: before.revision, edits: [], history: null });
  expect(libraryHash(current.whole.input!.library)).toBe(current.projected.projection.libraryHash);
  expect(save).not.toHaveBeenCalled();
});
