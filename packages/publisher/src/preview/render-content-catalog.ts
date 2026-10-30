import { resolveDocumentLocale, type DocumentLocaleOptions } from "./render-document-locale.js";
import { buildFunctionalCatalogIndex } from "./catalog/reader-renderer.js";
export { buildCatalogFunctionPages } from "./catalog/reader-renderer.js";
import { Children, cloneElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveSectionedViewDocument } from "../core/sectioned-view.js";
import { SectionedView } from "../web/views/SectionedView.server.js";
import type { ResolvedSectionedViewDocument } from "../core/sectioned-view.js";
import { PREVIEW_UTILITIES_BASENAME } from "./preview-stylesheet.js";
import { CONTENT_CATALOG_CAPTIONS, contentCatalogPreviewCopyResolver, contentCatalogPreviewDocument, type ContentCatalogCaption } from "./fixture-content-catalog.js";

/**
 * Historical band composition retained for compatibility checks. The public
 * content-catalog.html entry is now a function index; each nested page renders
 * its resolved samples through the native Publisher views.
 */

export const CONTENT_CATALOG_FILENAME = "content-catalog.html";

export interface ContentCatalogStylesheets {
  /** Href of Designer's `tokens.css`. */
  designerTokens: string;
  /** Href of the preview utility stylesheet (`styles/preview.css`, copied as `publisher-preview.css`): preflight plus every class Designer's components and Publisher's views emit. */
  utilities: string;
  /** Href of the consumer's brand stylesheet, linked last so it wins. `null` renders Designer's defaults only. */
  brand: string | null;
}

export const DEFAULT_CONTENT_CATALOG_STYLESHEETS: ContentCatalogStylesheets = {
  designerTokens: "designer-tokens.css",
  utilities: PREVIEW_UTILITIES_BASENAME,
  brand: "brand.css",
};

/** One top-level band of the rendered page: its caption and its exact markup. */
export interface ContentCatalogBand {
  caption: ContentCatalogCaption;
  markup: string;
}

export interface ContentCatalogRender {
  /** Complete resolved preview data, including honest draft closing provenance. */
  document: ResolvedSectionedViewDocument;
  bands: ContentCatalogBand[];
}

/** Resolve and validate the complete document before adding any preview chrome. */
function nativeContentCatalog() {
  const document = resolveSectionedViewDocument(contentCatalogPreviewDocument, contentCatalogPreviewCopyResolver);
  // SectionedView is the existing hook-free data renderer. Its validated native
  // children, rather than serialized HTML fragments, define these preview bands.
  const element = SectionedView({ document });
  const nodes = Children.toArray(element.props.children);
  if (nodes.length !== CONTENT_CATALOG_CAPTIONS.length || document.sections.length !== nodes.length) {
    throw new Error("content catalog: native section count does not match its captions");
  }
  const bands = nodes.map((node, index) => {
    const caption = CONTENT_CATALOG_CAPTIONS[index]!;
    if (document.sections[index]!.id !== caption.sectionId) throw new Error("content catalog: native section order does not match its captions");
    return { caption, markup: renderToStaticMarkup(node) };
  });
  return { document, element, nodes, bands };
}

/** The existing native data renderer, with every checked section intact. */
export function renderContentCatalogMarkup(): string {
  return renderToStaticMarkup(nativeContentCatalog().element);
}

