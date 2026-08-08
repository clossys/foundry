/**
 * The shared "resolve this document's bindings against this layout, then
 * paint every slot" pipeline behind BOTH `renderImageDocument` (one canvas)
 * and `./slides`' `renderSlidesDeck` (an ordered sequence of the same kind
 * of canvas, one call of this function per slide). Extracted here — rather
 * than duplicated once per channel, or left inline only in
 * `renderImageDocument.ts` for `./slides` to reach into — because the
 * resolution bar (`resolveDocument` then `resolveCopy`, never hand-rolled;
 * see this file's own logic below and `@vespeneventures/compose`'s own
 * `resolve-copy.ts` doc comment, "the #43 gap") and the "never silent"
 * warning bookkeeping are identical for a single image and for one slide of
 * a deck — a slide IS a canvas, and this package's whole argument (see the
 * README) is that the two are the same rendering problem.
 *
 * WHAT THIS FUNCTION DOES NOT DO
 * ---------------------------------
 * It does not wrap its output in `<svg>...</svg>` — `renderImageDocument`
 * adds `ImageMeta.alt`'s `<title>`/`role="img"`/`aria-label` (a REQUIRED
 * contract field with no `SlidesMeta` equivalent), while `./slides` adds
 * nothing extra per slide — so the two channels' own top-level functions
 * each build their own `<svg>` wrapper around this function's `markup`.
 *
 * TOTAL LOSS IS A FAILURE, NOT A WARNING — EVEN WHEN NO SLOT IS `required`
 * -----------------------------------------------------------------------
 * A single optional slot whose binding never produces text is PARTIAL loss:
 * it is omitted, reported as a warning, and the render proceeds — the rest
 * of the canvas still means something. But when EVERY resolved binding in
 * the whole document fails to produce text, "the rest of the canvas" is
 * nothing: without a required-slot check to catch it (a document can
 * legally have zero `required: true` slots), this used to fall straight
 * through both the required-slot check above AND the per-slot warning loop
 * below, returning a syntactically valid but entirely blank `<svg>` as a
 * SUCCESS. That is exactly the failure this package's own "never silent"
 * bar exists to catch — the same rule `@vespeneventures/compose`'s own
 * `resolveDocument` enforces by refusing `ok: true` when `resolved.length
 * === 0` (see its doc comment, "THE BAR THIS FILE IS BUILT AGAINST"):
 * "resolved nothing" and "resolved cleanly" must never look the same to a
 * caller that only checks whether the call threw.
 *
 * The precise rule this function applies, stated once so it never has to
 * be reverse-engineered from behavior: after resolution, if NOT ONE
 * resolved binding produced usable text (`textByKey.size === 0`) AND the
 * layout declares NO canvas-level `background` (`layout.background.
 * background`), there is nothing left to paint at all, and this function
 * throws `RenderError("empty-output", ...)` naming the document and every
 * omitted slot. A document with a real `background` but no text slots is
 * NOT empty by this rule — a background-only canvas is legitimate,
 * deliberate content, not an accidental total loss, and rendering ONE such
 * document must never throw just because it happens to have no text in
 * it. This is deliberately NOT "count the `<text>` elements in the
 * output" — that would conflate a rendering detail (how many DOM nodes a
 * slot happens to produce) with the real question (did resolution produce
 * anything a caller asked for).
 */

import { requiredSlotKeys, resolveCopy, resolveDocument } from "@vespeneventures/compose";
import type { ComposeDocument, CopyLookup, LayoutSpec } from "@vespeneventures/compose";
import { RenderError } from "../internal/errors.js";
import { buildFlatTokenMap, resolveColorRole, type CanvasPixelSize } from "./engine.js";
import { renderSlotsToSvg } from "./renderSlots.js";

export interface ResolveCanvasLayoutOptions {
  resolveCopyId?: CopyLookup;
  tokenOverrides?: Record<string, string>;
}

