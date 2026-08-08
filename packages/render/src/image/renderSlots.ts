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
 * `SlotBinding` only ever carries plain text (see `renderImageDocument.ts`'s
 * own doc comment, "Only plain text ever fills a slot" — the same
 * constraint `./web` documents for itself), so every `ElementKind` this
 * function knows about is one of three strategies applied to that one
 * string:
 *   - TEXT kinds (`heading`, `subheading`, `body`, `eyebrow`, `label`,
 *     `stat`, `list`, `button`, `fill`) — wrapped, multi-line `<text>`, via
 *     `wrapText`.
 *   - MEDIA kinds (`image`, `logo`) — the resolved text is treated as a URL
 *     and emitted as `<image href="...">`, sized to the slot's frame.
 *   - `divider` — a horizontal `<line>` at the slot frame's vertical
 *     center; its own resolved text (if any) is not rendered as text at
 *     all — a divider's meaning is the line, not a caption.
 *
 * A slot with no entry in `textByKey` (its binding never resolved, or no
 * binding targeted it at all) is skipped entirely — no empty `<text>`, no
 * empty `<image href="">`. Deciding WHY a slot has no text (never bound,
 * vs. bound but unresolved) is the caller's job — see
 * `renderImageDocument.ts` for the warning it emits for the latter case.
 */

import type { LayoutSpec, SlotSpec, StyleBinding } from "@vespeneventures/compose";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE_PX,
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

export interface RenderSlotsResult {
  /** Concatenated `<g>...</g>` markup, one group per rendered slot, in `layout.slots` order. */
  markup: string;
  /** One entry per slot whose text needed more lines than its frame allows at this element kind's font size, and was truncated — see `wrapText`. Never silent. */
  overflowWarnings: string[];
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
  const fontSizePx = DEFAULT_FONT_SIZE_PX[spec.element];
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
    `<text x="${x}" y="${firstY}" font-size="${fontSizePx}" font-family="${DEFAULT_FONT_FAMILY}" fill="${color}" text-anchor="${anchor}">${tspans}</text>` +
    "</g>"
  );
}

function renderMediaSlot(spec: SlotSpec, text: string, rect: PixelRect, flat: ReadonlyMap<string, string>): string {
  const background = renderBackgroundRect(rect, spec.style, flat);
  return (
    `<g data-slot="${escapeXml(spec.key)}">${background}` +
    `<image x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" href="${escapeXml(text)}" preserveAspectRatio="xMidYMid slice" />` +
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
 * Renders every slot in `layout.slots` that has an entry in `textByKey`, in
 * declaration order. See this file's top comment for the per-`ElementKind`
 * strategy and for what happens to a slot with no resolved text.
 */
export function renderSlotsToSvg(
  layout: LayoutSpec,
  textByKey: ReadonlyMap<string, string>,
  canvas: CanvasPixelSize,
  flat: ReadonlyMap<string, string>,
): RenderSlotsResult {
  const overflowWarnings: string[] = [];
  const parts: string[] = [];

  for (const spec of layout.slots) {
    const text = textByKey.get(spec.key);
    if (text === undefined) continue;

    const rect = frameToCanvasRect(spec.frame, canvas);

    if (spec.element === "divider") {
      parts.push(renderDividerSlot(spec, rect, flat));
    } else if (MEDIA_ELEMENT_KINDS.has(spec.element)) {
      parts.push(renderMediaSlot(spec, text, rect, flat));
    } else if (TEXT_ELEMENT_KINDS.has(spec.element)) {
      parts.push(renderTextSlot(spec, text, rect, flat, overflowWarnings));
    }
  }

  return { markup: parts.join(""), overflowWarnings };
}
