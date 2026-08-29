/**
 * @clossys/publisher/image — the `image` channel renderer. Takes a
 * `ComposeDocument` with `channel: "image"` and emits a self-contained SVG
 * string, sized and positioned from `ImageMeta`/`LayoutSpec`. See
 * `renderImageDocument.ts`'s own doc comment for the full picture, and this
 * package's README, "Architectural decision, already made" for why SVG,
 * never raster bytes.
 *
 * The canvas/geometry/text-wrapping engine this subpath exports
 * (`engine.ts`) is also imported directly (by relative path, not through
 * this index) by `./slides` — see `engine.ts`'s own top comment for why
 * that sharing lives here rather than in `src/internal/`.
 */

export { renderImageDocument } from "./renderImageDocument.js";

export { RenderError } from "../internal/errors.js";
export type { RenderErrorReason } from "../internal/errors.js";

export type { RenderImageOptions, RenderImageResult } from "./types.js";

export { computeCanvasDimensions, escapeXml, frameToCanvasRect, resolveColorRole, wrapText } from "./engine.js";
export type { CanvasDimensions, CanvasPixelSize, PixelRect, TextWrapOptions, TextWrapResult } from "./engine.js";
