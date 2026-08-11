/**
 * Assembles the complete, standalone HTML document string
 * `renderPrintDocument` returns — `<!doctype html>` through `</html>`, one
 * `<div class="page">` containing one `<div class="page-content">`
 * (positioned inset by `meta.margins` from the page's own edges) containing
 * one absolutely-positioned `<div class="slot">` per resolved slot (see
 * `slot.ts`). See this package's README, "The key architectural decision"
 * for why this is a plain HTML+CSS string and not a PDF.
 *
 * CONTAINING-BLOCK GEOMETRY, WHY NO `calc()` IS NEEDED
 * -------------------------------------------------------
 * `.page-content` is positioned with all four insets (`top`/`right`/
 * `bottom`/`left`) set to `meta.margins`' own values, on an element that is
 * itself `position:absolute` — which already makes it a positioned element
 * (a valid containing block for ITS OWN absolutely positioned children)
 * without an extra `position:relative` wrapper, and without ever computing
 * `width: calc(100% - left - right)` by hand: an element with
 * `position:absolute` and both `left`/`right` (or both `top`/`bottom`) set,
 * and `width`/`height` left `auto`, derives its own size from the gap
 * between them automatically — CSS Positioned Layout's own resolution for
 * that "over-constrained" case. So `.page-content`'s box is exactly "the
 * page, minus its margins" with no arithmetic on this file's part, and
 * every `.slot` child's `left`/`top`/`width`/`height` percentage (from
 * `geometry.ts`) resolves against exactly that box — which is what makes
 * `Frame`'s "0..1 fraction of the canvas" promise
 * (`@vespeneventures/surface/core`'s own `types.ts`) true for print
 * specifically: the canvas IS the page's printable area, not the page
 * including its margins.
 */

import type { ComposeDocument } from "../../core/index.js";
import { escapeHtmlAttr, escapeHtmlText } from "./escape.js";
import type { PageBox } from "./page.js";

/** Fixed, deliberately minimal reset — nothing in this channel depends on any framework's own reset. */
const RESET_CSS = "*{box-sizing:border-box;}html,body{margin:0;padding:0;}";

export interface DocumentParts {
  doc: ComposeDocument;
  pageBox: PageBox;
  pageAtRuleCss: string;
  pageColor: string | undefined;
  pageBackgroundColor: string | undefined;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  slotsHtml: string;
}

export function buildHtmlDocument(parts: DocumentParts): string {
  const pageStyleParts = [
    "position:relative",
    `width:${parts.pageBox.width}`,
    `height:${parts.pageBox.height}`,
    ...(parts.pageBackgroundColor !== undefined ? [`background-color:${parts.pageBackgroundColor}`] : []),
    ...(parts.pageColor !== undefined ? [`color:${parts.pageColor}`] : []),
  ];

  const contentStyleParts = [
    "position:absolute",
    `top:${parts.marginTop}`,
    `right:${parts.marginRight}`,
    `bottom:${parts.marginBottom}`,
    `left:${parts.marginLeft}`,
  ];

  return (
    "<!doctype html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="utf-8">' +
    `<title>${escapeHtmlText(parts.doc.id)}</title>` +
    `<style>${parts.pageAtRuleCss}${RESET_CSS}</style>` +
    "</head>" +
    "<body>" +
    `<div class="page" data-template="${escapeHtmlAttr(parts.doc.template)}" style="${pageStyleParts.join(";")}">` +
    `<div class="page-content" style="${contentStyleParts.join(";")}">` +
    parts.slotsHtml +
    "</div>" +
    "</div>" +
    "</body>" +
    "</html>"
  );
}
