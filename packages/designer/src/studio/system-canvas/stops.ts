import { fitTo, type CanvasRect, type CanvasSize, type Viewport } from "../../blocks/canvas/models.js";
import { legibleZoomFloor } from "../useCanvasWorld.js";
import type { SystemLayout } from "./layout.js";

/** The four zoom stops (Designer D5g), widest first. */
export type SystemStop = "system" | "layer" | "board" | "cell";
export const SYSTEM_STOPS: readonly SystemStop[] = ["system", "layer", "board", "cell"];

export interface ZoomRange { readonly min: number; readonly max: number }

/**
 * Every layer shares the same fit rule: fit the target, retain legible specimen
 * text, and never exceed 100%. Large systems remain pannable at their minimum
 * instead of shrinking every specimen into unreadable text.
 */
export function systemZoomRange(layout: SystemLayout, viewSize: CanvasSize, padding: number): ZoomRange {
  const fit = fitTo(layout.bounds, viewSize, padding).zoom;
  return { min: Math.min(1, Math.max(legibleZoomFloor(), fit)), max: 1 };
}

export function clampZoom(range: ZoomRange, zoom: number): number {
  return Math.min(range.max, Math.max(range.min, zoom));
}

/** The viewport that centres `rect` at `zoom`. */
export function centreOn(rect: CanvasRect, viewSize: CanvasSize, zoom: number): Viewport {
  return { x: viewSize.width / 2 - (rect.x + rect.width / 2) * zoom, y: viewSize.height / 2 - (rect.y + rect.height / 2) * zoom, zoom };
}

/**
 * A stop's zoom for the rectangle it frames: System, Layer and Board fit their
 * rectangle (`fitTo`) inside the range; Cell is always the range maximum (100%).
 */
export function stopZoom(stop: SystemStop, rect: CanvasRect, viewSize: CanvasSize, padding: number, range: ZoomRange): number {
  return stop === "cell" ? range.max : clampZoom(range, fitTo(rect, viewSize, padding).zoom);
}

/** The viewport of a stop, centred on the rectangle it frames. */
export function stopViewport(stop: SystemStop, rect: CanvasRect, viewSize: CanvasSize, padding: number, range: ZoomRange): Viewport {
  return centreOn(rect, viewSize, stopZoom(stop, rect, viewSize, padding, range));
}

/** The opening viewport: the system centre at the shared legible fit stop. */
export function systemStop(layout: SystemLayout, viewSize: CanvasSize, padding: number): Viewport {
  return stopViewport("system", layout.bounds, viewSize, padding, systemZoomRange(layout, viewSize, padding));
}
