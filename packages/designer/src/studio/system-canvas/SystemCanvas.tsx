"use client";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { CanvasLod, CANVAS_COUNTER_SCALED_TITLE } from "../../blocks/canvas/CanvasLod.js";
import { CanvasChipGrid, CanvasPlaced, type CanvasChipTone } from "../../blocks/canvas/CanvasPlaced.js";
import { CanvasSurface } from "../../blocks/canvas/CanvasSurface.js";
import type { CellLodTier } from "../../blocks/canvas/cell-lod.js";
import type { CanvasRect, CanvasSize, Viewport } from "../../blocks/canvas/models.js";
import type { LayerId, Placement } from "../../catalog-core/index.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { Badge } from "../../components/Badge.js";
import { Breadcrumb } from "../../components/Breadcrumb.js";
import { Button } from "../../components/Button.js";
import { cx } from "../../components/internal/cx.js";
import { Skeleton } from "../../components/Skeleton.js";
import { TOKENS } from "../../tokens/tokens.js";
import type { Candidate } from "../model.js";
import { CompactPreview } from "../previews.js";
import type { StudioLabels } from "../types.js";
import { readStudioMessage, studioCopyNeed, type StudioCopyBinding } from "../copy-binding.js";
import { StudioDataValue } from "../data-value.js";
import { viewRect, visibleBoards } from "../visible-rows.js";
import { trailAt } from "./breadcrumb.js";
import { litSet, type UsageEdge } from "./graph.js";
import { systemLayout, type SystemBoard, type SystemCell, type SystemMetrics } from "./layout.js";
import { cellTiers, liveCells, mountsLive, renderedTier } from "./lod.js";
import { planNavigation, type SystemTarget } from "./navigation.js";
import { clampZoom, systemStop, systemZoomRange, stopViewport, type SystemStop, type ZoomRange } from "./stops.js";

/** Host-supplied words; the canvas renders no copy of its own. */
export interface SystemCanvasLabels {
  /** The canvas region's accessible name. */
  label: string;
  /** Keyboard and gesture help for the canvas. */
  hint: string;
  /** The breadcrumb landmark's accessible name. */
  breadcrumb: string;
  /** Each layer row's name. */
  layers: Readonly<Record<LayerId, string>>;
}

/** What the host knows about one leaf; every field is optional. */
export interface SystemCellData {
  /** Display name; the leaf id otherwise. */
  readonly label?: string;
  /** The library the leaf's fill comes from, shown as a badge. */
  readonly source?: string;
  /** Status tone of the far-tier chip and the source badge. */
  readonly tone?: CanvasChipTone;
  /** A Tokens or Assets leaf's current candidate: its mid tier renders the existing compact specimen. */
  readonly candidate?: Candidate;
}

export interface SystemCanvasData {
  /** Catalog placements: one row per layer, one board per L1, one line per L2, one cell per leaf. */
  readonly placements: readonly Placement[];
  readonly cells?: Readonly<Record<string, SystemCellData>>;
}

export interface SystemCanvasHandle {
  /** Move the camera to a rail target (D5g): one eased move, or none when it is already on screen. */
  navigateTo(target: SystemTarget): void;
  fit(stop: SystemStop, target?: SystemTarget): void;
  setViewport(viewport: Viewport): void;
}

export interface SystemCanvasView { readonly viewport: Viewport; readonly size: CanvasSize; readonly range: ZoomRange; readonly layer?: LayerId; readonly board?: string; readonly line?: string }
export interface SystemCanvasProps {
  readonly copy: StudioCopyBinding;
  renderStaticThumbnail?: (leaf: string) => ReactNode;
  onViewChange?: (view: SystemCanvasView) => void;
  data: SystemCanvasData;
  labels: SystemCanvasLabels;
  /** Usage edges, `from` uses `to`; the selected leaf lights its transitive neighbours and dims the rest. */
  edges?: readonly UsageEdge[];
  selectedLeaf?: string;
  onSelect?: (leaf: string) => void;
  /** A live specimen for a near cell inside the budget. Never called for Sections or Frames. */
  renderSpecimen?: (leaf: string) => ReactNode;
  /** A rest-state thumbnail for any layer; Tokens and Assets may use their compact candidate specimen. */
  renderThumbnail?: (leaf: string) => ReactNode;
  /** Labels for the existing compact specimens. */
  studioLabels?: StudioLabels;
  handleRef?: Ref<SystemCanvasHandle>;
  /** Explicit screen size; measured otherwise. */
  viewSize?: CanvasSize;
  metrics?: SystemMetrics;
  className?: string;
}

