"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WholeStudioCanvas, useWholeStudio } from "./WholeStudio.js";
import { useFrameNotice } from "../frames/frame-notices.js";
import { Button } from "../components/Button.js";
import { CanvasExplorer } from "./CanvasExplorer.js";
import { CanvasModules } from "./CanvasModules.js";
import { SlotModule } from "../shell/FrameSlots.js";
import { cx } from "../components/internal/cx.js";
import { Board } from "./Board.js";
import { EditFeedback } from "./EditFeedback.js";
import { AssetExemptions } from "./AssetExemptions.js";
import { boardMatches, boardSources, canvasDomains, type CanvasFilter } from "./canvas-model.js";
import { CanvasSurface } from "../blocks/canvas/CanvasSurface.js";
import { CanvasLod } from "../blocks/canvas/CanvasLod.js";
import { CanvasDomain } from "./CanvasDomain.js";
import { useCanvasWorld } from "./useCanvasWorld.js";
import { Inspector } from "./Inspector.js";
import { SlotTree } from "./SlotTree.js";
import { candidatesCss } from "./preview-css.js";
import { visibleStudioRows } from "./visible-rows.js";
import { useStudioSession } from "./StudioProvider.js";
import type { MatrixRow } from "./matrix-model.js";
import type { Candidate } from "./model.js";
import type { StudioCanvasProps } from "./types.js";



