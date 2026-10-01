import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "../core/index.js";
import { RenderError } from "../internal/errors.js";
import { createWebRenderer } from "./internal/createWebRenderer.js";
import { defineWebTemplate } from "./internal/defineWebTemplate.js";
import { listWebTemplateNames } from "./internal/webTemplates.js";
import { REACT_DECLARED_RANGE, renderWebDocument } from "./renderWebDocument.js";

const baseErrorDoc: ComposeDocument = {
  id: "doc-1",
  channel: "web",
  template: "ErrorView",
  meta: { channel: "web", title: "Not found", description: "Not found." },
  bindings: [
    { slot: "status", value: "404" },
    { slot: "title", value: "Page not found" },
  ],
};

describe("renderWebDocument — refuses a document that resolves nothing", () => {
  it("throws RenderError('resolution-failed') for a document with no bindings at all", () => {
    const doc: ComposeDocument = { ...baseErrorDoc, bindings: [] };
    expect(() => renderWebDocument(doc)).toThrow(RenderError);
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
    }
  });

  it("throws RenderError('resolution-failed') when every binding targets an unknown slot", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [{ slot: "does-not-exist", value: "x" }],
    };
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("1 binding(s) targeting unknown slot(s)");
      expect((error as Error).message).not.toContain("does-not-exist");
    }
  });

  it("throws RenderError('resolution-failed') when a required slot has no binding", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [{ slot: "status", value: "404" }], // "title" is required and unbound
    };
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("title");
    }
  });

  it("throws RenderError('empty-output') when a required slot's copyId cannot be resolved — resolveDocument said ok, but the text is still empty", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [
        { slot: "status", value: "404" },
        { slot: "title", copyId: "missing.copy.id" }, // required, and no resolver is given
      ],
    };
    try {
      renderWebDocument(doc); // no options.resolveCopyId at all
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("title");
    }
  });

  it("throws RenderError('empty-output') when the resolver itself returns undefined for a required slot's copyId", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [
        { slot: "status", value: "404" },
        { slot: "title", copyId: "unresolvable" },
      ],
    };
    expect(() => renderWebDocument(doc, { resolveCopyId: () => undefined })).toThrow(RenderError);
  });
});

describe("renderWebDocument — hostile public RenderWebOptions.groups input", () => {
  const structuredGroupDoc: ComposeDocument = {
    id: "structured-group-direct-input",
    channel: "web",
    template: "MarketingView",
    meta: { channel: "web", title: "Acme", description: "Fixture." },
    bindings: [
      { slot: "brand", value: "Acme" },
      { slot: "heroHeading", value: "Fixture heading" },
      { slot: "ctaHeading", value: "Fixture CTA" },
    ],
  };
  const groupsWith = (faqItem: unknown) => ([
    { slot: "features", items: [] },
    { slot: "faq", items: [faqItem] },
  ]);

  function expectPublicGroupRefusal(groups: unknown): void {
    try {
      renderWebDocument(structuredGroupDoc, { groups: groups as never });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect(error).not.toBeInstanceOf(TypeError);
    }
  }

  it("rejects a non-array group input before attempting iteration", () => {
    expectPublicGroupRefusal({ slot: "faq" });
  });

  it("rejects a non-plain fields map before Object.entries can reach it", () => {
    expectPublicGroupRefusal(groupsWith({ index: 0, fields: new Map([['question', { value: "Q" }]]) }));
  });

  it("rejects mixed value and assetId in a structured field", () => {
    expectPublicGroupRefusal(groupsWith({ index: 0, fields: { question: { value: "Q", assetId: "asset.question" }, answer: { value: "A" } } }));
  });

  it("rejects unknown field-binding keys and malformed asset evidence", () => {
    expectPublicGroupRefusal(groupsWith({ index: 0, fields: { question: { value: "Q", node: {} }, answer: { assetId: "  " } } }));
  });

  it("rejects empty legacy and structured values before a template can build them", () => {
    expectPublicGroupRefusal([{ slot: " ", items: [] }]);
    expectPublicGroupRefusal([
      { slot: "features", items: [{ index: 0, value: "  " }] },
      { slot: "faq", items: [] },
    ]);
    expectPublicGroupRefusal(groupsWith({ index: 0, fields: { question: { value: "  " }, answer: { value: "A" } } }));
  });

  it("requires indexes to match the resolver's contiguous source order", () => {
    expectPublicGroupRefusal(groupsWith({ index: 1, fields: { question: { value: "Q" }, answer: { value: "A" } } }));
  });

  it("rejects sparse group/item arrays and hidden, symbol, or accessor wire keys before reading them", () => {
    const sparse = groupsWith({ index: 0, fields: { question: { value: "Q" }, answer: { value: "A" } } });
    sparse.length = 3;
    expectPublicGroupRefusal(sparse);
    const accessor = { slot: "faq", items: [] as unknown[] };
    Object.defineProperty(accessor, "slot", { enumerable: true, get: () => { throw new Error("getter must not run"); } });
    expectPublicGroupRefusal([{ slot: "features", items: [] }, accessor]);
    const itemAccessor = { fields: { question: { value: "Q" }, answer: { value: "A" } } };
    Object.defineProperty(itemAccessor, "index", { enumerable: true, get: () => { throw new Error("getter must not run"); } });
    expectPublicGroupRefusal(groupsWith(itemAccessor));
    const symbol = { slot: "faq", items: [] as unknown[] };
    Object.defineProperty(symbol, Symbol("hidden"), { value: true, enumerable: true });
    expectPublicGroupRefusal([{ slot: "features", items: [] }, symbol]);
    const nonIndex = groupsWith({ index: 0, fields: { question: { value: "Q" }, answer: { value: "A" } } });
    Object.defineProperty(nonIndex, "map", { enumerable: true, get: () => { throw new Error("map getter must not run"); } });
    expectPublicGroupRefusal(nonIndex);
  });
});

