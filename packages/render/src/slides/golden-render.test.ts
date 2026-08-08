/**
 * Golden-output tests for `./slides` — same bar as `./image`'s own
 * `golden-render.test.ts` and `src/web/golden-render.test.ts`: the EXACT
 * emitted SVG string per slide, byte for byte. Every number asserted below
 * is hand-computed and restated in this package's PR description.
 */

import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "@vespeneventures/compose";
import { RenderError } from "../internal/errors.js";
import { renderSlidesDeck } from "./renderSlidesDeck.js";
import type { SlidesDeckInput } from "./types.js";

// See `../image/golden-render.test.ts`'s own identical constants — the
// real, XML-attribute-escaped `--font-display`/`--font-body` literals this
// shared `../image/engine.ts`+`renderSlots.ts` pipeline now emits for every
// `./image`/`./slides` text slot.
const FONT_DISPLAY_XML = 'system-ui, ui-sans-serif, -apple-system, &quot;Segoe UI&quot;, sans-serif';

describe("golden: a two-slide 16:9 deck with notes", () => {
  const titleSlide: ComposeDocument = {
    id: "title",
    channel: "slides",
    template: "title-slide",
    meta: { channel: "slides", aspect: "16:9" },
    layout: {
      background: { background: "--color-surface-base" },
      slots: [
        { key: "title", element: "heading", frame: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, required: true, style: { color: "--color-ink-primary" }, align: "center" },
        { key: "subtitle", element: "subheading", frame: { x: 0.1, y: 0.6, w: 0.8, h: 0.1 }, style: { color: "--color-ink-secondary" }, align: "center" },
      ],
    },
    bindings: [
      { slot: "title", value: "Acme Quarterly Review" },
      { slot: "subtitle", value: "Q3 2026" },
    ],
  };
  const closingSlide: ComposeDocument = {
    id: "closing",
    channel: "slides",
    template: "closing-slide",
    meta: { channel: "slides", aspect: "16:9" },
    layout: {
      slots: [{ key: "title", element: "heading", frame: { x: 0.1, y: 0.45, w: 0.8, h: 0.15 }, required: true, align: "center" }],
    },
    bindings: [{ slot: "title", value: "Thank you" }],
  };
  const deck: SlidesDeckInput = {
    id: "acme-q3-review",
    slides: [titleSlide, closingSlide],
    notes: { title: "Welcome everyone warmly.", closing: "Open the floor for questions." },
  };

  it("16:9 -> 1920x1080 canvas, stated as this file's own convention", () => {
    const result = renderSlidesDeck(deck);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.aspect).toBe("16:9");
  });

  it("slide 0 renders the exact expected SVG, byte for byte", () => {
    const result = renderSlidesDeck(deck);
    expect(result.slides[0]!.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">' +
        "<title>title</title>" +
        '<rect x="0" y="0" width="1920" height="1080" fill="#f5f5f5" />' +
        `<g data-slot="title"><text x="960" y="454.4" font-size="28" font-family="${FONT_DISPLAY_XML}" fill="#1a1a1a" text-anchor="middle">` +
        '<tspan x="960" dy="0">Acme Quarterly Review</tspan></text></g>' +
        `<g data-slot="subtitle"><text x="960" y="662.4" font-size="18" font-family="${FONT_DISPLAY_XML}" fill="#3d3d3d" text-anchor="middle">` +
        '<tspan x="960" dy="0">Q3 2026</tspan></text></g>' +
        "</svg>",
    );
  });

  it("slide 1 renders the exact expected SVG, byte for byte", () => {
    const result = renderSlidesDeck(deck);
    expect(result.slides[1]!.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">' +
        "<title>closing</title>" +
        `<g data-slot="title"><text x="960" y="508.4" font-size="28" font-family="${FONT_DISPLAY_XML}" fill="#111111" text-anchor="middle">` +
        '<tspan x="960" dy="0">Thank you</tspan></text></g>' +
        "</svg>",
    );
  });

  it("HAND-COMPUTED: title slot {x:0.1,y:0.4,w:0.8,h:0.2} on 1920x1080 -> x=192,y=432,w=1536,h=216; align:center -> anchor x = 192+1536/2 = 960; \"heading\" resolves to --text-h1=28px -> baseline = 432 + 28*0.8 = 454.4", () => {
    const result = renderSlidesDeck(deck);
    expect(result.slides[0]!.svg).toContain('x="960" y="454.4"');
  });

  it("HAND-COMPUTED: subtitle slot {x:0.1,y:0.6,w:0.8,h:0.1} on 1920x1080 -> y=648; \"subheading\" resolves to --text-h2=18px -> baseline = 648 + 18*0.8 = 662.4", () => {
    const result = renderSlidesDeck(deck);
    expect(result.slides[0]!.svg).toContain('y="662.4"');
  });

  it("carries deck-wide notes through to each matching slide, keyed by slide id", () => {
    const result = renderSlidesDeck(deck);
    expect(result.slides[0]!.notes).toBe("Welcome everyone warmly.");
    expect(result.slides[1]!.notes).toBe("Open the floor for questions.");
    expect(result.unknownNoteKeys).toEqual([]);
  });

  it("deck order matches SlidesDeckInput.slides array order, explicitly", () => {
    const result = renderSlidesDeck(deck);
    expect(result.slides.map((s) => s.id)).toEqual(["title", "closing"]);
    expect(result.slides.map((s) => s.index)).toEqual([0, 1]);
  });

  it("no oklch() or var(--...) survives in either slide's emitted SVG", () => {
    const result = renderSlidesDeck(deck);
    for (const s of result.slides) {
      expect(s.svg).not.toMatch(/oklch\(/i);
      expect(s.svg).not.toMatch(/var\(--/);
    }
  });
});

describe("golden: 4:3 canvas convention", () => {
  it("4:3 -> 1024x768", () => {
    const slide: ComposeDocument = {
      id: "s1",
      channel: "slides",
      template: "t",
      meta: { channel: "slides", aspect: "4:3" },
      layout: { slots: [{ key: "title", element: "heading", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }] },
      bindings: [{ slot: "title", value: "x" }],
    };
    const result = renderSlidesDeck({ id: "d", slides: [slide] });
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
    expect(result.slides[0]!.svg).toContain('viewBox="0 0 1024 768"');
  });
});

describe("golden: assetId — a slide with an image, byte for byte", () => {
  const titleSlide: ComposeDocument = {
    id: "title",
    channel: "slides",
    template: "title-slide",
    meta: { channel: "slides", aspect: "16:9" },
    layout: {
      background: { background: "--color-surface-base" },
      slots: [
        { key: "title", element: "heading", frame: { x: 0.1, y: 0.15, w: 0.8, h: 0.15 }, required: true, align: "center" },
        { key: "hero", element: "image", frame: { x: 0.2, y: 0.35, w: 0.6, h: 0.5 } },
      ],
    },
    bindings: [
      { slot: "title", value: "Product Launch" },
      { slot: "hero", assetId: "marketing.hero" },
    ],
  };
  const asset = { id: "marketing.hero", src: "https://cdn.example/hero.png", width: 1152, height: 540, alt: "Product shot" };

  it("renders the exact expected SVG, byte for byte — a mixed slide (text title + asset hero image)", () => {
    const result = renderSlidesDeck({ id: "d", slides: [titleSlide] }, { resolveAssetId: (id) => (id === "marketing.hero" ? asset : undefined) });

    expect(result.slides[0]!.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">' +
        "<title>title</title>" +
        '<rect x="0" y="0" width="1920" height="1080" fill="#f5f5f5" />' +
        `<g data-slot="title"><text x="960" y="184.4" font-size="28" font-family="${FONT_DISPLAY_XML}" fill="#111111" text-anchor="middle">` +
        '<tspan x="960" dy="0">Product Launch</tspan></text></g>' +
        '<g data-slot="hero"><image x="384" y="378" width="1152" height="540" href="https://cdn.example/hero.png" ' +
        'preserveAspectRatio="xMidYMid slice" aria-label="Product shot"><title>Product shot</title></image></g>' +
        "</svg>",
    );
    expect(result.warnings).toEqual([]);
  });

  it("refuses (empty-output) the WHOLE deck when one slide's assetId is unresolved — naming the offending slide", () => {
    try {
      renderSlidesDeck({ id: "d", slides: [titleSlide] });
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as RenderError).message).toContain('slide 0 (id="title")');
      expect((error as RenderError).message).toContain("marketing.hero");
    }
  });

  it("BEFORE/AFTER: a slide made ENTIRELY of assetId bindings (no background even) renders successfully once resolved", () => {
    const assetOnlySlide: ComposeDocument = {
      id: "asset-only-slide",
      channel: "slides",
      template: "t",
      meta: { channel: "slides", aspect: "16:9" },
      layout: { slots: [{ key: "hero", element: "image", frame: { x: 0, y: 0, w: 1, h: 1 } }] },
      bindings: [{ slot: "hero", assetId: "marketing.hero" }],
    };
    // BEFORE: without a resolver, still correctly throws (nothing resolved).
    expect(() => renderSlidesDeck({ id: "d", slides: [assetOnlySlide] })).toThrow(RenderError);
    // AFTER: once resolved, the asset-only slide renders — never a false empty-output.
    const result = renderSlidesDeck({ id: "d", slides: [assetOnlySlide] }, { resolveAssetId: () => asset });
    expect(result.slides[0]!.svg).toContain('href="https://cdn.example/hero.png"');
  });
});

describe("golden: unknown notes key is reported, not dropped, and the deck still renders", () => {
  it("reports an orphaned note key in unknownNoteKeys without throwing", () => {
    const slide: ComposeDocument = {
      id: "real-slide",
      channel: "slides",
      template: "t",
      meta: { channel: "slides", aspect: "16:9" },
      layout: { slots: [{ key: "title", element: "heading", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }] },
      bindings: [{ slot: "title", value: "x" }],
    };
    const result = renderSlidesDeck({
      id: "d",
      slides: [slide],
      notes: { "real-slide": "kept", "old-renamed-slide-id": "lost note" },
    });
    expect(result.unknownNoteKeys).toEqual(["old-renamed-slide-id"]);
    expect(result.slides).toHaveLength(1);
  });
});
