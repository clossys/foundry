import { UI_RING_FOCUS } from "../components/internal/ui-vars.js";
import { TOKENS } from "../tokens/tokens.js";

export interface CameraPose { x: number; y: number; zoom: number }
export interface StudioCamera {
  read(): CameraPose;
  pan(x: number, y: number): void;
  zoom(factor: number, anchor?: { x: number; y: number }): void;
  fit(): void;
  flyTo(element: HTMLElement, options?: { reducedMotion?: boolean; focus?: boolean; zoom?: number }): void;
  destroy(): void;
}

/** One imperative transform; neither gestures nor semantic zoom schedule React renders. */
export function createStudioCamera({ viewport, world, initial, onPose }: {
  viewport: HTMLElement; world: HTMLElement; initial?: CameraPose; onPose?: (pose: CameraPose) => void;
}): StudioCamera {
  let pose: CameraPose = initial ? { ...initial } : { x: 0, y: 0, zoom: 1 };
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let highlighted: HTMLElement | undefined;
  let previousShadow = "";
  const pointers = new Map<number, { x: number; y: number }>();
  const clamp = (zoom: number): number => Math.max(.12, Math.min(2, zoom));
  const size = () => ({ width: viewport.clientWidth || 1, height: viewport.clientHeight || 1 });
  const paint = (animate = false): void => {
    world.style.transformOrigin = "0 0";
    world.style.transition = animate ? `transform 250ms var(--ease-default, ${TOKENS["--ease-default"]!.value})` : "none";
    world.style.transform = `translate(${pose.x}px, ${pose.y}px) scale(${pose.zoom})`;
    const semantic = pose.zoom < .5 ? "summary" : pose.zoom <= .9 ? "quiet" : "full";
    world.dataset.semantic = semantic;
    world.querySelectorAll<HTMLElement>("[data-studio-zoom-full]").forEach(element => { element.style.visibility = semantic === "summary" ? "hidden" : ""; element.inert = semantic === "summary"; });
    world.querySelectorAll<HTMLElement>("[data-studio-zoom-detail]").forEach(element => { element.style.visibility = semantic === "full" ? "" : "hidden"; });
    world.querySelectorAll<HTMLElement>("[data-studio-zoom-summary]").forEach(element => { element.hidden = semantic !== "summary"; });
    onPose?.({ ...pose });
  };
  const pan = (x: number, y: number): void => { pose = { ...pose, x: pose.x + x, y: pose.y + y }; paint(); };
  const zoom = (factor: number, anchor?: { x: number; y: number }): void => {
    const bounds = size(); const point = anchor ?? { x: bounds.width / 2, y: bounds.height / 2 }; const next = clamp(pose.zoom * factor);
    pose = { x: point.x - (point.x - pose.x) * next / pose.zoom, y: point.y - (point.y - pose.y) * next / pose.zoom, zoom: next }; paint();
  };
  const fit = (): void => {
    const bounds = size(); const width = world.offsetWidth || world.scrollWidth || bounds.width; const height = world.offsetHeight || world.scrollHeight || bounds.height;
    const next = clamp(Math.min(bounds.width / width, bounds.height / height));
    pose = { x: (bounds.width - width * next) / 2, y: (bounds.height - height * next) / 2, zoom: next }; paint();
  };
  const clearHighlight = (): void => { if (highlighted) { highlighted.style.boxShadow = previousShadow; delete highlighted.dataset.studioHighlight; } highlighted = undefined; };
  const flyTo = (element: HTMLElement, options: { reducedMotion?: boolean; focus?: boolean; zoom?: number } = {}): void => {
    const bounds = size(); const rect = element.getBoundingClientRect(); const host = viewport.getBoundingClientRect();
    const x = (rect.left - host.left - pose.x) / pose.zoom; const y = (rect.top - host.top - pose.y) / pose.zoom;
    const width = rect.width / pose.zoom; const height = rect.height / pose.zoom;
    const next = options.zoom !== undefined ? clamp(options.zoom) : options.focus ? 1 : pose.zoom;
    pose = { x: bounds.width / 2 - (x + width / 2) * next, y: bounds.height / 2 - (y + height / 2) * next, zoom: next };
    const reduced = options.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    paint(!reduced); clearTimeout(highlightTimer); clearHighlight(); highlighted = element; previousShadow = element.style.boxShadow; element.dataset.studioHighlight = ""; element.style.boxShadow = UI_RING_FOCUS;
    highlightTimer = setTimeout(clearHighlight, 250);
    if (options.focus) element.focus({ preventScroll: true });
  };
  const isControl = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest("input, textarea, select, button, a, [role=radio], [role=tab], [data-studio-panel]"));
  const wheel = (event: WheelEvent): void => {
    if (event.target instanceof Element && event.target.closest("[data-studio-panel]")) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) { const rect = viewport.getBoundingClientRect(); zoom(Math.exp(-event.deltaY / 300), { x: event.clientX - rect.left, y: event.clientY - rect.top }); }
    else pan(-event.deltaX, -event.deltaY);
  };
  const key = (event: KeyboardEvent): void => {
    if (isControl(event.target)) return;
    const bounds = size();
    if (event.key === "ArrowLeft") pan(bounds.width / 10, 0);
    else if (event.key === "ArrowRight") pan(-bounds.width / 10, 0);
    else if (event.key === "ArrowUp") pan(0, bounds.height / 10);
    else if (event.key === "ArrowDown") pan(0, -bounds.height / 10);
    else if (event.key === "+" || event.key === "=") zoom(1.2);
    else if (event.key === "-") zoom(1 / 1.2);
    else if (event.key === "0") fit();
    else return;
    event.preventDefault();
  };
  const down = (event: PointerEvent): void => {
    if (event.button !== 0 || isControl(event.target)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); viewport.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent): void => {
    const previous = pointers.get(event.pointerId); if (!previous) return;
    const others = [...pointers.entries()].filter(([id]) => id !== event.pointerId);
    if (others.length) {
      const other = others[0]![1]; const distance = Math.hypot(previous.x - other.x, previous.y - other.y); const next = Math.hypot(event.clientX - other.x, event.clientY - other.y); const rect = viewport.getBoundingClientRect();
      if (distance > 0 && next > 0) zoom(next / distance, { x: (event.clientX + other.x) / 2 - rect.left, y: (event.clientY + other.y) / 2 - rect.top });
    } else pan(event.clientX - previous.x, event.clientY - previous.y);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const up = (event: PointerEvent): void => { pointers.delete(event.pointerId); };
  viewport.addEventListener("wheel", wheel, { passive: false }); viewport.addEventListener("keydown", key);
  viewport.addEventListener("pointerdown", down); viewport.addEventListener("pointermove", move); viewport.addEventListener("pointerup", up); viewport.addEventListener("pointercancel", up); viewport.addEventListener("lostpointercapture", up);
  viewport.style.touchAction = "none"; paint();
  return { read: () => ({ ...pose }), pan, zoom, fit, flyTo, destroy: () => {
    clearTimeout(highlightTimer); clearHighlight(); pointers.clear(); viewport.removeEventListener("wheel", wheel); viewport.removeEventListener("keydown", key);
    viewport.removeEventListener("pointerdown", down); viewport.removeEventListener("pointermove", move); viewport.removeEventListener("pointerup", up); viewport.removeEventListener("pointercancel", up); viewport.removeEventListener("lostpointercapture", up);
  } };
}
