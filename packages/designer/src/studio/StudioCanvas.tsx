"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Banner } from "../atoms/Banner.js";
import { Button } from "../atoms/Button.js";
import { SearchField } from "../atoms/SearchField.js";
import { UI_ALPHA_DISABLED, UI_ELEVATION_FLOATING, UI_Z_POPOVER } from "../atoms/internal/ui-vars.js";
import { cx } from "../atoms/internal/cx.js";
import { TOKENS } from "../tokens/tokens.js";
import { Board } from "./Board.js";
import { boardMatches, boardSources, canvasDomains, type CanvasFilter } from "./canvas-model.js";
import { createStudioCamera, type StudioCamera } from "./camera.js";
import { Inspector } from "./Inspector.js";
import { SlotTree } from "./SlotTree.js";
import { candidatesCss } from "./preview-css.js";
import { useStudioSession } from "./StudioProvider.js";
import type { MatrixRow } from "./matrix-model.js";
import type { Candidate } from "./model.js";
import type { StudioCanvasProps } from "./types.js";

const variable = (key: keyof typeof TOKENS): string => "var(" + key + ", " + TOKENS[key]!.value + ")";
const length = (value: CSSProperties["insetBlockStart"], fallback: string): string => typeof value === "number" ? value + "px" : value ?? fallback;
const FILTERS: readonly CanvasFilter[] = ["all", "pending", "warnings", "undecided", "differs"];

