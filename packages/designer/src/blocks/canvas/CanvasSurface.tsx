import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Button } from "../../atoms/Button.js";
import { cx } from "../../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../../atoms/internal/ui-vars.js";
import {
  clamp, clearSelection, fitTo, minimapModel, navigate, panBy, selectMarquee, selectRange,
  selectSingle, toggleSelection, toWorld, validateCanvasItems, zoomAt,
  type CanvasDirection, type CanvasItem, type CanvasPoint, type CanvasRect, type CanvasSize, type Selection, type Viewport,
} from "./models.js";

export interface CanvasSurfaceProps {
  "aria-label": string;
  viewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  worldBounds: CanvasRect;
  items: readonly CanvasItem[];
  /** World-layer decoration (for example connectors), rendered once behind the item buttons. */
  children?: ReactNode;
  /** Passive content inside each generated button; never nest interactive controls. Defaults to label. */
  renderItem?: (item: CanvasItem) => ReactNode;
  /** Optional explicit screen dimensions; otherwise measured with ResizeObserver and a resize fallback. */
  viewSize?: CanvasSize;
  minimap?: boolean;
  zoomControls?: boolean;
  minZoom?: number;
  maxZoom?: number;
  fitPadding?: number;
  /** Keyboard and gesture help. @default "Arrow keys move item focus. Shift and arrows extend selection. Plus and minus zoom; zero or Home fits. Escape clears selection. Drag empty space or hold Space to pan; Shift and drag selects." */
  instructionText?: string;
  /** Minimap accessible name. @default "Recenter canvas" */
  recenterLabel?: string;
  /** Zoom control group name. @default "Canvas zoom" */
  zoomGroupLabel?: string;
  /** Zoom out accessible name. @default "Zoom out" */
  zoomOutLabel?: string;
  /** Percentage output accessible name. @default "Canvas zoom percentage" */
  zoomPercentageLabel?: string;
  /** Zoom in accessible name. @default "Zoom in" */
  zoomInLabel?: string;
  /** Fit action text. @default "Fit canvas" */
  fitLabel?: string;
  className?: string;
  style?: CSSProperties;
}

interface Drag { pointerId: number; kind: "pan" | "marquee"; start: CanvasPoint; last: CanvasPoint; viewport: Viewport }
interface Pinch { viewport: Viewport; center: CanvasPoint; distance: number }
function arrowDirection(key: string): CanvasDirection | undefined {
  switch (key) {
    case "ArrowLeft": return "left";
    case "ArrowRight": return "right";
    case "ArrowUp": return "up";
    case "ArrowDown": return "down";
    default: return undefined;
  }
}
const distance = (a: CanvasPoint, b: CanvasPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: CanvasPoint, b: CanvasPoint): CanvasPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const rectangle = (a: CanvasPoint, b: CanvasPoint): CanvasRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });

