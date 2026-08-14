import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolution } from "@vespeneventures/copy";
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
