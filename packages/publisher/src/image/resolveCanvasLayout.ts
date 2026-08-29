/**
 * The shared "resolve this document's bindings against this layout, then
 * paint every slot" pipeline behind BOTH `renderImageDocument` (one canvas)
 * and `./slides`' `renderSlidesDeck` (an ordered sequence of the same kind
 * of canvas, one call of this function per slide). Extracted here — rather
 * than duplicated once per channel, or left inline only in
 * `renderImageDocument.ts` for `./slides` to reach into — because the
 * resolution bar (`resolveDocument` then `resolveCopy`, never hand-rolled;
 * see this file's own logic below and `@clossys/publisher/core`'s own
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
 * bar exists to catch — the same rule `@clossys/publisher/core`'s own
 * `resolveDocument` enforces by refusing `ok: true` when `resolved.length
 * === 0` (see its doc comment, "THE BAR THIS FILE IS BUILT AGAINST"):
 * "resolved nothing" and "resolved cleanly" must never look the same to a
 * caller that only checks whether the call threw.
 *
 * The precise rule this function applies, stated once so it never has to
 * be reverse-engineered from behavior: after resolution, if NOT ONE
 * resolved binding produced usable content — no text AND no resolved asset
 * (`textByKey.size === 0 && assetByKey.size === 0`) — AND the layout
 * declares NO canvas-level `background` (`layout.background.background`),
 * there is nothing left to paint at all, and this function throws
 * `RenderError("empty-output", ...)` naming the document and every omitted
 * slot. A document with a real `background` but no text/asset slots is
 * NOT empty by this rule — a background-only canvas is legitimate,
 * deliberate content, not an accidental total loss, and rendering ONE such
 * document must never throw just because it happens to have no text or
 * images in it. This is deliberately NOT "count the `<text>`/`<image>`
 * elements in the output" — that would conflate a rendering detail (how
 * many DOM nodes a slot happens to produce) with the real question (did
 * resolution produce anything a caller asked for).
 *
 * THIS RULE USED TO ONLY LOOK AT TEXT — THAT WAS THE BUG
 * -------------------------------------------------------------
 * Before this file called `resolveDocumentAssets`, `textByKey` was the
 * ONLY content this function ever knew about — a document made entirely of
 * `assetId` bindings had `textByKey.size === 0` (every one of its slots is
 * legitimately `resolveCopy`'s `deferredToAssets`, never `texts`) and no
 * `layout.background` either, so this function threw `"empty-output"` for
 * a document that was never actually empty: `./image` was refusing to
 * render the exact shape of document `@clossys/publisher/core` 0.3.0
 * exists to make possible. Fixed by checking `assetByKey.size` alongside
 * `textByKey.size` everywhere this file asks "did anything resolve" — see
 * `resolveImageDocument.test.ts`'s (and `../image/renderImageDocument.test
 * .ts`'s) asset-only fixtures for the before/after.
 *
 * ASSETS GET A STRICTER BAR THAN OPTIONAL TEXT
 * -------------------------------------------------
 * An unresolved OPTIONAL text slot is a WARNING here, never fatal (see the
 * loop below). An `assetId` binding that fails to resolve into a real,
 * paintable asset does NOT get that leniency, required or not — this
 * function throws the moment `../internal/assets.ts`'s `hasAssetProblems`
 * is true for ANY bound asset slot, the identical bar `./web`/`./email`/
 * `./print` all hold `assetId` bindings to. "An unresolved asset id must
 * never render a blank box or a placeholder" (this package's own task
 * brief).
 *
 * VIDEO ON A CANVAS: A `RenderVideoAsset` REDUCES TO ITS `poster`, OR IT IS
 * FATAL (issue #177)
 * -------------------------------------------------------------------------
 * `./image`/`./slides` are SVG canvases — there is no `<video>`-equivalent
 * element, and this package's own README draws the line explicitly: real
 * playback support is `./web`-only. So the moment `resolveDocumentAssets`
 * resolves a `VideoAssetEntry`-sourced binding, this function reduces it to
 * its `poster` via `../internal/assets.ts`'s `resolveStaticAssets` — the
 * identical decision `./email`/`./print` make, made once and shared. A
 * video asset with a `poster` paints exactly like an image would (see
 * `renderSlots.ts`); a video asset with NO `poster` has nothing this
 * function can paint, and is treated with the identical fatal bar an
 * unresolved/invalid asset already gets — see `hasAssetProblems`'s own
 * check below, now joined by `staticAssets.posterlessVideo`.
 */

