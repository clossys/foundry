"use client";

import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CatalogData, ChangeSet, LibraryData, LayerId } from "../catalog-core/index.js";
import { studioEngine } from "./engine.js";
import { createStudioEvaluation } from "./evaluation.js";
import { matrixBoards, matrixRows, matrixSources, matrixSummary, purePlacementTree, type MatrixRow } from "./matrix-model.js";
import { DEFAULT_SLOT_ID, allNodes, changesFor, emptyChanges, scopeTargets, workingLibrary, type Candidate, type Change } from "./model.js";
import { liveCss } from "./preview-css.js";
import { EditSession, type EditSessionState, type EditTiming } from "./edit-session.js";
import { initialStudioLayer, studioLayerFromFragment } from "./layer-navigation.js";
import { valueHistoryChanges } from "./history.js";
import { useEditSession } from "./useEditSession.js";
import type { EditFeedbackState } from "./EditFeedback.js";
import type { LegacyStudioProps, StudioProviderProps } from "./types.js";

type Phase = { status: "loading" } | { status: "error" } | { status: "ready"; library: LibraryData; base: LibraryData };
export interface StudioValueEditPort extends EditFeedbackState {
  readonly committed: LibraryData;
  readonly edits: EditSessionState<LibraryData, Change>["edits"];
  readonly status: "saving" | "saved" | "not-saved";
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  edit(leaf: string, operations: readonly Change[], timing?: EditTiming, field?: string): void;
  flush(leaf?: string): Promise<boolean>;
  undo(): void;
  redo(): void;
}

