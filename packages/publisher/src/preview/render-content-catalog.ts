import { resolveDocumentLocale, type DocumentLocaleOptions } from "./render-document-locale.js";
import { buildFunctionalCatalogIndex } from "./catalog/reader-renderer.js";
export { buildCatalogFunctionPages } from "./catalog/reader-renderer.js";
import { buttonLinkClassName } from "@clossys/designer/components/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveSectionedViewDocument } from "../core/sectioned-view.js";
import { ServerLandingView as LandingView } from "@clossys/designer/frames";
import { PREVIEW_UTILITIES_BASENAME } from "./preview-stylesheet.js";
import { CONTENT_CATALOG_CALL_TO_ACTION, CONTENT_CATALOG_CAPTIONS, contentCatalogCopyResolver, contentCatalogDocument, type ContentCatalogCaption } from "./fixture-content-catalog.js";

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
  /** LandingView's root open tag, for example `<main data-landing-view="" ...>`. */
  rootOpen: string;
  rootClose: string;
  bands: ContentCatalogBand[];
}

/** Renders the catalog through native `LandingView` for use without hydration. */
export function renderContentCatalogMarkup(): string {
  const cta = CONTENT_CATALOG_CALL_TO_ACTION;
  return renderToStaticMarkup(
    createElement(LandingView, {
      document: resolveSectionedViewDocument(contentCatalogDocument, contentCatalogCopyResolver),
      header: "reserved",
      peek: false,
      callToAction: {
        id: cta.id,
        eyebrow: cta.eyebrow,
        heading: cta.heading,
        description: cta.description,
        action: createElement("a", { href: cta.actionHref, className: buttonLinkClassName("primary", "lg") }, cta.actionLabel),
      },
    }),
  );
}

const SECTION_TAG = /<section[\s>]|<\/section>/g;

/**
 * Splits LandingView's markup into its root tag and its top-level bands (each
 * one Designer `SectionFrame`, a `<section>`). Static markup escapes `<` in
 * text and attribute values, so every `<section` token in it is a real tag.
 * Throws when the markup is not a root holding only `<section>` children.
 */
export function splitLandingViewBands(markup: string): { rootOpen: string; rootClose: string; bands: string[] } {
  const openEnd = markup.indexOf(">");
  const closeStart = markup.lastIndexOf("</");
  if (!markup.startsWith("<main") || openEnd < 0 || closeStart <= openEnd || markup.slice(closeStart) !== "</main>") {
    throw new Error("content catalog: LandingView markup is not one <main> root");
  }
  const rootOpen = markup.slice(0, openEnd + 1);
  const body = markup.slice(openEnd + 1, closeStart);
  const bands: string[] = [];
  let depth = 0;
  let start = 0;
  for (const match of body.matchAll(SECTION_TAG)) {
    const index = match.index ?? 0;
    if (match[0] === "</section>") {
      depth -= 1;
      if (depth < 0) throw new Error("content catalog: unbalanced </section> in LandingView markup");
      if (depth === 0) {
        const end = index + match[0].length;
        bands.push(body.slice(start, end));
        start = end;
      }
    } else {
      if (depth === 0 && body.slice(start, index).trim() !== "") throw new Error("content catalog: LandingView root holds content outside its bands");
      if (depth === 0) start = index;
      depth += 1;
    }
  }
  if (depth !== 0 || body.slice(start).trim() !== "") throw new Error("content catalog: LandingView markup ends inside a band");
  return { rootOpen, rootClose: "</main>", bands };
}

/**
 * Renders the catalog and pairs each band with its caption. Throws when the
 * band count or order no longer matches the captions, so the chrome can
 * never label the wrong band.
 */
export function renderContentCatalog(): ContentCatalogRender {
  const { rootOpen, rootClose, bands } = splitLandingViewBands(renderContentCatalogMarkup());
  if (bands.length !== CONTENT_CATALOG_CAPTIONS.length) {
    throw new Error(`content catalog: LandingView rendered ${bands.length} bands for ${CONTENT_CATALOG_CAPTIONS.length} captions`);
  }
  return {
    rootOpen,
    rootClose,
    bands: bands.map((markup, index) => {
      const caption = CONTENT_CATALOG_CAPTIONS[index] as ContentCatalogCaption;
      if (!markup.includes(`id="${caption.sectionId}"`)) {
        throw new Error(`content catalog: band ${index + 1} does not hold section ${caption.sectionId}`);
      }
      return { caption, markup };
    }),
  };
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const BUDGET_TEXT = { typical: "typical copy", max: "max budget" } as const;

function captionNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function captionHtml(caption: ContentCatalogCaption, index: number): string {
  return (
    `<div class="catalog-caption" data-catalog-chrome="caption" data-catalog-budget="${caption.budget}" id="caption-${escapeHtml(caption.sectionId)}">` +
    `<span class="catalog-caption-number">${captionNumber(index)}</span>` +
    `<span class="catalog-caption-title">${escapeHtml(caption.title)}</span>` +
    `<span class="catalog-caption-detail">${escapeHtml(caption.detail)}</span>` +
    `<span class="catalog-caption-budget">${BUDGET_TEXT[caption.budget]}</span>` +
    `</div>`
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
 * LandingView root with one chrome caption before each band.
 */
export function buildHistoricalContentCatalogHtml(stylesheets: ContentCatalogStylesheets = DEFAULT_CONTENT_CATALOG_STYLESHEETS, options: DocumentLocaleOptions = {}): string {
  const { locale, dir } = resolveDocumentLocale(options);
  const render = renderContentCatalog();
  const links = [stylesheets.designerTokens, stylesheets.utilities, ...(stylesheets.brand === null ? [] : [stylesheets.brand])]
    .map((href) => `  <link rel="stylesheet" href="${escapeHtml(href)}" />`)
    .join("\n");
  const bands = render.bands.map((band, index) => `${captionHtml(band.caption, index)}\n${band.markup}`).join("\n");
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
    <p>Every content-section block, specimen arrangement and ground, rendered by Publisher's LandingView with ${stylesheets.brand === null ? "Designer's default tokens" : "the linked brand stylesheet"}. Sample copy for an invented company; every name and figure is made up. Grey captions are preview chrome, not part of the page; each names the collection or media shape and its variant. Collection blocks use <code>items</code> or <code>matrix</code>; recipes select presentation defaults. Bands marked max budget use the longest copy the content cookbook (Designer CONTENT.md) allows. The page shows every block, so it breaks the page-variety rules on purpose.</p>
    ${contentsHtml(captions)}
  </div>
</header>
${render.rootOpen}
${bands}
${render.rootClose}
</body>
</html>
`;
}

/** Function index for the nested catalog pages. */
export function buildContentCatalogHtml(stylesheets: ContentCatalogStylesheets = DEFAULT_CONTENT_CATALOG_STYLESHEETS, options: DocumentLocaleOptions = {}): string {
  return buildFunctionalCatalogIndex(stylesheets, options);
}