const defaultRowWidth = () => Number.parseFloat(TOKENS["--spacing-6xl"]!.value);
const ms = (token: string) => Number.parseFloat(TOKENS[token]!.value);
const px = (token: string) => Number.parseFloat(TOKENS[token]!.value);
/** The camera move: the default duration on the ease-out curve (a dedicated canvas-move token is a recorded NEED). */
const MOVE = { duration: "var(--ui-duration-default)", easing: "var(--ease-decelerate)" } as const;
const MOVE_TOKEN = "--ui-duration-default";
/** How long the arrival ring stays (a dedicated arrival token is a recorded NEED). */
const RING_TOKEN = "--ui-duration-deliberate";
const THUMBNAIL_LAYERS: ReadonlySet<LayerId> = new Set(["tokens", "assets"]);

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const change = (event: { matches: boolean }) => setReduced(event.matches);
    change(media); media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return reduced;
}

function useMeasured(explicit: CanvasSize | undefined): [CanvasSize | undefined, (element: HTMLDivElement | null) => void] {
  const [measured, setMeasured] = useState<CanvasSize>();
  const observer = useRef<ResizeObserver | null>(null);
  const onElement = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect(); observer.current = null;
    if (!element || explicit) return;
    const measure = () => { if (element.clientWidth > 0 && element.clientHeight > 0) setMeasured({ width: element.clientWidth, height: element.clientHeight }); };
    measure();
    if (typeof ResizeObserver !== "undefined") { observer.current = new ResizeObserver(measure); observer.current.observe(element); }
  }, [explicit]);
  return [explicit ?? measured, onElement];
}

/**
 * The whole design system on one canvas (Designer D5f/D5g): five layer rows of
 * boards, each a ragged grid of cells whose detail follows their on-screen
 * size. Off-screen boards mount nothing; far boards draw one chip grid; at
 * most the live budget of near cells mount a specimen. Rail targets arrive
 * through `navigateTo`, as one eased camera move whose detail swap waits for
 * the move to end.
 */
