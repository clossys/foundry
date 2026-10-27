import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { Icon } from "../../components/Icon.js";
import { List } from "../../icons/List.js";
import { Info } from "../../icons/Info.js";
import { X } from "../../icons/X.js";
import { Button } from "../../components/Button.js";
import { cx } from "../../components/internal/cx.js";
import { PATTERN_RECIPES, patternBackground, type PatternRecipe } from "../../tokens/pattern.js";
import { UI_BORDER_HAIRLINE, UI_ELEVATION_FLOATING } from "../../components/internal/ui-vars.js";
import {
  clamp, clearSelection, fitTo, minimapModel, navigate, panBy, selectMarquee, selectRange,
  selectSingle, toggleSelection, toWorld, validateCanvasItems, zoomAt, wheelZoomFactor, gestureZoomFactor, CANVAS_ZOOM_REQUEST_EVENT,
  type CanvasDirection, type CanvasZoomRequestDetail, type CanvasItem, type CanvasPoint, type CanvasRect, type CanvasSize, type Selection, type Viewport,
} from "./models.js";

export interface CanvasSurfaceActions {
  read(): Viewport;
  pan(x: number, y: number): void;
  zoom(factor: number): void;
  fit(): void;
  flyTo(element: HTMLElement, options?: { focus?: boolean; zoom?: number }): void;
}

export interface CanvasOverlayInsets {
  blockStart?: CSSProperties["insetBlockStart"]; blockEnd?: CSSProperties["insetBlockEnd"];
  inlineStart?: CSSProperties["insetInlineStart"]; inlineEnd?: CSSProperties["insetInlineEnd"];
}
export interface CanvasOverlay {
  placement: "explorer" | "inspector";
  label: string;
  openLabel: string;
  closeLabel: string;
  content: ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}
