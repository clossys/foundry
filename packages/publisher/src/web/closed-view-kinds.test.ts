/**
 * Issue #1053 — a page band SectionedView cannot express registers through
 * defineWebTemplate and renders via createWebRenderer; resolveSurfaceDocument
 * refuses unknown template names when knownTemplates is supplied.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { resolveSurfaceDocument, SurfaceResolutionError, validateSectionedViewDocument } from "../core/index.js";
import type { SurfaceDocument } from "../core/index.js";
import { createWebRenderer } from "./internal/createWebRenderer.js";
import { defineWebTemplate } from "./internal/defineWebTemplate.js";
import { assertRenderableSectionedViewDocument } from "./views/SectionedViewContent.js";

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
  blocks: [{ kind: "marketing-chapter", title: "statement" }],
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
      expect((error as Error).message).toBe("resolveSurfaceDocument cannot resolve the surface: its template is not registered. Known template(s): MarketingView.");
      expect((error as Error).message).not.toContain("StatementPageView");
    }
  });

  it("renders the statement band through a consumer createWebRenderer registry", () => {
    const renderer = createWebRenderer({ templates: [STATEMENT_PAGE_TEMPLATE] });
    const resolved = resolveSurfaceDocument(surface, resolver, { knownTemplates: renderer.listWebTemplateNames() });
    const { element } = renderer.renderWebDocument(resolved.document, { groups: resolved.groups, nodes: resolved.nodes });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Acme placeholder statement copy.");
    expect(html).toContain("text-h2");
  });
});

describe("SectionedView render boundary — the same closed kinds as the document contract", () => {
  /** The kinds the document contract names when it refuses an unknown one. */
  const contractKinds = (): string[] => {
    const message = validateSectionedViewDocument({ id: "acme-kinds", sections: [{ id: "x", kind: "statement-band", ground: "base", heading: ref("acme.hero.heading") }] } as never).find((entry) => entry.rule === "sectioned-view-section-kind")?.message ?? "";
    return (/supported kinds are (.+)\.$/.exec(message)?.[1] ?? "").split(", ");
  };
  const kindRefusal = (kind: string): boolean => {
    const resolved = {
      id: "acme-kinds",
      resolutions: [{ ref: { id: "acme.hero.heading" }, text: "Acme placeholder heading", recordId: "acme", revision: "1", locale: "en", servedLocale: "en", chain: ["en"], source: { kind: "consumer", reference: "fixture" }, entryId: "acme.hero.heading" }],
      sections: [{ id: "x", kind, ground: "base", heading: "Acme placeholder heading" }],
    };
    try {
      assertRenderableSectionedViewDocument(resolved);
    } catch (error) {
      return (error as Error).message === "sections.0.kind is not a supported SectionedView kind.";
    }
    return false;
  };

  it("accepts exactly the ten contract kinds, content-section included, and refuses any other", () => {
    const kinds = contractKinds();
    expect(kinds).toHaveLength(10);
    expect(kinds).toContain("content-section");
    expect(kinds.filter(kindRefusal)).toEqual([]);
    expect(kindRefusal("statement-band")).toBe(true);
  });
});