describe("renderWebDocument — assetId refusal paths (never a blank box)", () => {
  const assetDoc: ComposeDocument = {
    id: "acme-signin",
    channel: "web",
    template: "AuthView",
    meta: { channel: "web", title: "Sign in", description: "d" },
    bindings: [
      { slot: "brand", assetId: "marketing.logo" },
      { slot: "heading", value: "Sign in" },
      { slot: "form", value: "form" },
    ],
  };

  it("throws RenderError('empty-output') for an unresolved assetId — no resolveAssetId given at all", () => {
    try {
      renderWebDocument(assetDoc);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("resolved the document against its template, but at least one assetId binding did not produce a real asset: 1 assetId(s) that did not resolve to a real asset");
      expect((error as Error).message).not.toContain("marketing.logo");
      expect((error as Error).message).not.toContain("acme-signin");
      expect((error as Error).message).not.toContain("AuthView");
    }
  });

  it("throws RenderError('empty-output') when resolveAssetId returns undefined for a bound assetId", () => {
    try {
      renderWebDocument(assetDoc, { resolveAssetId: () => undefined });
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("1 assetId(s) that did not resolve to a real asset");
      expect((error as Error).message).not.toContain("marketing.logo");
    }
  });

  it("throws RenderError('empty-output') when resolveAssetId throws — the failure is caught and reported, never propagated raw", () => {
    try {
      renderWebDocument(assetDoc, {
        resolveAssetId: () => {
          throw new Error("registry unavailable");
        },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("1 slot(s) asset resolution could not even attempt to resolve");
      expect((error as Error).message).not.toContain("registry unavailable");
    }
  });

  it("throws RenderError('empty-output') when resolveAssetId is not a function", () => {
    try {
      // Deliberately wrong-typed input — cast, not `@ts-expect-error`; a
      // *.test.ts file isn't part of this package's real tsc build, so
      // that directive would be inert and never actually checked.
      renderWebDocument(assetDoc, { resolveAssetId: "not-a-function" as unknown as () => unknown });
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
    }
  });

  it("throws RenderError('empty-output') when resolveAssetId resolves to a value missing the required src/width/height/alt shape", () => {
    try {
      renderWebDocument(assetDoc, { resolveAssetId: () => ({ nope: true }) });
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("1 assetId(s) that resolved to a value that did not match the required RenderImageAsset or RenderVideoAsset shape");
      expect((error as Error).message).not.toContain("marketing.logo");
    }
  });

  it("an unresolved assetId on an OPTIONAL slot is STILL fatal — never a silent omission the way an optional copyId is", () => {
    // "brand" is optional in AuthView's own layout — proves assets get a
    // strictly stronger bar than text, per this file's own doc comment.
    expect(() => renderWebDocument(assetDoc, { resolveAssetId: () => undefined })).toThrow(RenderError);
  });
});

describe("renderWebDocument — other refusals", () => {
  it("throws RenderError('unknown-template') for a template this package does not know", () => {
    const doc: ComposeDocument = { ...baseErrorDoc, template: "DashboardView" };
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("unknown-template");
      expect((error as Error).message).not.toContain("DashboardView");
      expect((error as Error).message).toContain("AuthView");
      expect((error as Error).message).toContain("ErrorView");
    }
  });

  it("throws RenderError('wrong-channel') for a non-web document", () => {
    const doc = {
      id: "doc-email",
      channel: "email",
      template: "ErrorView",
      meta: { channel: "email", subject: "hi", preheader: "hi" },
      bindings: [],
    } as unknown as ComposeDocument;
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("wrong-channel");
    }
  });
});

