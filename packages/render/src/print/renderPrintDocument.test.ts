import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "@vespeneventures/compose";
import { RenderError } from "../internal/errors.js";
import { renderPrintDocument } from "./renderPrintDocument.js";

function baseDoc(overrides: Partial<ComposeDocument> = {}): ComposeDocument {
  return {
    id: "flyer-1",
    channel: "print",
    template: "Flyer",
    meta: {
      channel: "print",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
    },
    layout: {
      slots: [
        { key: "title", element: "heading", frame: { x: 0, y: 0, w: 1, h: 0.2 }, required: true },
        { key: "body", element: "body", frame: { x: 0, y: 0.25, w: 1, h: 0.5 } },
      ],
    },
    bindings: [
      { slot: "title", value: "Hello" },
      { slot: "body", value: "World" },
    ],
    ...overrides,
  };
}

function thrown(fn: () => unknown): RenderError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RenderError) return error;
    throw error;
  }
  throw new Error("expected renderPrintDocument to throw a RenderError, but it did not throw at all");
}

describe("renderPrintDocument — refusal paths", () => {
  it('REFUSES a document whose channel is not "print"', () => {
    const doc = baseDoc({ channel: "web", meta: { channel: "web", title: "x", description: "y" } });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("wrong-channel");
    expect(error.message).toContain('document.channel="web"');
  });

  it('REFUSES a document whose meta.channel disagrees with doc.channel (both must say "print")', () => {
    const doc = baseDoc({ meta: { channel: "web", title: "x", description: "y" } as never });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("wrong-channel");
  });

  it("REFUSES a print document with no layout at all", () => {
    const doc = baseDoc({ layout: undefined });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("missing-layout");
    expect(error.message).toContain('doc.layout is required for a "print" document');
    expect(error.message).toContain("absent");
  });

  it("REFUSES a print document whose layout.slots is not an array", () => {
    const doc = baseDoc({ layout: { slots: "nope" as never } });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("missing-layout");
  });

  it('REFUSES pageSize "Custom" with no customPageSize option supplied', () => {
    const doc = baseDoc({
      meta: {
        channel: "print",
        pageSize: "Custom",
        orientation: "portrait",
        margins: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      },
    });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("missing-custom-page-size");
  });

  it("does NOT throw for Custom when customPageSize is supplied", () => {
    const doc = baseDoc({
      meta: {
        channel: "print",
        pageSize: "Custom",
        orientation: "portrait",
        margins: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      },
    });
    const { page } = renderPrintDocument(doc, { customPageSize: { width: "148mm", height: "210mm" } });
    expect(page.width).toBe("148mm");
    expect(page.height).toBe("210mm");
  });

  it("REFUSES a document whose required slot has no binding at all (resolveDocument fails)", () => {
    const doc = baseDoc({ bindings: [{ slot: "body", value: "World" }] });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("resolution-failed");
    expect(error.message).toContain("missing required slot(s): title");
  });

  it("REFUSES a document whose bindings target no slot in the layout at all — the 'empty' case", () => {
    const doc = baseDoc({ layout: { slots: [{ key: "title", element: "heading", frame: { x: 0, y: 0, w: 1, h: 0.2 }, required: true }] }, bindings: [] });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("resolution-failed");
    expect(error.message).toContain("no binding matched any slot");
  });

  it('REFUSES a document with an unknown binding — targets a slot key the layout does not have', () => {
    const doc = baseDoc({ bindings: [{ slot: "title", value: "Hello" }, { slot: "does-not-exist", value: "x" }] });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("resolution-failed");
    expect(error.message).toContain("unknown slot(s): does-not-exist");
  });

  it("REFUSES (empty-output) when a required slot's copyId never resolves — no resolveCopyId given at all", () => {
    const doc = baseDoc({
      bindings: [
        { slot: "title", copyId: "flyer.title" },
        { slot: "body", value: "World" },
      ],
    });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("empty-output");
    expect(error.message).toContain("flyer.title");
  });

  it("REFUSES (empty-output) when the supplied resolveCopyId returns undefined for a bound copyId", () => {
    const doc = baseDoc({
      bindings: [
        { slot: "title", copyId: "flyer.title" },
        { slot: "body", value: "World" },
      ],
    });
    const error = thrown(() => renderPrintDocument(doc, { resolveCopyId: () => undefined }));
    expect(error.reason).toBe("empty-output");
  });

  it("REFUSES (unknown-style-role) a slot style.color naming a token role that does not exist", () => {
    const doc = baseDoc({
      layout: {
        slots: [
          { key: "title", element: "heading", frame: { x: 0, y: 0, w: 1, h: 0.2 }, required: true, style: { color: "--color-not-real" } },
        ],
      },
      bindings: [{ slot: "title", value: "Hello" }],
    });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("unknown-style-role");
    expect(error.message).toContain("--color-not-real");
  });

  it("REFUSES (unknown-style-role) a layout.background naming a token role that does not exist", () => {
    const doc = baseDoc({
      layout: {
        background: { background: "--color-not-real" },
        slots: [{ key: "title", element: "heading", frame: { x: 0, y: 0, w: 1, h: 0.2 }, required: true }],
      },
      bindings: [{ slot: "title", value: "Hello" }],
    });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("unknown-style-role");
    expect(error.message).toContain("<page>");
  });

  it("REFUSES (unknown-style-role) a slot style.typography naming a token role that does not exist — never a silent fallback to the ElementKind default size", () => {
    const doc = baseDoc({
      layout: {
        slots: [
          { key: "title", element: "heading", frame: { x: 0, y: 0, w: 1, h: 0.2 }, required: true, style: { typography: "--text-not-real" } },
        ],
      },
      bindings: [{ slot: "title", value: "Hello" }],
    });
    const error = thrown(() => renderPrintDocument(doc));
    expect(error.reason).toBe("unknown-style-role");
    expect(error.message).toContain("--text-not-real");
  });
});

