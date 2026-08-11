/**
 * Turns one `LayoutSpec` plus a `slot key -> resolved text` map into SVG
 * markup — the second half of the shared canvas engine (see `engine.ts`'s
 * own top comment for why this lives directly under `src/image/` and is
 * shared, by relative import, with `./slides`). `engine.ts` supplies the
 * pure math (frame -> rect, text wrapping, color resolution); this file is
 * where that math becomes actual `<text>`/`<image>`/`<line>`/`<rect>`
 * elements, in `layout.slots` array order (later slots paint over earlier
 * ones, the same z-order a caller would expect from any positioned-layer
 * format).
 *
 * ELEMENTKIND -> MARKUP STRATEGY
 * -------------------------------
 * `SlotBinding` carries plain text OR (since `@vespeneventures/surface/core`
 * 0.3.0) a real asset — see `renderImageDocument.ts`'s own doc comment —
 * so every `ElementKind` this function knows about is one of four
 * strategies:
 *   - TEXT kinds (`heading`, `subheading`, `body`, `eyebrow`, `label`,
 *     `stat`, `list`, `button`, `fill`) — wrapped, multi-line `<text>`, via
 *     `wrapText`.
 *   - MEDIA kinds bound via `assetId` (`image`, `logo`) — a real, validated
 *     `RenderAsset` (`../internal/assets.ts`), emitted as `<image href=...
 *     x= y= width= height=>` sized to the slot's frame, with a `<title>`/
 *     `aria-label` carrying `asset.alt` and an aspect-ratio-aware
 *     `preserveAspectRatio` — see {@link renderAssetMediaSlot}.
 *   - MEDIA kinds bound via `copyId`/`value` instead of `assetId` (`image`,
 *     `logo`, no matching entry in `assetByKey`) — the resolved TEXT is
 *     treated as a bare URL, same as before this package's asset support
 *     existed. Kept as a fallback for a caller with no
 *     `@vespeneventures/surface/media`-shaped registry at all, but with no `alt`
 *     text and no aspect-ratio awareness — see {@link renderLegacyTextMediaSlot}
 *     for exactly what it does and does not guarantee, and prefer
 *     `assetId` whenever accessible, non-distorting output matters.
 *   - `divider` — a horizontal `<line>` at the slot frame's vertical
 *     center; its own resolved text (if any) is not rendered as text at
 *     all — a divider's meaning is the line, not a caption.
 *
 * A slot with no entry in `textByKey`/`assetByKey` (its binding never
 * resolved, or no binding targeted it at all) is skipped entirely — no
 * empty `<text>`, no empty `<image href="">`. Deciding WHY a slot has no
 * content (never bound, vs. bound but unresolved) is the caller's job —
 * see `resolveCanvasLayout.ts` for the warning it emits for the latter
 * case, and for why an unresolved `assetId` (unlike an unresolved OPTIONAL
 * `copyId`) is never silently skipped this way — that failure is refused
 * before this function is ever called at all.
 */

import type { LayoutSpec, SlotSpec, StyleBinding } from "../core/index.js";
import type { RenderAsset } from "../internal/assets.js";
import { resolveElementFontFamily, resolveElementTypography } from "../internal/typography.js";
import {
  escapeXml,
  frameToCanvasRect,
  resolveColorRole,
  wrapText,
  type CanvasPixelSize,
  type PixelRect,
} from "./engine.js";

const TEXT_ELEMENT_KINDS = new Set([
  "heading",
  "subheading",
  "body",
  "eyebrow",
  "label",
  "stat",
  "list",
  "button",
  "fill",
]);
const MEDIA_ELEMENT_KINDS = new Set(["image", "logo"]);

/** Fallback literal hex colors used only when a slot's `style` gives no role name to resolve — see `resolveColorRole`'s own doc comment. Never `oklch(...)`, never a token role — a genuinely last-resort literal. */
const FALLBACK_TEXT_HEX = "#111111";
const FALLBACK_DIVIDER_HEX = "#cccccc";

const LINE_HEIGHT_MULTIPLIER = 1.2;
/** The fraction of `fontSizePx` from a line's top to its text baseline — a fixed approximation (typical for sans-serif fonts), not measured per font. See `engine.ts`'s `wrapText` doc comment for this module's general stance on font-metrics accuracy. */
const BASELINE_ASCENT_RATIO = 0.8;

