"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogData, LibraryData, LayerId } from "../catalog-core/index.js";
import { studioEngine } from "./engine.js";
import { createStudioEvaluation } from "./evaluation.js";
import { matrixBoards, matrixRows, matrixSources, matrixSummary, purePlacementTree } from "./matrix-model.js";
import { DEFAULT_SLOT_ID, allNodes, emptyChanges, scopeTargets, workingLibrary, type Candidate } from "./model.js";
import { normaliseWindowLocation, replaceStudioLocation, resolverFromPlacements } from "./layer-navigation.js";
import type { StudioNavigateTarget } from "./rail/explorer-tree.js";
import type { LegacyStudioProps, StudioProviderProps } from "./types.js";

type Phase = { status: "loading" } | { status: "error" } | { status: "ready"; library: LibraryData; base: LibraryData };
/** The committed consumer values a whole-library host shares with this provider. Read-only: nothing here writes. */
export interface StudioCommittedValues { readonly committed: LibraryData }
export type { StudioNavigateTarget } from "./rail/explorer-tree.js";
/**
 * The layer (and the selected leaf) a whole-library host shares with this provider. Without `select`, the
 * selection is this provider's own.
 */
export interface StudioLayerState {
  readonly layer: LayerId;
  setLayer(layer: LayerId): Promise<boolean>;
  readonly phase?: "loading" | "error";
  readonly selected?: string;
  select?(leaf: string | undefined): void;
}
/** No node-scope group choice is ever made in the read-only Designer. */
const NO_GROUP_CHOICES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Read-only value state: one adapter load, the committed library and its derived boards, rows and checks. It
 * exposes no apply, use, reset, generate-starter, undo or redo, and never calls the adapter's save.
 */
