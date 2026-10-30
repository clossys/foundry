"use client";
import { useLayoutEffect } from "react";
import { CANVAS_ZOOM_REQUEST_EVENT, gestureZoomFactor, wheelZoomFactor, type CanvasZoomRequestDetail } from "../blocks/canvas/models.js";

const FRAME = "[data-application-frame]";
const SURFACE = '[data-canvas-surface][data-canvas-layout="positioned"]';
const DOCK = '[data-application-frame-region="dock"]';
const GESTURES = ["gesturestart", "gesturechange", "gestureend"] as const;

/**
 * The application frame is the single owner of pinch-to-zoom while it hosts a
 * positioned canvas. Trackpad pinch (ctrl+wheel) and Safari gesture events
 * never zoom the page there: each is prevented wherever it lands in the frame,
 * and only the canvas itself or the dock chrome drives the canvas camera.
 * The surface handles its own targets first (at the pointer); dock targets are
 * routed to it as a center zoom request. Header, navigation and the right
 * panel are prevented without moving the camera. Plain wheel stays native
 * scrolling and keyboard page zoom (Cmd/Ctrl with plus or minus) remains the
 * browser's. Without a positioned canvas, page zoom is left untouched.
 *
 * The listener is scoped by each event's own frame, so installing it more
 * than once (several frames, or a remount) stays idempotent: the first owner
 * prevents the event and later ones see it already handled.
 */
export function installFrameZoomGestures(scope: Document | HTMLElement = document): () => void {
  let scale = 1;
  const own = (event: Event, factor?: number) => {
    const target = event.target instanceof Element ? event.target : null;
    const surface = target?.closest(FRAME)?.querySelector<HTMLElement>(SURFACE);
    if (!target || !surface || event.defaultPrevented) return;
    event.preventDefault();
    if (factor === undefined || factor === 1 || !target.closest(DOCK)) return;
    surface.dispatchEvent(new CustomEvent<CanvasZoomRequestDetail>(CANVAS_ZOOM_REQUEST_EVENT, { detail: { factor } }));
  };
  const wheel = (event: Event) => {
    if (event instanceof WheelEvent && event.ctrlKey) own(event, wheelZoomFactor(event.deltaY, event.deltaMode, window.innerHeight));
  };
  const gesture = (event: Event) => {
    const value = (event as Event & { scale?: number }).scale ?? 1, previous = scale;
    scale = event.type === "gesturechange" ? value : 1;
    own(event, event.type === "gesturechange" ? gestureZoomFactor(value, previous) : undefined);
  };
  scope.addEventListener("wheel", wheel, { passive: false });
  for (const type of GESTURES) scope.addEventListener(type, gesture, { passive: false });
  return () => {
    scope.removeEventListener("wheel", wheel);
    for (const type of GESTURES) scope.removeEventListener(type, gesture);
  };
}

/** Installs the frame gesture owner for the life of a mounted frame; renders nothing. */
export function FrameZoomGestures() {
  useLayoutEffect(() => installFrameZoomGestures(document), []);
  return null;
}
