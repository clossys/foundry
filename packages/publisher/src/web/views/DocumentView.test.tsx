import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { RenderError } from "../../internal/errors.js";
import { DocumentView } from "./DocumentView.js";

vi.mock("../../document/render.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../document/render.js")>();
  return { ...actual, renderStructuredDocument: vi.fn(actual.renderStructuredDocument) };
});

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
    { id: "acme.document.bold", text: "Bold words", context: "fixture", status: "approved" },
    { id: "acme.document.italic", text: "Italic words", context: "fixture", status: "approved" },
    { id: "acme.document.col.name", text: "Name", context: "fixture", status: "approved" },
    { id: "acme.document.col.code", text: "Identifier", context: "fixture", status: "approved" },
    { id: "acme.document.cell.name", text: "Widget", context: "fixture", status: "approved" },
    { id: "acme.document.cell.code", text: "widget_v1", context: "fixture", status: "approved" },
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

  it("emphasis and mono column reach the page", () => {
    const emphasised = {
      ...document,
      sections: [
        {
          ...document.sections[0]!,
          blocks: [
            { kind: "paragraph" as const, content: [{ kind: "strong" as const, content: [{ kind: "text" as const, text: ref("acme.document.bold") }] }, { kind: "em" as const, content: [{ kind: "text" as const, text: ref("acme.document.italic") }] }] },
            {
              kind: "table" as const,
              headers: [ref("acme.document.col.name"), ref("acme.document.col.code")],
              columnStyles: ["default" as const, "mono" as const],
              rows: [[ref("acme.document.cell.name"), ref("acme.document.cell.code")]],
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(<DocumentView brand="Acme" document={emphasised} resolveCopyId={resolver} />);
    expect(html).toContain("<strong>Bold words</strong>");
    expect(html).toContain("<em>Italic words</em>");
    expect(html).toContain("<td>Widget</td><td><code>widget_v1</code></td>");
    expect(html).not.toContain("<code>Widget");
    expect(html).not.toMatch(/<th[^>]*><code>/);
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
    expect(() => renderToStaticMarkup(<DocumentView brand="Acme" document={document} resolveCopyId={resolver} effectiveDate={{ dateTime: "2026-02-30", text: ref("acme.document.date") }} />)).toThrow(/real ISO date/);
    expect(() => renderToStaticMarkup(<DocumentView brand="Acme" document={document} resolveCopyId={resolver} effectiveDate={{ dateTime: "September 1", text: ref("acme.document.date") }} />)).toThrow(/real ISO date/);
  });
});

describe("DocumentView error messages never echo a caller id", () => {
  const SENTINEL_DOC_ID = "sentinel-doc-id-23";
  const SENTINEL_REF_ID = "sentinel.ref.id.23";

  function thrownMessage(render: () => unknown): string {
    try {
      render();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      return (error as RenderError).message;
    }
    return expect.unreachable("expected DocumentView to throw");
  }

  it("names only the fixed summary path for an unresolved summary CopyRef", () => {
    const message = thrownMessage(() => renderToStaticMarkup(<DocumentView brand="Acme" document={document} resolveCopyId={resolver} summary={ref(SENTINEL_REF_ID)} />));
    expect(message).toBe("DocumentView could not resolve a CopyRef at summary.");
    expect(message).not.toContain(SENTINEL_REF_ID);
  });

  it("names only the fixed effectiveDate.text path for an unresolved date CopyRef", () => {
    const message = thrownMessage(() => renderToStaticMarkup(<DocumentView brand="Acme" document={document} resolveCopyId={resolver} effectiveDate={{ dateTime: "2026-09-01", text: ref(SENTINEL_REF_ID) }} />));
    expect(message).toBe("DocumentView could not resolve a CopyRef at effectiveDate.text.");
    expect(message).not.toContain(SENTINEL_REF_ID);
  });

  it("reports an unresolved title without echoing the document id", async () => {
    const { renderStructuredDocument } = await import("../../document/render.js");
    vi.mocked(renderStructuredDocument).mockReturnValueOnce({ element: null, resolutions: [] } as never);
    const message = thrownMessage(() => renderToStaticMarkup(<DocumentView brand="Acme" document={{ ...document, id: SENTINEL_DOC_ID }} resolveCopyId={resolver} />));
    expect(message).toBe("DocumentView could not resolve the document title.");
    expect(message).not.toContain(SENTINEL_DOC_ID);
  });

  it("passes the document renderer's fixed message through for an unresolved body CopyRef", () => {
    const unresolvedBody = { ...document, id: SENTINEL_DOC_ID, sections: [{ ...document.sections[0]!, blocks: [{ kind: "paragraph" as const, content: [{ kind: "text" as const, text: ref(SENTINEL_REF_ID) }] }] }] };
    const message = thrownMessage(() => renderToStaticMarkup(<DocumentView brand="Acme" document={unresolvedBody} resolveCopyId={resolver} />));
    expect(message).toContain("could not resolve a CopyRef at sections.0.blocks.0.content.0.text");
    expect(message).not.toContain(SENTINEL_DOC_ID);
    expect(message).not.toContain(SENTINEL_REF_ID);
  });
});
