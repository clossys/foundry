/**
 * Behavioral tests for `renderEmailDocument` beyond the golden-output bar
 * (`golden-render.test.ts`): every refusal path actually fires with the
 * right `RenderError.reason`, the geometry-warning path names every slot
 * whose layout was lost, the no-`options.layout` path degrades to binding
 * order with zero warnings, and last-write-wins on a duplicate slot key.
 */

import { describe, expect, it } from "vitest";
import type { ComposeDocument, LayoutSpec } from "../core/index.js";
import { RenderError } from "../internal/errors.js";
import { renderEmailDocument } from "./renderEmailDocument.js";

const SINGLE_SLOT_LAYOUT: LayoutSpec = {
  slots: [{ key: "a", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }],
};

describe("refusal: wrong-channel", () => {
  it("throws RenderError('wrong-channel') for a non-email document", () => {
    const doc = {
      id: "x",
      channel: "web",
      template: "T",
      meta: { channel: "web", title: "t", description: "d" },
      bindings: [],
    } as unknown as ComposeDocument;

    let caught: unknown;
    try {
      renderEmailDocument(doc);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).reason).toBe("wrong-channel");
    expect((caught as RenderError).message).toBe(
      'renderEmailDocument only renders channel "email" documents, got document.channel="web" / document.meta.channel="web".',
    );
  });
});

describe("refusal: resolution-failed", () => {
  it("throws RenderError('resolution-failed') when a binding targets an unknown slot and a required slot goes unbound", () => {
    const doc: ComposeDocument = {
      id: "x",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "nonexistent", value: "v" }],
    };

    let caught: unknown;
    try {
      renderEmailDocument(doc, { layout: SINGLE_SLOT_LAYOUT });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).reason).toBe("resolution-failed");
    expect((caught as RenderError).message).toBe(
      'renderEmailDocument could not resolve document "x" against its layout: missing required slot(s): a; binding(s) targeting unknown slot(s): nonexistent.',
    );
  });

  it("throws RenderError('resolution-failed') for a wholly empty document (no bindings, no layout)", () => {
    const doc: ComposeDocument = {
      id: "empty-doc",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [],
    };

    let caught: unknown;
    try {
      renderEmailDocument(doc);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).reason).toBe("resolution-failed");
    expect((caught as RenderError).message).toContain("nothing to render");
  });
});

describe("refusal: empty-output", () => {
  it("throws RenderError('empty-output') when a bound copyId has no resolver at all", () => {
    const doc: ComposeDocument = {
      id: "x",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "a", copyId: "missing.copy" }],
    };

    let caught: unknown;
    try {
      renderEmailDocument(doc, { layout: SINGLE_SLOT_LAYOUT });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).reason).toBe("empty-output");
    expect((caught as RenderError).message).toBe(
      'renderEmailDocument resolved document "x" against its layout, but not every bound slot produced real content: copyId(s) that did not resolve to real text: missing.copy. Rendering would silently ship an incomplete email, which this function refuses to do.',
    );
  });

  it("throws RenderError('empty-output') when the lookup returns undefined for a bound copyId", () => {
    const doc: ComposeDocument = {
      id: "x",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "a", copyId: "missing.copy" }],
    };

    expect(() => renderEmailDocument(doc, { layout: SINGLE_SLOT_LAYOUT, lookup: () => undefined })).toThrow(RenderError);
  });
});

