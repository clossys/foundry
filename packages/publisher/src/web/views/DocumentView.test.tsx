import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { RenderError } from "../../internal/errors.js";
import { DocumentView } from "./DocumentView.js";

const ref = (id: string) => ({ id });
const registry: CopyRegistry = {
  id: "acme-document-view",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "fixtures/acme-document-view" },
  entries: [
    { id: "acme.document.title", text: "Privacy notice", context: "fixture", status: "approved" },
    { id: "acme.document.summary", text: "How this fixture handles data.", context: "fixture", status: "approved" },
    { id: "acme.document.date", text: "Effective today", context: "fixture", status: "approved" },
    { id: "acme.document.section", text: "Details", context: "fixture", status: "approved" },
    { id: "acme.document.body", text: "Fixture body.", context: "fixture", status: "approved" },
  ],
};
const resolver: CopyResolver = createCopyResolver(registry);
const document = {
  id: "acme.privacy",
  title: ref("acme.document.title"),
  sections: [{ kind: "section" as const, id: "details", level: 2 as const, heading: ref("acme.document.section"), blocks: [{ kind: "paragraph" as const, content: [{ kind: "text" as const, text: ref("acme.document.body") }] }] }],
};

describe("DocumentView", () => {
  it("renders one h1 plus validated semantic document body and optional chrome copy", () => {
    const html = renderToStaticMarkup(<DocumentView brand="Acme" document={document} resolveCopyId={resolver} summary={ref("acme.document.summary")} effectiveDate={{ dateTime: "2026-09-01", text: ref("acme.document.date") }} action={<a href="/notes">Back</a>} />);
    expect(html).toContain("Privacy notice");
    expect(html).toContain("Effective today");
    expect(html).toContain('<time dateTime="2026-09-01"');
    expect(html).toContain('<article');
    expect(html).toContain('<section id="details"><h2');
    expect(html).toContain("Fixture body.");
  });

  it("refuses an invalid document before it can become a page", () => {
    const invalid = { ...document, sections: [{ ...document.sections[0]!, level: 3 as const }] };
    expect(() => renderToStaticMarkup(<DocumentView brand="Acme" document={invalid} resolveCopyId={resolver} />)).toThrow(RenderError);
  });

  it("refuses a document whose in-document fragment is unresolved", () => {
    const invalid = { ...document, sections: [{ ...document.sections[0]!, blocks: [{ kind: "paragraph" as const, content: [{ kind: "link" as const, text: ref("acme.document.body"), href: "#missing" }] }] }] };
    expect(() => renderToStaticMarkup(<DocumentView brand="Acme" document={invalid} resolveCopyId={resolver} />)).toThrow(/link-fragment-unresolved/);
  });

  it("fails closed when semantic effective-date metadata is malformed", () => {
    expect(() => renderToStaticMarkup(<DocumentView brand="Acme" document={document} resolveCopyId={resolver} effectiveDate={{ dateTime: "", text: ref("acme.document.date") }} />)).toThrow(/effectiveDate.dateTime/);
  });
});