export interface CanvasEdge { readonly id: string; readonly from: string; readonly to: string }
export interface CanvasSurfaceProps {
  "aria-label": string;
  viewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  worldBounds: CanvasRect;
  items: readonly CanvasItem[];
  /** Connect registered world items. Connector geometry and paint stay inside CanvasSurface. */
  edges?: readonly CanvasEdge[];
  /** World-layer decoration (for example connectors), rendered once behind the item buttons. */
  children?: ReactNode;
  /** Passive content inside each generated button; never nest interactive controls. Defaults to label. */
  renderItem?: (item: CanvasItem) => ReactNode;
  /** Content mode places host editors in structural item groups, never in buttons.
   * Native nested controls retain keyboard, pointer and wheel ownership.
   */
  itemInteraction?: "select" | "content";
  /** Flowing world content uses the same camera and gesture ownership as positioned items. */
  worldClassName?: string;
  /** Frame-owned narrow fallback retains mounted content and returns native document gestures. */
  contentLayout?: "positioned" | "flow";
  /** Flow fallback follows the selected Frame stage scroll contract. */
  contentScroll?: "region" | "document";
  onSurfaceElement?: (element: HTMLDivElement | null) => void;
  onWorldElement?: (element: HTMLDivElement | null) => void;
  actionsRef?: Ref<CanvasSurfaceActions>;
  /** Closed floating panel geometry. Insets are forwarded from the owning frame. */
  overlays?: readonly CanvasOverlay[];
  overlayInsets?: CanvasOverlayInsets;
  overlayLayout?: "wide" | "compact" | "narrow";
  /** Optional explicit screen dimensions; otherwise measured with ResizeObserver and a resize fallback. */
  viewSize?: CanvasSize;
  minimap?: boolean;
  zoomControls?: boolean;
  /** Camera-relative token grid; Studio uses this as its working surface. `dots` paints the `assets.pattern` dots recipe, `crosses` its grid recipe. */
  grid?: "dots" | "crosses";
  /** A selected `assets.pattern` recipe to paint instead of the `grid` default; only applies while `grid` is set. */
  gridPattern?: PatternRecipe;
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
export function CanvasSurface(props: CanvasSurfaceProps) {
  const {
  "aria-label": label, viewport, onViewportChange, selection, onSelectionChange, worldBounds, items, edges = [],
  children, renderItem, itemInteraction = "select", worldClassName, contentLayout = "positioned", contentScroll = "region", onSurfaceElement, onWorldElement, actionsRef, overlays = [], overlayInsets, overlayLayout = "wide", viewSize, minimap = false, zoomControls = false, grid, gridPattern,
  minZoom = 0.1, maxZoom = 8, fitPadding = 0, className, style,
  instructionText = "Arrow keys move item focus. Shift and arrows extend selection. Plus and minus zoom; zero or Home fits. Escape clears selection. Drag empty space or hold Space to pan; Shift and drag selects.",
  recenterLabel = "Recenter canvas", zoomGroupLabel = "Canvas zoom", zoomOutLabel = "Zoom out",
  zoomPercentageLabel = "Canvas zoom percentage", zoomInLabel = "Zoom in", fitLabel = "Fit canvas",
} = props;
  const inset = (value: CSSProperties["insetBlockStart"]): string => {
    if (value === undefined) return "var(--spacing-md)";
    if (typeof value === "number") { if (!Number.isFinite(value) || value < 0) throw new TypeError("Canvas frame inset must be finite and nonnegative"); return `${value}px`; }
    if (typeof value !== "string" || !value.trim() || /[;{}<>]|url\s*\(|expression\s*\(/i.test(value)) throw new TypeError("Canvas frame inset must be a safe CSS length");
    return value;
  };
  const topInset = inset(overlayInsets?.blockStart), bottomInset = inset(overlayInsets?.blockEnd), startInset = inset(overlayInsets?.inlineStart), endInset = inset(overlayInsets?.inlineEnd);
  const flowing = contentLayout === "flow";
  if (flowing && (itemInteraction !== "content" || items.length || edges.length)) throw new TypeError("Canvas flow requires Frame-owned content without positioned items");
  const collapsedMap = itemInteraction === "content" && overlayLayout === "narrow";
  const reserveControls = minimap && !collapsedMap ? "calc(var(--ui-layout-sidebar-w) * 3 / 5 + var(--spacing-md))" : zoomControls ? "calc(var(--ui-control-h-sm) + var(--spacing-md) * 2)" : "0px";
  if (new Set(overlays.map(panel => panel.placement)).size !== overlays.length || overlays.some(panel => !["explorer", "inspector"].includes(panel.placement))) throw new TypeError("Canvas overlays require unique closed placements");
  if (!label.trim()) throw new TypeError("CanvasSurface requires an accessible label.");
  validateCanvasItems(items);
  const itemById = new Map(items.map(item => [item.id, item]));
  if (new Set(edges.map(edge => edge.id)).size !== edges.length || edges.some(edge => !edge.id.trim() || !itemById.has(edge.from) || !itemById.has(edge.to))) throw new TypeError("Canvas edges require unique IDs and existing item endpoints");
  // Validate limits and viewport even when a gesture has not yet happened.
  clamp(viewport, minZoom, maxZoom);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  const previousPanels = useRef(new Map<string, boolean>());
  const previousOverlayLayout = useRef<"wide" | "compact" | "narrow">("wide");
  const focusPanelTrigger = (placement: string) => panelRefs.current.get(placement)?.querySelector<HTMLButtonElement>("[data-canvas-panel-toggle]")?.focus({ preventScroll: true });
  const changePanel = (panel: CanvasOverlay, open: boolean) => {
    if (open && overlayLayout !== "wide") for (const other of overlays) if (other !== panel && other.isOpen) other.onOpenChange(false);
    panel.onOpenChange(open);
  };
  useLayoutEffect(() => {
    if (overlayLayout !== "wide") {
      const opened = overlays.filter(panel => panel.isOpen);
      if (previousOverlayLayout.current === "wide") {
        // Collapse before the next paint; the icon controls remain in the stage and retain focus access.
        for (const panel of opened) {
          if (panelRefs.current.get(panel.placement)?.contains(document.activeElement)) focusPanelTrigger(panel.placement);
          panel.onOpenChange(false);
        }
      } else if (opened.length > 1) {
        const latest = opened.filter(panel => !previousPanels.current.get(panel.placement)).at(-1) ?? opened.at(-1);
        for (const panel of opened) if (panel !== latest) panel.onOpenChange(false);
      }
    }
    previousOverlayLayout.current = overlayLayout;
    previousPanels.current = new Map(overlays.map(panel => [panel.placement, panel.isOpen]));
  }, [overlays, overlayLayout]);
  const captureOwner = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
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
  const pendingWheel = useRef<Viewport | null>(null);
  const wheelState = useRef({ viewport, minZoom, maxZoom, onViewportChange, width: size.width, height: size.height });
  // The whole props object marks an authoritative host commit, including a rejection
  // that supplies the same viewport and callback. Internal focus/gesture state keeps its intent.
  useLayoutEffect(() => {
    wheelState.current = { viewport, minZoom, maxZoom, onViewportChange, width: size.width, height: size.height };
    pendingWheel.current = null;
  }, [props, size.width, size.height]);
  const requestViewport = (next: Viewport) => {
    pendingWheel.current = null;
    onViewportChange(next);
  };
  const neutralizeScroll = () => {
    const node = surfaceRef.current;
    if (node?.scrollLeft) node.scrollLeft = 0;
    if (node?.scrollTop) node.scrollTop = 0;
  };
  const focusItem = (item: CanvasItem) => {
    neutralizeScroll();
    setFocused(item.id);
    const reveal = (start: number, length: number, extent: number) => {
      // Preserve the existing two-pixel focus outline while retaining a pixel in tiny views.
      const inset = Math.min(2, Math.max(0, (extent - 1) / 2));
      if (length > extent - inset * 2 || start < inset) return inset - start;
      return Math.min(0, extent - inset - start - length);
    };
    const dx = reveal(item.rect.x * viewport.zoom + viewport.x, item.rect.width * viewport.zoom, size.width);
    const dy = reveal(item.rect.y * viewport.zoom + viewport.y, item.rect.height * viewport.zoom, size.height);
    pendingWheel.current = null;
    if (dx || dy) { setFitting(false); requestViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom }); }
  };

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
    pointers.current.clear(); drag.current = null; pinch.current = null; pendingWheel.current = null;
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
    const pointAt = (event: { clientX: number; clientY: number }) => {
      const bounds = node.getBoundingClientRect();
      return { x: event.clientX - bounds.left - node.clientLeft, y: event.clientY - bounds.top - node.clientTop };
    };
    const zoomBy = (point: CanvasPoint, factor: number) => {
      setFitting(false);
      const state = wheelState.current, base = pendingWheel.current ?? state.viewport;
      const zoom = Math.min(state.maxZoom, Math.max(state.minZoom, base.zoom * factor));
      const next = zoomAt(base, point, zoom / base.zoom);
      // Store before notifying: a synchronous host commit may accept, clamp, or reject it.
      pendingWheel.current = next;
      state.onViewportChange(next);
    };
    const wheel = (event: WheelEvent) => {
      if (flowing) return;
      const target = event.target as Element;
      // A modified wheel (trackpad pinch) is always the camera's, even over nested controls.
      const modified = event.ctrlKey || event.metaKey;
      if (!modified && itemInteraction === "content" && target.closest?.("button, a, [role=radio], [role=tab]")) return;
      if (!modified && target.closest?.("[data-canvas-controls], [data-canvas-minimap], [data-canvas-panel], input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      event.preventDefault();
      if (itemInteraction === "content" && !modified) {
        setFitting(false);
        const state = wheelState.current, base = pendingWheel.current ?? state.viewport;
        const next = panBy(base, { x: -event.deltaX, y: -event.deltaY });
        pendingWheel.current = next; state.onViewportChange(next); return;
      }
      zoomBy(pointAt(event), wheelZoomFactor(event.deltaY, event.deltaMode, wheelState.current.height));
    };
    // Safari trackpad pinch arrives as non-standard gesture events with a cumulative scale.
    let gestureScale = 1;
    const gesture = (event: Event) => {
      if (flowing) return;
      event.preventDefault();
      const scale = (event as Event & { scale?: number }).scale ?? 1;
      if (event.type === "gesturestart") { gestureScale = 1; return; }
      if (event.type === "gesturechange") zoomBy(pointAt(event as Event & { clientX: number; clientY: number }), gestureZoomFactor(scale, gestureScale));
      gestureScale = event.type === "gestureend" ? 1 : scale;
    };
    // A frame-level owner routes gestures from its chrome here, anchored at the surface center.
    const request = (event: Event) => {
      const factor = (event as CustomEvent<CanvasZoomRequestDetail>).detail?.factor;
      if (flowing || typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) return;
      zoomBy({ x: wheelState.current.width / 2, y: wheelState.current.height / 2 }, factor);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) node.addEventListener(type, gesture, { passive: false });
    node.addEventListener(CANVAS_ZOOM_REQUEST_EVENT, request);
    return () => {
      node.removeEventListener("wheel", wheel);
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) node.removeEventListener(type, gesture);
      node.removeEventListener(CANVAS_ZOOM_REQUEST_EVENT, request);
    };
  }, [itemInteraction, flowing]);