import { requiredSlotKeys, resolveCopy, resolveDocument } from "../core/index.js";
import type { AssetLookup, ComposeDocument, CopyLookup, LayoutSpec } from "../core/index.js";
import { RenderError } from "../internal/errors.js";
import { describeAssetProblems, describeStaticAssetProblems, hasAssetProblems, resolveDocumentAssets, resolveStaticAssets } from "../internal/assets.js";
import { buildFlatTokenMap, resolveColorRole, type CanvasPixelSize } from "./engine.js";
import { renderSlotsToSvg } from "./renderSlots.js";

export interface ResolveCanvasLayoutOptions {
  resolveCopyId?: CopyLookup;
  /** See `@clossys/publisher/core`'s own `AssetLookup`. Omit when no binding in the document uses `assetId` — every `assetId` binding is then treated as unresolved, which is always fatal for this pipeline (see this file's own top comment, "Assets get a stricter bar than optional text"). */
  resolveAssetId?: AssetLookup;
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

  // Never hand-rolled — see this file's own top comment, "Assets get a
  // stricter bar than optional text". ANY problem here is fatal,
  // regardless of which slot(s) it hit or whether they're required.
  const assetsResolution = resolveDocumentAssets(result, options.resolveAssetId);
  // See this file's own top comment, "Video on a canvas" — a resolved
  // video asset with no poster has nothing this SVG-canvas channel can
  // paint, and is exactly as fatal as an unresolved/invalid asset.
  const staticAssets = resolveStaticAssets(assetsResolution);
  if (hasAssetProblems(assetsResolution) || staticAssets.posterlessVideo.length > 0) {
    const parts = [...describeAssetProblems(assetsResolution), ...describeStaticAssetProblems(staticAssets)];
    throw new RenderError(
      "empty-output",
      `resolved document "${doc.id}" against its layout, but at least one assetId binding did not produce a real asset: ${parts.join("; ")}. Rendering would silently ship a canvas with a broken or missing image, which this function refuses to do.`,
    );
  }

  const textByKey = new Map<string, string>();
  for (const t of copyResult.texts) textByKey.set(t.key, t.text);
  const assetByKey = staticAssets.byKey;

  const required = requiredSlotKeys(layout);
  const missingRequiredContent = required.filter((key) => !textByKey.has(key) && !assetByKey.has(key));
  if (missingRequiredContent.length > 0) {
    throw new RenderError(
      "empty-output",
      `resolved document "${doc.id}" against its layout, but required slot(s) [${missingRequiredContent.join(", ")}] produced no content — every copyId binding must resolve via options.resolveCopyId, every value binding must be non-empty, and every assetId binding must resolve via options.resolveAssetId. Rendering would silently ship an incomplete canvas, which this function refuses to do.`,
    );
  }

  const attemptedKeys = new Set(result.resolved.map((r) => r.key));

  // TOTAL LOSS, NOT PARTIAL — see this file's own top comment. A layout
  // with a real canvas-level background is never "empty" even with zero
  // resolved text/asset slots; a layout with no background AND zero
  // resolved content has nothing left to paint at all.
  const flat = buildFlatTokenMap(options.tokenOverrides);
  const backgroundFill = layout.background?.background !== undefined ? resolveColorRole(layout.background.background, flat, "none") : undefined;

  if (textByKey.size === 0 && assetByKey.size === 0 && backgroundFill === undefined) {
    throw new RenderError(
      "empty-output",
      `resolved document "${doc.id}" against its layout, but every matched slot produced no usable content (unresolved copyId(s)/assetId(s), or empty/ambiguous binding(s)) and the layout declares no background — there is nothing left to render. Omitted slot(s): ${[...attemptedKeys].join(", ")}.`,
    );
  }

  const warnings: string[] = [];
  for (const key of attemptedKeys) {
    if (!textByKey.has(key) && !assetByKey.has(key) && !required.includes(key)) {
      warnings.push(
        `slot "${key}" matched a binding but produced no content (unresolved copyId, or an empty/ambiguous binding) and was omitted from the render.`,
      );
    }
  }

  const { markup: slotsMarkup, warnings: slotWarnings } = renderSlotsToSvg(layout, textByKey, assetByKey, canvas, flat);
  warnings.push(...slotWarnings);

  const backgroundRect =
    backgroundFill !== undefined ? `<rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="${backgroundFill}" />` : "";

  return { markup: backgroundRect + slotsMarkup, warnings };
}
