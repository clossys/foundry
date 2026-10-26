import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanvasSurfaceActions } from "../blocks/canvas/CanvasSurface.js";
import { TOKENS } from "../tokens/tokens.js";
import { CANVAS_LOD_TEXT } from "../blocks/canvas/CanvasLod.js";
import type { Viewport } from "../blocks/canvas/models.js";

/**
 * The union box of the world's laid-out content in untransformed world pixels,
 * including the world's own end padding. Wrappers without a box of their own
 * (display: contents) are looked through. A positioned world stretched to its
 * stage would otherwise report the stage height, not its content.
 */
export function worldExtent(world: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(world);
  const end = { x: Number.parseFloat(style.paddingRight) || 0, y: Number.parseFloat(style.paddingBottom) || 0 };
  // Seed from the content, not the world box: a compact layout narrower than a
  // stage-stretched world would otherwise fit (and centre) the empty stage.
  let width = 0, height = 0;
  const visit = (parent: Element) => {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (!child.offsetWidth && !child.offsetHeight) { visit(child); continue; }
      width = Math.max(width, child.offsetLeft + child.offsetWidth + end.x);
      height = Math.max(height, child.offsetTop + child.offsetHeight + end.y);
    }
  };
  visit(world);
  return width || height ? { width, height } : { width: world.offsetWidth, height: world.offsetHeight };
}

/**
 * The smallest pan that brings a focused control inside the stage, inset by
 * the medium spacing token. A control larger than the inset stage aligns to
 * its start edge.
 */
export function revealDelta(stage: Pick<DOMRect, "left" | "top" | "right" | "bottom">, target: Pick<DOMRect, "left" | "top" | "right" | "bottom">): { x: number; y: number } {
  const inset = Number.parseFloat(TOKENS["--spacing-md"]!.value);
  const axis = (start: number, end: number, from: number, to: number) => {
    const low = from + inset, high = to - inset;
    if (start < low || end - start > high - low) return low - start;
    return end > high ? high - end : 0;
  };
  return { x: axis(target.left, target.right, stage.left, stage.right), y: axis(target.top, target.bottom, stage.top, stage.bottom) };
}

/** Smallest zoom at which the least detailed tier still paints its text at the caption size. */
export function legibleZoomFloor(): number {
  const px = (token: string) => Number.parseFloat(TOKENS[token]!.value);
  return px("--text-caption") / px(CANVAS_LOD_TEXT.overview);
}

/**
 * A narrow stage opens on the first domain: its first board fills the stage
 * width (never above 1:1, never below the legible floor), top-aligned under
 * the domain label, instead of fitting the whole world to an illegible zoom.
 */
export function openOnFirstBoard(host: HTMLElement, world: HTMLElement, pose: Viewport): Viewport | undefined {
  const board = world.querySelector<HTMLElement>("[data-studio-board]");
  const domain = board?.closest<HTMLElement>("[data-studio-domain]") ?? board;
  if (!board || !domain) return undefined;
  const origin = world.getBoundingClientRect(), rect = board.getBoundingClientRect(), top = domain.getBoundingClientRect();
  const scale = pose.zoom || 1;
  const x = (rect.left - origin.left) / scale, y = (top.top - origin.top) / scale, width = rect.width / scale;
  const view = host.clientWidth || host.getBoundingClientRect().width;
  if (!view || !width) return undefined;
  const gutter = Number.parseFloat(TOKENS["--spacing-md"]!.value);
  const zoom = Math.min(1, Math.max(legibleZoomFloor(), (view - gutter * 2) / width));
  return { x: gutter - x * zoom, y: gutter - y * zoom, zoom };
}

/** Studio supplies measured content; CanvasSurface owns all camera paint and gestures. */
/**
 * `ready` reports that the world holds its boards; the first-load camera
 * (saved pose, narrow opening or fit) waits for it so it never fits an empty world.
 */