/** Foundry CanvasSurface owns the transformed world and its pinned navigation panels. */
export function LegacyStudioCanvas({ panelInsets, className, candidateWorkflow }: StudioCanvasProps) {
  const state = useStudioSession(); const latest = useRef(state); latest.current = state;
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState<CanvasFilter>("all");
  const [explorerOpen, setExplorerOpen] = useState(true); const [inspectorOpen, setInspectorOpen] = useState(false);
  const boardRefs = useRef(new Map<string, (element: HTMLElement | null) => void>()); const openActions = useRef(new Map<string, () => void>());
  const text = state.labels.canvas; const enabled = Boolean(state.ready);
  // The frame owns transient chrome: a failed load is a frame notice, never a canvas-local banner.
  useFrameNotice(state.phase.status === "error" ? { id: "studio-load-failed", severity: "error", text: state.labels.loadFailed } : null);
  const canvas = useCanvasWorld(state.layer, pose => {
    latest.current.cameras.current.set(latest.current.layer, pose);
    if (canvas.surface.current) latest.current.showRows(visibleStudioRows(canvas.surface.current, latest.current.rowElements.current, pose.zoom));
  }, state.cameras.current.get(state.layer), Boolean(state.working && state.pending && state.boards.length));
  const camera = canvas.actions, narrow = canvas.overlayLayout !== "wide";
  const domains = useMemo(() => canvasDomains(state.activeCatalog, state.boards), [state.activeCatalog, state.boards]);
  const candidateStyles = useMemo(() => candidatesCss(state.rows.flatMap(row => row.candidates)), [state.rows]);
  const variants = useMemo(() => Object.fromEntries(state.activeCatalog.slots.filter(slot => slot.contract.members.mode === "closed").map(slot => [slot.id, slot.contract.members.mode === "closed" ? slot.contract.members.names.map(name => `${slot.id}.${name}`) : []])), [state.activeCatalog]);
  const contextTokens = useMemo(() => Object.entries(state.resolved?.members ?? {}).filter(([, member]) => member.slot.startsWith("tokens.")).map(([id, member]) => ({ id, value: member.css.light })), [state.resolved]);
  const summaries = useMemo(() => new Map(state.boards.map(board => {
    const findings = state.summary?.issues.filter(issue => issue.slotId !== undefined && board.leaves.includes(issue.slotId)).map(issue => issue.finding) ?? [];
    return [board.id, { errors: findings.filter(finding => finding.severity === "error").length, warnings: findings.filter(finding => finding.severity === "notice").length, sources: state.working ? boardSources(board, state.working) : [] }];
  })), [state.boards, state.summary, state.working]);
  const registerRow = useCallback((id: string, element: HTMLTableRowElement | null) => { const elements = latest.current.rowElements.current; if (element) elements.set(id, element); else elements.delete(id); }, []);
  const expand = useCallback((id: string) => latest.current.setExpanded(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; }), []);
  const use = useCallback((row: MatrixRow, source: string) => latest.current.use(row, source), []);
  const requestRow = useCallback((row: MatrixRow, source: string) => { latest.current.requestRow(row.id, source); setInspectorOpen(true); }, []);
  const focusCell = useCallback((row: MatrixRow, candidate: Candidate) => {
    if (row.leaves.length === 1) latest.current.setSlotId(row.leaves[0]!);
    latest.current.setFocusedCell(current => current.row === row.id && current.source === candidate.source ? current : { row: row.id, source: candidate.source });
    setInspectorOpen(true);
  }, [state.layer]);
  const reveal = useCallback((id: string, focus = false) => {
    const current = latest.current; current.setSlotId(id);
    const group = current.groups.find(group => group.id === id);
    const board = current.boards.find(board => board.id === id || board.leaves.includes(id) || group?.leaves.some(leaf => board.leaves.includes(leaf)));
    const target = current.boardElements.current.get(id) ?? current.rowElements.current.get(id) ?? (board ? current.boardElements.current.get(board.id) : undefined);
    const row = current.rowElements.current.get(id);
    if (row) current.requestRow(id);
    if (target) camera.current?.flyTo(target, { focus, ...(current.rowElements.current.has(id) ? { zoom: 1 } : {}) });
    if (focus) { setQuery(""); setFilter("all"); current.setFocusedCell({ row: id }); }
  }, [state.layer]);
  useEffect(() => { state.canvasActions.current = { reveal }; return () => { state.canvasActions.current = null; }; }, [state.canvasActions, reveal]);
  return <div data-studio="" data-layout={narrow ? "narrow" : "wide"} data-studio-canvas="" className={cx("relative isolate h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-raised text-ink-primary", className)}>
    {state.layer === "assets" && state.summary ? <AssetExemptions findings={state.summary.issues.map(issue => issue.finding)} label={state.labels.assetExemption} /> : null}
    {state.livePreview && state.live?.css ? <style data-studio-preview="">{state.live.css}</style> : null}
    {state.ready ? <style data-studio-candidates="">{candidateStyles}</style> : null}
    {state.phase.status === "loading" ? <p role="status">{state.labels.loading}</p> : null}

    <CanvasSurface aria-label={text.label} viewport={canvas.pose} onViewportChange={canvas.setPose} selection={[]} onSelectionChange={() => {}}
      worldBounds={canvas.bounds} items={[]} itemInteraction="content" minZoom={.12} maxZoom={2}
      onSurfaceElement={canvas.onSurfaceElement} onWorldElement={canvas.onWorldElement} actionsRef={canvas.actions}
      worldClassName="flex h-max w-max flex-col gap-3xl p-3xl" className="absolute inset-0 rounded-none border-0 bg-surface-raised"
      instructionText={text.hint} grid="dots" recenterLabel={text.minimap}
      zoomOutLabel={text.zoomOut} zoomInLabel={text.zoomIn} zoomPercentageLabel={text.zoomLabel} fitLabel={text.fit}
      >
        <CanvasLod zoom={canvas.pose.zoom}>{domains.map(domain => <CanvasDomain key={domain.id} id={domain.id} label={domain.label} narrow={canvas.overlayLayout === "narrow"}>
          {domain.boards.map(board => {
            if (!boardRefs.current.has(board.id)) boardRefs.current.set(board.id, element => { const elements = latest.current.boardElements.current; if (element) elements.set(board.id, element); else elements.delete(board.id); });
            if (!openActions.current.has(board.id)) openActions.current.set(board.id, () => { const element = latest.current.boardElements.current.get(board.id); if (element) camera.current?.flyTo(element, { focus: true }); });
            const summary = summaries.get(board.id)!; const matches = state.working && state.pending ? boardMatches({ board, domain: domain.label, query, filter, working: state.working, changes: state.pending, groupChoices: state.groupChoices, warnings: summary.warnings }) : true;
            return <div key={board.id} data-studio-board-match={matches ? "" : undefined} data-studio-board-wrapper={board.id} className={matches ? undefined : "opacity-[var(--ui-alpha-disabled)]"}>
              {state.working && state.pending ? <Board board={board} boardRef={boardRefs.current.get(board.id)!} summary={summary} onOpen={openActions.current.get(board.id)!} workflow={candidateWorkflow} variants={variants} contextTokens={contextTokens} sources={state.sources} labels={state.labels} working={state.working} changes={state.pending} groups={state.groups} groupChoices={state.groupChoices} expanded={state.expanded} layout="wide" onExpand={expand} onUse={use} onRowElement={registerRow} onFocusCell={focusCell} onRequestRow={requestRow} /> : null}
            </div>;
          })}
        </CanvasDomain>)}</CanvasLod>
    </CanvasSurface>
    {state.focused && state.focusedRow ? <SlotModule id="value-inspector" slot="right-panel" label={state.labels.inspectorLabel}><aside data-studio-panel="inspector" aria-label={state.labels.inspectorLabel} className="p-md">
      {state.autosave ? <EditFeedback leaf={state.focused.fill.slot} state={state.autosave} labels={state.labels} /> : null}
      <Inspector candidate={state.focused} labels={state.labels} canReset={state.canReset} resolved={state.resolved} tier={(() => { const contract = state.catalog.slots.find(slot => slot.id === state.focused?.fill.slot)?.contract; return contract?.kind === "token" ? contract.tier : undefined; })()} onReset={state.reset} />
    </aside></SlotModule> : null}
    <CanvasModules canvas={canvas} labels={state.labels} explorer={<CanvasExplorer labels={state.labels} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter}
      libraries={state.sources.map(id => { const board = state.boards.find(board => board.id === state.slotId || board.leaves.includes(state.slotId)); return { id, available: (board ? [board] : state.boards).some(board => board.rows.some(row => row.candidates.some(candidate => candidate.source === id && (candidate.fill.sourceAddress !== "" || candidate.members.length > 0)))) }; })}>
      <SlotTree nodes={state.tree} placements={state.activeCatalog.placements} counts={state.counts} memberCount={state.labels.memberCount} label={state.labels.treeLabel} slotId={state.slotId} onSelect={id => reveal(id)} />
    </CanvasExplorer>} />
  </div>;
}

export function StudioCanvas(props: StudioCanvasProps) { return useWholeStudio() ? <WholeStudioCanvas {...props} /> : <LegacyStudioCanvas {...props} />; }
