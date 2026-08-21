/**
 * `renderSlidesDeck` — this package's whole job for the `slides` channel.
 * Takes a `SlidesDeckInput` (an ORDERED array of `channel: "slides"`
 * `ComposeDocument`s, plus deck-wide speaker notes) and emits one
 * self-contained SVG per slide, all sharing one fixed canvas size derived
 * from `SlidesMeta.aspect` (`canvas.ts`'s `canvasForAspect`).
 *
 * DECIDING THE INPUT SHAPE
 * ---------------------------
 * The task brief names two candidate shapes: "a single `ComposeDocument`
 * per slide with the deck as an array" or "one document with multiple
 * layouts." The second is not actually available: `ComposeDocument` has
 * exactly one `layout` field (`@vespeneventures/publisher/core`'s frozen
 * `types.ts`), so "multiple layouts" would mean this package inventing a
 * new, non-`surface/core` array-of-layouts shape and hand-rolling its own
 * resolution loop over it — exactly the kind of parallel, drifting
 * reinvention `resolveDocument`/`resolveCopy` exist to prevent (see
 * `resolveCanvasLayout.ts`'s own top comment). So this package takes the
 * first shape: **`SlidesDeckInput.slides` is a plain array of real,
 * individually-valid `ComposeDocument`s**, each resolved through the exact
 * same `resolveCanvasLayout` pipeline `./image` uses for its one canvas.
 * `SlidesDeckInput` itself (see `types.ts`) is this package's own thin
 * wrapper adding exactly the two things a DECK needs that a single document
 * cannot express: an explicit array order, and deck-wide `notes`.
 *
 * ARRAY INDEX IS DECK ORDER — NEVER INFERRED
 * ----------------------------------------------
 * `SlidesDeckInput.slides` is a plain array; `RenderedSlide.index` is that
 * same array's index, carried straight through. This function never sorts,
 * never reorders by `id`, and never reads order from `notes`' own key
 * order (a plain object's key order is not a contract any caller should
 * rely on, and `notes`' keys are speaker-note lookups, not a sequence).
 *
 * WHY `notes` LIVES ON THE DECK, NOT ON EACH SLIDE'S OWN `meta.notes`
 * -----------------------------------------------------------------------
 * `SlidesMeta.notes` is typed `Record<string, string>` KEYED BY SLIDE ID —
 * structurally deck-wide data (a lookup across every slide in the deck),
 * even though the field sits on one `ComposeDocument`'s own `meta`. Reading
 * it from, say, `slides[0].meta.notes` would make slide zero a
 * privileged, magic carrier of every OTHER slide's notes too — surprising,
 * and fragile the moment a caller reorders or removes that one document.
 * This package's decision: `SlidesDeckInput.notes` is the single,
 * deck-level source of truth; every individual slide's own
 * `SlidesMeta.notes` (if a caller sets one) is simply never read by this
 * function. A caller who has notes per the `SlidesMeta` shape already has
 * them in exactly the right shape to hand to `SlidesDeckInput.notes`
 * directly — no reshaping required, just a different attachment point.
 *
 * ONE FAILING SLIDE FAILS THE WHOLE DECK
 * -------------------------------------------
 * `resolveCanvasLayout` refuses (throws `RenderError`) exactly like
 * `./image` does for a single canvas — a wrong channel, a failed
 * resolution, or an empty required slot on ANY slide aborts the entire
 * `renderSlidesDeck` call, re-thrown with the offending slide's index/id
 * named in the message. This package does not have a "skip the bad slide,
 * render the rest" mode: a deck with a silently-missing slide is a worse
 * failure than a deck that doesn't render at all, the same "never ship
 * something silently incomplete" bar every other refusal in this package
 * holds to.
 */

import { RenderError } from "../internal/errors.js";
import { computeCanvasDimensions, escapeXml } from "../image/engine.js";
import { resolveCanvasLayout } from "../image/resolveCanvasLayout.js";
import { canvasForAspect } from "./canvas.js";
import type { RenderSlidesOptions, RenderSlidesResult, RenderedSlide, SlidesDeckInput } from "./types.js";
import type { SlidesMeta } from "../core/index.js";

export function renderSlidesDeck(deck: SlidesDeckInput, options: RenderSlidesOptions = {}): RenderSlidesResult {
  if (deck.slides.length === 0) {
    throw new RenderError(
      "resolution-failed",
      `renderSlidesDeck could not render deck "${deck.id}": it has zero slides — nothing to render.`,
    );
  }

  deck.slides.forEach((slide, index) => {
    if (slide.channel !== "slides" || slide.meta.channel !== "slides") {
      throw new RenderError(
        "wrong-channel",
        `renderSlidesDeck only renders channel "slides" documents, but deck "${deck.id}" slide ${index} (id="${slide.id}") has document.channel="${slide.channel}" / document.meta.channel="${slide.meta.channel}".`,
      );
    }
  });

  const firstMeta = deck.slides[0]!.meta as SlidesMeta;
  const aspect = firstMeta.aspect;
  deck.slides.forEach((slide, index) => {
    const meta = slide.meta as SlidesMeta;
    if (meta.aspect !== aspect) {
      throw new RenderError(
        "inconsistent-deck-aspect",
        `renderSlidesDeck could not render deck "${deck.id}": slide 0 (id="${deck.slides[0]!.id}") declares aspect "${aspect}", but slide ${index} (id="${slide.id}") declares aspect "${meta.aspect}" — every slide in a deck must share one canvas aspect.`,
      );
    }
  });

  const canvas = canvasForAspect(aspect);
  const dims = computeCanvasDimensions(canvas, 1);

  const slides: RenderedSlide[] = deck.slides.map((slide, index) => {
    if (slide.layout === undefined) {
      throw new RenderError(
        "resolution-failed",
        `renderSlidesDeck could not render deck "${deck.id}" slide ${index} (id="${slide.id}"): channel "slides" requires a layout, but layout is undefined.`,
      );
    }

    let resolved;
    try {
      resolved = resolveCanvasLayout(slide, slide.layout, canvas, options);
    } catch (error) {
      if (error instanceof RenderError) {
        throw new RenderError(
          error.reason,
          `renderSlidesDeck could not render deck "${deck.id}" slide ${index} (id="${slide.id}"): ${error.message}`,
        );
      }
      throw error;
    }

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.attrWidth}" height="${dims.attrHeight}" viewBox="0 0 ${dims.viewBoxWidth} ${dims.viewBoxHeight}">` +
      `<title>${escapeXml(slide.id)}</title>` +
      resolved.markup +
      "</svg>";

    const note = deck.notes?.[slide.id];
    return {
      id: slide.id,
      index,
      svg,
      ...(note !== undefined ? { notes: note } : {}),
      warnings: resolved.warnings,
    };
  });

  const slideIds = new Set(deck.slides.map((s) => s.id));
  const unknownNoteKeys = Object.keys(deck.notes ?? {}).filter((key) => !slideIds.has(key));

  const warnings = slides.flatMap((s) => s.warnings.map((w) => `slide "${s.id}": ${w}`));

  return {
    slides,
    width: dims.attrWidth,
    height: dims.attrHeight,
    aspect,
    unknownNoteKeys,
    warnings,
  };
}
