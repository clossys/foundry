import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { checkBrandFileCoverage, readBrandCss } from "@clossys/designer/tokens";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveSectionedViewDocument } from "../core/sectioned-view.js";
import { renderWebDocument } from "../web/renderWebDocument.js";
import { CaptureView } from "../web/views/CaptureView.js";
import { CollectionView } from "../web/views/CollectionView.js";
import { DocumentView } from "../web/views/DocumentView.js";
import { SectionedView } from "../web/views/SectionedView.js";
import {
  previewAuthDocument,
  previewCaptureViewProps,
  previewCollectionViewProps,
  previewDocumentViewAction,
  previewDocumentViewDocument,
  previewCopyResolver,
  previewErrorDocument,
  previewMarketingDocument,
  previewMarketingGroups,
  previewSectionedDocument,
} from "./fixture-documents.js";

const require = createRequire(import.meta.url);

export const PREVIEW_GALLERY_FILENAME = "gallery.html";
const DESIGNER_TOKENS_BASENAME = "designer-tokens.css";
const DESIGNER_COMPILED_BASENAME = "designer-compiled.css";
const BRAND_COPY_BASENAME = "brand.css";

export interface PreviewBrandValidationFailure {
  ok: false;
  message: string;
}

export interface PreviewBrandValidationSuccess {
  ok: true;
  brandCssPath: string;
  declarations: Record<string, string>;
}

export type PreviewBrandValidationResult = PreviewBrandValidationFailure | PreviewBrandValidationSuccess;

export function validateBrandForPreview(brandCssPath: string): PreviewBrandValidationResult {
  const resolved = resolve(brandCssPath);
  const read = readBrandCss(resolved);
  if (!read.complete) {
    const detail = read.issues.map((issue) => `${issue.reason}: ${issue.detail}`).join("; ");
    return { ok: false, message: `Brand CSS file could not be read (${detail || "unknown reason"}).` };
  }
  if (read.unchecked.length > 0) {
    return { ok: false, message: "Brand CSS file has unparsed regions; coverage cannot be trusted." };
  }
  const coverage = checkBrandFileCoverage(read.declarations);
  if (coverage.unchecked.length > 0) {
    return { ok: false, message: "Brand CSS file has declarations the coverage check could not classify." };
  }
  if (!coverage.ok || coverage.findings.length > 0) {
    return { ok: false, message: `Brand CSS failed coverage (${coverage.findings.length} finding(s)).` };
  }
  return { ok: true, brandCssPath: resolved, declarations: read.declarations };
}

export interface PreviewGalleryEntry {
  view: string;
  markup: string;
}

