import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanvasSurfaceActions } from "../blocks/canvas/CanvasSurface.js";
import { TOKENS } from "../tokens/tokens.js";
import type { Viewport } from "../blocks/canvas/models.js";

/** Studio supplies measured content; CanvasSurface owns all camera paint and gestures. */
export function useCanvasWorld(key: string, onPose?: (pose: Viewport) => void, initial?: Viewport) {
  const surface = useRef<HTMLDivElement | null>(null), world = useRef<HTMLDivElement | null>(null);
  const actions = useRef<CanvasSurfaceActions | null>(null);
  const [pose, setPose] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [overlayLayout, setOverlayLayout] = useState<"wide" | "compact" | "narrow">("wide");
  const [measuredKey, setMeasuredKey] = useState<string>();
  const fittedKey = useRef<string | undefined>(undefined), saved = useRef(initial); saved.current = initial;
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
      const width = content.offsetWidth || content.scrollWidth || host.clientWidth || 1;
      const height = content.offsetHeight || content.scrollHeight || host.clientHeight || 1;
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
    host.addEventListener("scroll", scrolled, true);
    measure(); const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    observer?.observe(content); observer?.observe(host); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); host.removeEventListener("scroll", scrolled, true); };
  }, [key]);
  useEffect(() => {
    if (measuredKey !== key || fittedKey.current === key) return;
    fittedKey.current = key;
    if (saved.current) setPose(saved.current); else actions.current?.fit();
  }, [key, measuredKey, bounds.width, bounds.height]);
  useEffect(() => { latest.current?.(pose); }, [pose]);
  return { surface, world, actions, pose, setPose, bounds, overlayLayout, onSurfaceElement, onWorldElement };
}
