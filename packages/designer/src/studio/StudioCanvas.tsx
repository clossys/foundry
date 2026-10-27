"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WholeStudioCanvas, useWholeStudio } from "./WholeStudio.js";
import { useFrameNotice } from "../frames/frame-notices.js";
import { CanvasExplorer } from "./CanvasExplorer.js";
import { CanvasModules } from "./CanvasModules.js";
import { cx } from "../components/internal/cx.js";
import { AssetExemptions } from "./AssetExemptions.js";
import { boardMatches, canvasDomains, type CanvasFilter } from "./canvas-model.js";
import { CanvasSurface } from "../blocks/canvas/CanvasSurface.js";
import { CanvasLod } from "../blocks/canvas/CanvasLod.js";
import { CanvasBoards, canvasPreviewPort, canvasSourceDigests } from "./canvas-boards.js";
import { prepareValueLibraryBoard, valueBoardPrompt } from "./prepared-library-boards.js";
import { runtimeHash } from "../catalog-core/runtime-ports.js";
import type { LibraryBoardCommand } from "../blocks/library-board/model.js";
import { useCanvasWorld } from "./useCanvasWorld.js";
import { Inspector } from "./Inspector.js";
import { ExplorerTree, LayerSelect } from "./rail/ExplorerTree.js";
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
  // A board's notice count feeds the explorer's "warnings" filter.
  const warnings = useMemo(() => new Map(state.boards.map(board => [board.id, state.summary?.issues.filter(issue => issue.slotId !== undefined && board.leaves.includes(issue.slotId) && issue.finding.severity === "notice").length ?? 0])), [state.boards, state.summary]);
  const registerRow = useCallback((id: string, element: HTMLElement | null) => { const elements = latest.current.rowElements.current; if (element) elements.set(id, element); else elements.delete(id); }, []);
  const registerBoard = useCallback((id: string, element: HTMLElement | null) => { const elements = latest.current.boardElements.current; if (element) elements.set(id, element); else elements.delete(id); }, []);
  // A board's reveal selects the row's leaf (the Inspector card fills) and focuses that cell.
  const focusCell = useCallback((row: MatrixRow, candidate: Candidate) => {
    latest.current.select(row.leaves.length === 1 ? row.leaves[0]! : row.id, false);
    latest.current.setFocusedCell(current => current.row === row.id && current.source === candidate.source ? current : { row: row.id, source: candidate.source });
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
  // Each board's preview identities bind to the exact documents this canvas renders for a source.
  const digests = useMemo(() => new Map(state.boards.map(board => [board.id, canvasSourceDigests(board.rows.flatMap(row => row.candidates.map(candidate => [candidate.source, candidate.fill] as const)))])), [state.boards]);
  const selectionHash = useMemo(() => state.resolved?.selectionHash ?? (state.working ? runtimeHash(state.working) : undefined), [state.resolved, state.working]);
  const boards = useMemo(() => state.working && state.pending && selectionHash ? domains.flatMap(domain => domain.boards.map(board => {
    const prepared = prepareValueLibraryBoard({ layer: state.layer, board, sources: state.catalog.sources, consumerSource: state.working!.source.id, selectionHash, sourceHashes: digests.get(board.id),
      mode: "view", canSave: false, pending: false, labels: state.labels, workflow: candidateWorkflow, contextTokens, variants });
    const matches = boardMatches({ board, domain: domain.label, query, filter, working: state.working!, changes: state.pending!, groupChoices: state.groupChoices, warnings: warnings.get(board.id) ?? 0 });
    return { id: board.id, domain: domain.id, hidden: !matches, records: prepared.records, previews: canvasPreviewPort(prepared.previews) };
  })) : [], [domains, digests, selectionHash, query, filter, warnings, state.working, state.pending, state.layer, state.catalog.sources, state.labels, state.groupChoices, candidateWorkflow, contextTokens, variants]);
  // Reveal is the board's only command: it focuses the row's chosen cell (else its first candidate) so the
  // inspector shows it. Nothing writes.
  const command = useCallback((input: LibraryBoardCommand) => {
    if (input.command !== "reveal") return;
    const row = latest.current.boards.find(board => board.id === input.boardId)?.rows.find(row => row.id === input.leafId);
    const candidate = row?.candidates.find(candidate => candidate.source === input.source) ?? row?.candidates.find(candidate => candidate.selected) ?? row?.candidates[0];
    if (row && candidate) { focusCell(row, candidate); return; }
    // A row not yet evaluated (off-screen until now): demand it; the inspector shows its chosen, else default, else first candidate.
    const current = latest.current; current.select(input.leafId); current.requestRow(input.leafId);
  }, [focusCell]);
  const focusedBoard = state.focusedRow ? state.boards.find(board => board.rows.includes(state.focusedRow!)) : undefined;
  const prompts = useMemo(() => {
    if (!focusedBoard || !state.focusedRow || !state.working) return undefined;
    const input = { board: focusedBoard, row: state.focusedRow, consumer: state.working.source.id, contextTokens, variants, workflow: candidateWorkflow, returnStep: state.labels.board.returnStep };
    return { create: valueBoardPrompt(input), ...(state.focusedRow.candidates.some(candidate => candidate.selected) ? { refresh: valueBoardPrompt(input, true) } : {}), ...(candidateWorkflow ? { workflow: candidateWorkflow } : {}) };
  }, [focusedBoard, state.focusedRow, state.working, contextTokens, variants, candidateWorkflow, state.labels.board.returnStep]);
  const inspector = state.selected && state.focused && state.focusedRow ? <aside data-studio-panel="inspector" aria-label={state.labels.inspectorLabel} className="min-w-0">
    <Inspector candidate={state.focused} labels={state.labels} resolved={state.resolved} tier={(() => { const contract = state.catalog.slots.find(slot => slot.id === state.focused?.fill.slot)?.contract; return contract?.kind === "token" ? contract.tier : undefined; })()} {...(prompts ? { prompts } : {})} />
  </aside> : <p data-studio-inspector-empty="" className="text-body-s text-ink-secondary">{state.labels.rail.inspectorEmpty}</p>;
  return <div data-studio-body="" className="relative flex h-full w-full min-h-0 min-w-0 flex-1">
    <div data-studio="" data-layout={narrow ? "narrow" : "wide"} data-studio-canvas="" data-frame-bleed="" className={cx("relative isolate h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-raised text-ink-primary", className)}>
    {state.layer === "assets" && state.summary ? <AssetExemptions findings={state.summary.issues.map(issue => issue.finding)} label={state.labels.assetExemption} /> : null}
    {state.ready ? <style data-studio-candidates="">{candidateStyles}</style> : null}
    {state.phase.status === "loading" ? <p role="status">{state.labels.loading}</p> : null}

    <CanvasLod zoom={canvas.pose.zoom}><CanvasSurface aria-label={text.label} viewport={canvas.pose} onViewportChange={canvas.setPose} selection={[]} onSelectionChange={() => {}}
      worldBounds={canvas.bounds} items={[]} itemInteraction="content" minZoom={.12} maxZoom={2}
      onSurfaceElement={canvas.onSurfaceElement} onWorldElement={canvas.onWorldElement} actionsRef={canvas.actions}
      worldClassName="flex h-max w-max flex-col gap-3xl p-3xl" className="absolute inset-0 rounded-none border-0 bg-surface-raised"
      instructionText={text.hint} grid="dots" recenterLabel={text.minimap}
      zoomOutLabel={text.zoomOut} zoomInLabel={text.zoomIn} zoomPercentageLabel={text.zoomLabel} fitLabel={text.fit}
      >
        <CanvasBoards boards={boards} labels={state.labels} workflow={candidateWorkflow} onCommand={command} onBoardElement={registerBoard} onRowElement={registerRow} />
    </CanvasSurface></CanvasLod>
    </div>
    <CanvasModules canvas={canvas} labels={state.labels} inspector={inspector} explorerHeader={<LayerSelect />} explorer={<CanvasExplorer labels={state.labels} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter}
      libraries={state.sources.map(id => { const board = state.boards.find(board => board.id === state.slotId || board.leaves.includes(state.slotId)); return { id, available: (board ? [board] : state.boards).some(board => board.rows.some(row => row.candidates.some(candidate => candidate.source === id && (candidate.fill.sourceAddress !== "" || candidate.members.length > 0)))) }; })}>
      <ExplorerTree query={query} />
    </CanvasExplorer>} />
  </div>;
}

export function StudioCanvas(props: StudioCanvasProps) { return useWholeStudio() ? <WholeStudioCanvas {...props} /> : <LegacyStudioCanvas {...props} />; }
