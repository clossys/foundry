/**
 * End-to-end `MarketingView` tests — the second and final half of issue
 * #166 (the flowed-marketing-template gap; repeating-group bindings
 * themselves shipped separately). Unlike `golden-render.test.ts` (which
 * feeds a raw `ComposeDocument` plus a hand-built `options.groups`
 * directly to `renderWebDocument`, exercising this file's own
 * `resolveTemplateGroups` logic in isolation), every test here runs the
 * REAL end-to-end pipeline a consumer actually uses: author a
 * `SurfaceDocument`, resolve it with `resolveSurfaceDocument` against a
 * real `CopyRegistry`, then render the result — proving the whole seam
 * (`SurfaceRepeatingSlotBinding` -> `ResolvedSurfaceDocument.groups` ->
 * `RenderWebOptions.groups` -> `MarketingView`) actually works together,
 * not just each half in isolation.
 *
 * Fixtures are deliberately, obviously placeholder text — "Placeholder
 * feature one", "Acme Wordmark" — never anything that reads as real
 * product copy, per this repository's own public-safety rules.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRegistry, CopyResolver } from "@vespeneventures/copy";
import { createCopyResolver } from "@vespeneventures/copy";
import { resolveSurfaceDocument } from "../core/index.js";
import type { SurfaceDocument } from "../core/index.js";
import { RenderError } from "../internal/errors.js";
import { renderWebDocument } from "./renderWebDocument.js";

const ref = (id: string) => ({ id });

const registry: CopyRegistry = {
  id: "acme-marketing-fixture",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "fixtures/acme-marketing" },
  entries: [
    { id: "acme.brand", text: "Acme Wordmark", context: "fixture", status: "approved" },
    { id: "acme.hero.heading", text: "Placeholder hero heading", context: "fixture", status: "approved" },
    { id: "acme.hero.description", text: "Placeholder hero description.", context: "fixture", status: "approved" },
    { id: "acme.cta.heading", text: "Placeholder CTA heading", context: "fixture", status: "approved" },
    { id: "acme.feature.a", text: "Placeholder feature A", context: "fixture", status: "approved" },
    { id: "acme.feature.b", text: "Placeholder feature B", context: "fixture", status: "approved" },
    { id: "acme.feature.c", text: "Placeholder feature C", context: "fixture", status: "approved" },
  ],
};

const resolver: CopyResolver = createCopyResolver(registry);

const baseBindings: SurfaceDocument["bindings"] = [
  { slot: "brand", copy: ref("acme.brand") },
  { slot: "heroHeading", copy: ref("acme.hero.heading") },
  { slot: "heroDescription", copy: ref("acme.hero.description") },
  { slot: "ctaHeading", copy: ref("acme.cta.heading") },
];

function marketingDoc(bindings: SurfaceDocument["bindings"]): SurfaceDocument {
  return {
    id: "acme.marketing.home",
    channel: "web",
    meta: { channel: "web", title: ref("acme.brand"), description: ref("acme.hero.description") },
    template: "MarketingView",
    bindings,
  };
}

describe("MarketingView — realistic end-to-end render, every slot filled", () => {
  it("renders a full marketing page: header brand, hero, an ordered feature grid, and the CTA band", () => {
    const doc = marketingDoc([
      ...baseBindings,
      { slot: "features", items: [{ copy: ref("acme.feature.a") }, { copy: ref("acme.feature.b") }, { copy: ref("acme.feature.c") }] },
    ]);

    const resolved = resolveSurfaceDocument(doc, resolver);
    const { element, head } = renderWebDocument(resolved.document, { groups: resolved.groups });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Acme Wordmark");
    expect(html).toContain("Placeholder hero heading");
    expect(html).toContain("Placeholder hero description.");
    expect(html).toContain("Placeholder feature A");
    expect(html).toContain("Placeholder feature B");
    expect(html).toContain("Placeholder feature C");
    expect(html).toContain("Placeholder CTA heading");
    expect(head.title).toBe("Acme Wordmark");
  });
});

describe("MarketingView — repeating 'features' slot: 0, 1, and many items", () => {
  it("renders cleanly with zero items — an explicit empty group is valid, not an error", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    const { element } = renderWebDocument(resolved.document, { groups: resolved.groups });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("Placeholder feature");
    expect(html).toContain("Placeholder hero heading");
  });

  it("renders cleanly with exactly one item", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [{ copy: ref("acme.feature.a") }] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    const { element } = renderWebDocument(resolved.document, { groups: resolved.groups });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Placeholder feature A");
    expect(html).not.toContain("Placeholder feature B");
  });

  it("renders cleanly with many items, and preserves authored order end to end", () => {
    const doc = marketingDoc([
      ...baseBindings,
      { slot: "features", items: [{ copy: ref("acme.feature.c") }, { copy: ref("acme.feature.a") }, { copy: ref("acme.feature.b") }] },
    ]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    const { element } = renderWebDocument(resolved.document, { groups: resolved.groups });
    const html = renderToStaticMarkup(element);

    const indexC = html.indexOf("Placeholder feature C");
    const indexA = html.indexOf("Placeholder feature A");
    const indexB = html.indexOf("Placeholder feature B");
    expect(indexC).toBeGreaterThanOrEqual(0);
    expect(indexA).toBeGreaterThan(indexC);
    expect(indexB).toBeGreaterThan(indexA);
  });
});

describe("MarketingView — repeating 'faq' slot: absent, empty, one, and many, authored via node items", () => {
  const faqItem = (question: string, answer: string) => ({ node: { question, answer } });

  it("omits the FAQ section entirely when the binding is never authored — not an empty section", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    // "features" is present (empty is still a real, explicitly-authored
    // group); "faq" was never authored at all, so it must be absent from
    // resolved.groups entirely — the distinction this test exists to prove.
    expect(resolved.groups?.some((group) => group.slot === "faq")).toBe(false);
    const { element } = renderWebDocument(resolved.document, { groups: resolved.groups });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("aria-expanded");
  });

  it("renders the FAQ section with zero entries when the binding is explicitly authored empty", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [] }, { slot: "faq", items: [] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    const { element } = renderWebDocument(resolved.document, { groups: resolved.groups });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("aria-expanded");
  });

  it("renders one FAQ entry", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [] }, { slot: "faq", items: [faqItem("Placeholder question one?", "Placeholder answer one.")] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    const { element } = renderWebDocument(resolved.document, { groups: resolved.groups });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Placeholder question one?");
    expect(html).toContain("Placeholder answer one.");
  });

  it("renders many FAQ entries and preserves authored order end to end", () => {
    const doc = marketingDoc([
      ...baseBindings,
      { slot: "features", items: [] },
      {
        slot: "faq",
        items: [faqItem("Placeholder question two?", "Placeholder answer two."), faqItem("Placeholder question one?", "Placeholder answer one."), faqItem("Placeholder question three?", "Placeholder answer three.")],
      },
    ]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    const { element } = renderWebDocument(resolved.document, { groups: resolved.groups });
    const html = renderToStaticMarkup(element);

    const indexTwo = html.indexOf("Placeholder question two?");
    const indexOne = html.indexOf("Placeholder question one?");
    const indexThree = html.indexOf("Placeholder question three?");
    expect(indexTwo).toBeGreaterThanOrEqual(0);
    expect(indexOne).toBeGreaterThan(indexTwo);
    expect(indexThree).toBeGreaterThan(indexOne);
  });
});

describe("MarketingView — fail-closed contracts", () => {
  it("throws RenderError('resolution-failed') when the required 'features' repeating slot is never authored at all", () => {
    const doc = marketingDoc(baseBindings); // no "features" binding whatsoever
    const resolved = resolveSurfaceDocument(doc, resolver);
    expect(resolved.groups).toBeUndefined();
    try {
      renderWebDocument(resolved.document, { groups: resolved.groups });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("features");
    }
  });

  it("throws RenderError('resolution-failed') when a required flowed slot (e.g. brand) has no binding — the existing AuthView/ErrorView error contract, unchanged", () => {
    const doc = marketingDoc([{ slot: "heroHeading", copy: ref("acme.hero.heading") }, { slot: "ctaHeading", copy: ref("acme.cta.heading") }, { slot: "features", items: [] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    try {
      renderWebDocument(resolved.document, { groups: resolved.groups });
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("brand");
    }
  });

  it("throws RenderError('empty-output') when a 'faq' item is authored via copy instead of node — a single value cannot supply both question and answer", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [] }, { slot: "faq", items: [{ copy: ref("acme.feature.a") }] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    try {
      renderWebDocument(resolved.document, { groups: resolved.groups });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("faq");
    }
  });

  it("throws RenderError('empty-output') when a 'faq' node item is missing 'answer'", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [] }, { slot: "faq", items: [{ node: { question: "Q only?" } }] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    try {
      renderWebDocument(resolved.document, { groups: resolved.groups });
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
    }
  });

  it("throws RenderError('resolution-failed') when a repeating group targets a slot MarketingView does not declare as repeating", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [] }, { slot: "not-a-real-repeating-slot", items: [{ copy: ref("acme.feature.a") }] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    try {
      renderWebDocument(resolved.document, { groups: resolved.groups });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("not-a-real-repeating-slot");
    }
  });

  it("throws RenderError('empty-output') for a broken assetId inside a repeating 'features' item — the same stricter-than-text asset bar single bindings already get", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [{ assetId: "acme.feature.icon.missing" }] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    try {
      renderWebDocument(resolved.document, { groups: resolved.groups, resolveAssetId: () => undefined });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("acme.feature.icon.missing");
    }
  });

  it("resolves a real assetId inside a repeating 'features' item into a real <img>", () => {
    const doc = marketingDoc([...baseBindings, { slot: "features", items: [{ assetId: "acme.feature.icon.a" }] }]);
    const resolved = resolveSurfaceDocument(doc, resolver);
    const asset = { type: "image" as const, src: "https://cdn.example/icon-a.svg", width: 24, height: 24, alt: "Placeholder icon A" };
    const { element } = renderWebDocument(resolved.document, {
      groups: resolved.groups,
      resolveAssetId: (id) => (id === "acme.feature.icon.a" ? asset : undefined),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('<img src="https://cdn.example/icon-a.svg" alt="Placeholder icon A" width="24" height="24"/>');
  });
});