export interface ResolvedCanvasLayout {
  /** The canvas-level background `<rect>` (if `layout.background.background` was given) followed by every rendered slot's markup, in `layout.slots` order. Ready to drop straight inside an `<svg>...</svg>` wrapper. */
  markup: string;
  /** Every non-fatal finding — overflow truncations and skipped-optional-slot notices — in the order encountered. Never a reason to refuse; never silently dropped either. */
  warnings: string[];
}

/**
 * Resolves `doc`'s `bindings` against `layout` (via `resolveDocument` then
 * `resolveCopy` — see this file's top comment), refuses with a
 * `RenderError` exactly like `renderImageDocument.ts` documents
 * (`"resolution-failed"` / `"empty-output"`), and, once resolution
 * succeeds, paints every resolvable slot onto `canvas` via
 * `renderSlots.ts`'s `renderSlotsToSvg`.
 */
export function resolveCanvasLayout(
  doc: ComposeDocument,
  layout: LayoutSpec,
  canvas: CanvasPixelSize,
  options: ResolveCanvasLayoutOptions = {},
): ResolvedCanvasLayout {
  const result = resolveDocument(doc, layout);
  if (!result.ok) {
    const parts: string[] = [];
    if (result.missingRequired.length > 0) parts.push(`missing required slot(s): ${result.missingRequired.join(", ")}`);
    if (result.unknownBindings.length > 0) parts.push(`binding(s) targeting unknown slot(s): ${result.unknownBindings.map((b) => b.slot).join(", ")}`);
    if (result.resolved.length === 0) parts.push("no binding matched any slot in the layout — nothing to render");
    const bindingErrors = result.bindingFindings.filter((f) => f.severity === "error");
    if (bindingErrors.length > 0) parts.push(`malformed binding(s): ${bindingErrors.map((f) => f.message).join("; ")}`);
    throw new RenderError(
      "resolution-failed",
      `could not resolve document "${doc.id}" against its layout: ${parts.join("; ")}.`,
    );
  }

  const lookup = options.resolveCopyId ?? ((): undefined => undefined);
  const copyResult = resolveCopy(result, lookup);

  const textByKey = new Map<string, string>();
  for (const t of copyResult.texts) textByKey.set(t.key, t.text);

  const required = requiredSlotKeys(layout);
  const missingRequiredText = required.filter((key) => !textByKey.has(key));
  if (missingRequiredText.length > 0) {
    throw new RenderError(
      "empty-output",
      `resolved document "${doc.id}" against its layout, but required slot(s) [${missingRequiredText.join(", ")}] produced no text — every copyId binding must resolve via options.resolveCopyId, and every value binding must be non-empty. Rendering would silently ship an incomplete canvas, which this function refuses to do.`,
    );
  }

  const attemptedKeys = new Set(result.resolved.map((r) => r.key));

  // TOTAL LOSS, NOT PARTIAL — see this file's own top comment. A layout
  // with a real canvas-level background is never "empty" even with zero
  // resolved text slots; a layout with no background AND zero resolved
  // text slots has nothing left to paint at all.
  const flat = buildFlatTokenMap(options.tokenOverrides);
  const backgroundFill = layout.background?.background !== undefined ? resolveColorRole(layout.background.background, flat, "none") : undefined;

  if (textByKey.size === 0 && backgroundFill === undefined) {
    throw new RenderError(
      "empty-output",
      `resolved document "${doc.id}" against its layout, but every matched slot produced no usable text (unresolved copyId(s), or empty/ambiguous binding(s)) and the layout declares no background — there is nothing left to render. Omitted slot(s): ${[...attemptedKeys].join(", ")}.`,
    );
  }

  const warnings: string[] = [];
  for (const key of attemptedKeys) {
    if (!textByKey.has(key) && !required.includes(key)) {
      warnings.push(
        `slot "${key}" matched a binding but produced no text (unresolved copyId, or an empty/ambiguous binding) and was omitted from the render.`,
      );
    }
  }

  const { markup: slotsMarkup, overflowWarnings } = renderSlotsToSvg(layout, textByKey, canvas, flat);
  warnings.push(...overflowWarnings);

  const backgroundRect =
    backgroundFill !== undefined ? `<rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="${backgroundFill}" />` : "";

  return { markup: backgroundRect + slotsMarkup, warnings };
}