/** A controlled viewport and selection, with real DOM item focus and disposable transient gestures. */
export function CanvasSurface({
  "aria-label": label, viewport, onViewportChange, selection, onSelectionChange, worldBounds, items,
  children, renderItem, viewSize, minimap = false, zoomControls = false,
  minZoom = 0.1, maxZoom = 8, fitPadding = 0, className, style,
  instructionText = "Arrow keys move item focus. Shift and arrows extend selection. Plus and minus zoom; zero or Home fits. Escape clears selection. Drag empty space or hold Space to pan; Shift and drag selects.",
  recenterLabel = "Recenter canvas", zoomGroupLabel = "Canvas zoom", zoomOutLabel = "Zoom out",
  zoomPercentageLabel = "Canvas zoom percentage", zoomInLabel = "Zoom in", fitLabel = "Fit canvas",
}: CanvasSurfaceProps) {
  if (!label.trim()) throw new TypeError("CanvasSurface requires an accessible label.");
  validateCanvasItems(items);
  // Validate limits and viewport even when a gesture has not yet happened.
  clamp(viewport, minZoom, maxZoom);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const captureOwner = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const pointers = useRef(new Map<number, CanvasPoint>());
  const captured = useRef(new Set<number>());
  const drag = useRef<Drag | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const space = useRef(false);
  const suppressClick = useRef(false);
  const anchor = useRef<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [measured, setMeasured] = useState<CanvasSize | null>(null);
  const [marquee, setMarquee] = useState<CanvasRect | null>(null);
  const [fitting, setFitting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const instructionId = useId();
  const size = viewSize ?? measured ?? { width: 1, height: 1 };
  const map = minimapModel(worldBounds, viewport, size);
  // Also validates padding before a user invokes fit.
  if (!Number.isFinite(fitPadding) || fitPadding < 0) throw new RangeError("Canvas padding must be finite and nonnegative.");
  // Measured containers may collapse; retain one CSS pixel of fit area. Explicit sizes remain strict.
  const effectiveFitPadding = viewSize ? fitPadding : Math.min(fitPadding, Math.max(0, (Math.min(size.width, size.height) - 1) / 2));
  if (viewSize || measured) fitTo(worldBounds, size, effectiveFitPadding);
  const roving = items.some(item => item.id === focused) ? focused : items[0]?.id ?? null;
  const selectedIds = new Set(selection);

  const release = useCallback((pointerId: number) => {
    if (!captured.current.delete(pointerId)) return;
    // Retain the capture owner independently: React clears DOM refs before passive unmount cleanup.
    const node = captureOwner.current;
    // Capture may already have been lost through browser cancellation or DOM removal.
    if (node?.hasPointerCapture?.(pointerId)) node.releasePointerCapture(pointerId);
  }, []);
  const reset = useCallback(() => {
    for (const pointerId of captured.current) release(pointerId);
    captureOwner.current = null;
    pointers.current.clear(); drag.current = null; pinch.current = null;
  }, [release]);
  const cancel = useCallback(() => { reset(); setMarquee(null); }, [reset]);

  useEffect(() => {
    if (viewSize) return;
    const node = surfaceRef.current;
    if (!node) return;
    const measure = () => {
      const bounds = node.getBoundingClientRect();
      setMeasured({ width: Math.max(1, node.clientWidth || bounds.width), height: Math.max(1, node.clientHeight || bounds.height) });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [viewSize]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const change = (event: { matches: boolean }) => setReducedMotion(event.matches);
    change(media); media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const keyup = (event: globalThis.KeyboardEvent) => { if (event.key === " ") space.current = false; };
    const blur = () => { space.current = false; cancel(); };
    window.addEventListener("keyup", keyup); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keyup", keyup); window.removeEventListener("blur", blur); reset(); };
  }, [cancel, reset]);

  const local = (client: CanvasPoint): CanvasPoint => {
    const node = surfaceRef.current!, bounds = node.getBoundingClientRect();
    return { x: client.x - bounds.left - node.clientLeft, y: client.y - bounds.top - node.clientTop };
  };
  const capture = (pointerId: number) => {
    const node = surfaceRef.current;
    if (!node?.setPointerCapture || captured.current.has(pointerId)) return;
    node.setPointerCapture(pointerId); captureOwner.current = node; captured.current.add(pointerId);
  };
  const boundedZoom = (value: Viewport, point: CanvasPoint, factor: number) => {
    const zoom = Math.min(maxZoom, Math.max(minZoom, value.zoom * factor));
    return zoomAt(value, point, zoom / value.zoom);
  };

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest?.("[data-canvas-controls], [data-canvas-minimap], input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      event.preventDefault();
      setFitting(false);
      const bounds = node.getBoundingClientRect();
      const point = { x: event.clientX - bounds.left - node.clientLeft, y: event.clientY - bounds.top - node.clientTop };
      // Normalize line/page wheels; cap extreme deltas to keep every factor finite.
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      const factor = Math.exp(-Math.max(-1000, Math.min(1000, event.deltaY * units)) * 0.002);
      const zoom = Math.min(maxZoom, Math.max(minZoom, viewport.zoom * factor));
      onViewportChange(zoomAt(viewport, point, zoom / viewport.zoom));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [viewport, minZoom, maxZoom, onViewportChange, size.height]);

  const requestFit = () => {
    setFitting(!reducedMotion);
    const fitted = fitTo(worldBounds, size, effectiveFitPadding);
    const zoom = Math.min(maxZoom, Math.max(minZoom, fitted.zoom));
    onViewportChange({ x: size.width / 2 - (worldBounds.x + worldBounds.width / 2) * zoom,
      y: size.height / 2 - (worldBounds.y + worldBounds.height / 2) * zoom, zoom });
  };
  const requestZoom = (factor: number) => {
    setFitting(false); onViewportChange(boundedZoom(viewport, { x: size.width / 2, y: size.height / 2 }, factor));
  };
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    // A host's nested editor and the independent controls own their own keyboard input.
    if (target.closest("[data-canvas-controls], [data-canvas-minimap], input, textarea, select, a, [contenteditable]:not([contenteditable=false])") ||
      (target.closest("button") && !target.closest("[data-canvas-item]"))) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === " ") { event.preventDefault(); space.current = true; return; }
    const direction = arrowDirection(event.key);
    if (direction) {
      event.preventDefault();
      const current = target.closest<HTMLElement>("[data-canvas-item]")?.dataset.canvasItem ?? null;
      const next = navigate(items, current, direction);
      if (next) {
        setFocused(next); itemRefs.current.get(next)?.focus({ preventScroll: true });
        if (event.shiftKey) {
          const selected = new Set([...selection, ...(current ? [current] : []), next]);
          onSelectionChange(items.filter(item => selected.has(item.id)).map(item => item.id));
        }
      }
    } else if (event.key === "+" || event.key === "=") { event.preventDefault(); requestZoom(1.2); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); requestZoom(1 / 1.2); }
    else if (event.key === "0" || event.key === "Home") { event.preventDefault(); requestFit(); }
    else if (event.key === "Escape") { event.preventDefault(); cancel(); onSelectionChange(clearSelection()); }
  };

  const pointerdown = (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    const target = event.target as Element;
    if (event.button !== 0 || target.closest("[data-canvas-controls], [data-canvas-minimap], input, textarea, select, a, [contenteditable]:not([contenteditable=false])") ||
      (target.closest("button") && !target.closest("[data-canvas-item]"))) return;
    const onItem = !!target.closest("[data-canvas-item]");
    if (onItem && !space.current && event.pointerType !== "touch") return;
    if (pointers.current.size >= 2) return;
    if (!onItem) surfaceRef.current?.focus({ preventScroll: true });
    const point = local({ x: event.clientX, y: event.clientY });
    pointers.current.set(event.pointerId, point);
    // Touch starts with the item's implicit capture, so a stationary tap still clicks its native button.
    // Transfer to the surface only after dragging or once a second pointer starts a pinch.
    if (!onItem || space.current || event.pointerType !== "touch") capture(event.pointerId);
    setFitting(false);
    if (pointers.current.size === 2) {
      for (const pointerId of pointers.current.keys()) capture(pointerId);
      const [a, b] = [...pointers.current.values()] as [CanvasPoint, CanvasPoint];
      pinch.current = { viewport, center: midpoint(a, b), distance: distance(a, b) };
      drag.current = null; setMarquee(null); suppressClick.current = true;
    } else {
      drag.current = { pointerId: event.pointerId, kind: event.shiftKey && !space.current ? "marquee" : "pan", start: point, last: point, viewport };
      if (drag.current.kind === "marquee") setMarquee(rectangle(point, point));
    }
    // Preserve ordinary touch item activation; moved gestures suppress the resulting click.
    if (!onItem || space.current) event.preventDefault();
  };
  const pointermove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local({ x: event.clientX, y: event.clientY });
    pointers.current.set(event.pointerId, point);
    const zooming = pinch.current;
    if (zooming && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [CanvasPoint, CanvasPoint];
      if (zooming.distance === 0) { pinch.current = { ...zooming, center: midpoint(a, b), distance: distance(a, b) }; return; }
      const center = midpoint(a, b), factor = Math.max(Number.EPSILON, distance(a, b)) / zooming.distance;
      const scaled = boundedZoom(zooming.viewport, zooming.center, factor);
      onViewportChange(panBy(scaled, { x: center.x - zooming.center.x, y: center.y - zooming.center.y }));
      return;
    }
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.last = point;
    if (distance(point, gesture.start) > 3) { suppressClick.current = true; capture(event.pointerId); }
    if (gesture.kind === "pan") onViewportChange(panBy(gesture.viewport, { x: point.x - gesture.start.x, y: point.y - gesture.start.y }));
    else setMarquee(rectangle(gesture.start, point));
  };
  const pointerend = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!pointers.current.has(event.pointerId)) return;
    const gesture = drag.current;
    if (commit && gesture?.kind === "marquee" && gesture.pointerId === event.pointerId) {
      const end = local({ x: event.clientX, y: event.clientY });
      onSelectionChange(selectMarquee(items, rectangle(toWorld(gesture.viewport, gesture.start), toWorld(gesture.viewport, end))));
    }
    // End the whole gesture when either pinch pointer leaves, keeping capture ownership exact.
    cancel();
  };

  return <div ref={surfaceRef} role="region" aria-label={label} aria-describedby={instructionId}
    tabIndex={items.length ? -1 : 0} onKeyDown={keydown} onPointerDown={pointerdown} onPointerMove={pointermove}
    onPointerUp={event => pointerend(event, true)} onPointerCancel={event => pointerend(event, false)}
    onLostPointerCapture={event => { if (event.target === event.currentTarget && captured.current.has(event.pointerId)) cancel(); }}
    onClickCapture={event => {
      if (suppressClick.current) {
        suppressClick.current = false;
        if (event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
      }
    }}
    className={cx("relative h-full min-h-0 min-w-0 overflow-hidden rounded-control border border-line-base bg-surface-base text-ink-primary focus-visible:outline-2 focus-visible:outline-accent", className)}
    style={{ ...style, touchAction: "none", ...(viewSize ? { width: viewSize.width, height: viewSize.height, boxSizing: "content-box" } : {}) }}>
    <p id={instructionId} className="sr-only">{instructionText}</p>
    <div data-canvas-world="" dir="ltr" className={cx("absolute inset-0", fitting && !reducedMotion && "transition-transform motion-reduce:transition-none")}
      onTransitionEnd={event => { if (event.target === event.currentTarget) setFitting(false); }}
      style={{ transformOrigin: "0 0", transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        transitionDuration: fitting && !reducedMotion ? "var(--ui-duration-fast, 160ms)" : "0s", transitionTimingFunction: "var(--ease-default, ease)" }}>
      {children}
      {items.map(item => <button key={item.id} type="button" data-canvas-item={item.id} aria-label={item.label}
        aria-pressed={selectedIds.has(item.id)} tabIndex={item.id === roving ? 0 : -1}
        ref={node => { if (node) itemRefs.current.set(item.id, node); else itemRefs.current.delete(item.id); }}
        onFocus={() => setFocused(item.id)} onClick={event => {
          if (space.current) return;
          event.currentTarget.focus({ preventScroll: true });
          if (event.shiftKey) onSelectionChange(selectRange(items.map(value => value.id), anchor.current ?? item.id, item.id));
          else {
            anchor.current = item.id;
            onSelectionChange(event.ctrlKey || event.metaKey ? toggleSelection(selection, item.id) : selectSingle(item.id));
          }
        }}
        className="absolute rounded-control border border-line-base bg-surface-raised text-body-s text-ink-primary aria-pressed:border-accent focus-visible:outline-2 focus-visible:outline-accent"
        style={{ left: item.rect.x, top: item.rect.y, width: item.rect.width, height: item.rect.height, borderWidth: UI_BORDER_HAIRLINE }}>
        {renderItem ? renderItem(item) : item.label}
      </button>)}
    </div>
    {marquee && <div aria-hidden="true" data-canvas-marquee="" className="pointer-events-none absolute border border-accent bg-accent-tint"
      style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height, borderWidth: UI_BORDER_HAIRLINE }} />}
    {minimap && <button type="button" data-canvas-minimap="" aria-label={recenterLabel}
      className="absolute bottom-sm start-sm h-24 w-40 overflow-hidden rounded-control border border-line-base bg-surface-sunken focus-visible:outline-2 focus-visible:outline-accent"
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const unit = (value: number) => Math.min(1, Math.max(0, value));
        const x = event.detail && bounds.width ? unit((event.clientX - bounds.left) / bounds.width) : 0.5;
        const y = event.detail && bounds.height ? unit((event.clientY - bounds.top) / bounds.height) : 0.5;
        setFitting(false);
        onViewportChange({ x: size.width / 2 - (worldBounds.x + worldBounds.width * x) * viewport.zoom,
          y: size.height / 2 - (worldBounds.y + worldBounds.height * y) * viewport.zoom, zoom: viewport.zoom });
      }}>
      <span aria-hidden="true" className="pointer-events-none absolute border border-accent bg-accent-tint"
        style={{ left: `${map.visible.x * 100}%`, top: `${map.visible.y * 100}%`, width: `${map.visible.width * 100}%`, height: `${map.visible.height * 100}%`, borderWidth: UI_BORDER_HAIRLINE }} />
    </button>}
    {zoomControls && <div data-canvas-controls="" role="group" aria-label={zoomGroupLabel} className="absolute bottom-sm end-sm flex items-center gap-xs rounded-control bg-surface-raised p-xs">
      <Button size="sm" variant="ghost" aria-label={zoomOutLabel} onPress={() => requestZoom(1 / 1.2)}>−</Button>
      <output aria-label={zoomPercentageLabel} className="text-body-s tabular-nums">{Math.round(viewport.zoom * 100)}%</output>
      <Button size="sm" variant="ghost" aria-label={zoomInLabel} onPress={() => requestZoom(1.2)}>+</Button>
      <Button size="sm" variant="ghost" onPress={requestFit}>{fitLabel}</Button>
    </div>}
  </div>;
}
