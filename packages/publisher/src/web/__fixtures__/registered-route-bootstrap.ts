import { libraryHash, loadBuildCatalog, resolve, runtimeHash } from "@clossys/designer/catalog";
import type { PlacementNode } from "@clossys/designer/catalog";
import { DESIGNER_LAYER_BOARDS_QUERY } from "@clossys/designer/studio/queries";
import type { DesignerLayerBoardsInput } from "@clossys/designer/studio/queries";
import { syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../../core/__fixtures__/registered-route.js";
import type { RouteRegistration, RouteRegistry } from "../../core/route-registry.js";
import type { RegisteredRouteRuntime } from "../registered-route-binding.js";
import type { CompiledRegisteredRoute } from "./registered-route-runtime.js";

const leaves = (node: PlacementNode): readonly string[] => "leaves" in node ? node.leaves : node.children.flatMap(leaves);
/** SYNTHETIC derived Designer route over the actual shipped token placements. The
 * query, provider descriptors and records exercise joins only; nothing here is a
 * captured provider, selected runtime or rendered qualification. */
export function syntheticDerivedRoute(compiled: CompiledRegisteredRoute) {
  const engine = compiled.input, profile = resolve(engine), catalog = loadBuildCatalog(), layer = "themes" as const;
  const base = syntheticRoute();
  const { layout: _layout, ...registered } = { ...base.composition.binding, context: { consumer: profile.consumer, medium: "web" as const }, body: { kind: "canvas" as const, source: { kind: "derived" as const, query: DESIGNER_LAYER_BOARDS_QUERY }, boards: [], arrangement: { kind: "grid" as const, columns: 1, gap: { x: 0, y: 0 } }, collapseBelow: "md" as const } };
  const route: RouteRegistration = { ...base, composition: { ...base.composition, binding: registered } };
  const registry: RouteRegistry = { version: 1, consumer: profile.consumer, routes: [route] };
  const placement = catalog.placements.find(value => value.layer === layer)!;
  const boards = placement.nodes.flatMap(domain => ("children" in domain ? domain.children : [domain]).map(group => ({ id: `${layer}/${group.id}`, label: group.label, leaves: leaves(group) })));
  // Catalog hashes are sha256 digests; the query input types them as such.
  const hash = libraryHash(engine.library) as `sha256:${string}`, selectionHash = profile.selectionHash as `sha256:${string}`;
  const projection = { phase: "ready" as const, layer, consumer: profile.consumer, libraryHash: hash, selectionHash, session: { id: "SYNTHETIC-original-session", revision: 1, status: "saved", edits: [], history: null }, activeLeaf: boards[0]?.leaves[0] ?? "", placements: [placement], slots: catalog.slots.filter(slot => slot.layer === layer).map(({ id, layer }) => ({ id, layer })), boards };
  const input: DesignerLayerBoardsInput = { query: DESIGNER_LAYER_BOARDS_QUERY, projection, projectionHash: runtimeHash(projection), arrangement: { kind: "lanes", groupKey: "domain", gap: { x: 12, y: 8 }, laneGap: 20 }, stateSections: {}, records: boards.map(board => ({ sessionId: projection.session.id, consumer: projection.consumer, libraryHash: hash, selectionHash, records: { columns: { version: 1, items: [] }, controls: { version: 1, mode: "view", canSave: false, pending: false }, rows: { version: 1, layer, boardId: board.id, label: board.label, items: board.leaves.map(id => ({ id, label: id, scope: "slot", selectedSource: null, candidates: [], prompt: { consumer: projection.consumer, board: { id: board.id, label: board.label }, slot: { id, label: id }, variants: [], tokens: [], siblings: [], returnStep: "SYNTHETIC" } })) } } })) };
  const descriptor = (entry: string) => { const source = { entry, files: { [entry]: "// SYNTHETIC source declaration only" }, dependencies: {} }; return { id: entry, source, sourceHash: runtimeHash(source) }; };
  const designerQuery = { input, implementation: descriptor("studio/designer-layer-boards.js"), provider: descriptor("studio/WholeStudioProvider.js") };
  const registries = { ...SYNTHETIC_ROUTE_REGISTRIES, sections: catalog.slots.filter(slot => slot.contract.kind === "section").map(slot => ({ id: slot.id as `sections.${string}`, status: "draft" as const, contract: slot.contract as never })) };
  const instanceLibrary = { id: profile.consumer, role: "consumer" as const, resolveFill: (leaf: string, config?: string) => ({ library: profile.consumer, leaf, config, headings: [], states: ["default"] }), resolveContent: (ref: never) => ref };
  /** Only the inputs the live gate reads before its Stage port; no Stage or renderer. */
  const runtime = (source?: RegisteredRouteRuntime["source"], query = designerQuery): RegisteredRouteRuntime => ({
    assembly: { engine, ports: {} } as unknown as RegisteredRouteRuntime["assembly"],
    instanceLibrary, registries, cell: {} as RegisteredRouteRuntime["cell"], designerQuery: query, ...(source ? { source } : {}),
  });
  const styling = { profile: runtimeHash(profile), manifest: runtimeHash("SYNTHETIC selected manifest"), css: { "app/SYNTHETIC.css": runtimeHash("SYNTHETIC css") as `sha256:${string}` } };
  return { engine, route, registry, designerQuery, registries, instanceLibrary, runtime, styling };
}