describe("refusal: assetId problems (never a blank box)", () => {
  const assetDoc: ComposeDocument = {
    id: "x",
    channel: "email",
    template: "T",
    meta: { channel: "email", subject: "s", preheader: "p" },
    bindings: [{ slot: "a", assetId: "marketing.hero" }],
  };

  it("throws RenderError('empty-output') for an unresolved assetId — no assetLookup given at all", () => {
    try {
      renderEmailDocument(assetDoc, { layout: SINGLE_SLOT_LAYOUT });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("marketing.hero");
    }
  });

  it("throws RenderError('empty-output') when assetLookup returns undefined for a bound assetId", () => {
    expect(() =>
      renderEmailDocument(assetDoc, { layout: SINGLE_SLOT_LAYOUT, assetLookup: () => undefined }),
    ).toThrow(RenderError);
  });

  it("throws RenderError('empty-output') when assetLookup throws — caught and reported, never propagated raw", () => {
    try {
      renderEmailDocument(assetDoc, {
        layout: SINGLE_SLOT_LAYOUT,
        assetLookup: () => {
          throw new Error("registry down");
        },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("could not even attempt to resolve: a");
    }
  });

  it("throws RenderError('empty-output') when assetLookup is not a function", () => {
    try {
      // Deliberately wrong-typed input — cast, not `@ts-expect-error`; a
      // *.test.ts file isn't part of this package's real tsc build, so
      // that directive would be inert and never actually checked.
      renderEmailDocument(assetDoc, { layout: SINGLE_SLOT_LAYOUT, assetLookup: 42 as unknown as () => unknown });
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
    }
  });

  it("throws RenderError('empty-output') when assetLookup resolves to a value missing the required src/width/height/alt shape", () => {
    try {
      renderEmailDocument(assetDoc, { layout: SINGLE_SLOT_LAYOUT, assetLookup: () => ({ nope: true }) });
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("marketing.hero");
    }
  });
});

describe("before/after: an asset-only document — the empty-output bug this task fixes", () => {
  const assetOnlyDoc: ComposeDocument = {
    id: "asset-only",
    channel: "email",
    template: "T",
    meta: { channel: "email", subject: "s", preheader: "p" },
    bindings: [{ slot: "a", assetId: "marketing.hero" }],
  };
  const asset = { id: "marketing.hero", type: "image", src: "https://cdn.example/hero.png", width: 600, height: 300, alt: "A hero shot" };

  it("BEFORE (still true without an assetLookup): throws — nothing was resolved", () => {
    expect(() => renderEmailDocument(assetOnlyDoc, { layout: SINGLE_SLOT_LAYOUT })).toThrow(RenderError);
  });

  it("AFTER: a document made ENTIRELY of assetId bindings renders successfully — never a false empty-output", () => {
    const { html, text } = renderEmailDocument(assetOnlyDoc, {
      layout: SINGLE_SLOT_LAYOUT,
      assetLookup: (assetId) => (assetId === "marketing.hero" ? asset : undefined),
    });
    expect(html).toContain('<img src="https://cdn.example/hero.png" alt="A hero shot" width="600" height="300"');
    expect(text).toBe("A hero shot\n");
  });
});

describe("video assets — no email client has a dependable <video> story; poster fallback, or fail closed (issue #177)", () => {
  const videoDoc: ComposeDocument = {
    id: "acme-video-email",
    channel: "email",
    template: "T",
    meta: { channel: "email", subject: "s", preheader: "p" },
    bindings: [{ slot: "a", assetId: "marketing.hero-video" }],
  };
  const videoAsset = (overrides: Record<string, unknown> = {}) => ({
    id: "marketing.hero-video",
    type: "video",
    sources: [{ src: "https://cdn.example/hero.mp4", mimeType: "video/mp4" }],
    width: 600,
    height: 300,
    alt: "A product demo video",
    transcript: "A transcript.",
    reducedMotion: "no-autoplay",
    ...overrides,
  });

  it("a video asset WITH a poster renders its poster as a plain <img> row — exactly like an image asset", () => {
    const { html, text } = renderEmailDocument(videoDoc, {
      layout: SINGLE_SLOT_LAYOUT,
      assetLookup: () => videoAsset({ poster: "https://cdn.example/hero-poster.png" }),
    });
    expect(html).toContain('<img src="https://cdn.example/hero-poster.png" alt="A product demo video" width="600" height="300"');
    expect(text).toBe("A product demo video\n");
  });

  it("a video asset with NO poster refuses to render (empty-output) — this channel has nothing to paint instead", () => {
    try {
      renderEmailDocument(videoDoc, { layout: SINGLE_SLOT_LAYOUT, assetLookup: () => videoAsset() });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as RenderError).message).toMatch(/no poster/);
    }
  });
});

describe("the geometry problem: a two-column layout degrades to a stack, and BOTH slots are named in the warnings", () => {
  const twoColumnLayout: LayoutSpec = {
    slots: [
      { key: "left", element: "body", frame: { x: 0, y: 0, w: 0.5, h: 0.2 }, required: true },
      { key: "right", element: "body", frame: { x: 0.5, y: 0, w: 0.5, h: 0.2 }, required: true },
    ],
  };
  const doc: ComposeDocument = {
    id: "two-col",
    channel: "email",
    template: "T",
    meta: { channel: "email", subject: "s", preheader: "p" },
    bindings: [
      { slot: "left", value: "Left column" },
      { slot: "right", value: "Right column" },
    ],
  };

  it("names both slots in a single slots-stacked warning, plus one slot-width-lost warning each", () => {
    const { warnings } = renderEmailDocument(doc, { layout: twoColumnLayout });

    expect(warnings).toEqual([
      {
        code: "slots-stacked",
        slots: ["left", "right"],
        message:
          "Slot(s) left, right were positioned side-by-side (overlapping vertical extents, different x) in the supplied layout. Email cannot place content side-by-side, so they are now stacked as separate full-width rows, in top-to-bottom / left-to-right order — the side-by-side arrangement is lost.",
      },
      {
        code: "slot-width-lost",
        slots: ["left"],
        message:
          'Slot "left" was sized to 50% of the canvas width in the supplied layout. Email has no narrower-than-full-width unit once a slot is stacked into the vertical flow, so it now renders at the email\'s full content width — its intended width is lost.',
      },
      {
        code: "slot-width-lost",
        slots: ["right"],
        message:
          'Slot "right" was sized to 50% of the canvas width in the supplied layout. Email has no narrower-than-full-width unit once a slot is stacked into the vertical flow, so it now renders at the email\'s full content width — its intended width is lost.',
      },
    ]);
  });

  it("still renders both slots' content, stacked left-then-right per the sort order", () => {
    const { html } = renderEmailDocument(doc, { layout: twoColumnLayout });
    const leftIndex = html.indexOf("Left column");
    const rightIndex = html.indexOf("Right column");
    expect(leftIndex).toBeGreaterThan(-1);
    expect(rightIndex).toBeGreaterThan(leftIndex);
  });

  it("reports no width-lost warning for a slot whose frame.w is already 1 (full width)", () => {
    const fullWidthLayout: LayoutSpec = {
      slots: [{ key: "solo", element: "body", frame: { x: 0, y: 0, w: 1, h: 0.2 }, required: true }],
    };
    const soloDoc: ComposeDocument = {
      id: "solo",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "solo", value: "Full width" }],
    };
    const { warnings } = renderEmailDocument(soloDoc, { layout: fullWidthLayout });
    expect(warnings).toEqual([]);
  });
});

