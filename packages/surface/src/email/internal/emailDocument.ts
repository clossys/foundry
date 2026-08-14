/**
 * Assembles the complete, self-contained HTML document `renderEmailDocument`
 * returns — table-based layout, MSO conditional comments, a hidden
 * preheader, and every slot rendered as one full-width row in a ~600px
 * centered content table. See this package's README, "What email actually
 * requires," for the full list of hard constraints this file exists to
 * satisfy; each is called out inline below at the exact line that
 * satisfies it.
 *
 * WHY A HAND-BUILT STRING, NOT A TEMPLATE ENGINE OR `react-email`
 * ---------------------------------------------------------------------
 * Per this package's own conventions (see the README, "Every heavy or
 * channel-specific dependency is an OPTIONAL peer dependency" — and this
 * channel's own task brief, which prefers zero new dependencies): an email
 * HTML document is a string, table rows are a fixed, small, enumerable set
 * of shapes, and every value going into it is either a literal token
 * (`internal/styles.ts`) or already-escaped text (`internal/escapeHtml.ts`).
 * Nothing here needs a virtual DOM, a JSX runtime, or a componentized
 * templating layer to stay correct — and every byte this file emits is
 * exactly reproducible, which is what makes the golden test in
 * `../golden-render.test.ts` possible at all.
 */

import type { ElementKind, StyleBinding } from "../../core/index.js";
import type { StaticRenderAsset } from "../../internal/assets.js";
import { buildHiddenPreheaderContent, escapeHtml } from "./escapeHtml.js";
import type { EmailPalette } from "./styles.js";
import { readEmailToken, tdStyleForElement } from "./styles.js";

export interface EmailDocumentEntry {
  key: string;
  /** Canvas element kind on the deprecated positioned-email path only. */
  element?: ElementKind;
  text: string;
  /** The resolved slot's own `SlotSpec.style`, if it had one — read only for `style.typography` today (see `tdStyleForElement`'s own doc comment). */
  style?: StyleBinding;
  /**
   * When present, this entry came from an `assetId` binding — `buildRow`
   * paints an `<img>` for it instead of `text` (`text` is still populated,
   * with the asset's own `alt`, for `internal/plainText.ts` — see
   * `../internal/geometry.ts`'s own `GeometryEntry` doc comment).
   */
  asset?: StaticRenderAsset;
}

export interface BuildEmailHtmlInput {
  subject: string;
  preheader: string;
  entries: readonly EmailDocumentEntry[];
  palette: EmailPalette;
}

/**
 * One resolved asset slot's `<img>` tag. Every attribute Outlook's
 * Word-based rendering engine needs is emitted as a real HTML ATTRIBUTE,
 * never CSS alone (see this package's task brief: "Outlook needs
 * attributes") — `width`/`height` as bare-number attributes (the asset's
 * own INTRINSIC pixel dimensions; email has no frame/geometry concept for
 * an image to be sized against, the same reason `./web`'s own `<img>`
 * emits intrinsic dimensions rather than any layout size) plus
 * `border="0"` (some clients draw a default border around a linked/broken
 * image without it) and `display:block` (removes the few pixels of
 * baseline whitespace an inline `<img>` otherwise picks up beneath it,
 * consistent with this channel's own full-width block-stack model). `src`
 * is an OPAQUE string from the caller's asset registry — this function
 * never fetches it, never inlines it, and never inspects it beyond
 * escaping it exactly like every other untrusted string this channel
 * emits (`escapeHtml` — see that module's own doc comment for exactly what
 * it defends against, including a `src`/`alt` containing a raw `"` or
 * `</script...` sequence).
 */
function buildImageTag(asset: StaticRenderAsset): string {
  return (
    `<img src="${escapeHtml(asset.src)}" alt="${escapeHtml(asset.alt)}" width="${asset.width}" height="${asset.height}" ` +
    `border="0" style="display:block" />`
  );
}

/** One resolved slot's `<tr><td>...</td></tr>` row — an `<img>` (via {@link buildImageTag}) when `entry.asset` is present, escaped text otherwise. `escapeHtml` is the ONLY thing standing between a slot's resolved text/asset fields and this document's markup — see that module's own doc comment for exactly what it defends against. */
function buildRow(entry: EmailDocumentEntry, palette: EmailPalette): string {
  const style = tdStyleForElement(entry.element ?? "body", palette, entry.style, `slot "${entry.key}"`);
  const content = entry.asset !== undefined ? buildImageTag(entry.asset) : escapeHtml(entry.text);
  return `<tr><td style="${style}">${content}</td></tr>`;
}

/**
 * Builds the complete HTML document.
 *
 * SATISFIED HERE, LINE BY LINE — see the README for the full list:
 *   - table-based layout: every structural element below is a
 *     `<table role="presentation" cellpadding="0" cellspacing="0"
 *     border="0">`, never a `<div>` with flex/grid.
 *   - ~600px content width inside a full-width wrapper, centered: the
 *     outer `width="100%"` table centers an inner `width="600"` one via
 *     `align="center"`/`margin:0 auto`.
 *   - MSO conditional comments: a ghost `<table>` (real Outlook desktop
 *     ignores CSS `max-width`/`margin:auto` centering, so the VML-less but
 *     MSO-recognized `<!--[if mso]>` table forces the same 600px centered
 *     box) plus `<o:OfficeDocumentSettings>` fixing Word's DPI-driven
 *     image/measurement scaling.
 *   - hidden preheader: the `display:none` block immediately after
 *     `<body>`, built by `buildHiddenPreheaderContent` (real text +
 *     invisible filler so an inbox preview can't scavenge real body text
 *     after it — see that function's own doc comment).
 *   - every color/size/font literal: every value substituted below comes
 *     from `palette` (`internal/styles.ts`'s `buildEmailPalette`, itself
 *     `internal/tokens.ts`'s `flattenTokens`) or from
 *     `tdStyleForElement`, neither of which ever emits `var(--...)` or
 *     `oklch(...)` — see `internal/styles.ts`'s own top comment.
 */
export function buildEmailHtml(input: BuildEmailHtmlInput): string {
  const { subject, preheader, entries, palette } = input;

  const bodyBg = readEmailToken(palette, "--color-surface-base");
  const cardBg = readEmailToken(palette, "--color-surface-raised");
  const preheaderContent = buildHiddenPreheaderContent(preheader);
  const rows = entries.map((entry) => buildRow(entry, palette)).join("");

  return (
    "<!doctype html>" +
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">' +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="X-UA-Compatible" content="IE=edge">' +
    '<meta name="color-scheme" content="light">' +
    `<title>${escapeHtml(subject)}</title>` +
    "<!--[if mso]>" +
    "<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>" +
    "<![endif]-->" +
    "</head>" +
    `<body style="margin:0;padding:0;background-color:${bodyBg};">` +
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheaderContent}</div>` +
    '<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${bodyBg};">` +
    "<tr>" +
    '<td align="center" style="padding:0;">' +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;margin:0 auto;background-color:${cardBg};">` +
    rows +
    "</table>" +
    "</td>" +
    "</tr>" +
    "</table>" +
    "<!--[if mso]></td></tr></table><![endif]-->" +
    "</body>" +
    "</html>"
  );
}