/**
 * How far apart a frame's `w/h` and an asset's `width/height` aspect ratios
 * must be before {@link renderAssetMediaSlot} reports a mismatch warning —
 * an ABSOLUTE difference between the two ratios (both dimensionless), not a
 * relative one, chosen so the warning fires for any visually meaningful
 * crop/letterbox and stays silent on float noise from `frameToCanvasRect`'s
 * own fraction -> pixel multiplication (see `engine.test.ts`'s "reference
 * deltas" for the general scale of that noise elsewhere in this package).
 */
const ASPECT_RATIO_WARNING_EPSILON = 0.005;

export interface RenderSlotsResult {
  /** Concatenated `<g>...</g>` markup, one group per rendered slot, in `layout.slots` order. */
  markup: string;
  /** One entry per slot whose text needed more lines than its frame allows at this element kind's font size, and was truncated (see `wrapText`), OR whose `assetId`-resolved image's intrinsic aspect ratio disagreed with its frame's (see {@link renderAssetMediaSlot}). Never silent. */
  warnings: string[];
}

function anchorFor(align: SlotSpec["align"], rect: PixelRect): { x: number; anchor: "start" | "middle" | "end" } {
  switch (align) {
    case "center":
      return { x: rect.x + rect.w / 2, anchor: "middle" };
    case "end":
      return { x: rect.x + rect.w, anchor: "end" };
    case "start":
    default:
      return { x: rect.x, anchor: "start" };
  }
}

function firstBaselineY(vAlign: SlotSpec["vAlign"], rect: PixelRect, blockHeight: number, fontSizePx: number): number {
  const ascent = fontSizePx * BASELINE_ASCENT_RATIO;
  switch (vAlign) {
    case "middle":
      return rect.y + (rect.h - blockHeight) / 2 + ascent;
    case "bottom":
      return rect.y + rect.h - blockHeight + ascent;
    case "top":
    default:
      return rect.y + ascent;
  }
}

function renderBackgroundRect(rect: PixelRect, style: StyleBinding | undefined, flat: ReadonlyMap<string, string>): string {
  if (style?.background === undefined) return "";
  const fill = resolveColorRole(style.background, flat, "none");
  return `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${fill}" />`;
}

function renderTextSlot(
  spec: SlotSpec,
  text: string,
  rect: PixelRect,
  flat: ReadonlyMap<string, string>,
  warnings: string[],
): string {
  // RESOLVED, never the deleted placeholder table: `style.typography`
  // overrides the ElementKind default when present (see `../internal/
  // typography.ts`'s own doc comment); either way, `fontSizePx` below is
  // the REAL token value, so `wrapText`'s line-breaking and this slot's
  // own overflow warning both reflect the size actually painted, not a
  // stale hardcoded number that would silently mis-measure wrapping and
  // report the wrong font-size in an overflow warning.
  const typography = resolveElementTypography(spec.element, spec.style, `slot "${spec.key}"`, flat);
  const fontSizePx = typography.px;
  const fontFamily = resolveElementFontFamily(spec.element, flat);
  const lineHeightPx = fontSizePx * LINE_HEIGHT_MULTIPLIER;
  const color = resolveColorRole(spec.style?.color, flat, FALLBACK_TEXT_HEX);
  const wrapped = wrapText(text, { fontSizePx, widthPx: rect.w, heightPx: rect.h, lineHeightMultiplier: LINE_HEIGHT_MULTIPLIER });

  if (wrapped.overflowed) {
    warnings.push(
      `slot "${spec.key}" (element "${spec.element}") text overflowed its frame at font-size ${fontSizePx}px and was truncated — see wrapText in src/image/engine.ts for the wrapping heuristic and its accuracy limits.`,
    );
  }

  if (wrapped.lines.length === 0) return "";

  const { x, anchor } = anchorFor(spec.align, rect);
  const blockHeight = wrapped.lines.length * lineHeightPx;
  const firstY = firstBaselineY(spec.vAlign, rect, blockHeight, fontSizePx);

  const background = renderBackgroundRect(rect, spec.style, flat);
  const tspans = wrapped.lines
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeightPx}">${escapeXml(line)}</tspan>`)
    .join("");

  return (
    `<g data-slot="${escapeXml(spec.key)}">${background}` +
    `<text x="${x}" y="${firstY}" font-size="${fontSizePx}" font-family="${escapeXml(fontFamily)}" fill="${color}" text-anchor="${anchor}">${tspans}</text>` +
    "</g>"
  );
}

