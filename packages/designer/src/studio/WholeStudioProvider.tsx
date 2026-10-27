"use client";
import { createContext, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { applyLibraryChange, libraryHash, loadBuildCatalog } from "../catalog-core/index.js";
import type { CompositeChangeSet, CompositeEngineInput, CompositeLibraryOperation, LayerId } from "../catalog-core/index.js";
import { runtimeHash, runtimeSnapshot } from "../catalog-core/runtime-ports.js";
import type { RuntimeDigest } from "../catalog-core/runtime-ports.js";
import { StudioProvider, useStudioSession, type StudioValueEditPort } from "./StudioProvider.js";
import { initialStudioLayer, studioLayerFromFragment } from "./layer-navigation.js";
import { EditSession, type EditSessionState } from "./edit-session.js";
import { useEditSession } from "./useEditSession.js";
import { compositeHistoryChanges } from "./history.js";
import { evaluateWhole, placedLeaves } from "./whole-model.js";
import type { CompositeStudioProps, CompositeStudioSnapshot, StudioAdapter, StudioCandidateWorkflow } from "./types.js";
import type { DesignerLayerBoardProjection } from "./designer-layer-boards.js";
import type { DesignerLayerBoardsInput } from "./designer-layer-boards.js";
import { prepareValueLibraryBoard, prepareCompositeLibraryBoard, type PreparedBoardPreviews } from "./prepared-library-boards.js";
import type { LibraryBoardRecords } from "../blocks/library-board/model.js";
const LAYERS: readonly LayerId[] = ["tokens", "assets", "components", "sections", "frames"];
function useWholeState({ adapter, labels, initialSlotId, sessionRef }: CompositeStudioProps) {
  const [session, setSession] = useState<EditSession<CompositeStudioSnapshot, CompositeLibraryOperation, CompositeChangeSet>>();
  const sessionState = useEditSession(session);
  const sessionIdentity = useMemo(() => globalThis.crypto.randomUUID(), [session]);
  const snapshot = sessionState?.committed;
  const [failed, setFailed] = useState(false);
  const [layer, setLayer] = useState<LayerId>(() => { const fragment = initialStudioLayer(); if (fragment) return fragment; const id = initialSlotId?.split(".")[0] as LayerId; return LAYERS.includes(id) ? id : "tokens"; });
  const [leaf, setLeaf] = useState(initialSlotId ?? "tokens.accent-color");
  const [score, setScore] = useState(false);
  const contracts = useMemo(() => adapter.contracts ?? loadBuildCatalog(), [adapter.contracts]);
  const sessionRefState = useRef(session); sessionRefState.current = session;
  useImperativeHandle(sessionRef, () => ({ flush: () => sessionRefState.current?.flush() ?? Promise.resolve(true) }), []);
  useEffect(() => {
    let active = true; setSession(undefined); setFailed(false);
    adapter.load().then(value => { if (active) setSession(new EditSession(value, {
      copy: snapshot => ({ ...snapshot, library: structuredClone(snapshot.library) }),
      hash: snapshot => libraryHash(snapshot.library),
      changes: (snapshot, operations) => ({ baseHash: libraryHash(snapshot.library), changes: operations, ...(snapshot.bundles ? { bundles: snapshot.bundles } : {}), ...(snapshot.surfaceBundles ? { surfaceBundles: snapshot.surfaceBundles } : {}) }),
      save: async changes => { const result = await adapter.save(changes); return result.ok ? { ok: true, committed: { ...sessionRefState.current!.getSnapshot().committed, library: result.library } } : result; },
      restore: (current, target, leaf, expected) => compositeHistoryChanges(adapter.catalog, current, target, leaf, expected),
      load: () => adapter.load(),
    })); }, () => { if (active) setFailed(true); });
    return () => { active = false; void sessionRefState.current?.flush(); };
  }, [adapter]);
  const changes = useMemo<CompositeChangeSet | undefined>(() => snapshot ? { baseHash: libraryHash(snapshot.library), changes: sessionState?.edits.flatMap(edit => edit.operations) ?? [], ...(snapshot.bundles ? { bundles: snapshot.bundles } : {}), ...(snapshot.surfaceBundles ? { surfaceBundles: snapshot.surfaceBundles } : {}) } : undefined, [snapshot, sessionState?.edits]);
  const workingResult = useMemo(() => {
    if (!snapshot || !changes) return undefined;
    const operations = changes.changes;
    try { return { library: applyLibraryChange(adapter.catalog, snapshot.library, { ...changes, changes: operations }, snapshot.surfaceOptions ? { componentOptions: snapshot.componentOptions, surfaceOptions: snapshot.surfaceOptions } : undefined) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [adapter.catalog, snapshot, changes]);
  const working = workingResult?.library;
  // One input per working library and snapshot: a session notification that changes neither keeps it, so prepared boards stay stable.
  const input = useMemo<CompositeEngineInput | undefined>(() => working && snapshot ? { catalog: adapter.catalog, library: working, componentOptions: snapshot.componentOptions, surfaceOptions: snapshot.surfaceOptions, fileExists: snapshot.fileExists } : undefined, [adapter.catalog, working, snapshot]);
  // Reference dependencies include host catalog, observations, runtime ports and preview identity.
  const evaluated = useMemo(() => {
    if (workingResult?.error) return { error: workingResult.error };
    if (!input || !snapshot) return undefined;
    try { return { value: evaluateWhole(input, snapshot, contracts) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [workingResult, working, adapter.catalog, snapshot, contracts]);
  const projection = useMemo<StudioAdapter>(() => ({ catalog: adapter.catalog.values,
    load: async () => { const current = sessionRefState.current!.getSnapshot().committed; return { library: { ...current.library.values, source: current.library.source, ...(current.library.adoptedAt ? { adoptedAt: current.library.adoptedAt } : {}) } }; },
    // The internal value provider shares the whole edit session; it never writes through a second adapter.
    save: async () => ({ ok: false, reason: "unavailable" }),
  }), [adapter, adapter.catalog.values]);
  // Display state must not manufacture a new engine input. Reproject whenever the
  // complete committed library or pending operations change, including other portions.
  const valueLibrary = useMemo(() => snapshot ? {
    ...snapshot.library.values, source: snapshot.library.source,
    ...(snapshot.library.adoptedAt ? { adoptedAt: snapshot.library.adoptedAt } : {}),
  } : undefined, [snapshot?.library]);
  const valueEdits = useMemo(() => sessionState?.edits.flatMap(edit => {
    const operations = edit.operations.flatMap(operation => operation.portion === "values" ? [operation.change] : []);
    return operations.length ? [{ ...edit, operations }] : [];
  }) ?? [], [sessionState?.edits]);
  const valueSession: StudioValueEditPort | undefined = session && sessionState && snapshot && valueLibrary ? {
    committed: valueLibrary,
    edits: valueEdits,
    status: sessionState.status, canUndo: sessionState.canUndo, canRedo: sessionState.canRedo, historyFailure: sessionState.historyFailure,
    edit: (leaf, operations, timing, field) => { session.edit(leaf, operations.map(change => ({ portion: "values", change })), timing, field); },
    flush: leaf => session.flush(leaf), retry: (leaf, keepMine) => session.retry(leaf, keepMine), takeTheirs: leaf => { void session.takeTheirs(leaf); }, undo: session.undo, redo: session.redo,
  } : undefined;
  const edit = (leaf: string, operations: readonly CompositeLibraryOperation[]): void => { session?.edit(leaf, operations); };
  const setActiveLayer = async (next: LayerId): Promise<boolean> => {
    if (await sessionRefState.current?.flush() === false) return false;
    setLayer(next); setLeaf(current => contracts.slots.some(slot => slot.id === current && slot.layer === next) ? current : contracts.slots.find(slot => slot.layer === next)?.id ?? "");
    return true;
  };
  useEffect(() => {
    const changed = () => { const layer = studioLayerFromFragment(window.location.hash); if (layer) void setActiveLayer(layer); };
    window.addEventListener("hashchange", changed); return () => window.removeEventListener("hashchange", changed);
  }, []);
  const feedback: { edits: EditSessionState<CompositeStudioSnapshot, CompositeLibraryOperation>["edits"]; historyFailure: EditSessionState<CompositeStudioSnapshot, CompositeLibraryOperation>["historyFailure"]; retry(leaf: string, keepMine?: boolean): void; takeTheirs(leaf: string): void } | undefined = session && sessionState ? { edits: sessionState.edits, historyFailure: sessionState.historyFailure, retry: (leaf: string, keepMine?: boolean) => session.retry(leaf, keepMine), takeTheirs: (leaf: string) => { void session.takeTheirs(leaf); } } : undefined;
  return { adapter, labels, sessionIdentity, snapshot, contracts, failed, changes, layer, setLayer: setActiveLayer, leaf, setLeaf, score, setScore, input, evaluated, projection, session, sessionState, valueSession, edit, feedback, saving: sessionState?.status === "saving" };
}
export type WholeStudioState = ReturnType<typeof useWholeState>;
const WholeContext = createContext<WholeStudioState | null>(null);
export const useWholeStudio = (): WholeStudioState | null => useContext(WholeContext);
/** State only: children and the one shared value projection remain mounted through loading/error. */
export function WholeStudioProvider({ children, ...props }: CompositeStudioProps & { children: ReactNode }) {
  const state = useWholeState(props);
  return <WholeContext.Provider value={state}><StudioProvider layerState={{ layer: state.layer, setLayer: state.setLayer, phase: state.failed ? "error" : "loading" }} valueSession={state.valueSession} adapter={state.projection} labels={props.labels} livePreview={props.livePreview} initialSlotId={props.initialSlotId}>{children}</StudioProvider></WholeContext.Provider>;
}
/** Finite facts from the original shared session. Preview functions, actions and candidate engines stay outside. */
export function useDesignerLayerBoardProjection(): { readonly projection: DesignerLayerBoardProjection; readonly projectionHash: RuntimeDigest } {
  const state = useWholeStudio();
  const values = useStudioSession();
  // Hash the working library once per working library, not on every render of a projection reader.
  const working = state?.input?.library;
  const workingHash = useMemo(() => working ? libraryHash(working) as RuntimeDigest : null, [working]);
  if (!state) throw new TypeError('Original WholeStudioProvider required');
  const valueLayer = state.layer === 'tokens' || state.layer === 'assets';
  const placements = (valueLayer ? values.activeCatalog.placements : state.contracts.placements).filter(placement => placement.layer === state.layer);
  const slots = (valueLayer ? values.activeCatalog.slots : state.contracts.slots).filter(slot => slot.layer === state.layer).map(({ id, layer }) => ({ id, layer }));
  const boards = valueLayer ? values.boards.map(({ id, label, leaves }) => ({ id, label, leaves })) : placements.flatMap(placement => placement.nodes.flatMap(domain => ('children' in domain ? domain.children : [domain]).map(group => ({ id: `${placement.layer}/${group.id}`, label: group.label, leaves: placedLeaves([group]).map(leaf => leaf.id) }))));
  const profile = state.evaluated?.value?.profile;
  const historyFailure = state.sessionState?.historyFailure;
  const projection: DesignerLayerBoardProjection = runtimeSnapshot({
    phase: state.failed || state.evaluated?.error ? 'error' : state.input && profile ? 'ready' : 'loading',
    layer: state.layer, consumer: state.input?.library.source.id ?? null,
    libraryHash: state.input ? workingHash : null,
    selectionHash: profile ? profile.selectionHash as RuntimeDigest : null,
    session: { id: state.sessionIdentity, revision: state.sessionState?.revision ?? 0, status: state.sessionState?.status ?? 'loading',
      edits: state.sessionState?.edits.map(edit => ({ id: edit.id, leaf: edit.leaf, field: edit.field, status: edit.status, operationsHash: runtimeHash(edit.operations), ...(edit.failure ? { failure: edit.failure } : {}) })) ?? [],
      history: historyFailure ? { ...historyFailure, request: { ...historyFailure.request } } : null },
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
