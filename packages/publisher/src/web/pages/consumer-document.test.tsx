/** @vitest-environment node */
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createCopyResolver } from "@clossys/writer";
import { resolveSectionedViewDocument, validateSectionedViewDocument } from "@clossys/publisher/core";
import { SectionedView } from "@clossys/publisher/web";
import * as native from "@clossys/publisher/web/admin-pages";
import * as compatibility from "@clossys/publisher/web/registered-route";
import * as core from "@clossys/publisher/core";
import { adminCopyFixture } from "./__fixtures__/copy.mjs";

it("owns a consumer-authored SectionedViewDocument and its Writer resolution/rendering without Designer landing", () => {
  const resolver = createCopyResolver({ id: "consumer-site", revision: "1", locale: "en", source: { kind: "consumer", reference: "test-only-document" }, entries: [
    { id: "site.title", text: "Consumer-owned publication", context: "Test title", status: "draft" },
    { id: "site.body", text: "Its composition belongs to the consumer.", context: "Test description", status: "draft" },
  ] }, { target: "preview" });
  const document = { id: "consumer-home", sections: [{ id: "intro", kind: "hero" as const, ground: "base" as const, heading: { id: "site.title", locale: "en" }, description: { id: "site.body", locale: "en" } }] };
  expect(validateSectionedViewDocument(document)).toEqual([]);
  const resolved = resolveSectionedViewDocument(document, resolver);
  expect(resolved.resolutions.map(value => value.status)).toEqual(["draft", "draft"]);
  const before = JSON.stringify(resolved);
  const html = renderToStaticMarkup(<SectionedView document={resolved} />);
  expect(html).toContain("Consumer-owned publication"); expect(html).toContain("Its composition belongs to the consumer.");
  expect(resolved.resolutions.every(value => value.revision === "1" && value.approval === undefined && value.source.kind === "consumer")).toBe(true);
  expect(JSON.stringify(resolved)).toBe(before);
  expect(() => resolveSectionedViewDocument(document, () => undefined)).toThrow(/CopyRef|resolve/i);
});
it("removes the public three-page authority while keeping the native data route and explicit draft marker", () => {
  for (const name of ["DesignerRoutePage", "WriterRoutePage", "PublisherRoutePage"]) expect(compatibility).not.toHaveProperty(name);
  expect(core).not.toHaveProperty("COMPLETE_ROUTE_KINDS");
  expect(native).not.toHaveProperty("createDesignerPageRecords"); expect(native).not.toHaveProperty("createWriterPageRecords"); expect(native).not.toHaveProperty("createPublisherPageRecords");
  expect(native.createConsumerPageRegistry).toBeTypeOf("function");
  const copy = adminCopyFixture(); const title = copy("strings.admin.page.writer"); const preview = copy.previewState();
  const html = renderToStaticMarkup(<main data-copy-target={preview.target} data-copy-status={preview.draft ? "draft" : "resolved"}>{title}</main>);
  expect(html).toContain('data-copy-target="preview"'); expect(html).toContain('data-copy-status="draft"');
});