/**
 * The pre-`assetId` fallback: a slot's resolved TEXT (from `copyId`/
 * `value`), treated as a bare image URL and emitted as `<image href=...>`.
 * Kept for a caller with no `@vespeneventures/surface/media`-shaped registry —
 * only ever called for a MEDIA-kind slot with NO entry in `assetByKey`
 * (see `renderSlotsToSvg`'s own dispatch) — but deliberately weaker than
 * {@link renderAssetMediaSlot}: no `alt` text (this path has no asset
 * record to read one from — a bare URL string carries no accessible
 * description), and no aspect-ratio comparison (no intrinsic
 * `width`/`height` to compare the frame against either). A caller who
 * wants accessible, aspect-ratio-aware image output registers the asset
 * and binds via `assetId` instead.
 */
function renderLegacyTextMediaSlot(spec: SlotSpec, text: string, rect: PixelRect, flat: ReadonlyMap<string, string>): string {
  const background = renderBackgroundRect(rect, spec.style, flat);
  return (
    `<g data-slot="${escapeXml(spec.key)}">${background}` +
    `<image x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" href="${escapeXml(text)}" preserveAspectRatio="xMidYMid slice" />` +
    "</g>"
  );
}

/**
 * A slot resolved via `assetId` — a real, shape-validated `RenderAsset`
 * (`../internal/assets.ts`) — emitted as `<image href=... x= y= width=
 * height=>`, sized to the slot's frame exactly like every other kind of
 * slot. Two things this function does that {@link renderLegacyTextMediaSlot}
 * cannot:
 *
 *   - **`asset.alt` always reaches the output.** Both a `<title>` child
 *     (the SVG-native accessible-name mechanism, read by SVG-aware screen
 *     readers and matching this package's own `renderImageDocument.ts`
 *     convention for the whole canvas's `ImageMeta.alt`) AND an
 *     `aria-label` attribute (the redundant, ARIA-native path — some
 *     assistive tech reads one but not the other, so this function commits
 *     to both rather than picking one and hoping) — see the task brief:
 *     "an asset renderer that drops the alt text it was handed is a bug."
 *   - **`preserveAspectRatio`, chosen per `ElementKind`, plus a warning
 *     when the asset's own aspect ratio disagrees with its frame's.**
 *     `"logo"` gets `xMidYMid meet` (fit inside the frame, letterboxed,
 *     NEVER cropped — a wordmark with its edges cut off is a worse outcome
 *     than a wordmark with visible empty space around it). `"image"` gets
 *     `xMidYMid slice` (fill the frame, cropped — the conventional
 *     behaviour for a photographic/hero-style image, where empty
 *     letterbox bars read as more obviously broken than a crop). NEITHER
 *     setting ever DISTORTS the asset (SVG's `preserveAspectRatio` only
 *     distorts when explicitly set to `"none"`, which this function never
 *     uses) — but a frame whose aspect ratio disagrees with the asset's own
 *     still means real content is being cropped or letterboxed away from
 *     what the layout asked for, which is exactly the kind of silent
 *     surprise this package's own "never a silent fallback" discipline
 *     (see `internal/tokens.ts`'s own doc comment) exists to catch. So this
 *     function compares the two ratios and pushes a warning — never a
 *     throw; a mismatched aspect ratio is a legitimate, common situation
 *     (a wide hero photo dropped into a square avatar frame), not a
 *     resolution failure — into `warnings` whenever they disagree by more
 *     than {@link ASPECT_RATIO_WARNING_EPSILON}, and says nothing at all
 *     when they agree, so the warning is trustworthy signal, not noise
 *     that fires on every render regardless of input.
 */