function useStudioState({ catalog: catalogProp, adapter, labels, initialSlotId = DEFAULT_SLOT_ID, livePreview = true, sessionRef }: Omit<LegacyStudioProps, "header" | "panelInsets" | "className">, shared?: StudioValueEditPort, sharedLayer?: { layer: LayerId; setLayer(layer: LayerId): Promise<boolean>; phase?: 'loading' | 'error' }) {
  const catalog: CatalogData = useMemo(() => catalogProp ?? adapter.catalog ?? studioEngine.loadCatalog(), [catalogProp, adapter.catalog]);
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [session, setSession] = useState<EditSession<LibraryData, Change, ChangeSet>>();
  const editState = useEditSession(session);
  const [slotId, setSlotId] = useState(initialSlotId);
  const [localLayer, setLocalLayer] = useState<LayerId>(() => initialStudioLayer() ?? catalog.slots.find(slot => slot.id === initialSlotId)?.layer ?? catalog.placements[0]?.layer ?? "tokens");
  const layer = sharedLayer?.layer ?? localLayer;
  const layers = useMemo(() => catalog.placements.map(placement => placement.layer), [catalog]);
  const activeCatalog = useMemo(() => ({ ...catalog, slots: catalog.slots.filter(slot => slot.layer === layer), placements: catalog.placements.filter(placement => placement.layer === layer) }), [catalog, layer]);
  const boardElements = useRef(new Map<string, HTMLElement>());
  const rowElements = useRef(new Map<string, HTMLElement>());
  const canvasActions = useRef<{ reveal: (id: string, focus?: boolean) => void } | null>(null);
  const cameras = useRef(new Map<string, import("./camera.js").CameraPose>());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [visibleRows, setVisibleRows] = useState<ReadonlySet<string>>(new Set());
  const [demandedRow, setDemandedRow] = useState<string>();
  const [focusedCell, setFocusedCell] = useState<{ row: string; source?: string }>({ row: initialSlotId });
  const [groupChoices, setGroupChoices] = useState<Record<string, string>>({});
  const [scoreOpen, setScoreOpen] = useState(false);
  const scoreTrigger = useRef<HTMLElement | undefined>(undefined);
  const adapterRef = useRef(adapter);
  const lastSafe = useRef("");
  useEffect(() => {
    if (shared || sharedLayer) return;
    let active = true;
    adapterRef.current.load().then(
      ({ library }) => { if (active) {
        setPhase({ status: "ready", library, base: library });
        setSession(new EditSession<LibraryData, Change, ChangeSet>(library, {
          copy: structuredClone,
          hash: studioEngine.libraryHash,
          changes: (base, operations) => ({ baseHash: studioEngine.libraryHash(base), changes: operations }),
          save: async changes => { const result = await adapterRef.current.save(changes); return result.ok ? { ok: true, committed: result.library } : result; },
          restore: (current, target, leaf, expected) => valueHistoryChanges(catalog, current, target, leaf, expected),
          load: async () => (await adapterRef.current.load()).library,
        }));
      } },
      () => { if (active) setPhase({ status: "error" }); },
    );
    return () => { active = false; };
  }, []);
  useEffect(() => () => { void session?.flush(); }, [session]);
  const autosave: StudioValueEditPort | undefined = shared ?? (session && editState ? {
    committed: editState.committed, edits: editState.edits, status: editState.status, canUndo: editState.canUndo, canRedo: editState.canRedo, historyFailure: editState.historyFailure,
    edit: (leaf, operations, timing, field) => { session.edit(leaf, operations, timing, field); },
    flush: leaf => session.flush(leaf), retry: (leaf, keepMine) => session.retry(leaf, keepMine), takeTheirs: leaf => { void session.takeTheirs(leaf); }, undo: session.undo, redo: session.redo,
  } : undefined);
  const autosaveRef = useRef(autosave); autosaveRef.current = autosave;
  useImperativeHandle(sessionRef, () => ({ flush: () => autosaveRef.current?.flush() ?? Promise.resolve(true) }), []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable=true]")) return;
      const state = autosaveRef.current;
      if (event.shiftKey ? state?.canRedo : state?.canUndo) { event.preventDefault(); if (event.shiftKey) state?.redo(); else state?.undo(); }
    };
    document.addEventListener("keydown", keydown); return () => document.removeEventListener("keydown", keydown);
  }, []);
  const ready = autosave ? { status: "ready" as const, library: autosave.committed, base: autosave.committed } : phase.status === "ready" ? phase : undefined;
  const base = ready?.base;
  const library = ready?.library;
  const pending = useMemo(() => base ? { ...emptyChanges(base), changes: autosave?.edits.flatMap(edit => edit.operations) ?? [] } : undefined, [base, autosave?.edits]);
  const working = useMemo(() => base && pending ? workingLibrary({ catalog, base, changes: pending }) : undefined, [catalog, base, pending]);
  const saving = autosave?.status === "saving";
  const setActiveLayer = async (next: LayerId): Promise<boolean> => {
    if (sharedLayer) return sharedLayer.setLayer(next);
    if (await autosaveRef.current?.flush() === false) return false;
    setLocalLayer(next); return true;
  };
  useEffect(() => {
    if (sharedLayer) return;
    const changed = () => { const layer = studioLayerFromFragment(window.location.hash); if (layer) void setActiveLayer(layer); };
    window.addEventListener("hashchange", changed); return () => window.removeEventListener("hashchange", changed);
  }, []);
  const tree = useMemo(() => purePlacementTree(activeCatalog.placements), [activeCatalog]);
  const groups = useMemo(() => allNodes(activeCatalog.placements), [activeCatalog]);
  const counts = useMemo(() => Object.fromEntries(catalog.slots.map(slot => [slot.id, library ? scopeTargets({ catalog, library, slotId: slot.id, scope: "member" }).length : 0])), [catalog, library]);
  const evaluation = useMemo(() => working ? createStudioEvaluation({ catalog, working }) : undefined, [catalog, working]);
  const candidateCache = useMemo(() => new Map<string, Candidate[]>(), [catalog, library, working]);
  const evaluateRows = useMemo(() => {
    const ids = new Set(visibleRows);
    if (demandedRow) ids.add(demandedRow);
    for (const id of expanded) {
      ids.add(id);
      if (library) scopeTargets({ catalog, library, slotId: id, scope: "member" }).forEach(member => ids.add(member));
    }
    return ids;
  }, [catalog, library, visibleRows, demandedRow, expanded]);
  const rows = useMemo(() => library && working && pending ? matrixRows({ catalog, placements: activeCatalog.placements, library, working, cache: candidateCache, evaluation, changes: pending, expanded, evaluateRows }) : [], [catalog, library, working, candidateCache, evaluation, pending, expanded, evaluateRows, activeCatalog]);
  const boards = useMemo(() => library && working ? matrixBoards({ catalog: activeCatalog, library, working }, rows) : [], [activeCatalog, library, working, rows]);
  const sources = useMemo(() => library ? matrixSources({ catalog, library }) : [], [catalog, library]);
  const summary = useMemo(() => library && working ? matrixSummary({ catalog, library, working, layer, evaluation }) : undefined, [catalog, library, working, layer, evaluation]);
  const resolved = useMemo(() => evaluation?.evaluate().resolved, [evaluation]);
  const focusedRow = rows.find(row => row.id === focusedCell.row) ?? rows.find(row => row.scope === "slot") ?? rows[0];
  const focused = focusedRow?.candidates.find(candidate => candidate.source === focusedCell.source) ?? focusedRow?.candidates.find(candidate => candidate.selected) ?? focusedRow?.candidates.find(candidate => candidate.inUseByDefault) ?? focusedRow?.candidates[0];
  const live = useMemo(() => library && working ? liveCss({ catalog, library, working, evaluation, previous: lastSafe.current }) : undefined, [catalog, library, working, evaluation]);
  if (live) lastSafe.current = live.css;
  const showRows = useCallback((ids: ReadonlySet<string>): void => {
    setVisibleRows(current => current.size === ids.size && [...current].every(id => ids.has(id)) ? current : ids);
  }, []);
  const requestRow = (id: string, source?: string): void => {
    setDemandedRow(id);
    if (source !== undefined) setFocusedCell(current => current.row === id && current.source === source ? current : { row: id, source });
  };
  const apply = (list: readonly Change[], timing: EditTiming = "discrete", field?: string): void => {
    if (!base || !autosave) return;
    const leaves = [...new Set(list.map(change => change.slot))];
    for (const leaf of leaves) autosave.edit(leaf, list.filter(change => change.slot === leaf), timing, field);
  };
  const use = (row: MatrixRow, source: string): void => {
    if (!library || !working || !pending) return;
    const checkedRow = row.candidatesReady === false ? matrixRows({ catalog, library, working, evaluation, cache: candidateCache, changes: pending, expanded, evaluateRows: new Set([row.id]) }).find(entry => entry.id === row.id) : row;
    requestRow(row.id);
    if (!checkedRow?.candidates.find(candidate => candidate.source === source)?.usable) return;
    apply(changesFor({ catalog, library, scope: row.scope, target: row.target, source }));
    if (row.scope === "node") setGroupChoices(current => ({ ...current, [row.target]: source }));
  };
  const resetList = library && focusedRow ? changesFor({ catalog, library, scope: focusedRow.scope, target: focusedRow.target }) : [];
  const canReset = working !== undefined && resetList.some(entry => working.fills.some(fill => fill.$extensions["com.clossys.fill"].slot === entry.slot));
  const closeScore = (): void => { setScoreOpen(false); scoreTrigger.current?.focus(); };
  const reset = (): void => { apply(resetList); if (focusedRow?.scope === "node") setGroupChoices(current => { const next = { ...current }; delete next[focusedRow.target]; return next; }); };
  return { catalog, activeCatalog, layer, layers, setLayer: setActiveLayer, labels, adapter, phase: ready ?? (sharedLayer ? { status: sharedLayer.phase ?? 'loading' } : phase), ready, pending, working, tree, groups, counts, rows, boards, sources, summary, resolved, focusedRow, focused, live,
    livePreview, saving, autosave, apply, slotId, setSlotId, expanded, setExpanded, focusedCell, setFocusedCell, showRows, requestRow, groupChoices, boardElements, rowElements, canvasActions, cameras,
    scoreOpen, setScoreOpen, scoreTrigger, closeScore, canReset, reset, use };
}
type StudioSession = ReturnType<typeof useStudioState>;
const StudioContext = createContext<StudioSession | null>(null);
export const useOptionalStudioSession = (): StudioSession | null => useContext(StudioContext);
export function useStudioSession(): StudioSession {
  const state = useOptionalStudioSession();
  if (!state) throw new TypeError("StudioProvider");
  return state;
}
/** One adapter load and one in-memory working consumer library, shared by the host header and canvas. */
export function StudioProvider({ children, valueSession, layerState, ...props }: StudioProviderProps & { valueSession?: StudioValueEditPort; layerState?: { layer: LayerId; setLayer(layer: LayerId): Promise<boolean>; phase?: 'loading' | 'error' } }) {
  const state = useStudioState(props, valueSession, layerState);
  return <StudioContext.Provider value={state}>{children}</StudioContext.Provider>;
}