  const requestFit = () => {
    setFitting(!reducedMotion);
    const fitted = fitTo(worldBounds, size, effectiveFitPadding);
    const zoom = Math.min(maxZoom, Math.max(minZoom, fitted.zoom));
    // A world that still overflows at the zoom floor starts at its own origin on that axis rather than centring away its beginning.
    const axis = (origin: number, extent: number, view: number) => extent * zoom > view - effectiveFitPadding * 2 + 0.5
      ? effectiveFitPadding - origin * zoom : view / 2 - (origin + extent / 2) * zoom;
    requestViewport({ x: axis(worldBounds.x, worldBounds.width, size.width), y: axis(worldBounds.y, worldBounds.height, size.height), zoom });
  };
  const requestZoom = (factor: number) => {
    setFitting(false); requestViewport(boundedZoom(viewport, { x: size.width / 2, y: size.height / 2 }, factor));
  };
  useImperativeHandle(actionsRef, () => ({
    read: () => ({ ...viewport }),
    pan: (x, y) => requestViewport(panBy(viewport, { x, y })),
    zoom: requestZoom,
    fit: requestFit,
    flyTo: (element, options = {}) => {
      const host = surfaceRef.current;
      if (!host || !worldRef.current?.contains(element)) throw new TypeError("Canvas target must belong to its world");
      const rect = element.getBoundingClientRect(), bounds = host.getBoundingClientRect();
      const x = (rect.left - bounds.left - viewport.x) / viewport.zoom, y = (rect.top - bounds.top - viewport.y) / viewport.zoom;
      const zoom = Math.min(maxZoom, Math.max(minZoom, options.zoom ?? (options.focus ? 1 : viewport.zoom)));
      requestViewport({ x: size.width / 2 - (x + rect.width / viewport.zoom / 2) * zoom, y: size.height / 2 - (y + rect.height / viewport.zoom / 2) * zoom, zoom });
      if (options.focus) element.focus({ preventScroll: true });
    },
  }));
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (flowing) return;
    const target = event.target as Element;
    if (itemInteraction === "content" && target !== surfaceRef.current) return;
    // A host's nested editor and the independent controls own their own keyboard input.
    if (target.closest("[data-canvas-controls], [data-canvas-minimap], [data-canvas-panel], input, textarea, select, a, [contenteditable]:not([contenteditable=false])") ||
      (target.closest("button") && !target.closest("[data-canvas-item]"))) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === " ") { event.preventDefault(); space.current = true; return; }
    const direction = arrowDirection(event.key);
    if (direction) {
      event.preventDefault();
      if (itemInteraction === "content" && !items.length) {
        requestViewport(panBy(viewport, { x: direction === "left" ? size.width / 10 : direction === "right" ? -size.width / 10 : 0, y: direction === "up" ? size.height / 10 : direction === "down" ? -size.height / 10 : 0 }));
        return;
      }
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
    else if (event.key === "1") { event.preventDefault(); requestZoom(1 / viewport.zoom); }
    else if (event.key === "Escape") { event.preventDefault(); cancel(); onSelectionChange(clearSelection()); }
  };

  const pointerdown = (event: PointerEvent<HTMLDivElement>) => {
    if (flowing) return;
    suppressClick.current = false;
    const target = event.target as Element;
    if (itemInteraction === "content" && target.closest("button, a, [role=radio], [role=tab]")) return;
    if (event.button !== 0 || target.closest("[data-canvas-controls], [data-canvas-minimap], [data-canvas-panel], input, textarea, select, a, [contenteditable]:not([contenteditable=false])") ||
      (target.closest("button") && !target.closest("[data-canvas-item]"))) return;
    const onItem = !!target.closest("[data-canvas-item]");
    if (onItem && !space.current && event.pointerType !== "touch") return;
    if (pointers.current.size >= 2) return;
    pendingWheel.current = null;
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
      requestViewport(panBy(scaled, { x: center.x - zooming.center.x, y: center.y - zooming.center.y }));
      return;
    }
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.last = point;
    if (distance(point, gesture.start) > 3) { suppressClick.current = true; capture(event.pointerId); }
    if (gesture.kind === "pan") requestViewport(panBy(gesture.viewport, { x: point.x - gesture.start.x, y: point.y - gesture.start.y }));
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

  return <div ref={element => { surfaceRef.current = element; onSurfaceElement?.(element); }} role="region" aria-label={label} aria-describedby={instructionId}
    data-canvas-surface="" data-canvas-layout={contentLayout}
    onScroll={event => { if (!flowing && event.target === event.currentTarget) neutralizeScroll(); }}
    tabIndex={items.length ? -1 : 0} onKeyDown={keydown} onPointerDown={pointerdown} onPointerMove={pointermove}
    onPointerUp={event => pointerend(event, true)} onPointerCancel={event => pointerend(event, false)}
    onLostPointerCapture={event => { if (event.target === event.currentTarget && captured.current.has(event.pointerId)) cancel(); }}
    onClickCapture={event => {
      if (suppressClick.current) {
        suppressClick.current = false;
        if (event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
      }
    }}
    className={cx("relative isolate h-full min-h-0 min-w-0 overflow-hidden rounded-control border border-line-base bg-surface-base text-ink-primary focus-visible:outline-2 focus-visible:outline-accent", className)}
    /* Named inline-style exception: the camera-relative pattern layer (recipe from assets.pattern, offset by pan, scaled by zoom). */
    style={{ ...(grid && !flowing ? { ...patternBackground(gridPattern ?? PATTERN_RECIPES[grid === "dots" ? "dots" : "grid"], viewport.zoom), backgroundPosition: `${viewport.x}px ${viewport.y}px`, "--canvas-grid-zoom": viewport.zoom } : {}), ...style, touchAction: flowing ? "auto" : "none", overflow: flowing ? contentScroll === "document" ? "visible" : "auto" : "hidden", ...(viewSize ? { width: viewSize.width, height: flowing && contentScroll === "document" ? "auto" : viewSize.height, boxSizing: "content-box" } : {}) }}>
    <p id={instructionId} className="sr-only">{instructionText}</p>
    <div ref={element => { worldRef.current = element; onWorldElement?.(element); }} data-canvas-world="" dir="ltr" className={cx(flowing ? "relative" : "absolute inset-0", worldClassName, fitting && !reducedMotion && "transition-transform motion-reduce:transition-none")}
      onTransitionEnd={event => { if (event.target === event.currentTarget) setFitting(false); }}
      style={{ transformOrigin: "0 0", transform: flowing ? undefined : `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        transitionDuration: fitting && !reducedMotion ? "var(--ui-duration-fast, 160ms)" : "0s", transitionTimingFunction: "var(--ease-default, ease)" }}>
      {edges.length ? <svg data-canvas-edges="" aria-hidden="true" focusable="false" className="pointer-events-none absolute text-ink-muted"
        viewBox={`${worldBounds.x} ${worldBounds.y} ${worldBounds.width} ${worldBounds.height}`}
        style={{ left: worldBounds.x, top: worldBounds.y, width: worldBounds.width, height: worldBounds.height }}>
        {edges.map(edge => {
          const from = itemById.get(edge.from)!.rect, to = itemById.get(edge.to)!.rect;
          const x1 = from.x + from.width, y1 = from.y + from.height / 2, x2 = to.x, y2 = to.y + to.height / 2, middle = (x1 + x2) / 2;
          return <path key={edge.id} data-canvas-edge={edge.id} d={`M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`} fill="none" stroke="currentColor" strokeWidth={UI_BORDER_HAIRLINE} vectorEffect="non-scaling-stroke" />;
        })}
      </svg> : null}
      {children}
      {items.map(item => itemInteraction === "content" ? <section key={item.id} data-canvas-item={item.id} aria-label={item.label} tabIndex={item.id === roving ? 0 : -1}
        ref={node => { if (node) itemRefs.current.set(item.id, node); else itemRefs.current.delete(item.id); }}
        onFocus={event => { if (event.target === event.currentTarget) focusItem(item); }}
        className="absolute rounded-control border border-line-base bg-surface-raised text-body-s text-ink-primary focus-visible:outline-2 focus-visible:outline-accent"
        style={{ left: item.rect.x, top: item.rect.y, width: item.rect.width, height: item.rect.height, borderWidth: UI_BORDER_HAIRLINE }}>
        {renderItem ? renderItem(item) : item.label}
      </section> : <button key={item.id} type="button" data-canvas-item={item.id} aria-label={item.label}
        aria-pressed={selectedIds.has(item.id)} tabIndex={item.id === roving ? 0 : -1}
        ref={node => { if (node) itemRefs.current.set(item.id, node); else itemRefs.current.delete(item.id); }}
        onFocus={() => focusItem(item)} onClick={event => {
          if (space.current) return;
          event.currentTarget.focus({ preventScroll: true });
          if (event.shiftKey) {
            const order = items.map(value => value.id);
            const start = anchor.current !== null && order.includes(anchor.current) ? anchor.current : item.id;
            onSelectionChange(selectRange(order, start, item.id));
          }
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
    {overlays.map(panel => {
      const compactOpen = overlayLayout !== "wide" && panel.isOpen;
      const otherTrigger = overlays.some(other => other.placement !== panel.placement);
      const triggerReserve = "var(--ui-control-h-md) + var(--spacing-md)";
      const contentId = `${instructionId}-${panel.placement}`;
      return <div key={panel.placement} ref={node => { if (node) panelRefs.current.set(panel.placement, node); else panelRefs.current.delete(panel.placement); }} data-canvas-panel={panel.placement}
        onKeyDown={event => {
          if (event.key === "Escape" && !event.defaultPrevented && panel.isOpen) {
            event.stopPropagation(); changePanel(panel, false); focusPanelTrigger(panel.placement);
          }
        }}
        className="absolute min-h-0 overflow-auto rounded-surface border border-line-base bg-surface-base"
        style={{ insetBlockStart: topInset, maxBlockSize: `max(0px, calc(100% - ${topInset} - ${bottomInset} - ${reserveControls}))`, maxInlineSize: `calc(100% - ${startInset} - ${endInset})`,
          insetInlineStart: panel.placement === "explorer" ? startInset : compactOpen ? otherTrigger ? `calc(${startInset} + ${triggerReserve})` : startInset : undefined,
          insetInlineEnd: panel.placement === "inspector" ? endInset : compactOpen ? otherTrigger ? `calc(${endInset} + ${triggerReserve})` : endInset : undefined,
          inlineSize: !panel.isOpen || compactOpen ? "auto" : panel.placement === "explorer" ? "var(--ui-layout-sidebar-w)" : "var(--ui-layout-aside-w)",
          zIndex: "var(--ui-z-sticky)", boxShadow: UI_ELEVATION_FLOATING }}>
        <div className={cx("flex items-center justify-between", panel.isOpen && "gap-sm border-b border-line-base p-xs")}>
          {panel.isOpen ? <h2 className="min-w-0 truncate px-sm text-body-s font-semibold">{panel.label}</h2> : null}
          <Button data-canvas-panel-toggle="" variant="ghost" size="sm" className="icon-control-md shrink-0 p-0" aria-label={panel.isOpen ? panel.closeLabel : panel.openLabel}
            aria-expanded={panel.isOpen} aria-controls={contentId} onPress={() => changePanel(panel, !panel.isOpen)}>
            <Icon glyph={panel.isOpen ? X : panel.placement === "explorer" ? List : Info} decorative size="sm" />
          </Button>
        </div>
        <div id={contentId} hidden={!panel.isOpen} inert={!panel.isOpen}>{panel.content}</div>
      </div>;
    })}
    {marquee && <div aria-hidden="true" data-canvas-marquee="" className="pointer-events-none absolute border border-accent bg-accent-tint"
      style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height, borderWidth: UI_BORDER_HAIRLINE }} />}
    {minimap && !flowing && <button type="button" data-canvas-minimap="" aria-label={recenterLabel} hidden={collapsedMap} inert={collapsedMap}
      className={cx("absolute overflow-hidden rounded-control border border-line-base bg-surface-sunken focus-visible:outline-2 focus-visible:outline-accent", itemInteraction === "content" ? "bottom-md start-md" : "bottom-sm start-sm h-24 w-40")}
      style={itemInteraction === "content" ? { inlineSize: "var(--ui-layout-sidebar-w)", maxInlineSize: `calc(100% - ${startInset} - ${endInset})`, aspectRatio: "5 / 3", insetInlineStart: startInset, insetBlockEnd: bottomInset, zIndex: "var(--ui-z-sticky)" } : { zIndex: "var(--ui-z-sticky)" }}
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const unit = (value: number) => Math.min(1, Math.max(0, value));
        const x = event.detail && bounds.width ? unit((event.clientX - bounds.left) / bounds.width) : 0.5;
        const y = event.detail && bounds.height ? unit((event.clientY - bounds.top) / bounds.height) : 0.5;
        setFitting(false);
        requestViewport({ x: size.width / 2 - (worldBounds.x + worldBounds.width * x) * viewport.zoom,
          y: size.height / 2 - (worldBounds.y + worldBounds.height * y) * viewport.zoom, zoom: viewport.zoom });
      }}>
      <span aria-hidden="true" className="pointer-events-none absolute border border-accent bg-accent-tint"
        style={{ left: `${map.visible.x * 100}%`, top: `${map.visible.y * 100}%`, width: `${map.visible.width * 100}%`, height: `${map.visible.height * 100}%`, borderWidth: UI_BORDER_HAIRLINE }} />
    </button>}
    {zoomControls && !flowing && <div data-canvas-controls="" role="group" aria-label={zoomGroupLabel} className={cx("absolute flex max-w-full flex-wrap items-center gap-xs rounded-control bg-surface-raised p-xs", itemInteraction === "content" ? "bottom-md end-md" : "bottom-sm end-sm")} style={itemInteraction === "content" ? { insetInlineEnd: endInset, insetBlockEnd: bottomInset, maxInlineSize: `calc(100% - ${startInset} - ${endInset})`, zIndex: "var(--ui-z-sticky)" } : { zIndex: "var(--ui-z-sticky)" }}>
      <Button size="sm" variant="ghost" aria-label={zoomOutLabel} onPress={() => requestZoom(1 / 1.2)}>−</Button>
      <output aria-label={zoomPercentageLabel} className="text-body-s tabular-nums">{Math.round(viewport.zoom * 100)}%</output>
      <Button size="sm" variant="ghost" aria-label={zoomInLabel} onPress={() => requestZoom(1.2)}>+</Button>
      <Button size="sm" variant="ghost" onPress={requestFit}>{fitLabel}</Button>
    </div>}
  </div>;
}