describe("renderWebDocument — success paths", () => {
  it("resolves a literal value binding with no resolver needed", () => {
    const { element, head } = renderWebDocument(baseErrorDoc);
    expect(element).toBeDefined();
    expect(head.title).toBe("Not found");
  });

  it("resolves a copyId binding through the caller's resolveCopyId", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [
        { slot: "status", copyId: "status.404" },
        { slot: "title", value: "Page not found" },
      ],
    };
    const { element } = renderWebDocument(doc, {
      resolveCopyId: (id) => (id === "status.404" ? "404" : undefined),
    });
    expect(element).toBeDefined();
  });

  it("last binding wins when two bindings target the same slot key, matching resolveDocument's own documented behavior", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [
        { slot: "status", value: "404" },
        { slot: "title", value: "First" },
        { slot: "title", value: "Second" },
      ],
    };
    // Both resolve (resolveDocument does not pick a winner at its own
    // layer — see its doc comment); this package's content-building loop
    // applies bindings in array order, so the LAST one determines the
    // slot's final text. Documented here as this renderer's own policy
    // choice on top of resolveDocument's neutral "you decide" stance.
    const { element } = renderWebDocument(doc);
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Second");
    expect(html).not.toContain("First");
  });
});

describe("renderWebDocument — module-level sugar is unaffected by defineWebTemplate/createWebRenderer existing (issue #175 compatibility)", () => {
  it("listWebTemplateNames() still returns exactly AuthView/ErrorView/MarketingView", () => {
    expect(listWebTemplateNames().sort()).toEqual(["AuthView", "ErrorView", "MarketingView"]);
  });

  it("renders AuthView from brand, heading, and form: a site header, the heading above a card, and a site footer", () => {
    const doc: ComposeDocument = {
      id: "acme-signin",
      channel: "web",
      template: "AuthView",
      meta: { channel: "web", title: "Sign in", description: "d" },
      bindings: [
        { slot: "brand", value: "Acme" },
        { slot: "heading", value: "Sign in" },
        { slot: "form", value: "form-marker-7f3a" },
      ],
    };
    const html = renderToStaticMarkup(renderWebDocument(doc).element);
    expect(html).toContain("Sign in");
    expect(html).toContain("<header");
    expect(html).toContain("<footer");
    expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("rounded-control"));
    expect(html.indexOf("rounded-control")).toBeLessThan(html.indexOf("form-marker-7f3a"));
  });

  it("renders the AuthView footerSecondary slot inside the site footer, after the form", () => {
    const doc: ComposeDocument = {
      id: "acme-signin-footer",
      channel: "web",
      template: "AuthView",
      meta: { channel: "web", title: "Sign in", description: "d" },
      bindings: [
        { slot: "brand", value: "Acme" },
        { slot: "heading", value: "Sign in" },
        { slot: "form", value: "form-marker-7f3a" },
        { slot: "footerSecondary", value: "footer-secondary-marker-2c9d" },
      ],
    };
    const html = renderToStaticMarkup(renderWebDocument(doc).element);
    const footerStart = html.indexOf("<footer");
    expect(footerStart).toBeGreaterThan(-1);
    expect(html.indexOf("footer-secondary-marker-2c9d")).toBeGreaterThan(footerStart);
    expect(html.indexOf("form-marker-7f3a")).toBeLessThan(footerStart);
  });
});

