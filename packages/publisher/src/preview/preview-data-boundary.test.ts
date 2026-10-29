import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveSectionedViewDocument } from "../core/sectioned-view.js";
import { SectionedView } from "../web/views/SectionedView.server.js";
import { CATALOG_COMPOSITIONS, CATALOG_FIXTURES, catalogCopyResolver } from "./catalog/index.js";
import { renderCatalogComposition, renderCatalogFixture, resolveCatalogFixtureDocument } from "./catalog/contract-reference.js";
import { READER_SAMPLES, resolveReaderSampleDocument } from "./catalog/reader-data.js";
import { renderReaderSample } from "./catalog/reader-renderer.js";
import { CONTENT_CATALOG_CALL_TO_ACTION } from "./fixture-content-catalog.js";
import { renderContentCatalog, renderContentCatalogMarkup } from "./render-content-catalog.js";
import { renderPreviewGalleryEntries } from "./render-preview-gallery.js";

describe("checked native preview documents after Landing retirement", () => {
  it("renders the compact hero gallery entry through the current sectioned view", () => {
    const entry = renderPreviewGalleryEntries().find(entry => entry.view === "SectionedView (hero-compact)");
    expect(entry?.markup).toContain("Tell us what needs attention");
    expect(entry?.markup).not.toContain("data-landing-view");
  });

  it("keeps the full historical catalog and resolves its four closing strings as draft copy", () => {
    const result = renderContentCatalog();
    expect(result.document).toBeDefined();
    const closing = result.document.resolutions.filter(resolution => resolution.ref.id.startsWith("catalog.preview.close."));
    expect(result.document.sections).toHaveLength(27);
    expect(closing.every(resolution => resolution.approval === undefined)).toBe(true);
    expect(closing).toHaveLength(4);
    expect(closing.map(resolution => resolution.ref.id)).toContain("catalog.preview.close.action.label");
    expect(closing.every(resolution => resolution.status === "draft")).toBe(true);
    const html = renderContentCatalogMarkup();
    for (const text of [CONTENT_CATALOG_CALL_TO_ACTION.eyebrow, CONTENT_CATALOG_CALL_TO_ACTION.heading, CONTENT_CATALOG_CALL_TO_ACTION.description, CONTENT_CATALOG_CALL_TO_ACTION.actionLabel]) expect(html).toContain(text);
    expect(html).not.toContain("data-landing-view");
    expect(html).toContain('id="catalog-close"');
  });

  it("renders the entire checked recipe composition, including its closing actions", () => {
    const id = "recipes-nav-composition", document = resolveSectionedViewDocument(CATALOG_COMPOSITIONS[id]!, catalogCopyResolver);
    expect(renderCatalogComposition(id)).toBe(renderToStaticMarkup(createElement(SectionedView, { document, landmark: "none" })));
  });

  it("renders canonical closing samples directly, without prepended hero content or HTML clipping", () => {
    const fixture = CATALOG_FIXTURES.find(fixture => fixture.id === "say-close")!;
    expect(renderCatalogFixture(fixture)).toBe(renderToStaticMarkup(createElement(SectionedView, { document: resolveCatalogFixtureDocument(fixture), landmark: "none" })));
    const reader = READER_SAMPLES.find(fixture => fixture.id === "say-close")!;
    expect(renderReaderSample(reader)).toBe(renderToStaticMarkup(createElement(SectionedView, { document: resolveReaderSampleDocument(reader), landmark: "none" })));
  });

  it("selects native FAQ blocks under actual react-server conditions without client hooks", () => {
    const script = `
      import { createElement } from "react";
      import { SectionedView } from "@clossys/publisher/web";
      import { createCopyResolver } from "@clossys/writer";
      import { resolveSectionedViewDocument } from "@clossys/publisher/core";
      const ref = id => ({ id: "preview." + id });
      const entries = [{ id: "heading", text: "Host heading" }, { id: "questions", text: "Questions" }, ...[1, 2, 3, 4].flatMap(id => [{ id: "q" + id, text: "Question " + id }, { id: "a" + id, text: "Answer " + id }])].map(entry => ({ ...entry, id: ref(entry.id).id, context: "Preview render proof", status: "draft" }));
      const resolver = createCopyResolver({ id: "preview-render-proof", locale: "en", revision: "1", source: { kind: "consumer", reference: "preview-test" }, entries }, { target: "preview" });
      const document = resolveSectionedViewDocument({ id: "preview", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") }, { id: "faq", kind: "faq", heading: ref("questions"), ground: "base", items: [1, 2, 3, 4].map(id => ({ id: "q" + id, question: ref("q" + id), answer: ref("a" + id) })) }] }, resolver);
      const tags = [];
      function walk(node) {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node.type === "function") return walk(node.type(node.props));
        if (typeof node.type === "string") tags.push(node.type);
        walk(node.props?.children);
      }
      walk(createElement(SectionedView, { document }));
      process.stdout.write(JSON.stringify(tags));
    `;
    const tags = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000 }));
    expect(tags.filter((tag: string) => tag === "h1")).toHaveLength(1);
    expect(tags).toContain("details");
    expect(tags).toContain("summary");
  });
});
