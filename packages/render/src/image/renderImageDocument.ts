/**
 * `renderImageDocument` — this package's whole job for the `image` channel.
 * Takes a `ComposeDocument` with `channel: "image"` and emits a
 * self-contained SVG string sized to `ImageMeta.width`/`height` (scaled per
 * `ImageMeta.scale`), with every `LayoutSpec` slot placed at its `Frame`'s
 * absolute canvas position via `engine.ts`'s `frameToCanvasRect`.
 *
 * ARCHITECTURAL DECISION, ALREADY MADE: SVG, NEVER RASTER BYTES
 * -----------------------------------------------------------------
 * This function never produces PNG/JPEG/WebP bytes, and never will — see
 * this package's README for the full argument (SVG is a deterministic
 * string a golden test can assert byte-for-byte; raster output is an
 * opaque blob no test can meaningfully assert; every rasterizer is a
 * heavyweight native dependency this package's zero-new-dependencies rule
 * rules out). `ImageMeta.format` may ask for `"png"`/`"jpeg"`/`"webp"` —
 * this function still emits SVG, and says so in `RenderImageResult`:
 * `requestedFormat` carries the caller's original ask, and `warnings`
 * carries an explicit note that rasterizing the returned SVG to that
 * format is the CALLER's job, never silently pretended to have already
 * happened.
 *
 * RESOLUTION AND SLOT PAINTING — SHARED WITH `./slides`
 * ---------------------------------------------------------
 * The actual "resolve `doc.bindings` against `doc.layout`, via
 * `resolveDocument` then `resolveCopy`/`resolveDocumentAssets` (never
 * hand-rolled — see `@vespeneventures/compose`'s own `resolve-copy.ts`,
 * "the #43 gap", and this package's own `../internal/assets.ts`), then
 * paint every resolvable slot" pipeline lives in `resolveCanvasLayout.ts`,
 * shared verbatim with `./slides` (a slide is the same kind of canvas,
 * rendered once per array entry — see this package's README). This file's
 * own job is the `image`-specific wrapping around that shared pipeline:
 * validate `channel`, compute `ImageMeta.width`/`height`/`scale`'s
 * `<svg>` attributes (`engine.ts`'s `computeCanvasDimensions`), and emit
 * `ImageMeta.alt` as `<title>` plus `role="img"`/`aria-label` — a
 * `SlidesMeta` has no `alt` equivalent, which is exactly why this
 * wrapping isn't itself part of the shared pipeline. `options
 * .resolveAssetId` (see `./types.ts`) is passed straight through to
 * `resolveCanvasLayout` unchanged — this file has no `assetId`-specific
 * logic of its own beyond that pass-through; every actual resolution,
 * validation, and refusal rule lives in `resolveCanvasLayout.ts` and
 * `renderSlots.ts`.
 */

import type { ComposeDocument, ImageMeta } from "@vespeneventures/compose";
import { RenderError } from "../internal/errors.js";
import { computeCanvasDimensions, escapeXml } from "./engine.js";
import { resolveCanvasLayout } from "./resolveCanvasLayout.js";
import type { RenderImageOptions, RenderImageResult } from "./types.js";

export function renderImageDocument(doc: ComposeDocument, options: RenderImageOptions = {}): RenderImageResult {
  if (doc.channel !== "image" || doc.meta.channel !== "image") {
    throw new RenderError(
      "wrong-channel",
      `renderImageDocument only renders channel "image" documents, got document.channel="${doc.channel}" / document.meta.channel="${doc.meta.channel}".`,
    );
  }
  const meta = doc.meta as ImageMeta;

  // `ComposeDocument.layout` is typed optional (see @vespeneventures/
  // compose's own `types.ts`) because it's forbidden for web/email —
  // `validateComposeDocument` already enforces it's REQUIRED for `image`,
  // but this function does not assume its caller ran that validation
  // first, so it checks again rather than crashing on the shared
  // pipeline's own `layout.slots` access.
  const layout = doc.layout;
  if (layout === undefined) {
    throw new RenderError(
      "resolution-failed",
      `renderImageDocument could not resolve document "${doc.id}": channel "image" requires a layout, but doc.layout is undefined.`,
    );
  }

  const canvas = { width: meta.width, height: meta.height };
  const dims = computeCanvasDimensions(canvas, meta.scale ?? 1);

  let resolved;
  try {
    resolved = resolveCanvasLayout(doc, layout, canvas, options);
  } catch (error) {
    if (error instanceof RenderError) {
      throw new RenderError(error.reason, `renderImageDocument ${error.message}`);
    }
    throw error;
  }

  const warnings = [...resolved.warnings];
  const escapedAlt = escapeXml(meta.alt);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.attrWidth}" height="${dims.attrHeight}" viewBox="0 0 ${dims.viewBoxWidth} ${dims.viewBoxHeight}" role="img" aria-label="${escapedAlt}">` +
    `<title>${escapedAlt}</title>` +
    resolved.markup +
    "</svg>";

  if (meta.format !== "svg") {
    warnings.push(
      `renderImageDocument emits SVG only; format "${meta.format}" was requested but not produced — rasterizing this SVG to "${meta.format}" is the caller's own responsibility. See this package's README, "Architectural decision, already made".`,
    );
  }

  return {
    svg,
    requestedFormat: meta.format,
    width: dims.attrWidth,
    height: dims.attrHeight,
    viewBox: { width: dims.viewBoxWidth, height: dims.viewBoxHeight },
    scale: dims.scale,
    warnings,
  };
}