describe("no options.layout at all: binding order is the only order there is", () => {
  it("renders every bound slot in binding order, with zero geometry warnings", () => {
    const doc: ComposeDocument = {
      id: "no-layout",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [
        { slot: "b", value: "Second" },
        { slot: "a", value: "First" },
      ],
    };

    const { html, text, warnings } = renderEmailDocument(doc);

    expect(warnings).toEqual([]);
    expect(text).toBe("Second\n\nFirst\n");
    const secondIndex = html.indexOf("Second");
    const firstIndex = html.indexOf("First");
    expect(secondIndex).toBeGreaterThan(-1);
    expect(firstIndex).toBeGreaterThan(secondIndex);
  });

  it("throws resolution-failed, not a silent empty render, when an unbound required-looking layout is never supplied and bindings is empty", () => {
    const doc: ComposeDocument = {
      id: "no-layout-empty",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [],
    };
    expect(() => renderEmailDocument(doc)).toThrow(RenderError);
  });
});

describe("duplicate bindings targeting the same slot key: last write wins", () => {
  it("emits exactly one row for the slot, using the LAST binding's resolved text", () => {
    const layout: LayoutSpec = {
      slots: [{ key: "a", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }],
    };
    const doc: ComposeDocument = {
      id: "dup",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [
        { slot: "a", value: "first value" },
        { slot: "a", value: "second value" },
      ],
    };

    const { html, text } = renderEmailDocument(doc, { layout });
    expect(html).not.toContain("first value");
    expect(html.match(/second value/g)).toHaveLength(1);
    expect(text).toBe("second value\n");
  });
});

describe("options.brand — a flattenTokens override reaches the emitted HTML", () => {
  it("substitutes a branded literal hex color in place of the default token value", () => {
    const layout: LayoutSpec = {
      slots: [{ key: "a", element: "heading", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }],
    };
    const doc: ComposeDocument = {
      id: "brand",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "a", value: "Branded heading" }],
    };

    const { html: defaultHtml } = renderEmailDocument(doc, { layout });
    const { html: brandedHtml } = renderEmailDocument(doc, {
      layout,
      brand: { "--color-ink-primary": "oklch(0.5 0.2 30)" },
    });

    expect(defaultHtml).not.toBe(brandedHtml);
    expect(/oklch\(/i.test(brandedHtml)).toBe(false);
    expect(defaultHtml).toContain("color:#1a1a1a");
    expect(brandedHtml).not.toContain("color:#1a1a1a");
  });
});

describe("SlotSpec.style.typography overrides the ElementKind default font size", () => {
  it("a \"body\" element (default --text-body=15px) with style.typography=\"--text-display-xl\" (72px) emits font-size:72px, not 15px", () => {
    const layout: LayoutSpec = {
      slots: [{ key: "a", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true, style: { typography: "--text-display-xl" } }],
    };
    const doc: ComposeDocument = {
      id: "typography-override",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "a", value: "Hero copy" }],
    };

    const { html } = renderEmailDocument(doc, { layout });
    expect(html).toContain("font-size:72px");
    expect(html).not.toContain("font-size:15px");
  });

  it("throws RenderError('unknown-style-role') for an unknown style.typography role — never a silent fallback to the ElementKind default size", () => {
    const layout: LayoutSpec = {
      slots: [{ key: "a", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true, style: { typography: "--text-not-real" } }],
    };
    const doc: ComposeDocument = {
      id: "typography-unknown",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "a", value: "x" }],
    };

    let caught: unknown;
    try {
      renderEmailDocument(doc, { layout });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).reason).toBe("unknown-style-role");
    expect((caught as RenderError).message).toContain("--text-not-real");
  });
});
