/**
 * `SlidesMeta.aspect` -> a fixed canvas pixel size. The convention this
 * module fixes, stated once and used everywhere in `./slides`:
 *
 *   - `"16:9"` -> 1920x1080 (standard HD/widescreen slide canvas — the same
 *     pixel size PowerPoint/Google Slides/Keynote all default a 16:9 deck
 *     to at 96dpi-equivalent).
 *   - `"4:3"`  -> 1024x768 (the traditional slide canvas size, still the
 *     conventional 4:3 pixel size across the same tools).
 *
 * These are the ONLY two aspects `SlidesMeta.aspect` allows (see
 * `@vespeneventures/compose`'s own `types.ts`), so this is a closed,
 * two-entry table, not a general aspect-ratio calculator.
 */

import type { SlidesMeta } from "@vespeneventures/compose";
import type { CanvasPixelSize } from "../image/engine.js";

const ASPECT_CANVAS_PX: Record<SlidesMeta["aspect"], CanvasPixelSize> = {
  "16:9": { width: 1920, height: 1080 },
  "4:3": { width: 1024, height: 768 },
};

/** The fixed canvas pixel size for a given `SlidesMeta.aspect` — see this file's top comment for the convention. */
export function canvasForAspect(aspect: SlidesMeta["aspect"]): CanvasPixelSize {
  return ASPECT_CANVAS_PX[aspect];
}
