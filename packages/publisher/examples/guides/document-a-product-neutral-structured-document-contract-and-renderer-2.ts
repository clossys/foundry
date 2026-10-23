// Example fix: Use the public data-only template API and declare its instance-scoped template name.
const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const myCopyResolver = fixtureResolveCopy;
const ref = (id: string): import("@clossys/writer").CopyRef => ({ id });
const element = createElement("p", null, "Article body");

import { createElement } from "react";
import { defineWebTemplate, createWebRenderer } from "@clossys/publisher/web";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import type { SurfaceDocument } from "@clossys/publisher/core";

const HelpArticleView = defineWebTemplate({
  name: "HelpArticleView",
  flow: { slots: [{ key: "heading", required: true }, { key: "body", required: true }] },
  slotKinds: { body: ["node"] },
  blocks: [{ kind: "page-header", title: "heading" }, { kind: "node-chapter", node: "body", title: "heading" }],
});

const page: SurfaceDocument = {
  id: "acme.help.getting-started.page",
  channel: "web",
  template: "HelpArticleView",
  meta: { channel: "web", title: ref("acme.page.title"), description: ref("acme.page.title") },
  bindings: [
    { slot: "heading", copy: ref("acme.page.title") },
    { slot: "body", node: element as object }, // renderStructuredDocument's own `element`, from above
  ],
};

const resolved = resolveSurfaceDocument(page, myCopyResolver, { nodeSlots: ["body"], knownTemplates: [HelpArticleView.name] });
const { element: pageElement } = createWebRenderer({ templates: [HelpArticleView] }).renderWebDocument(resolved.document, { nodes: resolved.nodes });

export { pageElement };
