import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKENS } from "@clossys/designer/tokens";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { DocumentLocaleOptions } from "./render-document-locale.js";
import {
  buildCatalogFunctionPages,
  buildContentCatalogHtml,
  buildHistoricalContentCatalogHtml,
  DEFAULT_CONTENT_CATALOG_STYLESHEETS,
} from "./render-content-catalog.js";
import {
  buildLaunchPackIndexHtml,
  renderEmailSection,
  renderMaterialsSection,
  renderSitePages,
} from "./render-launch-pack-gallery.js";
import { buildMinimalBrandCssFromTokens, buildPreviewGalleryHtml, writePreviewGallery } from "./render-preview-gallery.js";

const manifest: NonNullable<DocumentLocaleOptions["manifest"]> = {
  defaultLocale: "en",
  locales: [
    { tag: "en", dir: "ltr", state: "active" },
    { tag: "ar", dir: "rtl", state: "active" },
    { tag: "ar-XB", dir: "rtl", state: "pseudo" },
  ],
};

const cases: Array<[string, "ltr" | "rtl", DocumentLocaleOptions]> = [
  ["en", "ltr", {}],
  ["ar", "rtl", { locale: "ar", manifest }],
  ["ar-XB", "rtl", { locale: "ar-xb", manifest }],
];

function expectDocumentLocale(html: string, locale: string, dir: string, brandBound = true): void {
  expect(html.match(/<html\b[^>]*>/)?.[0]).toBe(`<html lang="${locale}" dir="${dir}"${brandBound ? " data-brand-bound" : ""}>`);
}

function expectEmailLocale(html: string, locale: string, dir: string): void {
  const frame = new JSDOM(html).window.document.querySelector("iframe");
  if (frame === null) return;
  const email = new JSDOM(frame.getAttribute("srcdoc")!).window.document.documentElement;
  expect(email.getAttribute("lang")).toBe(locale);
  expect(email.getAttribute("dir")).toBe(dir);
}

describe("preview artifact document locales", () => {
  it.each(cases)("declares %s and its Writer direction on every surviving HTML root", (locale, dir, options) => {
    const documents = [
      buildPreviewGalleryHtml([{ view: "Sample", markup: "<main>Sample</main>" }], options),
      buildHistoricalContentCatalogHtml(undefined, options),
      buildContentCatalogHtml(undefined, options),
      ...buildCatalogFunctionPages(DEFAULT_CONTENT_CATALOG_STYLESHEETS, options).map(entry => entry.content),
      buildLaunchPackIndexHtml([], options),
      ...renderSitePages(options).map(entry => entry.content),
    ];
    for (const html of documents) expectDocumentLocale(html, locale, dir);
    for (const { file, content } of renderMaterialsSection({}, options)) {
      expectDocumentLocale(content, locale, dir, file.startsWith("materials-overview-"));
    }
    const emailFiles = renderEmailSection({}, options);
    expect(emailFiles).toHaveLength(4);
    for (const { content } of emailFiles) {
      expectDocumentLocale(content, locale, dir);
      expectEmailLocale(content, locale, dir);
    }
  });

  it("uses the manifest default when the locale is omitted", () => {
    expectDocumentLocale(buildPreviewGalleryHtml([], { manifest: { ...manifest, defaultLocale: "ar" } }), "ar", "rtl");
  });

  it("propagates locale through the gallery writer, nested catalog, and launch pack", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-document-locale-"));
    try {
      const brandCssPath = join(directory, "brand.css");
      writeFileSync(brandCssPath, buildMinimalBrandCssFromTokens({ TOKENS }));
      const outputDir = join(directory, "output");
      const result = writePreviewGallery({ brandCssPath, outputDir, locale: "ar-xb", manifest });
      const files = result.writtenFiles.filter(file => file.endsWith(".html"));
      expect(files).toContain("catalog/overview.html");
      expect(files).toContain("materials-pitch-deck.html");
      expect(files).toContain("email-launch-announcement.html");
      for (const file of files) {
        const html = readFileSync(join(outputDir, file), "utf8");
        expectDocumentLocale(html, "ar-XB", "rtl", !["materials-pitch-deck.html", "materials-pitch-deck-partner.html", "materials-index.html"].includes(file));
        if (file.startsWith("email-")) expectEmailLocale(html, "ar-XB", "rtl");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