describe("renderPrintDocument — assetId refusal paths (never a blank box)", () => {
  const assetDoc: ComposeDocument = {
    id: "flyer-hero",
    channel: "print",
    template: "Flyer",
    meta: {
      channel: "print",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
    },
    layout: {
      slots: [{ key: "hero", element: "image", frame: { x: 0, y: 0, w: 1, h: 1 } }],
    },
    bindings: [{ slot: "hero", assetId: "marketing.hero" }],
  };

  it("REFUSES (empty-output) an unresolved assetId — no resolveAssetId given at all", () => {
    const error = thrown(() => renderPrintDocument(assetDoc));
    expect(error.reason).toBe("empty-output");
    expect(error.message).toContain("marketing.hero");
  });

  it("REFUSES (empty-output) when resolveAssetId returns undefined for a bound assetId", () => {
    const error = thrown(() => renderPrintDocument(assetDoc, { resolveAssetId: () => undefined }));
    expect(error.reason).toBe("empty-output");
  });

  it("REFUSES (empty-output) when resolveAssetId throws — caught and reported, never propagated raw", () => {
    const error = thrown(() =>
      renderPrintDocument(assetDoc, {
        resolveAssetId: () => {
          throw new Error("registry down");
        },
      }),
    );
    expect(error.reason).toBe("empty-output");
    expect(error.message).toContain("could not even attempt to resolve: hero");
  });

  it("REFUSES (empty-output) when resolveAssetId is not a function", () => {
    // Deliberately wrong-typed input — cast, not `@ts-expect-error`; a
    // *.test.ts file isn't part of this package's real tsc build, so that
    // directive would be inert and never actually checked.
    const error = thrown(() => renderPrintDocument(assetDoc, { resolveAssetId: "nope" as unknown as () => unknown }));
    expect(error.reason).toBe("empty-output");
  });

  it("REFUSES (empty-output) when resolveAssetId resolves to a value missing the required src/width/height/alt shape", () => {
    const error = thrown(() => renderPrintDocument(assetDoc, { resolveAssetId: () => ({ nope: true }) }));
    expect(error.reason).toBe("empty-output");
    expect(error.message).toContain("marketing.hero");
  });

  it("an unresolved assetId on a NON-required slot is still fatal — assets get no leniency at all", () => {
    // "hero" above is not `required: true` — proves this channel's
    // existing "every bound slot must resolve" bar already covers assets
    // with no extra leniency to remove (see renderPrintDocument.ts's own
    // doc comment).
    expect(() => renderPrintDocument(assetDoc, { resolveAssetId: () => undefined })).toThrow(RenderError);
  });
});

