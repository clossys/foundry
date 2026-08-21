/**
 * `@page` rule construction — the CSS Paged Media Module Level 3 (W3C)
 * `size` / `margin-*` / `bleed` / `marks` descriptors, driven entirely by
 * `PrintMeta`. See https://www.w3.org/TR/css-page-3/ for the formal
 * grammar this file implements:
 *
 *   size  = <length>{1,2} | auto | [ <page-size> || [ portrait | landscape ] ]
 *   <page-size> = A5 | A4 | A3 | B5 | B4 | JIS-B5 | JIS-B4 | letter | legal | ledger
 *   bleed = auto | <length>
 *   marks = none | [ crop || cross ]
 *
 * Two facts from that grammar drive the split below between named sizes and
 * `"Custom"`:
 *   - a NAMED page-size keyword (`A4`, `letter`) may be paired with a
 *     `portrait`/`landscape` keyword (`size: A4 landscape;`) — this is the
 *     `<page-size> || [ portrait | landscape ]` branch of the grammar;
 *   - explicit LENGTHS cannot be paired with that keyword at all — the
 *     grammar's `<length>{1,2}` branch is a separate alternative, so
 *     `size: 148mm 210mm portrait;` is not valid CSS. A `"Custom"` page
 *     therefore emits ONLY the two lengths, in the exact width/height order
 *     the caller supplied via `RenderPrintOptions.customPageSize` — the
 *     caller is responsible for having already oriented them (a landscape
 *     custom page passes `{ width: "297mm", height: "210mm" }`), which is
 *     also why `PrintMeta.orientation` is never read for `"Custom"`.
 *
 * `bleed`'s own spec definition: "This property only has an effect if the
 * value of the 'marks' property is 'crop'." This file does not enforce that
 * — a `bleed` declaration with `marks:none` (or omitted) is harmless dead
 * CSS, not a defect this renderer needs to guard against — it only cites it
 * here so a reader isn't surprised that `meta.bleed` alone, with
 * `meta.cropMarks` unset, visibly does nothing when printed.
 */

import type { PrintMeta } from "../../core/index.js";
import { RenderError } from "../../internal/errors.js";
import type { CustomPageSize } from "../types.js";

/** The page's real, resolved total dimensions — a CSS length pair. What every `@page`/`.page` box is sized from. */
export interface PageBox {
  width: string;
  height: string;
}

const NAMED_PAGE_SIZES = {
  A4: { portrait: { width: "210mm", height: "297mm" }, landscape: { width: "297mm", height: "210mm" } },
  Letter: { portrait: { width: "8.5in", height: "11in" }, landscape: { width: "11in", height: "8.5in" } },
} as const satisfies Record<"A4" | "Letter", Record<"portrait" | "landscape", PageBox>>;

/**
 * The `size` descriptor's own page-size keyword for a named
 * `PrintMeta.pageSize` — CSS spells A4's keyword `"A4"` and Letter's
 * `"letter"` (see this file's own grammar citation above); never used for
 * `"Custom"`, which emits raw lengths instead.
 */
const PAGE_SIZE_KEYWORD: Record<"A4" | "Letter", string> = { A4: "A4", Letter: "letter" };

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/**
 * Resolves `meta.pageSize` (plus, for `"Custom"`, the caller's
 * `customPageSize`) into a real `PageBox`.
 *
 * Throws `RenderError("missing-custom-page-size", ...)` when
 * `meta.pageSize === "Custom"` and `customPageSize` is absent, or either of
 * its `width`/`height` is missing or blank — see this package's README,
 * "`pageSize: "Custom"` with no explicit dimensions is an ERROR, not a
 * default": silently falling back to A4 here means someone prints 500
 * copies at the wrong trim size, so this is a hard refusal, never a
 * default.
 */
export function resolvePageBox(meta: PrintMeta, customPageSize: CustomPageSize | undefined): PageBox {
  if (meta.pageSize === "Custom") {
    if (customPageSize === undefined || isBlank(customPageSize.width) || isBlank(customPageSize.height)) {
      throw new RenderError(
        "missing-custom-page-size",
        `renderPrintDocument: doc.meta.pageSize is "Custom", which carries no dimensions of its own — ` +
          `options.customPageSize must supply both "width" and "height" as non-blank CSS lengths ` +
          `(e.g. { width: "148mm", height: "210mm" }). Refusing to fall back to A4: a silent default here ` +
          `means printing at the wrong trim size.`,
      );
    }
    return { width: customPageSize.width, height: customPageSize.height };
  }
  return NAMED_PAGE_SIZES[meta.pageSize][meta.orientation];
}

/**
 * Builds the full `@page { ... }` rule text for `meta`, against the
 * already-resolved `pageBox` (see `resolvePageBox`). Every declaration is
 * emitted with no internal whitespace (`size:A4 portrait;`, not
 * `size: A4 portrait;`) — a deliberate, consistent convention across this
 * whole channel's emitted CSS (see `internal/document.ts`), so a golden
 * test asserts one unambiguous byte sequence rather than a
 * whitespace-tolerant pattern.
 */
export function buildPageAtRuleCss(meta: PrintMeta, pageBox: PageBox): string {
  const sizeDecl =
    meta.pageSize === "Custom"
      ? `size:${pageBox.width} ${pageBox.height};`
      : `size:${PAGE_SIZE_KEYWORD[meta.pageSize]} ${meta.orientation};`;

  const marginDecl =
    `margin-top:${meta.margins.top};` +
    `margin-right:${meta.margins.right};` +
    `margin-bottom:${meta.margins.bottom};` +
    `margin-left:${meta.margins.left};`;

  const bleedDecl = meta.bleed !== undefined ? `bleed:${meta.bleed};` : "";
  const marksDecl = meta.cropMarks === true ? "marks:crop;" : "";

  return `@page{${sizeDecl}${marginDecl}${bleedDecl}${marksDecl}}`;
}