function useStudioState({ catalog: catalogProp, adapter, labels, initialSlotId: initialSlotProp = DEFAULT_SLOT_ID }: Omit<LegacyStudioProps, "header" | "panelInsets" | "className">, shared?: StudioCommittedValues, sharedLayer?: StudioLayerState) {
  const catalog: CatalogData = useMemo(() => catalogProp ?? adapter.catalog ?? studioEngine.loadCatalog(), [catalogProp, adapter.catalog]);
  const resolver = useMemo(() => resolverFromPlacements(catalog.placements), [catalog]);
  // A standalone Studio owns the URL: normalise it once, before the first paint. A host provider already has.
  const [initial] = useState(() => sharedLayer ? {} : normaliseWindowLocation(resolver));
  const initialLeaf = initial.node && catalog.slots.some(slot => slot.id === initial.node) ? initial.node : undefined;
  const initialSlotId = initialLeaf ?? initialSlotProp;
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [slotId, setSlotId] = useState(initialSlotId);
  const [localLayer, setLocalLayer] = useState<LayerId>(() => initial.layer ?? catalog.slots.find(slot => slot.id === initialSlotId)?.layer ?? catalog.placements[0]?.layer ?? "tokens");
  const [localSelected, setLocalSelected] = useState<string | undefined>(initialLeaf);
  const layer = sharedLayer?.layer ?? localLayer;
  const selected = sharedLayer?.select ? sharedLayer.selected : localSelected;
  const layerRef = useRef(layer); layerRef.current = layer;
  const layers = useMemo(() => catalog.placements.map(placement => placement.layer), [catalog]);
  const activeCatalog = useMemo(() => ({ ...catalog, slots: catalog.slots.filter(slot => slot.layer === layer), placements: catalog.placements.filter(placement => placement.layer === layer) }), [catalog, layer]);
  const boardElements = useRef(new Map<string, HTMLElement>());
  const rowElements = useRef(new Map<string, HTMLElement>());
  const canvasActions = useRef<{ reveal: (id: string, focus?: boolean) => void } | null>(null);
  const cameras = useRef(new Map<string, import("./camera.js").CameraPose>());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [visibleRows, setVisibleRows] = useState<ReadonlySet<string>>(new Set());
  // A deep-linked (or host-selected) leaf is evaluated at once, so the Inspector card can show it.
  const [demandedRow, setDemandedRow] = useState<string | undefined>(() => sharedLayer?.select ? sharedLayer.selected : initialLeaf);
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
  // A layer change clears the selection (in the same update, so a navigation can select on the new layer).
  const setActiveLayer = async (next: LayerId): Promise<boolean> => {
    if (sharedLayer) return sharedLayer.setLayer(next);
    if (next !== layerRef.current) setLocalSelected(undefined);
    setLocalLayer(next); return true;
  };
  /** Select an L3 leaf (the Inspector card fills) or clear the selection. */
  const select = (leaf: string | undefined): void => {
    if (sharedLayer?.select) sharedLayer.select(leaf); else setLocalSelected(leaf);
    if (leaf === undefined) return;
    setSlotId(leaf); setDemandedRow(leaf);
    setFocusedCell(current => current.row === leaf ? current : { row: leaf });
  };
  // One navigation callback for the explorer, the inspector's usage entries, the scorecard and the boards. It
  // switches layer, selects a leaf and reveals the target once the target layer's canvas has mounted.
  const pendingReveal = useRef<StudioNavigateTarget | undefined>(undefined);
  const [revealRequest, setRevealRequest] = useState(0);
  const navigation = useRef({ setActiveLayer, select }); navigation.current = { setActiveLayer, select };
  const onNavigate = useCallback((target: StudioNavigateTarget): void => {
    if (target.layer !== layerRef.current) void navigation.current.setActiveLayer(target.layer);
    if (target.leaf) navigation.current.select(target.leaf);
    pendingReveal.current = target; setRevealRequest(count => count + 1);
  }, []);
  useEffect(() => {
    const target = pendingReveal.current;
    if (!target || target.layer !== layer) return;
    pendingReveal.current = undefined;
    const id = target.leaf ?? target.l2 ?? target.l1;
    if (id) canvasActions.current?.reveal(id, Boolean(target.leaf));
  }, [revealRequest, layer]);
  // Escape closes the Inspector card: it clears the selection unless a control consumed the key (a popover, a
  // search field). Collections stop the key's propagation without consuming it, so the page listens in capture
  // and decides once the key's dispatch has finished.
  const hasSelection = selected !== undefined;
  useEffect(() => {
    if (!hasSelection) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      clearTimeout(pending);
      pending = setTimeout(() => { if (!event.defaultPrevented) navigation.current.select(undefined); });
    };
    window.addEventListener("keydown", escape, true);
    return () => { clearTimeout(pending); window.removeEventListener("keydown", escape, true); };
  }, [hasSelection]);
  // The selection writes the canonical URL (?layer=&node=); the first paint never does.
  const written = useRef<{ layer: LayerId; selected: string | undefined } | undefined>(undefined);
  useEffect(() => {
    const previous = written.current; written.current = { layer, selected };
    if (!previous || (previous.layer === layer && previous.selected === selected)) return;
    replaceStudioLocation({ layer, ...(selected ? { node: selected } : {}) });
  }, [layer, selected]);
  // A legacy #studio-layer= link followed in page goes through the same normalisation.
  useEffect(() => {
    if (sharedLayer) return;
    const changed = (): void => {
      const location = normaliseWindowLocation(resolver);
      if (location.layer) onNavigate({ layer: location.layer, ...(location.node && catalog.slots.some(slot => slot.id === location.node) ? { leaf: location.node } : {}) });
    };
    window.addEventListener("hashchange", changed); return () => window.removeEventListener("hashchange", changed);
  }, [resolver]);
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
    selected, select, onNavigate,
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
export function StudioProvider({ children, values, layerState, ...props }: StudioProviderProps & { values?: StudioCommittedValues; layerState?: StudioLayerState }) {
  const state = useStudioState(props, values, layerState);
  return <StudioContext.Provider value={state}>{children}</StudioContext.Provider>;
}

