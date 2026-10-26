'use client';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { arrangeCanvas, assertCanvasArrangement, type CanvasBody, type FlowBody, type CanvasSize, type FrameStageContract } from '../catalog-core/body-substrate.js';
import { CanvasSurface, type CanvasSurfaceActions } from '../blocks/canvas/CanvasSurface.js';
import type { RuntimeLayoutPort } from '../catalog-core/runtime-assembly.js';
import type { RuntimeCell } from '../catalog-core/runtime-ports.js';
import type { CompositeResolved } from '../catalog-core/types.js';
import type { Viewport } from '../blocks/canvas/models.js';
import { CanvasMap } from '../components/CanvasMap.js';
import { CanvasZoom, type CanvasZoomProps } from '../components/CanvasZoom.js';
import { SlotModule } from '../shell/FrameSlots.js';
import { frameSectionRefKey, type FrameStageSectionRef } from './frame-stage-ref.js';
export { frameSectionRefKey } from './frame-stage-ref.js';
export type { FrameStageSectionRef } from './frame-stage-ref.js';

interface FrameStageCommon<Section extends FrameStageSectionRef> {
  readonly 'aria-label': string;
  /** Produced only by the qualified selected renderer adapter, never serialized in the body. */
  readonly sectionNodes: Readonly<Record<string, { readonly label: string; readonly node: ReactNode }>>;
  readonly contract: FrameStageContract;
}
interface CanvasStageProps<Section extends FrameStageSectionRef> extends FrameStageCommon<Section> {
  readonly body: CanvasBody<Section>;
  /** Resolved from body.collapseBelow in the consumer's existing token profile. */
  readonly collapseBelowPx: number;
  readonly camera: { readonly viewport: Viewport; readonly onViewportChange: (value: Viewport) => void; readonly minZoom: number; readonly maxZoom: number; readonly fitPadding: number; readonly actionsRef?: Ref<CanvasSurfaceActions> };
  readonly modules?: { readonly map?: { readonly id: string; readonly label: string }; readonly zoom?: { readonly id: string; readonly labels: CanvasZoomProps['labels'] } };
  readonly currentBoardId?: string;
  readonly onCurrentBoardChange?: (id: string) => void;
}
interface FlowStageProps<Section extends FrameStageSectionRef> extends FrameStageCommon<Section> {
  readonly body: FlowBody<Section>;
  readonly layout: RuntimeLayoutPort<ReactNode>;
  readonly cell: RuntimeCell;
  readonly profile: CompositeResolved;
}
export type FrameStageProps<Section extends FrameStageSectionRef = FrameStageSectionRef> = CanvasStageProps<Section> | FlowStageProps<Section>;
/** The shared Frame Stage owns container measurement; flow keeps its selected Layout. */
export function FrameStage<Section extends FrameStageSectionRef>(props: FrameStageProps<Section>) {
  const { body, sectionNodes, contract } = props;
  const canvas = 'camera' in props ? props : undefined;
  const camera = canvas?.camera, modules = canvas?.modules;
  if (!contract.accepts.includes(body.kind)) throw new TypeError(`FrameStage requires an accepted ${body.kind} body`);
  if (body.kind === 'canvas') {
    if (!canvas || !Number.isFinite(canvas.collapseBelowPx) || canvas.collapseBelowPx <= 0) throw new TypeError('FrameStage requires its resolved breakpoint');
    assertCanvasArrangement(body.boards, body.arrangement);
    if (body.arrangement.kind === 'graph' || body.arrangement.kind === 'freeform') throw new TypeError('Canvas arrangement unavailable');
  }
  const references = body.kind === 'canvas' ? body.boards.map(board => board.section) : body.sections;
  const keys = references.map(frameSectionRefKey);
  if (new Set(keys).size !== keys.length) throw new TypeError('FrameStage duplicate selected Section');
  for (const key of keys) if (!sectionNodes[key]?.label.trim()) throw new TypeError('FrameStage selected Section unavailable');
  const host = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const measures = useRef(new Map<string, HTMLDivElement>());
  const actions = useRef<CanvasSurfaceActions | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [sizes, setSizes] = useState<Readonly<Record<string, CanvasSize>>>({});
  const [current, setCurrent] = useState<string>();
  const focusedBoard = useRef<string | undefined>(undefined);
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const measure = useCallback(() => {
    const stage = host.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const width = stage.clientWidth || rect.width, height = stage.clientHeight || rect.height;
    const nextSize = { width: Number.isFinite(width) ? Math.max(0, width) : 0, height: Number.isFinite(height) ? Math.max(0, height) : 0 };
    setSize(previous => previous.width === nextSize.width && previous.height === nextSize.height ? previous : nextSize);
    const next: Record<string, CanvasSize> = {};
    for (const [id, node] of measures.current) {
      // offset dimensions remain unscaled; transformed client rectangles do not.
      const width = node.offsetWidth, height = node.offsetHeight;
      if (width > 0 && height > 0) next[id] = { width, height };
    }
    setSizes(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const measureRefs = useRef(new Map<string, (node: HTMLDivElement | null) => void>());
  const measureRef = (id: string) => {
    let callback = measureRefs.current.get(id);
    if (!callback) {
      callback = node => {
        const previous = measures.current.get(id);
        if (previous === node) return;
        if (previous) observer.current?.unobserve?.(previous);
        if (node) { measures.current.set(id, node); observer.current?.observe(node); }
        else measures.current.delete(id);
        if (observer.current) measure();
      };
      measureRefs.current.set(id, callback);
    }
    return callback;
  };
  useLayoutEffect(() => {
    const stage = host.current;
    if (!stage) return;
    measure();
    observer.current = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer.current?.observe(stage); for (const node of measures.current.values()) observer.current?.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer.current?.disconnect(); observer.current = undefined; window.removeEventListener('resize', measure); };
  }, [measure]);
  const measured = body.kind === 'canvas' && body.boards.every(board => sizes[board.id]);
  const layout = useMemo(() => body.kind === 'canvas' && measured ? arrangeCanvas(body.boards, Object.fromEntries(body.boards.map(board => [board.id, sizes[board.id]!])), body.arrangement) : undefined, [body, sizes, measured]);
  const ready = layout?.status === 'ready' ? layout : undefined;
  const narrow = !!canvas && size.width < canvas.collapseBelowPx;
  const flowing = narrow || !ready;
  const order = body.kind === 'canvas' ? ready?.readingOrder ?? body.boards.map(board => board.id) : [];
  const active = canvas?.currentBoardId ?? current;
  const setActions = useCallback((value: CanvasSurfaceActions | null) => {
    actions.current = value;
    if (typeof camera?.actionsRef === 'function') camera.actionsRef(value);
    else if (camera?.actionsRef) camera.actionsRef.current = value;
  }, [camera?.actionsRef]);
  const keydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const boardRegion = target.closest<HTMLElement>('[data-frame-stage-board] > section');
    if (target !== boardRegion) return;
    if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const id = target.closest<HTMLElement>('[data-frame-stage-board]')?.dataset.frameStageBoard;
    if (!id) return;
    const index = order.indexOf(id), next = order[index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)];
    event.preventDefault(); event.stopPropagation();
    if (next) elements.current.get(next)?.focus({ preventScroll: true });
  };
  const bounds = ready?.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  if ('layout' in props) {
    const slots: Record<string, ReactNode[]> = {};
    for (const reference of props.body.sections) (slots[reference.slot] ??= [])[reference.index] = sectionNodes[frameSectionRefKey(reference)]!.node;
    if (Object.values(slots).some(nodes => Object.keys(nodes).length !== nodes.length)) throw new TypeError('FrameStage selected Section slots must be dense');
    return <div ref={host} role="region" aria-label={props['aria-label']} aria-busy={size.width <= 0 || undefined} data-frame-stage="" data-frame-stage-scroll={contract.scroll} data-frame-stage-layout="flow" className="relative min-h-0 min-w-0" style={{ overflow: contract.scroll === 'region' ? 'auto' : 'visible', height: contract.scroll === 'region' ? '100%' : 'auto' }}>
      {size.width > 0 ? props.layout.render({ slots, cell: props.cell, profile: props.profile, stageWidth: size.width }) : null}
    </div>;
  }
  if (body.kind !== 'canvas' || !canvas || !camera) throw new TypeError('FrameStage canvas inputs unavailable');
  const canvasSize = { width: Math.max(1, size.width), height: Math.max(1, size.height) };
  return <div ref={host} data-frame-stage="" data-frame-stage-scroll={contract.scroll} className="relative h-full min-h-0 min-w-0" onKeyDownCapture={keydown}>
    <CanvasSurface aria-label={props['aria-label']} viewport={camera.viewport} onViewportChange={camera.onViewportChange} selection={[]} onSelectionChange={() => {}}
      worldBounds={{ ...bounds, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }} items={[]} itemInteraction="content" contentLayout={flowing ? 'flow' : 'positioned'} contentScroll={contract.scroll}
      viewSize={canvasSize} minZoom={camera.minZoom} maxZoom={camera.maxZoom} fitPadding={flowing ? 0 : camera.fitPadding} actionsRef={setActions} grid="dots">
      <div role="list" aria-label={props['aria-label']} data-frame-stage-layout={flowing ? 'flow' : body.arrangement.kind} data-frame-stage-bounds={`${bounds.width},${bounds.height}`}
        className={flowing ? 'flex flex-col items-start gap-md' : 'relative'} style={flowing ? undefined : { width: bounds.width, height: bounds.height }}>
        {order.map(id => {
          const board = body.boards.find(board => board.id === id)!;
          const selected = sectionNodes[frameSectionRefKey(board.section)]!, position = ready?.positions.find(item => item.id === board.id);
          return <div key={board.id} role="listitem" data-frame-stage-board={board.id} className={flowing ? 'relative max-w-full' : 'absolute'} style={flowing || !position ? undefined : { left: position.x, top: position.y }}>
            <section aria-label={selected.label} tabIndex={board.id === (active ?? order[0]) ? 0 : -1}
              ref={node => { if (node) elements.current.set(board.id, node); else elements.current.delete(board.id); }}
              onFocus={event => {
                const target = event.target as HTMLElement;
                // React portals bubble synthetically; only physical stage descendants belong here.
                if (!event.currentTarget.contains(target)) return;
                if (focusedBoard.current !== board.id) { focusedBoard.current = board.id; setCurrent(board.id); canvas.onCurrentBoardChange?.(board.id); }
                if (flowing) { target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); return; }
                const stageRect = host.current!.getBoundingClientRect(), targetRect = target.getBoundingClientRect();
                if (target === event.currentTarget || targetRect.left < stageRect.left || targetRect.top < stageRect.top || targetRect.right > stageRect.right || targetRect.bottom > stageRect.bottom) actions.current?.flyTo(target);
              }}>
              <div data-frame-stage-measure={board.id} className="w-max" ref={measureRef(board.id)}>{selected.node}</div>
            </section>
          </div>;
        })}
      </div>
    </CanvasSurface>
    {!flowing && modules?.map ? <SlotModule id={modules.map.id} slot="dock-tab" label={modules.map.label}><CanvasMap label={modules.map.label} items={ready!.positions.map(item => ({ id: item.id, rect: item }))} bounds={bounds} viewport={camera.viewport} viewSize={canvasSize} onViewportChange={camera.onViewportChange} /></SlotModule> : null}
    {!flowing && modules?.zoom ? <SlotModule id={modules.zoom.id} slot="dock-strip" label={modules.zoom.labels.group}><CanvasZoom value={camera.viewport.zoom} min={camera.minZoom} max={camera.maxZoom} labels={modules.zoom.labels} onChange={value => actions.current?.zoom(value / camera.viewport.zoom)} onFit={() => actions.current?.fit()} /></SlotModule> : null}
  </div>;
}