export function renderContentCatalog(): ContentCatalogRender {
  const { document, bands } = nativeContentCatalog();
  return { document, bands };
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const BUDGET_TEXT = { typical: "typical copy", max: "max budget" } as const;

function captionNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function captionElement(caption: ContentCatalogCaption, index: number) {
  return createElement("div", { className: "catalog-caption", "data-catalog-chrome": "caption", "data-catalog-budget": caption.budget, id: `caption-${caption.sectionId}`, key: `caption-${caption.sectionId}` },
    createElement("span", { className: "catalog-caption-number" }, captionNumber(index)),
    createElement("span", { className: "catalog-caption-title" }, caption.title),
    createElement("span", { className: "catalog-caption-detail" }, caption.detail),
    createElement("span", { className: "catalog-caption-budget" }, BUDGET_TEXT[caption.budget]),
  );
}

function contentsHtml(captions: readonly ContentCatalogCaption[]): string {
  const items = captions
    .map((caption, index) => `<li><a href="#caption-${escapeHtml(caption.sectionId)}">${captionNumber(index)} ${escapeHtml(caption.title)}</a> <span>${BUDGET_TEXT[caption.budget]}</span></li>`)
    .join("");
  return `<ol class="catalog-contents">${items}</ol>`;
}

/** Neutral chrome styling: system fonts and greys, never brand tokens. */
const CHROME_STYLE = `
    body { margin: 0; background: var(--color-surface-base, #fff); }
    .catalog-chrome-header { font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; color: #2b2b2b; background: #f3f3f1; border-bottom: 1px solid #d6d6d2; padding: 24px 16px; }
    .catalog-chrome-header > div { max-width: 72rem; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; }
    .catalog-chrome-header h1 { margin: 0; font-size: 18px; font-weight: 600; }
    .catalog-chrome-header p { margin: 0; max-width: 48rem; color: #555; }
    .catalog-contents { margin: 8px 0 0; padding: 0; list-style: none; columns: 2 18rem; column-gap: 32px; }
    .catalog-contents li { break-inside: avoid; padding: 2px 0; }
    .catalog-contents a { color: #2b2b2b; }
    .catalog-contents span { color: #777; font-size: 12px; }
    .catalog-caption { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; padding: 8px 16px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #444; background: #f3f3f1; border-top: 1px dashed #b9b9b4; border-bottom: 1px dashed #b9b9b4; scroll-margin-top: 0; }
    .catalog-caption-number { font-weight: 700; }
    .catalog-caption-title { font-weight: 600; color: #1f1f1f; }
    .catalog-caption-detail { color: #666; }
    .catalog-caption-budget { margin-left: auto; padding: 0 6px; border: 1px solid #b9b9b4; border-radius: 3px; }
    .catalog-caption[data-catalog-budget="max"] .catalog-caption-budget { background: #1f1f1f; border-color: #1f1f1f; color: #f3f3f1; }`;

/**
 * The catalog page: the stylesheets (Designer tokens, the preview utility
 * stylesheet, then the brand file when given), the chrome header, and the
 * SectionedView root with one chrome caption before each native section.
 */
export function buildHistoricalContentCatalogHtml(stylesheets: ContentCatalogStylesheets = DEFAULT_CONTENT_CATALOG_STYLESHEETS, options: DocumentLocaleOptions = {}): string {
  const { locale, dir } = resolveDocumentLocale(options);
  const render = nativeContentCatalog();
  const links = [stylesheets.designerTokens, stylesheets.utilities, ...(stylesheets.brand === null ? [] : [stylesheets.brand])]
    .map((href) => `  <link rel="stylesheet" href="${escapeHtml(href)}" />`)
    .join("\n");
  const markup = renderToStaticMarkup(cloneElement(render.element, { children: render.nodes.flatMap((node, index) => [captionElement(render.bands[index]!.caption, index), node]) }));
  const captions = render.bands.map((band) => band.caption);

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}" data-brand-bound>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Content catalog</title>
${links}
  <style>${CHROME_STYLE}
  </style>
</head>
<body>
<header class="catalog-chrome-header" data-catalog-chrome="header">
  <div>
    <h1>Content catalog</h1>
    <p>Every content-section block, specimen arrangement and ground, rendered by Publisher's SectionedView with ${stylesheets.brand === null ? "Designer's default tokens" : "the linked brand stylesheet"}. Sample copy for an invented company; every name and figure is made up. Grey captions are preview chrome, not part of the page; each names the collection or media shape and its variant. Collection blocks use <code>items</code> or <code>matrix</code>; recipes select presentation defaults. Bands marked max budget use the longest copy the content cookbook (Designer CONTENT.md) allows. The page shows every block, so it breaks the page-variety rules on purpose.</p>
    ${contentsHtml(captions)}
  </div>
</header>
${markup}
</body>
</html>
`;
}

/** Function index for the nested catalog pages. */
export function buildContentCatalogHtml(stylesheets: ContentCatalogStylesheets = DEFAULT_CONTENT_CATALOG_STYLESHEETS, options: DocumentLocaleOptions = {}): string {
  return buildFunctionalCatalogIndex(stylesheets, options);
}
