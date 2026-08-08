/**
 * @vespeneventures/render/slides — the `slides` channel renderer. Takes a
 * `SlidesDeckInput` (an ordered array of `channel: "slides"`
 * `ComposeDocument`s, plus deck-wide speaker notes) and emits one
 * self-contained SVG per slide, sharing one fixed canvas derived from
 * `SlidesMeta.aspect`. See `renderSlidesDeck.ts`'s own doc comment for the
 * full picture, including why this channel's input is `SlidesDeckInput`
 * rather than a bare `ComposeDocument`.
 *
 * Reuses `./image`'s canvas/geometry/text-wrapping engine (`engine.ts`) and
 * resolution pipeline (`resolveCanvasLayout.ts`) rather than duplicating
 * either — a slide IS the same fixed-canvas-with-positioned-slots problem
 * `./image` already solves once.
 */

export { renderSlidesDeck } from "./renderSlidesDeck.js";
export { canvasForAspect } from "./canvas.js";

export { RenderError } from "../internal/errors.js";
export type { RenderErrorReason } from "../internal/errors.js";

export type {
  RenderedSlide,
  RenderSlidesOptions,
  RenderSlidesResult,
  SlidesDeckInput,
} from "./types.js";