export function SystemCanvas({ copy, data, labels, edges = [], selectedLeaf, onSelect, renderSpecimen, renderThumbnail, renderStaticThumbnail, onViewChange, studioLabels, handleRef, viewSize, metrics, className }: SystemCanvasProps) {
  if (!copy || typeof copy.locale !== "string" || !copy.locale || typeof copy.resolver !== "function") studioCopyNeed("studio.copy.binding");
  const layout = useMemo(() => systemLayout(data.placements, metrics), [data.placements, metrics]);
  const [size, onSurfaceElement] = useMeasured(viewSize);
  const padding = px("--spacing-xl");
  const range = useMemo(() => size ? systemZoomRange(layout, size, padding) : undefined, [layout, size, padding]);
  const [pose, setPose] = useState<Viewport>();
  const viewport = pose ?? (size ? systemStop(layout, size, padding) : { x: 0, y: 0, zoom: 1 });
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const reduced = useReducedMotion();
  /** The viewport the detail tiers follow; held at the move's start until the move ends. */
  const [held, setHeld] = useState<Viewport>();
  const [ring, setRing] = useState<CanvasRect>();
  const moveTimer = useRef<ReturnType<typeof setTimeout>>(undefined), ringTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => { clearTimeout(moveTimer.current); clearTimeout(ringTimer.current); }, []);

  const endMove = useCallback(() => { clearTimeout(moveTimer.current); setHeld(undefined); }, []);
  const navigateTo = useCallback((target: SystemTarget) => {
    if (!size || !range) return;
    const plan = planNavigation(layout, target, viewportRef.current, size, padding, range);
    if (!plan) return;
    if (plan.select !== undefined) onSelect?.(plan.select);
    clearTimeout(ringTimer.current);
    setRing(plan.focus);
    ringTimer.current = setTimeout(() => setRing(undefined), ms(RING_TOKEN));
    const current = viewportRef.current;
    // A legibility-clamped board may exceed the stage: it cannot be wholly
    // revealed, but asking for its already-centred stop still moves nothing.
    if (!plan.move || (current.x === plan.viewport.x && current.y === plan.viewport.y && current.zoom === plan.viewport.zoom)) return;
    clearTimeout(moveTimer.current);
    if (reduced) { setHeld(undefined); setPose(plan.viewport); return; }
    // Read now: the updater runs during the next render, after the ref already holds the target.
    const from = viewportRef.current;
    setHeld(previous => previous ?? from);
    setPose(plan.viewport);
    // A transition that never reports its end (a hidden tab, a cancelled move) still releases the held detail.
    const fallback = ms(MOVE_TOKEN) * 2;
    moveTimer.current = setTimeout(endMove, fallback);
  }, [endMove, layout, onSelect, padding, range, reduced, size]);
  useImperativeHandle(handleRef, () => ({ navigateTo, setViewport: next => { endMove(); setPose({ ...next, zoom: range ? clampZoom(range, next.zoom) : next.zoom }); }, fit: (stop, target) => {
    if (!size || !range) return;
    const cell = target?.leaf ? layout.cells.get(target.leaf) : undefined;
    const board = cell ? layout.boards.get(cell.board) : target?.l1 ? layout.boards.get(target.layer + "/" + target.l1) : undefined;
    const row = layout.rows.find(row => row.layer === target?.layer);
    const rect = stop === "system" ? layout.bounds : stop === "cell" ? cell?.rect : stop === "board" ? board?.rect : row?.rect;
    if (rect) { const next = stopViewport(stop, rect, size, padding, range); const from = viewportRef.current;
      if (next.x === from.x && next.y === from.y && next.zoom === from.zoom) return;
      if (reduced) { endMove(); setPose(next); } else { clearTimeout(moveTimer.current); setHeld(previous => previous ?? from); setPose(next); moveTimer.current = setTimeout(endMove, ms(MOVE_TOKEN) * 2); }
    }
  } }), [navigateTo, endMove, layout, padding, range, size, reduced]);

  // Free wheel, pinch and pan arrive already clamped to the stop range by the surface.
  const changeViewport = useCallback((next: Viewport) => { endMove(); setPose(next); }, [endMove]);

  const lodViewport = held ?? viewport;
  const previousTiers = useRef<ReadonlyMap<string, CellLodTier>>(new Map());
  const tiers = useMemo(() => cellTiers(layout.cells.values(), lodViewport.zoom, previousTiers.current), [layout, lodViewport.zoom]);
  useEffect(() => { previousTiers.current = tiers; }, [tiers]);
  const shown = useMemo(() => {
    if (!size) return new Set<string>();
    const boards = [...layout.boards.values()];
    const now = visibleBoards(boards, viewport, size);
    if (held) for (const id of visibleBoards(boards, held, size)) now.add(id);
    return now;
  }, [layout, viewport, held, size]);
  const live = useMemo(() => size ? liveCells([...shown].flatMap(id => layout.boards.get(id)!.lines.flatMap(line => line.cells)), tiers, viewRect(lodViewport, size)) : new Set<string>(),
    [layout, shown, tiers, lodViewport, size]);
  const lit = useMemo(() => litSet(edges, selectedLeaf), [edges, selectedLeaf]);
  const dim = (leaf: string) => selectedLeaf !== undefined && !lit.has(leaf);
  const trail = size ? trailAt(layout, viewport, size) : {};
  const reportView = useRef(onViewChange); reportView.current = onViewChange;
  useEffect(() => { if (size && range) reportView.current?.({ viewport, size, range, layer: trail.layer, board: trail.board?.id, line: trail.line?.id }); }, [viewport.x, viewport.y, viewport.zoom, size?.width, size?.height, range?.min, range?.max, trail.layer, trail.board?.id, trail.line?.id]);

  const cellBody = (cell: SystemCell, tier: CellLodTier): ReactNode => {
    const info = data.cells?.[cell.leaf];
    if (tier === "near" && mountsLive(cell.layer) && renderSpecimen) { const specimen = renderSpecimen(cell.leaf); if (specimen != null) return specimen; }
    if (THUMBNAIL_LAYERS.has(cell.layer)) {
      const thumbnail = renderThumbnail?.(cell.leaf) ?? (info?.candidate && studioLabels ? <CompactPreview candidate={info.candidate} labels={studioLabels} /> : null);
      if (thumbnail) return thumbnail;
    }
    if (!THUMBNAIL_LAYERS.has(cell.layer)) {
      const thumbnail = renderStaticThumbnail?.(cell.leaf) ?? renderThumbnail?.(cell.leaf);
      // Rest previews remain inert: navigation and other interactive canvas
      // specimens cannot steal focus or expand the live interaction budget.
      if (thumbnail != null) return <div inert data-system-rest-preview="" className="min-h-0 flex-1 overflow-hidden">{thumbnail}</div>;
    }
    // No implementation or capture: retain the explicit pending skeleton.
    return <Skeleton shape="block" data-system-thumbnail="pending" className="min-h-0 flex-1" />;
  };

  const board = (entry: SystemBoard) => {
    const cells = entry.lines.flatMap(line => line.cells);
    const far = cells.filter(cell => renderedTier(cell.leaf, tiers, live) === "far");
    return [<CanvasPlaced key={entry.id} rect={entry.rect} data-system-board={entry.id} className="rounded-control border border-line-base bg-surface-base">
      <h3 className={cx(CANVAS_COUNTER_SCALED_TITLE, "truncate px-sm text-body-s font-body text-ink-primary")}>{readStudioMessage(copy,`studio.ia.board.${entry.id}`)}</h3>
    </CanvasPlaced>, far.length ? <CanvasChipGrid key={`${entry.id}#chips`} rect={entry.rect} data-system-chips={entry.id}
      chips={far.map(cell => ({ id: cell.leaf, rect: cell.rect, tone: data.cells?.[cell.leaf]?.tone ?? "neutral", dimmed: dim(cell.leaf) }))} /> : null];
  };
  const cellsOf = (entry: SystemBoard) => entry.lines.flatMap(line => {
    const visible = line.cells.filter(cell => renderedTier(cell.leaf, tiers, live) !== "far");
    if (!visible.length) return [];
    return [<CanvasPlaced key={line.id} rect={line.labelRect} data-system-line={line.id} className="flex items-center overflow-hidden">
      <span className={cx(CANVAS_COUNTER_SCALED_TITLE, "truncate text-caption text-ink-secondary")}>{readStudioMessage(copy,`studio.ia.line.${line.id}`)}</span>
    </CanvasPlaced>, ...visible.map(cell => {
      const tier = renderedTier(cell.leaf, tiers, live), info = data.cells?.[cell.leaf];
      return <CanvasPlaced key={cell.leaf} rect={cell.rect} dimmed={dim(cell.leaf)} data-system-cell={cell.leaf} data-system-tier={tier}
        data-selected={cell.leaf === selectedLeaf ? "" : undefined}
        className={cx("flex flex-col gap-xs overflow-hidden rounded-control border bg-surface-raised p-xs", cell.leaf === selectedLeaf ? "border-accent" : "border-line-base")}>
        <div className="flex min-w-0 items-center justify-between gap-xs">
          <Button variant="ghost" size="sm" className={cx(CANVAS_COUNTER_SCALED_TITLE, "min-w-0 truncate")} onPress={() => onSelect?.(cell.leaf)}>{readStudioMessage(copy,`studio.ia.item.${cell.leaf}`)}</Button>
          {info?.source ? <Badge variant={info.tone ?? "neutral"}><StudioDataValue kind="source" value={info.source}/></Badge> : null}
        </div>
        {cellBody(cell, tier)}
      </CanvasPlaced>;
    })];
  });

  const crumbs = trail.layer ? [labels.layers[trail.layer], trail.board?readStudioMessage(copy,`studio.ia.board.${trail.board.id}`):undefined, trail.line?readStudioMessage(copy,`studio.ia.line.${trail.line.id}`):undefined].filter((crumb): crumb is string => crumb !== undefined) : [];

  return <div className={cx("relative h-full min-h-0", className)} data-system-canvas="" data-system-lit={[...lit].sort().join(" ")}>
    <CanvasLod zoom={viewport.zoom}>
      <CanvasSurface aria-label={labels.label} instructionText={labels.hint} viewport={viewport} onViewportChange={changeViewport}
        selection={[]} onSelectionChange={() => {}} worldBounds={layout.bounds} items={[]} edgeItems={[...layout.cells.values()].map(cell => ({id:cell.leaf,label:readStudioMessage(copy,`studio.ia.item.${cell.leaf}`),rect:cell.rect}))} edges={edges.filter(edge => layout.cells.has(edge.from) && layout.cells.has(edge.to) && (!selectedLeaf || lit.has(edge.from) && lit.has(edge.to))).map((edge,index) => ({...edge,id:edge.from+":"+edge.to+":"+index}))} itemInteraction="content" grid="dots"
        {...(range ? { minZoom: range.min, maxZoom: range.max } : {})} fitPadding={padding} {...(viewSize ? { viewSize } : {})}
        {...(held && !reduced ? { viewportTransition: MOVE } : {})} onViewportTransitionEnd={endMove} onSurfaceElement={onSurfaceElement}
        className="absolute inset-0 rounded-none border-0 bg-surface-raised">
        {[...layout.boards.values()].filter(entry => shown.has(entry.id)).flatMap(entry => [...board(entry), ...cellsOf(entry)])}
        {layout.rows.map(row => <CanvasPlaced key={row.layer} aria-hidden="true" rect={{x:-viewport.x/viewport.zoom,y:row.rect.y,width:defaultRowWidth(),height:defaultRowWidth()}} className="pointer-events-none" data-system-row-label={row.layer}><SemanticContent as="span" className={cx(CANVAS_COUNTER_SCALED_TITLE,"rounded-control bg-surface-base text-body-s text-ink-primary")}>{labels.layers[row.layer]}</SemanticContent></CanvasPlaced>)}
        {ring ? <CanvasPlaced rect={ring} ring aria-hidden="true" data-system-ring="" className="pointer-events-none rounded-control" /> : null}
      </CanvasSurface>
    </CanvasLod>
    {crumbs.length ? <div className="pointer-events-none absolute start-md top-md rounded-control bg-surface-base px-sm py-xs" data-system-breadcrumb="">
      <Breadcrumb aria-label={labels.breadcrumb}>{crumbs.map((crumb, index) => <Breadcrumb.Item key={index}>{crumb}</Breadcrumb.Item>)}</Breadcrumb>
    </div> : null}
  </div>;
}