describe("renderWebDocument — node-kind slots (options.nodes), via a consumer-defined template", () => {
  const WIDGET_TEMPLATE = defineWebTemplate({
    name: "WidgetView",
    flow: {
      slots: [
        { key: "heading", required: true },
        { key: "widget", required: true },
        { key: "caption" },
      ],
    },
    slotKinds: { widget: ["node"] },
    repeatingSlots: [{ key: "items" }],
    blocks: [
      { kind: "page-header", title: "heading", description: "caption" },
      { kind: "node-chapter", node: "widget" },
      { kind: "stat-grid", repeating: "items" },
    ],
  });

  const rendererFor = (template = WIDGET_TEMPLATE) => createWebRenderer({ templates: [template] });

  const baseWidgetDoc: ComposeDocument = {
    id: "acme-widget",
    channel: "web",
    template: "WidgetView",
    meta: { channel: "web", title: "Widget", description: "d" },
    bindings: [{ slot: "heading", value: "Acme Widget Page" }],
  };

  it("renders a real caller-owned ReactElement into a node-kind slot, end to end via react-dom/server", () => {
    const renderer = rendererFor();
    const widgetNode = createElement("button", { type: "button" }, "Click me");
    const { element } = renderer.renderWebDocument(baseWidgetDoc, { nodes: [{ slot: "widget", node: widgetNode }] });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Acme Widget Page");
    expect(html).toContain('<button type="button">Click me</button>');
  });

  it("rejects sparse and accessor-shaped options.nodes without invoking an accessor", () => {
    const renderer = rendererFor();
    const sparse = new Array(1);
    expect(() => renderer.renderWebDocument(baseWidgetDoc, { nodes: sparse as never })).toThrow(RenderError);

    let accessed = false;
    const accessorItem = { slot: "widget", node: {} };
    Object.defineProperty(accessorItem, "node", { enumerable: true, get: () => { accessed = true; throw new Error("node getter must not run"); } });
    expect(() => renderer.renderWebDocument(baseWidgetDoc, { nodes: [accessorItem] as never })).toThrow(RenderError);
    expect(accessed).toBe(false);
  });

  it("throws RenderError('empty-output') when a required node-kind slot has no matching entry in options.nodes", () => {
    const renderer = rendererFor();
    try {
      renderer.renderWebDocument(baseWidgetDoc);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("widget");
    }
  });

  it("throws RenderError('resolution-failed') when a node targets a slot the template does not declare at all", () => {
    const renderer = rendererFor();
    try {
      renderer.renderWebDocument(baseWidgetDoc, { nodes: [{ slot: "does-not-exist", node: {} }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("a node binding for a slot the template does not declare as a flowed slot");
      expect((error as Error).message).not.toContain("does-not-exist");
    }
  });

  it("throws RenderError('resolution-failed') when a node targets a real flowed slot whose slotKinds does not include 'node'", () => {
    const renderer = rendererFor();
    try {
      renderer.renderWebDocument(baseWidgetDoc, { nodes: [{ slot: "heading", node: {} }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain('a node binding for a slot whose declared content kind(s) (copy, asset) do not include "node"');
      expect((error as Error).message).not.toContain("heading");
      expect((error as Error).message).not.toContain("acme-widget");
    }
  });

  it("throws RenderError('resolution-failed') when a single node targets a slot that is REPEATING on this template, not flowed", () => {
    const renderer = rendererFor();
    try {
      renderer.renderWebDocument(baseWidgetDoc, { nodes: [{ slot: "items", node: {} }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("REPEATING");
    }
  });

  it("throws RenderError('resolution-failed') when a node collides with a copy/asset binding already targeting the same slot", () => {
    const renderer = rendererFor();
    const doc: ComposeDocument = { ...baseWidgetDoc, bindings: [...baseWidgetDoc.bindings, { slot: "widget", value: "text version" }] };
    try {
      renderer.renderWebDocument(doc, { nodes: [{ slot: "widget", node: createElement("span", null, "node version") }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
    }
  });

  it("throws RenderError('resolution-failed') when a copy binding targets a slot restricted to 'node'-only content", () => {
    const renderer = rendererFor();
    const doc: ComposeDocument = { ...baseWidgetDoc, bindings: [...baseWidgetDoc.bindings, { slot: "widget", value: "not allowed here" }] };
    try {
      renderer.renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain('a copy binding for a slot whose declared content kind(s) (node) do not include "copy"');
      expect((error as Error).message).not.toContain("widget");
    }
  });

  it("throws RenderError('resolution-failed') when an assetId binding targets a slot restricted to 'node'-only content", () => {
    const renderer = rendererFor();
    const doc: ComposeDocument = { ...baseWidgetDoc, bindings: [...baseWidgetDoc.bindings, { slot: "widget", assetId: "acme.widget.icon" }] };
    try {
      renderer.renderWebDocument(doc, { resolveAssetId: () => ({ type: "image", src: "https://cdn.example/icon.svg", width: 1, height: 1, alt: "Placeholder icon" }) });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("asset");
    }
  });

  it("an optional node-kind slot with no options.nodes entry simply renders absent, like any other unbound optional slot", () => {
    const renderer = rendererFor(
      defineWebTemplate({
        name: "OptionalWidgetView",
        flow: { slots: [{ key: "heading", required: true }, { key: "widget" }] },
        slotKinds: { widget: ["node"] },
        blocks: [
          { kind: "page-header", title: "heading" },
          { kind: "node-chapter", node: "widget" },
        ],
      }),
    );
    const doc: ComposeDocument = { ...baseWidgetDoc, template: "OptionalWidgetView" };
    const { element } = renderer.renderWebDocument(doc);
    expect(renderToStaticMarkup(element)).toContain("Acme Widget Page");
  });
});

describe("the react peer-version guard (#182)", () => {
  it("keeps REACT_DECLARED_RANGE in sync with package.json's declared peer range", () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
    };
    expect(REACT_DECLARED_RANGE).toBe(manifest.peerDependencies.react);
    expect(manifest.peerDependenciesMeta.react?.optional).toBe(true);
  });

  it("importing this module does not throw against this repository's own real installed react", () => {
    // renderWebDocument.ts calls assertPeerVersion(...) at module load
    // time (see its own header comment); this file already imported it
    // above, so reaching this test at all is itself the assertion that
    // it didn't throw against the real react this workspace has installed.
    expect(REACT_DECLARED_RANGE).toBe(">=18");
  });
});

describe("renderWebDocument — refusal messages never echo a document id, template name, slot or field key", () => {
  const SENTINEL_DOC_ID = "sentinel-doc-id-34";
  const SENTINEL_TEMPLATE = "SentinelTemplate34";
  const SENTINEL_SLOT = "sentinel-slot-34";
  const SENTINEL_FIELD = "sentinel-field-34";

  const template = (name: string) =>
    defineWebTemplate({
      name,
      flow: { slots: [{ key: "heading", required: true }, { key: "widget" }] },
      slotKinds: { widget: ["node"] },
      repeatingSlots: [{ key: "items" }],
      blocks: [
        { kind: "page-header", title: "heading" },
        { kind: "node-chapter", node: "widget" },
        { kind: "stat-grid", repeating: "items" },
      ],
    });
  const doc = (overrides: Partial<ComposeDocument> = {}): ComposeDocument => ({
    id: SENTINEL_DOC_ID,
    channel: "web",
    template: SENTINEL_TEMPLATE,
    meta: { channel: "web", title: "Sentinel", description: "d" },
    bindings: [{ slot: "heading", value: "Sentinel heading" }],
    ...overrides,
  });
  const renderer = () => createWebRenderer({ templates: [template(SENTINEL_TEMPLATE)] });

  function refusal(run: () => unknown, reason: RenderError["reason"]): string {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe(reason);
      return (error as RenderError).message;
    }
    return expect.unreachable("expected renderWebDocument to throw");
  }

  function expectNoEchoes(message: string): void {
    expect(message).not.toContain(SENTINEL_DOC_ID);
    expect(message).not.toContain(SENTINEL_TEMPLATE);
    expect(message).not.toContain(SENTINEL_SLOT);
    expect(message).not.toContain(SENTINEL_FIELD);
  }

  it("an unknown template is refused without the template name", () => {
    const message = refusal(() => createWebRenderer({ templates: [template("OtherView")] }).renderWebDocument(doc()), "unknown-template");
    expect(message).toBe("renderWebDocument does not know the document's template. Known templates: OtherView.");
    expectNoEchoes(message);
  });

  it("a structured fields item on a slot whose template declares no fields is refused without the template name", () => {
    const message = refusal(
      () => renderer().renderWebDocument(doc(), { groups: [{ slot: "items", items: [{ index: 0, fields: { [SENTINEL_FIELD]: { value: "v" } } }] }] }),
      "resolution-failed",
    );
    expect(message).toBe('renderWebDocument received a structured fields item for repeating slot "items", but the template does not declare fields for that slot.');
    expectNoEchoes(message);
  });

  it("repeating groups for undeclared slots are refused without the slot names", () => {
    const message = refusal(() => renderer().renderWebDocument(doc(), { groups: [{ slot: SENTINEL_SLOT, items: [{ index: 0, value: "v" }] }] }), "resolution-failed");
    expect(message).toBe("renderWebDocument received 1 repeating group(s) for slot(s) the template does not declare as repeating. Known repeating slot(s): items.");
    expectNoEchoes(message);
  });

  it("an assetId binding on a node-only slot is refused without the slot or template name", () => {
    const message = refusal(
      () =>
        renderer().renderWebDocument(doc({ bindings: [{ slot: "heading", value: "h" }, { slot: "widget", assetId: "sentinel.asset.34" }] }), {
          resolveAssetId: () => ({ type: "image", src: "https://cdn.example/icon.svg", width: 1, height: 1, alt: "Placeholder icon" }),
        }),
      "resolution-failed",
    );
    expect(message).toBe('renderWebDocument received an assetId binding for a slot whose declared content kind(s) (node) do not include "asset".');
    expectNoEchoes(message);
    expect(message).not.toContain("sentinel.asset.34");
  });

  it("a single node binding on a repeating slot is refused without the slot or template name", () => {
    const message = refusal(() => renderer().renderWebDocument(doc(), { nodes: [{ slot: "items", node: {} }] }), "resolution-failed");
    expect(message).toContain("received a single node binding for a slot that is a REPEATING slot on this template");
    expectNoEchoes(message);
  });

  it("a node binding on a slot the template does not declare is refused without the slot or template name", () => {
    const message = refusal(() => renderer().renderWebDocument(doc(), { nodes: [{ slot: SENTINEL_SLOT, node: {} }] }), "resolution-failed");
    expect(message).toBe("renderWebDocument received a node binding for a slot the template does not declare as a flowed slot at all. Known flowed slot(s): heading, widget.");
    expectNoEchoes(message);
  });

  it("a node colliding with a copy binding on the same slot is refused without the slot or template name", () => {
    const message = refusal(
      () => createWebRenderer({ templates: [defineWebTemplate({ name: SENTINEL_TEMPLATE, flow: { slots: [{ key: "heading", required: true }, { key: "widget" }] }, slotKinds: { widget: ["node", "copy"] }, blocks: [{ kind: "page-header", title: "heading" }, { kind: "node-chapter", node: "widget" }] })] }).renderWebDocument(doc({ bindings: [{ slot: "heading", value: "h" }, { slot: "widget", value: "text" }] }), { nodes: [{ slot: "widget", node: {} }] }),
      "resolution-failed",
    );
    expect(message).toBe("renderWebDocument received both a node binding (options.nodes) and a copy/asset binding (doc.bindings) for one slot — a slot may resolve from exactly one source.");
    expectNoEchoes(message);
  });

  it("a required slot that resolves to no content is refused without the document id or template name", () => {
    const message = refusal(() => renderer().renderWebDocument(doc({ bindings: [{ slot: "heading", copyId: "sentinel.copy.34" }] })), "empty-output");
    expect(message).toContain("renderWebDocument resolved the document against its template, but required slot(s) [heading] produced no content");
    expectNoEchoes(message);
    expect(message).not.toContain("sentinel.copy.34");
  });

  it.each([
    ["an unknown key in a field binding", { bogus: 1 }, "fields[1] must be a plain value/assetId binding with no unknown keys."],
    ["a field binding with neither source", {}, "fields[1] must set exactly one of value/assetId."],
    ["a blank field value", { value: "  " }, "fields[1].value must be a non-whitespace string when supplied."],
    ["a blank field assetId", { assetId: "  " }, "fields[1].assetId must be a non-whitespace string when supplied."],
  ])("%s is named by field position, not by the field key", (_label, binding, tail) => {
    const message = refusal(
      () => renderer().renderWebDocument(doc(), { groups: [{ slot: "items", items: [{ index: 0, fields: { first: { value: "v" }, [SENTINEL_FIELD]: binding } }] }] as never }),
      "resolution-failed",
    );
    expect(message).toBe(`renderWebDocument refused malformed RenderWebOptions.groups: groups[0].items[0].${tail}`);
    expectNoEchoes(message);
  });
});
