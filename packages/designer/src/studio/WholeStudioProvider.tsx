"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { libraryHash, loadBuildCatalog } from "../catalog-core/index.js";
import type { CompositeChangeSet, CompositeEngineInput, CompositeLibraryData, LayerId } from "../catalog-core/index.js";
import { committedCompositeLibrary } from "../catalog-core/library-components.js";
import { runtimeHash, runtimeSnapshot } from "../catalog-core/runtime-ports.js";
import type { RuntimeDigest } from "../catalog-core/runtime-ports.js";
import { StudioProvider, useStudioSession } from "./StudioProvider.js";
import { normaliseWindowLocation, resolverFromPlacements } from "./layer-navigation.js";
import { evaluateWhole, placedLeaves, resolveWhole, wholeLibraryHash } from "./whole-model.js";
import type { CompositeStudioAdapter, CompositeStudioProps, CompositeStudioSnapshot, StudioAdapter, StudioCandidateWorkflow } from "./types.js";
import type { DesignerLayerBoardProjection } from "./designer-layer-boards.js";
import type { DesignerLayerBoardsInput } from "./designer-layer-boards.js";
import { prepareValueLibraryBoard, prepareCompositeLibraryBoard, type PreparedBoardPreviews } from "./prepared-library-boards.js";
import type { LibraryBoardRecords } from "../blocks/library-board/model.js";
const LAYERS: readonly LayerId[] = ["tokens", "assets", "components", "sections", "frames"];
const VALUE_LAYERS: ReadonlySet<LayerId> = new Set(["tokens", "assets"]);
/** The host adapter as the read-only Designer sees it: catalog, contracts and load. Its save is never reachable. */
export type CompositeStudioReadAdapter = Pick<CompositeStudioAdapter, "kind" | "catalog" | "contracts" | "load">;
/**
 * Read-only whole-library state: one host load, the committed snapshot and its evaluation. It holds no edit
 * session, so it exposes no edit, undo, redo, retry or flush, and never calls the host adapter's save.
 */
