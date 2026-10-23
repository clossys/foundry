"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogData, ChangeSet, Finding, LibraryData, Selection } from "../catalog-core/index.js";
import { studioEngine } from "./engine.js";
import { matrixBoards, matrixRows, matrixSources, matrixSummary, purePlacementTree, type MatrixRow } from "./matrix-model.js";
import { DEFAULT_SLOT_ID, addChanges, allNodes, changesFor, emptyChanges, pendingCount, pickAt, scopeTargets, workingSelection, type Candidate, type Change } from "./model.js";
import { liveCss } from "./preview-css.js";
import type { StudioProps, StudioProviderProps } from "./types.js";

type Phase = { status: "loading" } | { status: "error" } | { status: "ready"; library: LibraryData; base: Selection };
type SaveFailure = { reason: "unavailable" | "conflict" | "invalid" | "failed"; findings?: readonly Finding[] };

function useStudioState({ catalog: catalogProp, adapter, labels, initialSlotId = DEFAULT_SLOT_ID, livePreview = true }: Omit<StudioProps, "header" | "panelInsets" | "className">) {
  const catalog: CatalogData = useMemo(() => catalogProp ?? adapter.catalog ?? studioEngine.loadCatalog(), [catalogProp, adapter.catalog]);
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [changes, setChanges] = useState<ChangeSet | undefined>(undefined);
  const [slotId, setSlotId] = useState(initialSlotId);
  const boardElements = useRef(new Map<string, HTMLElement>());
  const rowElements = useRef(new Map<string, HTMLElement>());
  const canvasActions = useRef<{ reveal: (id: string, focus?: boolean) => void } | null>(null);
  const cameras = useRef(new Map<string, import("./camera.js").CameraPose>());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusedCell, setFocusedCell] = useState<{ row: string; source?: string }>({ row: initialSlotId });
  const [groupChoices, setGroupChoices] = useState<Record<string, string>>({});
  const savedGroups = useRef<Record<string, string>>({});
  const [scoreOpen, setScoreOpen] = useState(false);
  const scoreTrigger = useRef<HTMLElement | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure>();
  const adapterRef = useRef(adapter);
  const mounted = useRef(true);
  const lastSafe = useRef("");
  useEffect(() => {
    mounted.current = true;
    adapterRef.current.load().then(
      ({ library, selection }) => { if (mounted.current) setPhase({ status: "ready", library, base: selection }); },
      () => { if (mounted.current) setPhase({ status: "error" }); },
    );
    return () => { mounted.current = false; };
  }, []);
  const ready = phase.status === "ready" ? phase : undefined;
  const base = ready?.base;
  const library = ready?.library;
  const pending = useMemo(() => base ? changes ?? emptyChanges(base) : undefined, [base, changes]);
  const working = useMemo(() => base && pending ? workingSelection({ base, changes: pending }) : undefined, [base, pending]);
  const tree = useMemo(() => purePlacementTree(catalog.placements), [catalog]);
  const groups = useMemo(() => allNodes(catalog.placements.filter(placement => placement.layer === "tokens")), [catalog]);
  const counts = useMemo(() => Object.fromEntries(catalog.slots.filter(slot => slot.layer === "tokens").map(slot => [slot.id, library ? scopeTargets({ catalog, library, slotId: slot.id, scope: "member" }).length : 0])), [catalog, library]);
  const candidateCache = useMemo(() => new Map<string, Candidate[]>(), [catalog, library, working]);
  const rows = useMemo(() => library && working && pending ? matrixRows({ catalog, library, working, cache: candidateCache, changes: pending, expanded }) : [], [catalog, library, working, candidateCache, pending, expanded]);
  const boards = useMemo(() => library && working ? matrixBoards({ catalog, library, working }, rows) : [], [catalog, library, working, rows]);
  const sources = useMemo(() => library ? matrixSources({ catalog, library }) : [], [catalog, library]);
  const summary = useMemo(() => library && working ? matrixSummary({ catalog, library, working, cache: candidateCache }) : undefined, [catalog, library, working, candidateCache]);
  const resolved = useMemo(() => library && working ? studioEngine.resolve({ catalog, library, selection: working }) : undefined, [catalog, library, working]);
  const focusedRow = rows.find(row => row.id === focusedCell.row) ?? rows.find(row => row.scope === "slot") ?? rows[0];
  const focused = focusedRow?.candidates.find(candidate => candidate.source === focusedCell.source) ?? focusedRow?.candidates.find(candidate => candidate.selected) ?? focusedRow?.candidates.find(candidate => candidate.inUseByDefault) ?? focusedRow?.candidates[0];
  const live = library && working ? liveCss({ catalog, library, working, previous: lastSafe.current }) : undefined;
  if (live) lastSafe.current = live.css;
  const apply = (list: readonly Change[]): void => {
    if (!base || !pending) return;
    setChanges(addChanges({ base, changes: pending, list }));
    setFailure(undefined);
  };
  const use = (row: MatrixRow, source: string): void => {
    if (!library || !row.candidates.find(candidate => candidate.source === source)?.usable) return;
    apply(changesFor({ catalog, library, scope: row.scope, target: row.target, source }));
    if (row.scope === "node") setGroupChoices(current => ({ ...current, [row.target]: source }));
  };
  const resetList = library && focusedRow ? changesFor({ catalog, library, scope: focusedRow.scope, target: focusedRow.target }) : [];
  const canReset = working !== undefined && resetList.some((entry) => entry.op === "clear" && pickAt(working, entry.scope, entry.target) !== undefined);
  const save = async (): Promise<void> => {
    if (!pending) return;
    setSaving(true); setFailure(undefined);
    try {
      const result = await adapterRef.current.save(pending);
      if (!mounted.current) return;
      if (result.ok) {
        setPhase(current => current.status === "ready" ? { ...current, base: result.selection } : current);
        setChanges(emptyChanges(result.selection));
        savedGroups.current = groupChoices;
      } else setFailure({ reason: result.reason, ...(result.findings ? { findings: result.findings } : {}) });
    } catch { if (mounted.current) setFailure({ reason: "failed" }); }
    finally { if (mounted.current) setSaving(false); }
  };
  const closeScore = (): void => { setScoreOpen(false); scoreTrigger.current?.focus(); };
  const discard = (): void => { if (ready) { setChanges(emptyChanges(ready.base)); setGroupChoices(savedGroups.current); setFailure(undefined); } };
  const reset = (): void => { apply(resetList); if (focusedRow?.scope === "node") setGroupChoices(current => { const next = { ...current }; delete next[focusedRow.target]; return next; }); };
  return { catalog, labels, adapter, phase, ready, pending, working, tree, groups, counts, rows, boards, sources, summary, resolved, focusedRow, focused, live,
    livePreview, saving, failure, slotId, setSlotId, expanded, setExpanded, focusedCell, setFocusedCell, groupChoices, boardElements, rowElements, canvasActions, cameras,
    scoreOpen, setScoreOpen, scoreTrigger, closeScore, canReset, reset, save, discard, use, pendingCount: pending ? pendingCount(pending) : 0 };
}
type StudioSession = ReturnType<typeof useStudioState>;
const StudioContext = createContext<StudioSession | null>(null);
export const useOptionalStudioSession = (): StudioSession | null => useContext(StudioContext);
export function useStudioSession(): StudioSession {
  const state = useOptionalStudioSession();
  if (!state) throw new TypeError("StudioProvider");
  return state;
}
/** One adapter load and one in-memory working selection, shared by the host header and canvas. */
export function StudioProvider({ children, ...props }: StudioProviderProps) {
  const state = useStudioState(props);
  return <StudioContext.Provider value={state}>{children}</StudioContext.Provider>;
}
