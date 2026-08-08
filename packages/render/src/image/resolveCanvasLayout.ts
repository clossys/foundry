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

  const warnings: string[] = [];
  const attemptedKeys = new Set(result.resolved.map((r) => r.key));
  for (const key of attemptedKeys) {
    if (!textByKey.has(key) && !required.includes(key)) {
      warnings.push(
        `slot "${key}" matched a binding but produced no text (unresolved copyId, or an empty/ambiguous binding) and was omitted from the render.`,
      );
    }
  }

  const flat = buildFlatTokenMap(options.tokenOverrides);
  const { markup: slotsMarkup, overflowWarnings } = renderSlotsToSvg(layout, textByKey, canvas, flat);
  warnings.push(...overflowWarnings);

  const backgroundFill = layout.background?.background !== undefined ? resolveColorRole(layout.background.background, flat, "none") : undefined;
  const backgroundRect =
    backgroundFill !== undefined ? `<rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="${backgroundFill}" />` : "";

  return { markup: backgroundRect + slotsMarkup, warnings };
}