function useWholeState({ adapter: host, labels, initialSlotId }: CompositeStudioProps) {
  const adapter = useMemo<CompositeStudioReadAdapter>(() => ({ kind: host.kind, catalog: host.catalog, ...(host.contracts ? { contracts: host.contracts } : {}), load: () => host.load() }), [host]);
  const [snapshot, setSnapshot] = useState<CompositeStudioSnapshot>();
  const sessionIdentity = useMemo(() => globalThis.crypto.randomUUID(), [snapshot]);
  const [failed, setFailed] = useState(false);
  const contracts = useMemo(() => adapter.contracts ?? loadBuildCatalog(), [adapter.contracts]);
  // Every leaf the explorer lists: the value catalog's tokens and assets, the contracts' other layers.
  const resolver = useMemo(() => {
    const values = adapter.catalog.values.placements.filter(placement => VALUE_LAYERS.has(placement.layer));
    const { layerOf } = resolverFromPlacements([...values, ...contracts.placements.filter(placement => !VALUE_LAYERS.has(placement.layer))]);
    return { layers: LAYERS, layerOf };
  }, [adapter.catalog.values, contracts]);
  const isLeaf = (id: string | undefined): id is string => id !== undefined && (adapter.catalog.values.slots.some(slot => slot.id === id) || contracts.slots.some(slot => slot.id === id));
  // The host page owns one canonical URL (?layer=&node=): normalise it once, before the first paint.
  const [initial] = useState(() => { const location = normaliseWindowLocation(resolver); return { layer: location.layer, leaf: isLeaf(location.node) ? location.node : undefined }; });
  const [layer, setLayer] = useState<LayerId>(() => { if (initial.layer) return initial.layer; const id = initialSlotId?.split(".")[0] as LayerId; return LAYERS.includes(id) ? id : "tokens"; });
  const [leaf, setLeaf] = useState(initial.leaf ?? initialSlotId ?? "tokens.accent-color");
  const [selected, setSelected] = useState<string | undefined>(initial.leaf);
  const layerRef = useRef(layer); layerRef.current = layer;
  const [score, setScore] = useState(false);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  useEffect(() => {
    let active = true; setSnapshot(undefined); setFailed(false);
    adapter.load().then(value => { if (active) setSnapshot(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [adapter]);
  // The committed change set: no pending operation, only the host's bundles.
  const changes = useMemo<CompositeChangeSet | undefined>(() => snapshot ? { baseHash: libraryHash(snapshot.library), changes: [], ...(snapshot.bundles ? { bundles: snapshot.bundles } : {}), ...(snapshot.surfaceBundles ? { surfaceBundles: snapshot.surfaceBundles } : {}) } : undefined, [snapshot]);
  // With no pending operation the working library is the committed one: no change set is applied. Its closing
  // check is the evaluation's own resolution of the one engine input below, so the library resolves once.
  const workingResult = useMemo(() => {
    if (!snapshot || !changes) return undefined;
    const inputFor = (library: CompositeLibraryData): CompositeEngineInput => ({ catalog: adapter.catalog, library, componentOptions: snapshot.componentOptions, surfaceOptions: snapshot.surfaceOptions, fileExists: snapshot.fileExists });
    try {
      let checked: CompositeEngineInput | undefined;
      const library = committedCompositeLibrary(adapter.catalog, snapshot.library, snapshot.surfaceOptions ? { componentOptions: snapshot.componentOptions, surfaceOptions: snapshot.surfaceOptions } : undefined, result => resolveWhole(checked = inputFor(result)));
      return { library, input: checked ?? inputFor(library) };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [adapter.catalog, snapshot, changes]);
  const working = workingResult?.library;
  // One input per working library and snapshot, so prepared boards stay stable.
  const input = workingResult?.input;
  // Reference dependencies include host catalog, observations, runtime ports and preview identity.
  const evaluated = useMemo(() => {
    if (workingResult?.error) return { error: workingResult.error };
    if (!input || !snapshot) return undefined;
    try { return { value: evaluateWhole(input, snapshot, contracts) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [workingResult, working, adapter.catalog, snapshot, contracts]);
  // The internal value provider reads the shared committed snapshot; it has no save of its own.
  const projection = useMemo<StudioAdapter>(() => ({ catalog: adapter.catalog.values,
    load: async () => { const current = snapshotRef.current; if (!current) throw new TypeError("Designer snapshot not loaded"); return { library: { ...current.library.values, source: current.library.source, ...(current.library.adoptedAt ? { adoptedAt: current.library.adoptedAt } : {}) } }; },
  }), [adapter, adapter.catalog.values]);
  // Display state must not manufacture a new engine input. Reproject whenever the committed library changes.
  const valueLibrary = useMemo(() => snapshot ? {
    ...snapshot.library.values, source: snapshot.library.source,
    ...(snapshot.library.adoptedAt ? { adoptedAt: snapshot.library.adoptedAt } : {}),
  } : undefined, [snapshot?.library]);
  const values = useMemo(() => valueLibrary ? { committed: valueLibrary } : undefined, [valueLibrary]);
  // A layer change clears the selection in the same update, so a navigation can then select on the new layer.
  const setActiveLayer = async (next: LayerId): Promise<boolean> => {
    if (next !== layerRef.current) setSelected(undefined);
    setLayer(next); setLeaf(current => contracts.slots.some(slot => slot.id === current && slot.layer === next) ? current : contracts.slots.find(slot => slot.layer === next)?.id ?? "");
    return true;
  };
  /** The selected L3 leaf (the Inspector card fills), or none. Selecting also makes it the inspected leaf. */
  const select = useCallback((next: string | undefined): void => { setSelected(next); if (next !== undefined) setLeaf(next); }, []);
  const latest = useRef({ setActiveLayer, select }); latest.current = { setActiveLayer, select };
  useEffect(() => {
    const changed = (): void => {
      const location = normaliseWindowLocation(resolver);
      if (location.layer) void latest.current.setActiveLayer(location.layer);
      if (isLeaf(location.node)) latest.current.select(location.node);
    };
    window.addEventListener("hashchange", changed); return () => window.removeEventListener("hashchange", changed);
  }, [resolver]);
  return { adapter, labels, sessionIdentity, snapshot, contracts, failed, changes, layer, setLayer: setActiveLayer, leaf, setLeaf, selected, select, score, setScore, input, evaluated, projection, values };
}
export type WholeStudioState = ReturnType<typeof useWholeState>;
const WholeContext = createContext<WholeStudioState | null>(null);
export const useWholeStudio = (): WholeStudioState | null => useContext(WholeContext);
/** State only: children and the one shared value projection remain mounted through loading/error. */
export function WholeStudioProvider({ children, ...props }: CompositeStudioProps & { children: ReactNode }) {
  const state = useWholeState(props);
  return <WholeContext.Provider value={state}><StudioProvider layerState={{ layer: state.layer, setLayer: state.setLayer, phase: state.failed ? "error" : "loading", selected: state.selected, select: state.select }} values={state.values} adapter={state.projection} labels={props.labels} initialSlotId={state.selected ?? props.initialSlotId}>{children}</StudioProvider></WholeContext.Provider>;
}
/** Finite facts from the original shared session. Preview functions, actions and candidate engines stay outside. */
export function useDesignerLayerBoardProjection(): { readonly projection: DesignerLayerBoardProjection; readonly projectionHash: RuntimeDigest } {
  const state = useWholeStudio();
  const values = useStudioSession();
  // Hash the working library once per engine input, not on every render of a projection reader; its kept
  // resolution already carries that hash, so a resolved input is not hashed again.
  const engineInput = state?.input;
  const workingHash = useMemo(() => engineInput ? wholeLibraryHash(engineInput) as RuntimeDigest : null, [engineInput]);
  if (!state) throw new TypeError('Original WholeStudioProvider required');
  const valueLayer = state.layer === 'tokens' || state.layer === 'assets';
  const placements = (valueLayer ? values.activeCatalog.placements : state.contracts.placements).filter(placement => placement.layer === state.layer);
  const slots = (valueLayer ? values.activeCatalog.slots : state.contracts.slots).filter(slot => slot.layer === state.layer).map(({ id, layer }) => ({ id, layer }));
  const boards = valueLayer ? values.boards.map(({ id, label, leaves }) => ({ id, label, leaves })) : placements.flatMap(placement => placement.nodes.flatMap(domain => ('children' in domain ? domain.children : [domain]).map(group => ({ id: `${placement.layer}/${group.id}`, label: group.label, leaves: placedLeaves([group]).map(leaf => leaf.id) }))));
  const profile = state.evaluated?.value?.profile;
  const projection: DesignerLayerBoardProjection = runtimeSnapshot({
    phase: state.failed || state.evaluated?.error ? 'error' : state.input && profile ? 'ready' : 'loading',
    layer: state.layer, consumer: state.input?.library.source.id ?? null,
    libraryHash: state.input ? workingHash : null,
    selectionHash: profile ? profile.selectionHash as RuntimeDigest : null,
    // The read-only Designer holds no edit: the session is the committed load, with no edits and no history.
    session: { id: state.sessionIdentity, revision: 0, status: state.snapshot ? 'saved' : 'loading', edits: [], history: null },
    activeLeaf: valueLayer ? values.focusedRow?.id ?? state.leaf : state.leaf, placements, slots, boards,
  });
  return { projection, projectionHash: runtimeHash(projection) };
}

export interface DesignerPreparedLibraryBoardOptions {
  readonly workflow?: StudioCandidateWorkflow;
  /** Original controller state and source-owner association; no persistence or hash defaults are inferred. */
  readonly board: (id: string) => { readonly mode: 'view' | 'edit'; readonly canSave: boolean; readonly pending: boolean; readonly sourceHashes?: Readonly<Record<string, string>> } | undefined;
}
export type DesignerPreparedLibraryBoards = {
  readonly projection: DesignerLayerBoardProjection;
  readonly projectionHash: RuntimeDigest;
} & ({ readonly status: 'pending'; readonly code: 'DESIGNER_PROVIDER_UNAVAILABLE' | 'BOARD_CONTROLS_UNAVAILABLE'; readonly boards: readonly string[] }
  | { readonly status: 'prepared'; readonly records: DesignerLayerBoardsInput['records']; readonly boards: readonly { readonly records: LibraryBoardRecords; readonly previews: PreparedBoardPreviews }[] });
/** Mounted read-only accessor over the original provider, engine rows and prompt context.
 * Live preview ports stay separate from finite query records; neither is runtime qualification.
 */
export function useDesignerPreparedLibraryBoards(options: DesignerPreparedLibraryBoardOptions): DesignerPreparedLibraryBoards {
  const state = useWholeStudio();
  const values = useStudioSession();
  const projected = useDesignerLayerBoardProjection();
  if (!state) throw new TypeError('Original WholeStudioProvider required');
  const { projection } = projected;
  return useMemo<DesignerPreparedLibraryBoards>(() => {
  if (projection.phase !== 'ready' || !projection.consumer || !projection.libraryHash || !projection.selectionHash || !state.input || !state.snapshot || !state.changes || !state.evaluated?.value?.profile)
    return { ...projected, status: 'pending', code: 'DESIGNER_PROVIDER_UNAVAILABLE', boards: [] };
  const controls = new Map(projection.boards.map(board => [board.id, options.board(board.id)]));
  const missing = projection.boards.filter(board => !controls.get(board.id)).map(board => board.id);
  if (missing.length) return { ...projected, status: 'pending', code: 'BOARD_CONTROLS_UNAVAILABLE', boards: missing };
  const profile = state.evaluated.value.profile;
  const boards = projection.boards.map(board => {
    const control = controls.get(board.id)!;
    if (state.layer === 'tokens' || state.layer === 'assets') {
      const original = values.boards.find(value => value.id === board.id);
      if (!original || !values.working) throw new TypeError('Original Designer value board unavailable');
      return prepareValueLibraryBoard({ ...control, layer: state.layer, board: original, sources: values.catalog.sources, consumerSource: projection.consumer!, selectionHash: projection.selectionHash!, labels: state.labels, workflow: options.workflow,
        variants: Object.fromEntries(values.activeCatalog.slots.filter(slot => slot.contract.members.mode === 'closed').map(slot => [slot.id, slot.contract.members.mode === 'closed' ? slot.contract.members.names.map(name => `${slot.id}.${name}`) : []])),
        contextTokens: Object.entries(values.resolved?.members ?? {}).filter(([, member]) => member.slot.startsWith('tokens.')).map(([id, member]) => ({ id, value: member.css.light })) });
    }
    return prepareCompositeLibraryBoard({ ...control, layer: state.layer, board: { ...board, leaves: board.leaves.map(id => ({ id })) }, input: state.input!, snapshot: state.snapshot!, changes: state.changes!, contracts: state.contracts, profile, sources: values.catalog.sources, labels: state.labels, workflow: options.workflow });
  });
  return { ...projected, status: 'prepared', boards, records: boards.map(board => ({ sessionId: projection.session.id, consumer: projection.consumer!, libraryHash: projection.libraryHash!, selectionHash: projection.selectionHash!, records: board.records })) };
  }, [projected.projectionHash, state.input?.library, state.input?.catalog, state.input?.componentOptions, state.input?.surfaceOptions, state.input?.fileExists, state.snapshot, state.changes, state.evaluated, state.contracts, state.layer, state.labels, values.boards, values.working, values.catalog, values.activeCatalog, values.resolved, options.board, options.workflow]);
}
