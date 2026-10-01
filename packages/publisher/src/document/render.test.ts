import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolution } from "@clossys/writer";
import { collectCopyProvenance } from "../core/output-manifest.js";
import { RenderError } from "../internal/errors.js";
import { renderStructuredDocument } from "./render.js";
import type { StructuredDocument } from "./types.js";

const ref = (id: string): CopyRef => ({ id });

/** A tiny in-memory resolver mirroring resolveSurfaceDocument's own test fixtures — resolves every ref whose id it recognizes, `undefined` otherwise. */
function fakeResolver(entries: Record<string, string>) {
  return (candidate: CopyRef): CopyResolution | undefined => {
    const text = entries[candidate.id];
    if (text === undefined) return undefined;
    return { ref: candidate, text, recordId: "acme-registry", revision: "rev-1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: candidate.id };
  };
}

const fullDoc: StructuredDocument = {
  id: "acme.help.getting-started",
  title: ref("acme.title"),
  sections: [
    {
      kind: "section",
      id: "overview",
      level: 2,
      heading: ref("acme.overview.heading"),
      blocks: [
        { kind: "paragraph", content: [{ kind: "text", text: ref("acme.overview.p1") }, { kind: "link", text: ref("acme.overview.link"), href: "#pricing" }] },
        { kind: "list", style: "ordered", items: [[{ kind: "text", text: ref("acme.overview.item1") }], [{ kind: "text", text: ref("acme.overview.item2") }]] },
        { kind: "callout", tone: "warning", content: [{ kind: "text", text: ref("acme.overview.callout") }] },
        {
          kind: "section",
          id: "overview-details",
          level: 3,
          heading: ref("acme.overview.details.heading"),
          blocks: [{ kind: "definition-list", items: [{ term: ref("acme.term1"), description: ref("acme.desc1") }] }],
        },
      ],
    },
    {
      kind: "section",
      id: "pricing",
      level: 2,
      heading: ref("acme.pricing.heading"),
      blocks: [
        {
          kind: "table",
          caption: ref("acme.pricing.caption"),
          headers: [ref("acme.pricing.plan"), ref("acme.pricing.price")],
          rows: [[ref("acme.pricing.plan1"), ref("acme.pricing.price1")]],
        },
      ],
    },
  ],
};

const fullDocCopy: Record<string, string> = {
  "acme.title": "Getting started",
  "acme.overview.heading": "Overview",
  "acme.overview.p1": "Read this first.",
  "acme.overview.link": "See pricing",
  "acme.overview.item1": "Step one",
  "acme.overview.item2": "Step two",
  "acme.overview.callout": "Heads up.",
  "acme.overview.details.heading": "More detail",
  "acme.term1": "Widget",
  "acme.desc1": "A thing that widgets.",
  "acme.pricing.heading": "Pricing",
  "acme.pricing.caption": "Plans",
  "acme.pricing.plan": "Plan",
  "acme.pricing.price": "Price",
  "acme.pricing.plan1": "Pro",
  "acme.pricing.price1": "$9",
};

describe("renderStructuredDocument — happy path", () => {
  it("renders nested sections, a table, a list, a definition list, a callout, and a cross-reference link to real semantic HTML", () => {
    const { element } = renderStructuredDocument(fullDoc, { resolveCopyId: fakeResolver(fullDocCopy) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('<section id="overview">');
    expect(html).toContain("<h2>Overview</h2>");
    expect(html).toContain('<section id="overview-details">');
    expect(html).toContain("<h3>More detail</h3>");
    expect(html).toContain('<a href="#pricing">See pricing</a>');
    expect(html).toMatch(/<ol>.*<li>Step one<\/li>.*<li>Step two<\/li>.*<\/ol>/s);
    expect(html).toContain('<aside role="note" data-callout-tone="warning">Heads up.</aside>');
    expect(html).toContain("<dt>Widget</dt><dd>A thing that widgets.</dd>");
    expect(html).toContain("<caption>Plans</caption>");
    expect(html).toContain('<th scope="col">Plan</th>');
    expect(html).toContain("<td>Pro</td><td>$9</td>");

    // Never rendered — h1 stays the caller's own page title.
    expect(html).not.toContain("<h1>");
    expect(html).not.toContain("Getting started");
  });

  it("resolves and collects every CopyRef — title, every heading, every inline text/link, every table header/cell, callout, and definition-list text — into a CopyResolution[] collectCopyProvenance accepts unchanged", () => {
    const { resolutions } = renderStructuredDocument(fullDoc, { resolveCopyId: fakeResolver(fullDocCopy) });
    const ids = resolutions.map((r) => r.entryId).sort();
    expect(ids).toEqual(Object.keys(fullDocCopy).sort());

    const provenance = collectCopyProvenance(resolutions);
    expect(provenance).toEqual([{ recordId: "acme-registry", revision: "rev-1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryIds: ids }]);
    // Provenance is referential only — never a second store for rendered text.
    expect(JSON.stringify(provenance)).not.toContain("Getting started");
    expect(JSON.stringify(provenance)).not.toContain("Overview");
  });
});

describe("renderStructuredDocument — inline emphasis and column styles", () => {
  const emphasisCopy: Record<string, string> = {
    "acme.title": "Emphasis",
    "acme.h": "Heading",
    "acme.bold": "Bold run",
    "acme.italic": "Italic run",
    "acme.boldlink": "Bold link",
    "acme.plain": "Plain run",
    "acme.plan": "Plan",
    "acme.code": "Code",
    "acme.plan1": "Pro",
    "acme.code1": "pro_v2",
    "acme.plan2": "Team",
    "acme.code2": "team_v2",
  };

  function docWith(blocks: StructuredDocument["sections"][number]["blocks"]): StructuredDocument {
    return { id: "acme.emphasis", title: ref("acme.title"), sections: [{ kind: "section", id: "s", level: 2, heading: ref("acme.h"), blocks }] };
  }

  it("emphasis renders strong and em", () => {
    const doc = docWith([
      {
        kind: "paragraph",
        content: [
          { kind: "strong", content: [{ kind: "text", text: ref("acme.bold") }] },
          { kind: "em", content: [{ kind: "text", text: ref("acme.italic") }] },
          { kind: "strong", content: [{ kind: "link", text: ref("acme.boldlink"), href: "#s" }] },
          { kind: "text", text: ref("acme.plain") },
        ],
      },
    ]);
    const { element, resolutions } = renderStructuredDocument(doc, { resolveCopyId: fakeResolver(emphasisCopy) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("<strong>Bold run</strong>");
    expect(html).toContain("<em>Italic run</em>");
    expect(html).toContain('<strong><a href="#s">Bold link</a></strong>');
    expect(html).toContain("<p><strong>Bold run</strong><em>Italic run</em><strong><a href=\"#s\">Bold link</a></strong>Plain run</p>");
    expect(resolutions.map((r) => r.entryId)).toEqual(["acme.title", "acme.h", "acme.bold", "acme.italic", "acme.boldlink", "acme.plain"]);
  });

  it("renders nested emphasis with the children rendered by the inline renderer", () => {
    const doc = docWith([{ kind: "paragraph", content: [{ kind: "strong", content: [{ kind: "em", content: [{ kind: "text", text: ref("acme.bold") }] }, { kind: "text", text: ref("acme.plain") }] }] }]);
    const html = renderToStaticMarkup(renderStructuredDocument(doc, { resolveCopyId: fakeResolver(emphasisCopy) }).element);
    expect(html).toContain("<p><strong><em>Bold run</em>Plain run</strong></p>");
  });

  it("emphasis also renders inside a list item and a callout", () => {
    const doc = docWith([
      { kind: "list", style: "unordered", items: [[{ kind: "em", content: [{ kind: "text", text: ref("acme.italic") }] }]] },
      { kind: "callout", tone: "info", content: [{ kind: "strong", content: [{ kind: "text", text: ref("acme.bold") }] }] },
    ]);
    const html = renderToStaticMarkup(renderStructuredDocument(doc, { resolveCopyId: fakeResolver(emphasisCopy) }).element);
    expect(html).toContain("<li><em>Italic run</em></li>");
    expect(html).toContain('<aside role="note" data-callout-tone="info"><strong>Bold run</strong></aside>');
  });

  it("mono column wraps cells only", () => {
    const doc = docWith([
      {
        kind: "table",
        headers: [ref("acme.plan"), ref("acme.code")],
        columnStyles: ["default", "mono"],
        rows: [
          [ref("acme.plan1"), ref("acme.code1")],
          [ref("acme.plan2"), ref("acme.code2")],
        ],
      },
    ]);
    const { element, resolutions } = renderStructuredDocument(doc, { resolveCopyId: fakeResolver(emphasisCopy) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('<th scope="col">Plan</th><th scope="col">Code</th>');
    expect(html).toContain("<td>Pro</td><td><code>pro_v2</code></td>");
    expect(html).toContain("<td>Team</td><td><code>team_v2</code></td>");
    expect((html.match(/<code>/g) ?? []).length).toBe(2);
    expect(html).not.toContain("<th scope=\"col\"><code>");
    expect(html).not.toContain("<td><code>Pro");
    // Every `<code>` is a bare element: no class and no inline style.
    expect(html).not.toMatch(/<code[^>]*\s(class|style)=/);
    expect(resolutions.map((r) => r.entryId)).toEqual(["acme.title", "acme.h", "acme.plan", "acme.code", "acme.plan1", "acme.code1", "acme.plan2", "acme.code2"]);
  });

  it("renders a table with no columnStyles, and one of all-default styles, exactly as before", () => {
    const table = { kind: "table" as const, headers: [ref("acme.plan"), ref("acme.code")], rows: [[ref("acme.plan1"), ref("acme.code1")]] };
    const plain = renderToStaticMarkup(renderStructuredDocument(docWith([table]), { resolveCopyId: fakeResolver(emphasisCopy) }).element);
    const defaults = renderToStaticMarkup(renderStructuredDocument(docWith([{ ...table, columnStyles: ["default", "default"] }]), { resolveCopyId: fakeResolver(emphasisCopy) }).element);
    expect(plain).toContain("<td>Pro</td><td>pro_v2</td>");
    expect(plain).not.toContain("<code>");
    expect(defaults).toBe(plain);
  });

  it("refuses a document whose emphasis is empty, before resolving anything", () => {
    const doc = docWith([{ kind: "paragraph", content: [{ kind: "strong", content: [] }] }]);
    let resolverCalled = false;
    expect(() =>
      renderStructuredDocument(doc, {
        resolveCopyId: (r) => {
          resolverCalled = true;
          return fakeResolver(emphasisCopy)(r);
        },
      }),
    ).toThrow(/inline-emphasis-empty at sections\.0\.blocks\.0\.content\.0\.content/);
    expect(resolverCalled).toBe(false);
  });
});

describe("renderStructuredDocument — the empty/degenerate cases", () => {
  it("renders an empty document (sections: []) to nothing, resolving only its title for provenance", () => {
    const doc: StructuredDocument = { id: "acme.empty", title: ref("acme.title"), sections: [] };
    const { element, resolutions } = renderStructuredDocument(doc, { resolveCopyId: fakeResolver({ "acme.title": "Empty doc" }) });
    expect(renderToStaticMarkup(element)).toBe("");
    expect(resolutions.map((r) => r.entryId)).toEqual(["acme.title"]);
  });

  it("renders an empty list as an empty <ul>/<ol>, never omitted", () => {
    const doc: StructuredDocument = {
      id: "acme.list",
      title: ref("acme.title"),
      sections: [{ kind: "section", id: "s", level: 2, heading: ref("acme.h"), blocks: [{ kind: "list", style: "unordered", items: [] }] }],
    };
    const html = renderToStaticMarkup(renderStructuredDocument(doc, { resolveCopyId: fakeResolver({ "acme.title": "T", "acme.h": "H" }) }).element);
    expect(html).toContain("<ul></ul>");
  });

  it("renders an empty table body as a <thead> with zero <tbody> rows, never omitted", () => {
    const doc: StructuredDocument = {
      id: "acme.table",
      title: ref("acme.title"),
      sections: [
        {
          kind: "section",
          id: "s",
          level: 2,
          heading: ref("acme.h"),
          blocks: [{ kind: "table", headers: [ref("acme.col")], rows: [] }],
        },
      ],
    };
    const html = renderToStaticMarkup(renderStructuredDocument(doc, { resolveCopyId: fakeResolver({ "acme.title": "T", "acme.h": "H", "acme.col": "Col" }) }).element);
    expect(html).toContain('<th scope="col">Col</th>');
    expect(html).toContain("<tbody></tbody>");
  });
});

describe("renderStructuredDocument — fails closed", () => {
  it("throws RenderError('resolution-failed') for a document that fails shape/heading-order/link/table/anchor validation, without ever calling the resolver", () => {
    const invalid: StructuredDocument = {
      id: "acme.invalid",
      title: ref("acme.title"),
      sections: [{ kind: "section", id: "s", level: 4, heading: ref("acme.h"), blocks: [] }], // top-level must be level 2
    };
    let resolverCalled = false;
    const resolver = fakeResolver({});
    expect(() =>
      renderStructuredDocument(invalid, {
        resolveCopyId: (r) => {
          resolverCalled = true;
          return resolver(r);
        },
      }),
    ).toThrow(RenderError);
    expect(resolverCalled).toBe(false);

    try {
      renderStructuredDocument(invalid);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
    }
  });

  it("throws RenderError('resolution-failed') when a CopyRef fails to resolve (missing resolver)", () => {
    const doc: StructuredDocument = { id: "acme.doc", title: ref("acme.title"), sections: [] };
    expect(() => renderStructuredDocument(doc)).toThrow(RenderError);
  });

  it("throws RenderError('resolution-failed') when the resolver returns undefined for a real CopyRef", () => {
    const doc: StructuredDocument = { id: "acme.doc", title: ref("acme.title"), sections: [] };
    expect(() => renderStructuredDocument(doc, { resolveCopyId: fakeResolver({}) })).toThrow(RenderError);
  });

  it("throws RenderError('resolution-failed') for a rejected link scheme even though the rest of the document is well-formed — the whole document is invalid, never a partial render", () => {
    const doc: StructuredDocument = {
      id: "acme.doc",
      title: ref("acme.title"),
      sections: [{ kind: "section", id: "s", level: 2, heading: ref("acme.h"), blocks: [{ kind: "paragraph", content: [{ kind: "link", text: ref("acme.t"), href: "javascript:alert(1)" }] }] }],
    };
    let thrown: unknown;
    try {
      renderStructuredDocument(doc, { resolveCopyId: fakeResolver({ "acme.title": "T", "acme.h": "H", "acme.t": "click" }) });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("resolution-failed");
  });
});

describe("renderStructuredDocument — messages never echo a caller id or key", () => {
  const SENTINEL_DOC_ID = "sentinel-doc-id-17";
  const SENTINEL_REF_ID = "sentinel.ref.id.17";
  const SENTINEL_HREF = "sentinel-href-17:payload";

  function thrownMessage(doc: StructuredDocument, options?: Parameters<typeof renderStructuredDocument>[1]): string {
    try {
      renderStructuredDocument(doc, options);
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      return (error as RenderError).message;
    }
    return expect.unreachable("expected renderStructuredDocument to throw");
  }

  it("names the rule and fixed path of an invalid document, not its id or the finding's own text", () => {
    const message = thrownMessage({
      id: SENTINEL_DOC_ID,
      title: ref("acme.title"),
      sections: [{ kind: "section", id: "s", level: 2, heading: ref("acme.h"), blocks: [{ kind: "paragraph", content: [{ kind: "link", text: ref("acme.t"), href: SENTINEL_HREF }] }] }],
    });
    expect(message).toBe("renderStructuredDocument refused to render an invalid document: link-scheme-not-allowed at sections.0.blocks.0.content.0.href.");
    expect(message).not.toContain(SENTINEL_DOC_ID);
    expect(message).not.toContain(SENTINEL_HREF);
  });

  it("names only the fixed path of an unresolved CopyRef, not its id or the document id", () => {
    const doc: StructuredDocument = { id: SENTINEL_DOC_ID, title: ref(SENTINEL_REF_ID), sections: [] };
    const message = thrownMessage(doc, { resolveCopyId: fakeResolver({}) });
    expect(message).toBe("renderStructuredDocument could not resolve a CopyRef at title (missing options.resolveCopyId, an unresolved id, or empty resolved text).");
    expect(message).not.toContain(SENTINEL_DOC_ID);
    expect(message).not.toContain(SENTINEL_REF_ID);
  });
});