export function renderPreviewGalleryEntries(): PreviewGalleryEntry[] {
  const marketing = renderToStaticMarkup(renderWebDocument(previewMarketingDocument, { groups: previewMarketingGroups }).element);
  const sectioned = renderToStaticMarkup(
    createElement(SectionedView, {
      document: resolveSectionedViewDocument(previewSectionedDocument, previewCopyResolver),
    }),
  );
  const auth = renderToStaticMarkup(renderWebDocument(previewAuthDocument).element);
  const error = renderToStaticMarkup(renderWebDocument(previewErrorDocument).element);
  const capture = renderToStaticMarkup(createElement(CaptureView, previewCaptureViewProps));
  const documentView = renderToStaticMarkup(
    createElement(DocumentView, {
      brand: previewCollectionViewProps.brand,
      document: previewDocumentViewDocument,
      resolveCopyId: previewCopyResolver,
      summary: { id: "preview.document.summary" },
      effectiveDate: { dateTime: "2026-09-01", text: { id: "preview.document.date" } },
      action: previewDocumentViewAction,
    }),
  );
  const collection = renderToStaticMarkup(createElement(CollectionView, previewCollectionViewProps));

  return [
    { view: "MarketingView", markup: marketing },
    { view: "SectionedView", markup: sectioned },
    { view: "AuthView", markup: auth },
    { view: "ErrorView", markup: error },
    { view: "CaptureView", markup: capture },
    { view: "DocumentView", markup: documentView },
    { view: "CollectionView", markup: collection },
  ];
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildPreviewGalleryHtml(entries: PreviewGalleryEntry[]): string {
  const sections = entries
    .map(
      (entry) =>
        `<section class="publisher-preview-panel" id="${escapeHtml(entry.view)}">` +
        `<h2 class="publisher-preview-label">${escapeHtml(entry.view)}</h2>` +
        `<div class="publisher-preview-frame">${entry.markup}</div>` +
        `</section>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en" data-brand-bound>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Publisher shipped view preview</title>
  <link rel="stylesheet" href="${DESIGNER_TOKENS_BASENAME}" />
  <link rel="stylesheet" href="${DESIGNER_COMPILED_BASENAME}" />
  <link rel="stylesheet" href="${BRAND_COPY_BASENAME}" />
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: var(--color-surface-base, #f5f5f5); }
    .publisher-preview-index { max-width: 72rem; margin: 0 auto; padding: 2rem 1.5rem 4rem; display: flex; flex-direction: column; gap: 3rem; }
    .publisher-preview-intro { display: flex; flex-direction: column; gap: 0.5rem; }
    .publisher-preview-intro h1 { margin: 0; font-size: 1.5rem; }
    .publisher-preview-intro p { margin: 0; color: var(--color-ink-secondary, #444); }
    .publisher-preview-panel { display: flex; flex-direction: column; gap: 0.75rem; border-top: 1px solid var(--color-line-base, #ddd); padding-top: 2rem; }
    .publisher-preview-label { margin: 0; font-size: 1.125rem; font-weight: 600; }
    .publisher-preview-frame { overflow: hidden; border: 1px solid var(--color-line-base, #ddd); border-radius: 0.5rem; background: var(--color-surface-base, #fff); }
  </style>
</head>
<body>
  <main class="publisher-preview-index">
    <header class="publisher-preview-intro">
      <h1>Publisher shipped view preview</h1>
      <p>Fixture documents rendered with your brand.css and Designer tokens.</p>
    </header>
${sections}
  </main>
</body>
</html>
`;
}

function resolveDesignerStylesheet(exportSubpath: string): string {
  return require.resolve(`@clossys/designer/${exportSubpath}`);
}

export interface WritePreviewGalleryOptions {
  brandCssPath: string;
  outputDir: string;
}

export interface WritePreviewGalleryResult {
  galleryPath: string;
  brandCssPath: string;
  entryCount: number;
}

export function writePreviewGallery(options: WritePreviewGalleryOptions): WritePreviewGalleryResult {
  const validation = validateBrandForPreview(options.brandCssPath);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const outputDir = resolve(options.outputDir);
  mkdirSync(outputDir, { recursive: true });

  copyFileSync(validation.brandCssPath, join(outputDir, BRAND_COPY_BASENAME));
  copyFileSync(resolveDesignerStylesheet("tokens.css"), join(outputDir, DESIGNER_TOKENS_BASENAME));
  copyFileSync(resolveDesignerStylesheet("compiled.css"), join(outputDir, DESIGNER_COMPILED_BASENAME));

  const entries = renderPreviewGalleryEntries();
  const galleryPath = join(outputDir, PREVIEW_GALLERY_FILENAME);
  writeFileSync(galleryPath, buildPreviewGalleryHtml(entries), "utf8");

  return {
    galleryPath,
    brandCssPath: validation.brandCssPath,
    entryCount: entries.length,
  };
}

/** Test helper: minimal brand.css that satisfies real TOKENS coverage. */
export function buildMinimalBrandCssFromTokens(tokensModule: typeof import("@clossys/designer/tokens")): string {
  const lines = Object.values(tokensModule.TOKENS)
    .filter((def) => def.brandable)
    .map((def) => `  ${def.property}: ${def.value};`);
  return `:root[data-brand-bound] {\n${lines.join("\n")}\n}\n`;
}
