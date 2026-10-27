"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogData, LibraryData, LayerId } from "../catalog-core/index.js";
import { studioEngine } from "./engine.js";
import { createStudioEvaluation } from "./evaluation.js";
import { matrixBoards, matrixRows, matrixSources, matrixSummary, purePlacementTree } from "./matrix-model.js";
import { DEFAULT_SLOT_ID, allNodes, emptyChanges, scopeTargets, workingLibrary, type Candidate } from "./model.js";
import { initialStudioLayer, studioLayerFromFragment } from "./layer-navigation.js";
import type { LegacyStudioProps, StudioProviderProps } from "./types.js";

type Phase = { status: "loading" } | { status: "error" } | { status: "ready"; library: LibraryData; base: LibraryData };
/** The committed consumer values a whole-library host shares with this provider. Read-only: nothing here writes. */
export interface StudioCommittedValues { readonly committed: LibraryData }
/** No node-scope group choice is ever made in the read-only Designer. */
const NO_GROUP_CHOICES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Read-only value state: one adapter load, the committed library and its derived boards, rows and checks. It
 * exposes no apply, use, reset, generate-starter, undo or redo, and never calls the adapter's save.
 */
function useStudioState({ catalog: catalogProp, adapter, labels, initialSlotId = DEFAULT_SLOT_ID }: Omit<LegacyStudioProps, "header" | "panelInsets" | "className">, shared?: StudioCommittedValues, sharedLayer?: { layer: LayerId; setLayer(layer: LayerId): Promise<boolean>; phase?: 'loading' | 'error' }) {
  const catalog: CatalogData = useMemo(() => catalogProp ?? adapter.catalog ?? studioEngine.loadCatalog(), [catalogProp, adapter.catalog]);
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
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
  const [scoreOpen, setScoreOpen] = useState(false);
  const scoreTrigger = useRef<HTMLElement | undefined>(undefined);
  const adapterRef = useRef(adapter);
  useEffect(() => {
    if (shared || sharedLayer) return;
    let active = true;
    adapterRef.current.load().then(
      ({ library }) => { if (active) setPhase({ status: "ready", library, base: library }); },
      () => { if (active) setPhase({ status: "error" }); },
    );
    return () => { active = false; };
  }, []);
  const sharedReady = useMemo(() => shared ? { status: "ready" as const, library: shared.committed, base: shared.committed } : undefined, [shared?.committed]);
  const ready = sharedReady ?? (phase.status === "ready" ? phase : undefined);
  const base = ready?.base;
  const library = ready?.library;
  // The working library is the committed one: the read-only Designer holds no pending edit.
  const pending = useMemo(() => base ? emptyChanges(base) : undefined, [base]);
  const working = useMemo(() => base && pending ? workingLibrary({ catalog, base, changes: pending }) : undefined, [catalog, base, pending]);
  const setActiveLayer = async (next: LayerId): Promise<boolean> => {
    if (sharedLayer) return sharedLayer.setLayer(next);
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
  const showRows = useCallback((ids: ReadonlySet<string>): void => {
    setVisibleRows(current => current.size === ids.size && [...current].every(id => ids.has(id)) ? current : ids);
  }, []);
  const requestRow = (id: string, source?: string): void => {
    setDemandedRow(id);
    if (source !== undefined) setFocusedCell(current => current.row === id && current.source === source ? current : { row: id, source });
  };
  const closeScore = (): void => { setScoreOpen(false); scoreTrigger.current?.focus(); };
  return { catalog, activeCatalog, layer, layers, setLayer: setActiveLayer, labels, phase: ready ?? (sharedLayer ? { status: sharedLayer.phase ?? 'loading' } : phase), ready, pending, working, tree, groups, counts, rows, boards, sources, summary, resolved, focusedRow, focused,
    slotId, setSlotId, expanded, setExpanded, focusedCell, setFocusedCell, showRows, requestRow, groupChoices: NO_GROUP_CHOICES, boardElements, rowElements, canvasActions, cameras,
    scoreOpen, setScoreOpen, scoreTrigger, closeScore };
}
type StudioSession = ReturnType<typeof useStudioState>;
const StudioContext = createContext<StudioSession | null>(null);
export const useOptionalStudioSession = (): StudioSession | null => useContext(StudioContext);
export function useStudioSession(): StudioSession {
  const state = useOptionalStudioSession();
  if (!state) throw new TypeError("StudioProvider");
  return state;
}
/** One adapter load and one read-only consumer library, shared by the host header and canvas. */
export function StudioProvider({ children, values, layerState, ...props }: StudioProviderProps & { values?: StudioCommittedValues; layerState?: { layer: LayerId; setLayer(layer: LayerId): Promise<boolean>; phase?: 'loading' | 'error' } }) {
  const state = useStudioState(props, values, layerState);
  return <StudioContext.Provider value={state}>{children}</StudioContext.Provider>;
}

