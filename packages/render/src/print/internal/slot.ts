/**
 * One resolved `SlotSpec` + its text -> one absolutely-positioned `<div>`.
 * Combines this channel's collaborators: `geometry.ts` for frame->percent
 * placement, `style.ts` for token-role->hex colour AND (see
 * `resolveStyleTypography`) token-role->literal `font-size`/`font-family`,
 * and `escape.ts` for safe text/attribute embedding.
 *
 * EVERY SLOT GETS A RESOLVED FONT SIZE/FAMILY, ALWAYS
 * -----------------------------------------------------
 * Unlike colour (`style.color`/`.background`, both optional — a slot with
 * neither simply inherits whatever the page's own `color` is), typography
 * is NEVER omitted: `resolveStyleTypography` always returns a real
 * `fontSize`/`fontFamily`, because every `ElementKind` has a real default
 * role in `../../internal/typography.ts`'s `ELEMENT_TYPOGRAPHY_ROLE`/
 * `ELEMENT_FONT_FAMILY_ROLE`. Before this was wired in, `./print` emitted NO
 * typography at all, leaving every slot's size/family to whatever default
 * the receiving browser or print pipeline happened to pick — silently
 * ignoring the design system's own type scale exactly the way `./image`/
 * `./slides`' now-deleted `DEFAULT_FONT_SIZE_PX` placeholder table did.
 *
 * PAGE-BREAK CONTROL
 * -------------------
 * Every slot gets `break-inside:avoid;page-break-inside:avoid;` by default
 * — modern `break-inside` (CSS Fragmentation Module Level 3) plus the
 * legacy CSS 2.1 `page-break-inside` property alongside it, the same
 * belt-and-suspenders pairing real print stylesheets and prepress tooling
 * still use, since not every consumer of this HTML is a bang-up-to-date
 * browser. A print/prepress document splitting a heading or a stat
 * mid-way across a page boundary is almost never intentional, so "avoid"
 * is the default; a caller who genuinely wants a slot to flow across pages
 * (long body copy, say) opts it out via
 * `RenderPrintOptions.allowBreakInside`. `breakBefore`/`breakAfter` are
 * the opposite knob — force a slot to start a fresh page
 * (`break-before:page;page-break-before:always;`) or be followed by one
 * (`break-after:page;page-break-after:always;`).
 */

import type { SlotSpec } from "@vespeneventures/compose";
import type { RenderPrintOptions } from "../types.js";
import { escapeHtmlAttr, escapeHtmlText } from "./escape.js";
import { frameToPercentStrings } from "./geometry.js";
import { resolveStyleColors, resolveStyleTypography } from "./style.js";

const ALIGN_TO_TEXT_ALIGN: Record<NonNullable<SlotSpec["align"]>, string> = {
  start: "start",
  center: "center",
  end: "end",
};

const VALIGN_TO_JUSTIFY_CONTENT: Record<NonNullable<SlotSpec["vAlign"]>, string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

type BreakOptions = Pick<RenderPrintOptions, "breakBefore" | "breakAfter" | "allowBreakInside">;

function breakDeclarations(key: string, options: BreakOptions): string[] {
  const decls: string[] = [];
  if (!(options.allowBreakInside ?? []).includes(key)) {
    decls.push("break-inside:avoid", "page-break-inside:avoid");
  }
  if ((options.breakBefore ?? []).includes(key)) {
    decls.push("break-before:page", "page-break-before:always");
  }
  if ((options.breakAfter ?? []).includes(key)) {
    decls.push("break-after:page", "page-break-after:always");
  }
  return decls;
}

/**
 * Builds one `<div class="slot" ...>` for `spec`, filled with `text`.
 * `spec.vAlign`, when present, switches the box to a column flex container
 * so its text can be justified top/middle/bottom within a fixed-height
 * box; `spec.align` always maps to `text-align`, independent of that.
 */
export function buildSlotHtml(
  spec: SlotSpec,
  text: string,
  flat: ReadonlyMap<string, string>,
  options: BreakOptions,
): string {
  const { left, top, width, height } = frameToPercentStrings(spec.frame);
  const { color, backgroundColor } = resolveStyleColors(spec.style, `slot "${spec.key}"`, flat);
  const { fontSize, fontFamily } = resolveStyleTypography(spec.element, spec.style, `slot "${spec.key}"`, flat);

  const styleParts = [
    "position:absolute",
    `left:${left}%`,
    `top:${top}%`,
    `width:${width}%`,
    `height:${height}%`,
    ...(spec.vAlign !== undefined ? ["display:flex", "flex-direction:column", `justify-content:${VALIGN_TO_JUSTIFY_CONTENT[spec.vAlign]}`] : []),
    ...(spec.align !== undefined ? [`text-align:${ALIGN_TO_TEXT_ALIGN[spec.align]}`] : []),
    `font-family:${fontFamily}`,
    `font-size:${fontSize}`,
    ...(color !== undefined ? [`color:${color}`] : []),
    ...(backgroundColor !== undefined ? [`background-color:${backgroundColor}`] : []),
    ...breakDeclarations(spec.key, options),
  ];

  return (
    `<div class="slot" data-slot="${escapeHtmlAttr(spec.key)}" data-element="${escapeHtmlAttr(spec.element)}" ` +
    `style="${styleParts.join(";")}">${escapeHtmlText(text)}</div>`
  );
}
