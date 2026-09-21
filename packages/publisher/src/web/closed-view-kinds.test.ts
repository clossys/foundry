/**
 * Issue #1053 — a page band SectionedView cannot express registers through
 * defineWebTemplate and renders via createWebRenderer; resolveSurfaceDocument
 * refuses unknown template names when knownTemplates is supplied.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { resolveSurfaceDocument, SurfaceResolutionError } from "../core/index.js";
import type { SurfaceDocument } from "../core/index.js";
import { createWebRenderer } from "./internal/createWebRenderer.js";
import { defineWebTemplate } from "./internal/defineWebTemplate.js";

const ref = (id: string) => ({ id });

const registry: CopyRegistry = {
  id: "acme-statement-page-fixture",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "fixtures/acme-statement-page" },
  entries: [
    { id: "acme.hero.heading", text: "Acme placeholder heading", context: "fixture", status: "approved" },
    { id: "acme.statement.body", text: "Acme placeholder statement copy.", context: "fixture", status: "approved" },
  ],
};

const resolver: CopyResolver = createCopyResolver(registry);

const STATEMENT_PAGE_TEMPLATE = defineWebTemplate({
  name: "StatementPageView",
  flow: { slots: [{ key: "statement", required: true }] },
  build: (content) => createElement("section", { "data-testid": "statement-band" }, createElement("p", null, content.statement)),
});

const surface: SurfaceDocument = {
  id: "acme.statement",
  channel: "web",
  template: "StatementPageView",
  meta: { channel: "web", title: ref("acme.hero.heading"), description: ref("acme.hero.heading") },
  bindings: [{ slot: "statement", copy: ref("acme.statement.body") }],
};

describe("defineWebTemplate — statement band not expressible as a SectionedView kind", () => {
  it("resolveSurfaceDocument refuses an unregistered template name when knownTemplates is supplied", () => {
    try {
      resolveSurfaceDocument(surface, resolver, { knownTemplates: ["MarketingView"] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SurfaceResolutionError);
      expect((error as SurfaceResolutionError).reason).toBe("unsupported-template");
      expect((error as Error).message).toContain("StatementPageView");
    }
  });

  it("renders the statement band through a consumer createWebRenderer registry", () => {
    const renderer = createWebRenderer({ templates: [STATEMENT_PAGE_TEMPLATE] });
    const resolved = resolveSurfaceDocument(surface, resolver, { knownTemplates: renderer.listWebTemplateNames() });
    const { element } = renderer.renderWebDocument(resolved.document, { groups: resolved.groups, nodes: resolved.nodes });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('data-testid="statement-band"');
    expect(html).toContain("Acme placeholder statement copy.");
  });
});