/** Floating controls surround a single transformed world; camera motion never enters React state. */
export function StudioCanvas({ panelInsets, className }: StudioCanvasProps) {
  const state = useStudioSession(); const latest = useRef(state); latest.current = state;
  const viewport = useRef<HTMLDivElement>(null); const world = useRef<HTMLDivElement>(null); const camera = useRef<StudioCamera | null>(null);
  const zoomText = useRef<HTMLOutputElement>(null); const mapViewport = useRef<SVGRectElement>(null);
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState<CanvasFilter>("all");
  const [explorerOpen, setExplorerOpen] = useState(true); const [inspectorOpen, setInspectorOpen] = useState(false); const [narrow, setNarrow] = useState(false);
  const explorerTrigger = useRef<HTMLButtonElement | null>(null); const inspectorTrigger = useRef<HTMLElement | null>(null); const suppressInspector = useRef(false);
  const boardRefs = useRef(new Map<string, (element: HTMLElement | null) => void>()); const openActions = useRef(new Map<string, () => void>());
  const hintId = useId(); const text = state.labels.canvas; const enabled = Boolean(state.ready);
  const domains = useMemo(() => canvasDomains(state.catalog, state.boards), [state.catalog, state.boards]);
  const summaries = useMemo(() => new Map(state.boards.map(board => {
    const findings = state.summary?.issues.filter(issue => issue.slotId !== undefined && board.leaves.includes(issue.slotId)).map(issue => issue.finding) ?? [];
    return [board.id, { errors: findings.filter(finding => finding.severity === "error").length, warnings: findings.filter(finding => finding.severity === "notice").length, sources: state.working ? boardSources(board, state.working) : [] }];
  })), [state.boards, state.summary, state.working]);
  const registerRow = useCallback((id: string, element: HTMLTableRowElement | null) => { const elements = latest.current.rowElements.current; if (element) elements.set(id, element); else elements.delete(id); }, []);
  const expand = useCallback((id: string) => latest.current.setExpanded(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; }), []);
  const use = useCallback((row: MatrixRow, source: string) => latest.current.use(row, source), []);
  const focusCell = useCallback((row: MatrixRow, candidate: Candidate) => {
    latest.current.setFocusedCell(current => current.row === row.id && current.source === candidate.source ? current : { row: row.id, source: candidate.source });
    if (suppressInspector.current) { suppressInspector.current = false; return; }
    const element = latest.current.rowElements.current.get(row.id);
    const cell = [...(element?.querySelectorAll<HTMLElement>("[data-studio-card]") ?? [])].find(cell => cell.dataset.studioCard === candidate.source);
    inspectorTrigger.current = cell?.querySelector<HTMLElement>("input[type=radio], [role=radio]") ?? element ?? null;
    setInspectorOpen(true);
  }, []);
  const reveal = useCallback((id: string, focus = false) => {
    const current = latest.current; current.setSlotId(id);
    const group = current.groups.find(group => group.id === id);
    const board = current.boards.find(board => board.id === id || board.leaves.includes(id) || group?.leaves.some(leaf => board.leaves.includes(leaf)));
    const target = current.boardElements.current.get(id) ?? current.rowElements.current.get(id) ?? (board ? current.boardElements.current.get(board.id) : undefined);
    if (target) camera.current?.flyTo(target, { focus, ...(current.rowElements.current.has(id) ? { zoom: 1 } : {}) });
    if (focus) { setQuery(""); setFilter("all"); current.setFocusedCell({ row: id }); }
  }, []);
  useEffect(() => { state.canvasActions.current = { reveal }; return () => { state.canvasActions.current = null; }; }, [state.canvasActions, reveal]);
  useEffect(() => {
    if (!enabled || !viewport.current || !world.current) return;
    const host = viewport.current; const content = world.current; const stored = state.cameras.current.get("tokens");
    const controller = createStudioCamera({ viewport: host, world: content, ...(stored ? { initial: stored } : {}), onPose: pose => {
      latest.current.cameras.current.set("tokens", pose);
      if (zoomText.current) zoomText.current.textContent = latest.current.labels.canvas.zoom(pose.zoom * 100);
      if (mapViewport.current) {
        const width = content.offsetWidth || content.scrollWidth || host.clientWidth || 1; const height = content.offsetHeight || content.scrollHeight || host.clientHeight || 1;
        mapViewport.current.setAttribute("x", String(-pose.x / pose.zoom / width * 100)); mapViewport.current.setAttribute("y", String(-pose.y / pose.zoom / height * 60));
        mapViewport.current.setAttribute("width", String(host.clientWidth / pose.zoom / width * 100)); mapViewport.current.setAttribute("height", String(host.clientHeight / pose.zoom / height * 60));
        const hostRect = host.getBoundingClientRect();
        mapViewport.current.parentElement?.querySelectorAll<SVGRectElement>("[data-studio-map-board]").forEach(cell => {
          const element = latest.current.boardElements.current.get(cell.dataset.studioMapBoard ?? ""); if (!element) return; const rect = element.getBoundingClientRect();
          cell.setAttribute("x", String((rect.left - hostRect.left - pose.x) / pose.zoom / width * 100)); cell.setAttribute("y", String((rect.top - hostRect.top - pose.y) / pose.zoom / height * 60));
          cell.setAttribute("width", String(rect.width / pose.zoom / width * 100)); cell.setAttribute("height", String(rect.height / pose.zoom / height * 60));
        });
      }
    } });
    camera.current = controller; if (!stored) controller.fit();
    const resize = (): void => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const breakpoint = parseFloat(TOKENS["--breakpoint-tablet-lg"]!.value) * rem;
      if (host.clientWidth > 0) setNarrow(host.clientWidth < breakpoint);
      controller.pan(0, 0);
    };
    resize(); const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : undefined; observer?.observe(host);
    return () => { observer?.disconnect(); controller.destroy(); camera.current = null; };
  }, [enabled, state.cameras]);
  useEffect(() => { camera.current?.pan(0, 0); }, [state.rows, state.labels]);
  const closeInspector = (): void => { setInspectorOpen(false); suppressInspector.current = true; inspectorTrigger.current?.focus({ preventScroll: true }); };
  const inset = variable("--spacing-md"); const top = length(panelInsets?.blockStart, inset); const bottom = length(panelInsets?.blockEnd, inset); const start = length(panelInsets?.inlineStart, inset); const end = length(panelInsets?.inlineEnd, inset);
  const panel: CSSProperties = { position: "absolute", insetBlockStart: top, maxBlockSize: "calc(100% - " + top + " - " + bottom + ")", maxInlineSize: "calc(100% - " + start + " - " + end + ")", overflowY: "auto", zIndex: UI_Z_POPOVER, boxShadow: UI_ELEVATION_FLOATING };
  const panelClass = "rounded-surface border border-line-base bg-surface-base p-md";
  return <div data-studio="" data-layout={narrow ? "narrow" : "wide"} data-studio-canvas="" className={cx("relative min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-raised text-ink-primary", className)} style={{ blockSize: "100%", inlineSize: "100%" }}>
    {state.livePreview && state.live?.css ? <style data-studio-preview="">{state.live.css}</style> : null}
    {state.ready ? <style data-studio-candidates="">{candidatesCss(state.rows.flatMap(row => row.candidates))}</style> : null}
    {state.phase.status === "loading" ? <p role="status">{state.labels.loading}</p> : null}
    {state.phase.status === "error" ? <Banner variant="danger">{state.labels.loadFailed}</Banner> : null}
    {state.failure ? <Banner variant="danger">{state.labels.saveFailed[state.failure.reason]}{state.failure.findings?.length ? <ul>{state.failure.findings.map((finding, index) => <li key={index}>{finding.message}</li>)}</ul> : null}</Banner> : null}
    <div ref={element => { explorerTrigger.current = element?.querySelector("button") ?? null; }} data-studio-panel="explorer" className={explorerOpen ? panelClass : undefined} style={{ ...panel, insetInlineStart: start, inlineSize: explorerOpen ? variable("--ui-layout-sidebar-w") : undefined, maxBlockSize: "calc(100% - " + top + " - " + bottom + " - " + variable("--ui-layout-sidebar-w") + " * .75)" }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setExplorerOpen(false); explorerTrigger.current?.focus(); } }}>
      <Button variant="ghost" size="sm" aria-expanded={explorerOpen} onPress={() => setExplorerOpen(current => !current)}>{explorerOpen ? text.explorerClose : text.explorerOpen}</Button>
      {explorerOpen ? <div className="flex flex-col gap-md">
        <SearchField label={text.search} value={query} onChange={setQuery} />
        <div className="flex flex-wrap gap-xs">{FILTERS.map(key => <Button key={key} variant={filter === key ? "secondary" : "ghost"} size="sm" aria-pressed={filter === key} onPress={() => setFilter(key)}>{text.filters[key]}</Button>)}</div>
        <SlotTree nodes={state.tree} placements={state.catalog.placements.filter(placement => placement.layer === "tokens")} counts={state.counts} memberCount={state.labels.memberCount} label={state.labels.treeLabel} slotId={state.slotId} onSelect={id => reveal(id)} />
      </div> : null}
    </div>
    <div ref={viewport} role="region" aria-label={text.label} aria-describedby={hintId} tabIndex={0} data-studio-viewport="" className="absolute inset-0 overflow-hidden outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent">
      <p id={hintId} className="sr-only">{text.hint}</p>
      <div ref={world} data-studio-world="" className="flex w-max flex-col gap-3xl p-3xl">
        {domains.map(domain => <section key={domain.id} data-studio-domain={domain.id} aria-label={domain.label} className="flex items-start gap-2xl">
          <h2 className="text-body text-ink-secondary" style={{ writingMode: "vertical-rl", blockSize: variable("--ui-layout-sidebar-rail-w"), inlineSize: "calc(" + variable("--ui-layout-aside-w") + " * 2)", flexShrink: 0 }}>{domain.label}</h2>
          {domain.boards.map(board => {
            if (!boardRefs.current.has(board.id)) boardRefs.current.set(board.id, element => { const elements = latest.current.boardElements.current; if (element) elements.set(board.id, element); else elements.delete(board.id); });
            if (!openActions.current.has(board.id)) openActions.current.set(board.id, () => { const element = latest.current.boardElements.current.get(board.id); if (element) camera.current?.flyTo(element, { focus: true }); });
            const summary = summaries.get(board.id)!; const matches = state.working && state.pending ? boardMatches({ board, domain: domain.label, query, filter, working: state.working, changes: state.pending, groupChoices: state.groupChoices, warnings: summary.warnings }) : true;
            return <div key={board.id} data-studio-board-match={matches ? "" : undefined} data-studio-board-wrapper={board.id} style={{ opacity: matches ? undefined : UI_ALPHA_DISABLED }}>
              {state.working && state.pending ? <Board board={board} boardRef={boardRefs.current.get(board.id)!} summary={summary} onOpen={openActions.current.get(board.id)!} sources={state.sources} labels={state.labels} working={state.working} changes={state.pending} groups={state.groups} groupChoices={state.groupChoices} expanded={state.expanded} layout="wide" onExpand={expand} onUse={use} onRowElement={registerRow} onFocusCell={focusCell} /> : null}
            </div>;
          })}
        </section>)}
      </div>
    </div>
    {inspectorOpen && state.focused && state.focusedRow ? <aside data-studio-panel="inspector" aria-label={state.labels.inspectorLabel} className={panelClass} style={{ ...panel, insetInlineEnd: end, insetInlineStart: narrow ? start : undefined, inlineSize: narrow ? "auto" : variable("--ui-layout-aside-w") }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeInspector(); } }}>
      <Button variant="ghost" size="sm" onPress={closeInspector}>{text.inspectorClose}</Button>
      <Inspector candidate={state.focused} labels={state.labels} canReset={state.canReset} {...(state.resolved ? { resolved: state.resolved } : {})} tier={state.catalog.slots.find(slot => slot.id === state.focused?.fill.slot)?.contract.tier} onReset={state.reset} />
    </aside> : null}
    {enabled ? <>
      <nav data-studio-panel="minimap" aria-label={text.minimap} className={panelClass} style={{ position: "absolute", insetBlockEnd: bottom, insetInlineStart: start, inlineSize: variable("--ui-layout-sidebar-w"), zIndex: UI_Z_POPOVER }}>
        <svg role="img" aria-label={text.minimap} viewBox="0 0 100 60" className="block w-full overflow-hidden" style={{ aspectRatio: "5 / 3" }}>
          {domains.flatMap(domain => domain.boards.map(board => { const summary = summaries.get(board.id)!; const matches = state.working && state.pending ? boardMatches({ board, domain: domain.label, query, filter, working: state.working, changes: state.pending, groupChoices: state.groupChoices, warnings: summary.warnings }) : true; return <rect key={board.id} data-studio-map-board={board.id} fill="currentColor" className="text-ink-secondary" style={{ opacity: matches ? undefined : UI_ALPHA_DISABLED }}><title>{text.goToBoard(domain.label + " / " + board.label)}</title></rect>; }))}
          <rect ref={mapViewport} aria-hidden="true" fill="none" stroke="currentColor" className="text-accent" />
        </svg>
      </nav>
      <div data-studio-panel="zoom" className={cx(panelClass, "flex items-center gap-sm")} style={{ position: "absolute", insetInlineEnd: end, insetBlockEnd: bottom, zIndex: UI_Z_POPOVER }}>
        <Button variant="ghost" size="sm" onPress={() => camera.current?.zoom(1 / 1.2)}>{text.zoomOut}</Button><output ref={zoomText} aria-label={text.zoomLabel} />
        <Button variant="ghost" size="sm" onPress={() => camera.current?.zoom(1.2)}>{text.zoomIn}</Button><Button variant="ghost" size="sm" onPress={() => camera.current?.fit()}>{text.fit}</Button>
      </div>
    </> : null}
  </div>;
}