function renderAssetMediaSlot(
  spec: SlotSpec,
  asset: RenderAsset,
  rect: PixelRect,
  flat: ReadonlyMap<string, string>,
  warnings: string[],
): string {
  const background = renderBackgroundRect(rect, spec.style, flat);

  const preserveAspectRatio = spec.element === "logo" ? "xMidYMid meet" : "xMidYMid slice";

  if (rect.w > 0 && rect.h > 0) {
    const frameAspect = rect.w / rect.h;
    const assetAspect = asset.width / asset.height;
    if (Math.abs(frameAspect - assetAspect) > ASPECT_RATIO_WARNING_EPSILON) {
      const behavior = spec.element === "logo" ? "letterboxed (never cropped)" : "filled and cropped";
      warnings.push(
        `slot "${spec.key}" (element "${spec.element}") asset's intrinsic aspect ratio (${asset.width}x${asset.height}, ${assetAspect.toFixed(3)}) disagrees with its frame's aspect ratio (${rect.w}x${rect.h}, ${frameAspect.toFixed(3)}) — rendered ${behavior} via preserveAspectRatio="${preserveAspectRatio}" rather than distorted.`,
      );
    }
  }

  const escapedAlt = escapeXml(asset.alt);

  return (
    `<g data-slot="${escapeXml(spec.key)}">${background}` +
    `<image x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" href="${escapeXml(asset.src)}" ` +
    `preserveAspectRatio="${preserveAspectRatio}" aria-label="${escapedAlt}"><title>${escapedAlt}</title></image>` +
    "</g>"
  );
}

function renderDividerSlot(spec: SlotSpec, rect: PixelRect, flat: ReadonlyMap<string, string>): string {
  const color = resolveColorRole(spec.style?.color ?? spec.style?.border, flat, FALLBACK_DIVIDER_HEX);
  const y = rect.y + rect.h / 2;
  return (
    `<g data-slot="${escapeXml(spec.key)}">` +
    `<line x1="${rect.x}" y1="${y}" x2="${rect.x + rect.w}" y2="${y}" stroke="${color}" stroke-width="1" />` +
    "</g>"
  );
}

/**
 * Renders every slot in `layout.slots` that has an entry in
 * `assetByKey`/`textByKey`, in declaration order. See this file's top
 * comment for the per-`ElementKind` strategy and for what happens to a
 * slot with no resolved content. A MEDIA-kind slot (`image`/`logo`) checks
 * `assetByKey` FIRST — {@link renderAssetMediaSlot}'s real, `alt`-bearing,
 * aspect-ratio-aware output — and only falls back to the weaker
 * `textByKey`-as-URL path ({@link renderLegacyTextMediaSlot}) when no
 * asset was resolved for that key; a slot resolved via `assetId` is never
 * ALSO in `textByKey` (`resolveCopy`/`resolveDocumentAssets` each defer
 * the other's bindings — see `../internal/assets.ts`), so this is a clean
 * either/or, never a double-render.
 */
export function renderSlotsToSvg(
  layout: LayoutSpec,
  textByKey: ReadonlyMap<string, string>,
  assetByKey: ReadonlyMap<string, RenderAsset>,
  canvas: CanvasPixelSize,
  flat: ReadonlyMap<string, string>,
): RenderSlotsResult {
  const warnings: string[] = [];
  const parts: string[] = [];

  for (const spec of layout.slots) {
    const asset = assetByKey.get(spec.key);
    const text = textByKey.get(spec.key);
    if (asset === undefined && text === undefined) continue;

    const rect = frameToCanvasRect(spec.frame, canvas);

    if (spec.element === "divider") {
      parts.push(renderDividerSlot(spec, rect, flat));
    } else if (asset !== undefined && MEDIA_ELEMENT_KINDS.has(spec.element)) {
      parts.push(renderAssetMediaSlot(spec, asset, rect, flat, warnings));
    } else if (text !== undefined && MEDIA_ELEMENT_KINDS.has(spec.element)) {
      parts.push(renderLegacyTextMediaSlot(spec, text, rect, flat));
    } else if (text !== undefined && TEXT_ELEMENT_KINDS.has(spec.element)) {
      parts.push(renderTextSlot(spec, text, rect, flat, warnings));
    }
  }

  return { markup: parts.join(""), warnings };
}
