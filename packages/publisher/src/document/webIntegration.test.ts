/**
 * The end-to-end path issue #176's own "Consumer evidence" section asks
 * for: a real multi-section `StructuredDocument` — nested sections at
 * least two levels deep, a table, a list, and a cross-reference link
 * between sections — rendered through `renderStructuredDocument`, then
 * handed to a consumer-defined `surface/web` template's `"node"`-kind slot
 * (`defineWebTemplate`/`createWebRenderer`, issue #175) and rendered into a
 * full page. This is the wiring `renderStructuredDocument`'s own output was
 * built to plug into — see this package's README, "document", "Plugging a
 * rendered document into a page".
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolution } from "@vespeneventures/writer";
import { collectCopyProvenance, resolveSurfaceDocument } from "../core/index.js";
import type { SurfaceDocument } from "../core/index.js";
import { createWebRenderer, defineWebTemplate } from "../web/index.js";
import { renderStructuredDocument } from "./render.js";
import type { StructuredDocument } from "./types.js";

const ref = (id: string): CopyRef => ({ id });

const copy: Record<string, string> = {
  "acme.page.title": "Acme help center",
  "acme.doc.title": "Getting started with Acme",
  "acme.overview.heading": "Overview",
  "acme.overview.p1": "Read this first.",
  "acme.overview.link": "See pricing",
  "acme.overview.item1": "Create a project",
  "acme.overview.item2": "Invite your team",
  "acme.overview.details.heading": "Before you begin",
  "acme.overview.details.p1": "Make sure billing is set up.",
  "acme.pricing.heading": "Pricing",
  "acme.pricing.plan": "Plan",
  "acme.pricing.price": "Price",
  "acme.pricing.plan1": "Starter",
  "acme.pricing.price1": "$0",
  "acme.pricing.plan2": "Pro",
  "acme.pricing.price2": "$9",
};

function resolver(candidate: CopyRef): CopyResolution | undefined {
  const text = copy[candidate.id];
  if (text === undefined) return undefined;
  return { ref: candidate, text, recordId: "acme-help-registry", revision: "rev-7", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: candidate.id };
}

const helpArticle: StructuredDocument = {
  id: "acme.help.getting-started",
  title: ref("acme.doc.title"),
  sections: [
    {
      kind: "section",
      id: "overview",
      level: 2,
      heading: ref("acme.overview.heading"),
      blocks: [
        { kind: "paragraph", content: [{ kind: "text", text: ref("acme.overview.p1") }, { kind: "link", text: ref("acme.overview.link"), href: "#pricing" }] },
        { kind: "list", style: "ordered", items: [[{ kind: "text", text: ref("acme.overview.item1") }], [{ kind: "text", text: ref("acme.overview.item2") }]] },
        {
          kind: "section",
          id: "overview-details",
          level: 3,
          heading: ref("acme.overview.details.heading"),
          blocks: [{ kind: "paragraph", content: [{ kind: "text", text: ref("acme.overview.details.p1") }] }],
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
          headers: [ref("acme.pricing.plan"), ref("acme.pricing.price")],
          rows: [
            [ref("acme.pricing.plan1"), ref("acme.pricing.price1")],
            [ref("acme.pricing.plan2"), ref("acme.pricing.price2")],
          ],
        },
      ],
    },
  ],
};

// A consumer's own help-article page shell — the "page shell (header, nav,
// footer) around the document body" issue #176 itself describes as exactly
// the kind of thing a consumer's own template already provides.
const HelpArticleView = defineWebTemplate({
  name: "HelpArticleView",
  flow: { slots: [{ key: "heading", required: true }, { key: "body", required: true }] },
  slotKinds: { body: ["node"] },
  build: (content) => createElement("main", null, createElement("h1", null, content.heading), content.body),
});

describe("StructuredDocument -> renderStructuredDocument -> a consumer's own node-kind web slot -> a full page", () => {
  it("renders a real multi-section document (nested sections, a table, a list, a cross-reference link) into a page composed via createWebRenderer", () => {
    const { element: documentElement, resolutions: documentResolutions } = renderStructuredDocument(helpArticle, { resolveCopyId: resolver });

    const HelpArticleRenderer = createWebRenderer({ templates: [HelpArticleView] });

    const page: SurfaceDocument = {
      id: "acme.help.getting-started.page",
      channel: "web",
      template: "HelpArticleView",
      meta: { channel: "web", title: ref("acme.page.title"), description: ref("acme.page.title") },
      bindings: [
        { slot: "heading", copy: ref("acme.page.title") },
        // The rendered structured-document tree reaches the page through
        // exactly the same "node"-kind slot seam every other rich,
        // caller-owned node uses — never a second, parallel composition
        // path this package invented for documents specifically.
        { slot: "body", node: documentElement as object },
      ],
    };

    const resolved = resolveSurfaceDocument(page, resolver, { nodeSlots: ["body"] });
    const { element: pageElement } = HelpArticleRenderer.renderWebDocument(resolved.document, { nodes: resolved.nodes });
    const html = renderToStaticMarkup(pageElement);

    expect(html).toContain("<h1>Acme help center</h1>");
    expect(html).toContain('<section id="overview">');
    expect(html).toContain('<section id="overview-details">');
    expect(html).toContain('<a href="#pricing">See pricing</a>');
    expect(html).toContain('<th scope="col">Plan</th>');
    expect(html).toContain("<td>Starter</td><td>$0</td>");
    // The page's own <h1> and the document's own resolved title are
    // independent — the document's title is provenance-only, never
    // rendered into the tree itself (see render.ts's own doc comment).
    expect(html).not.toContain("Getting started with Acme");

    // Structured-document provenance folds into the same
    // collectCopyProvenance every other channel's manifest already uses —
    // resolved.resolutions (the page's own copy) plus the document's own
    // resolutions, together, not two disconnected provenance stores.
    const provenance = collectCopyProvenance([...resolved.resolutions, ...documentResolutions]);
    const allEntryIds = provenance.flatMap((p) => p.entryIds);
    expect(allEntryIds).toEqual(expect.arrayContaining(["acme.doc.title", "acme.overview.heading", "acme.pricing.plan1"]));
  });
});
