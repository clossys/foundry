/**
 * The two unit conversions renderers actually need out of a `Frame`. Both
 * pure — no I/O, no dependency on any other file in this package beyond
 * `types.ts`'s shapes.
 */

import type { Frame, Rect } from "./types.js";

/** The canvas's real size in inches — what `frameToInches` needs to turn a 0..1 fraction into an absolute measurement. */
export interface CanvasInches {
  width: number;
  height: number;
}

/**
 * Converts a `Frame`'s 0..1 fractions into percentages (0..100) — what a
 * CSS emitter wants (`left: 12.5%`), and, per the README's "prior art"
 * note, one of the two real emitters this fractional design was already
 * validated against.
 */
export function frameToPercent(frame: Frame): Rect {
  return {
    x: frame.x * 100,
    y: frame.y * 100,
    w: frame.w * 100,
    h: frame.h * 100,
  };
}

/**
 * Converts a `Frame`'s 0..1 fractions into inches, given the canvas's real
 * size — what a print/slides emitter wants (a `PrintMeta`/`SlidesMeta`
 * canvas has a real physical or 96/72-dpi-equivalent size, and a `Frame`
 * on it needs an absolute position in that unit).
 */
export function frameToInches(frame: Frame, canvasInches: CanvasInches): Rect {
  return {
    x: frame.x * canvasInches.width,
    y: frame.y * canvasInches.height,
    w: frame.w * canvasInches.width,
    h: frame.h * canvasInches.height,
  };
}