describe("before/after: an asset-only print document — the empty-output bug this task fixes", () => {
  const assetOnlyDoc: ComposeDocument = {
    id: "asset-only-flyer",
    channel: "print",
    template: "Flyer",
    meta: {
      channel: "print",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
    },
    layout: {
      slots: [{ key: "hero", element: "image", frame: { x: 0, y: 0, w: 1, h: 1 } }],
    },
    bindings: [{ slot: "hero", assetId: "marketing.hero" }],
  };
  const asset = { id: "marketing.hero", src: "https://cdn.example/hero.png", width: 800, height: 400, alt: "Storefront photo" };

  it("BEFORE (still true without resolveAssetId): throws — nothing was resolved", () => {
    expect(() => renderPrintDocument(assetOnlyDoc)).toThrow(RenderError);
  });

  it("AFTER: a document made ENTIRELY of assetId bindings renders successfully — never a false empty-output", () => {
    const { html } = renderPrintDocument(assetOnlyDoc, {
      resolveAssetId: (assetId) => (assetId === "marketing.hero" ? asset : undefined),
    });
    expect(html).toContain('<img src="https://cdn.example/hero.png" alt="Storefront photo"');
  });
});

describe("renderPrintDocument — StyleBinding.typography overrides the ElementKind default", () => {
  it("a \"body\" element (default --text-body=15px) with style.typography=\"--text-display-xl\" (72px) emits font-size:72px, not 15px", () => {
    const doc = baseDoc({
      layout: {
        slots: [
          { key: "body", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true, style: { typography: "--text-display-xl" } },
        ],
      },
      bindings: [{ slot: "body", value: "Hero copy" }],
    });
    const { html } = renderPrintDocument(doc);
    expect(html).toContain("font-size:72px");
    expect(html).not.toContain("font-size:15px");
  });
});

describe("renderPrintDocument — successful render, structural properties", () => {
  it("returns page metadata matching the resolved page box and passes dpi through unchanged", () => {
    const doc = baseDoc({
      meta: {
        channel: "print",
        pageSize: "A4",
        orientation: "landscape",
        margins: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
        dpi: 300,
      },
    });
    const { page } = renderPrintDocument(doc);
    expect(page).toEqual({ pageSize: "A4", orientation: "landscape", width: "297mm", height: "210mm", dpi: 300 });
  });

  it("omits dpi from the result entirely when meta.dpi was not supplied — never invents a default", () => {
    const { page } = renderPrintDocument(baseDoc());
    expect(page.dpi).toBeUndefined();
    expect("dpi" in page).toBe(false);
  });

  it("never lets an oklch(...) or var(--...) reference survive into the emitted HTML", () => {
    const doc = baseDoc({
      layout: {
        slots: [
          {
            key: "title",
            element: "heading",
            frame: { x: 0, y: 0, w: 1, h: 0.2 },
            required: true,
            style: { color: "--color-ink-primary", background: "--color-surface-raised" },
          },
        ],
        background: { background: "--color-surface-base" },
      },
      bindings: [{ slot: "title", value: "Hello" }],
    });
    const { html } = renderPrintDocument(doc);
    expect(html).not.toMatch(/oklch\(/i);
    expect(html).not.toMatch(/var\(--/);
  });

  it("renders geometry as two absolutely-positioned boxes at the expected hand-computed percentages", () => {
    const doc = baseDoc({
      layout: {
        slots: [
          { key: "a", element: "heading", frame: { x: 0, y: 0, w: 0.5, h: 0.5 }, required: true },
          { key: "b", element: "body", frame: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
        ],
      },
      bindings: [
        { slot: "a", value: "A" },
        { slot: "b", value: "B" },
      ],
    });
    const { html } = renderPrintDocument(doc);
    // Hand-computed: {x:0,y:0,w:0.5,h:0.5} -> left:0% top:0% width:50% height:50%.
    expect(html).toContain('data-slot="a"');
    expect(html).toContain("left:0%;top:0%;width:50%;height:50%");
    // Hand-computed: {x:0.5,y:0.5,w:0.5,h:0.5} -> left:50% top:50% width:50% height:50%.
    expect(html).toContain('data-slot="b"');
    expect(html).toContain("left:50%;top:50%;width:50%;height:50%");
  });

  it("de-dupes two bindings targeting the same slot key into one rendered box, last one wins", () => {
    const doc = baseDoc({
      bindings: [
        { slot: "title", value: "First" },
        { slot: "title", value: "Second" },
        { slot: "body", value: "World" },
      ],
    });
    const { html } = renderPrintDocument(doc);
    expect(html.match(/data-slot="title"/g)).toHaveLength(1);
    expect(html).toContain(">Second<");
    expect(html).not.toContain(">First<");
  });
});