export function useCanvasWorld(key: string, onPose?: (pose: Viewport) => void, initial?: Viewport, ready = true) {
  const surface = useRef<HTMLDivElement | null>(null), world = useRef<HTMLDivElement | null>(null);
  const actions = useRef<CanvasSurfaceActions | null>(null);
  const [pose, setPose] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [overlayLayout, setOverlayLayout] = useState<"wide" | "compact" | "narrow">("wide");
  const [measuredKey, setMeasuredKey] = useState<string>();
  // The saved pose is read once per key: the host's own pose callback stores the
  // unfitted mount pose before measurement, which must not count as a saved camera.
  const fittedKey = useRef<string | undefined>(undefined), saved = useRef(initial), savedKey = useRef(key);
  if (savedKey.current !== key) { savedKey.current = key; saved.current = initial; }
  const latest = useRef(onPose); latest.current = onPose;
  const onSurfaceElement = useCallback((node: HTMLDivElement | null) => {
    surface.current = node;
    if (!node) return;
    node.dataset.studioViewport = "";
    const minimap = node.querySelector<HTMLElement>("[data-canvas-minimap]"), controls = node.querySelector<HTMLElement>("[data-canvas-controls]");
    if (minimap) minimap.dataset.studioPanel = "minimap";
    if (controls) controls.dataset.studioPanel = "zoom";
  }, []);
  const onWorldElement = useCallback((node: HTMLDivElement | null) => { world.current = node; if (node) node.dataset.studioWorld = ""; }, []);
  useLayoutEffect(() => {
    const host = surface.current, content = world.current;
    if (!host || !content) return;
    const measure = () => {
      const extent = worldExtent(content);
      const width = extent.width || content.scrollWidth || host.clientWidth || 1;
      const height = extent.height || content.scrollHeight || host.clientHeight || 1;
      setBounds(current => current.width === width && current.height === height ? current : { x: 0, y: 0, width, height });
      const computed = getComputedStyle(host);
      const rootRem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const breakpoint = (property: "--breakpoint-tablet-lg" | "--breakpoint-tablet") => {
        const declared = computed.getPropertyValue(property).trim() || TOKENS[property]!.value;
        return Number.parseFloat(declared) * (declared.endsWith("rem") ? rootRem : 1);
      };
      // Only the measured stage width selects overlay density; viewport media queries do not participate.
      if (host.clientWidth) setOverlayLayout(host.clientWidth < breakpoint("--breakpoint-tablet") ? "narrow" : host.clientWidth < breakpoint("--breakpoint-tablet-lg") ? "compact" : "wide");
      setMeasuredKey(key);
    };
    const scrolled = () => latest.current?.(actions.current?.read() ?? pose);
    // Keyboard focus inside the world: undo any native scroll it caused in the
    // stage or its ancestors (which would slide the canvas under the frame
    // chrome), then pan the camera so the control sits inside the stage.
    let frame = 0;
    const focused = (event: FocusEvent) => {
      const target = event.target;
      // Programmatic focus of a board (tabIndex -1, after Open or a tier change) keeps the camera the caller chose.
      if (!(target instanceof HTMLElement) || !content.contains(target) || target.tabIndex < 0) return;
      const scrollers: [Element, number, number][] = [];
      for (let node: Element | null = host; node; node = node.parentElement) scrollers.push([node, node.scrollLeft, node.scrollTop]);
      const reveal = () => {
        for (const [node, left, top] of scrollers) { if (node.scrollLeft !== left) node.scrollLeft = left; if (node.scrollTop !== top) node.scrollTop = top; }
        const delta = revealDelta(host.getBoundingClientRect(), target.getBoundingClientRect());
        if (delta.x || delta.y) actions.current?.pan(delta.x, delta.y);
      };
      cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal);
    };
    host.addEventListener("scroll", scrolled, true); host.addEventListener("focusin", focused);
    measure(); const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    observer?.observe(content); observer?.observe(host); window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", measure); host.removeEventListener("scroll", scrolled, true); host.removeEventListener("focusin", focused); };
  }, [key]);
  useEffect(() => {
    if (measuredKey !== key || fittedKey.current === key || !ready) return;
    fittedKey.current = key;
    const host = surface.current, content = world.current;
    const opening = !saved.current && overlayLayout === "narrow" && host && content ? openOnFirstBoard(host, content, pose) : undefined;
    if (saved.current) setPose(saved.current); else if (opening) setPose(opening); else actions.current?.fit();
  }, [key, measuredKey, bounds.width, bounds.height, ready]);
  useEffect(() => { latest.current?.(pose); }, [pose]);
  return { surface, world, actions, pose, setPose, bounds, overlayLayout, onSurfaceElement, onWorldElement };
}
