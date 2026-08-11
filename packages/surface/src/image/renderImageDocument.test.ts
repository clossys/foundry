import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "../core/index.js";
import { renderImageDocument } from "./renderImageDocument.js";
import { RenderError } from "../internal/errors.js";

function baseDoc(overrides: Partial<ComposeDocument> = {}): ComposeDocument {
  return {
    id: "acme-og-card",
    channel: "image",
    template: "og-card",
    meta: { channel: "image", width: 1200, height: 630, format: "png", alt: "Acme — build faster" },
    layout: {
      slots: [
        { key: "eyebrow", element: "eyebrow", frame: { x: 0.08, y: 0.1, w: 0.6, h: 0.08 } },
        { key: "headline", element: "heading", frame: { x: 0.08, y: 0.2, w: 0.84, h: 0.4 }, required: true },
      ],
    },
    bindings: [
      { slot: "eyebrow", value: "Product update" },
      { slot: "headline", value: "Ship faster with Acme" },
    ],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Refusal paths — each must throw the right RenderErrorReason
// ─────────────────────────────────────────────────────────────────────────

describe("refusal paths", () => {
  it("wrong channel: doc.channel !== 'image'", () => {
    const doc = baseDoc({ channel: "web" as ComposeDocument["channel"] });
    try {
      renderImageDocument(doc);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("wrong-channel");
      expect((error as RenderError).message).toContain('document.channel="web"');
    }
  });

  it("wrong channel: doc.meta.channel !== 'image'", () => {
    const doc = baseDoc({ meta: { channel: "web", title: "x", description: "y" } as unknown as ComposeDocument["meta"] });
    expect(() => renderImageDocument(doc)).toThrow(RenderError);
    try {
      renderImageDocument(doc);
    } catch (error) {
      expect((error as RenderError).reason).toBe("wrong-channel");
    }
  });

  it("missing layout entirely", () => {
    const doc = baseDoc({ layout: undefined });
    try {
      renderImageDocument(doc);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as RenderError).message).toContain("requires a layout");
    }
  });

  it("failed resolution: a required slot has no binding at all", () => {
    const doc = baseDoc({ bindings: [{ slot: "eyebrow", value: "Product update" }] });
    try {
      renderImageDocument(doc);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as RenderError).message).toContain("missing required slot(s): headline");
    }
  });

  it("failed resolution: a binding targets an unknown slot", () => {
    const doc = baseDoc({
      bindings: [
        { slot: "eyebrow", value: "Product update" },
        { slot: "headline", value: "Ship faster with Acme" },
        { slot: "does-not-exist", value: "orphan" },
      ],
    });
    try {
      renderImageDocument(doc);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as RenderError).message).toContain("does-not-exist");
    }
  });

  it("empty output: the required slot's copyId never resolves (no resolveCopyId given)", () => {
    const doc = baseDoc({
      bindings: [
        { slot: "eyebrow", value: "Product update" },
        { slot: "headline", copyId: "headline.acme.v1" },
      ],
    });
    try {
      renderImageDocument(doc);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as RenderError).message).toContain("headline");
    }
  });

  it("empty output: resolveCopyId is given but returns undefined for the required slot's copyId", () => {
    const doc = baseDoc({
      bindings: [
        { slot: "eyebrow", value: "Product update" },
        { slot: "headline", copyId: "headline.acme.v1" },
      ],
    });
    expect(() => renderImageDocument(doc, { resolveCopyId: () => undefined })).toThrow(RenderError);
  });

  it("empty output: EVERY slot fails to resolve and NONE is required — total loss, not partial — must throw, not return a blank canvas", () => {
    // The exact fixture from the coordinator's report: a single, non-required
    // slot whose copyId resolves to "" (empty string — treated as
    // unresolved by resolveCopy). No slot is required, so the old
    // required-only check never fired, and no layout.background was given
    // either, so there is nothing left to render at all.
    const doc: ComposeDocument = {
      id: "i2",
      channel: "image",
      template: "T",
      meta: { channel: "image", width: 100, height: 100, format: "svg", alt: "A" },
      bindings: [{ slot: "s", copyId: "m" }],
      layout: { slots: [{ key: "s", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 } }] },
    };

    try {
      renderImageDocument(doc, { resolveCopyId: () => "" });
      expect.unreachable("should have thrown empty-output — a document with zero renderable content must never return a blank canvas as a success");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as RenderError).message).toContain("i2");
      expect((error as RenderError).message).toContain("s");
    }
  });

  it("CONTROL: a document with only a background and no text slots is NOT empty — must still render, never throw", () => {
    // Distinguishes the new check from a naive "did anything resolve"
    // count: a background-only canvas is legitimate, deliberate content,
    // not an accidental total loss.
    const doc: ComposeDocument = {
      id: "background-only",
      channel: "image",
      template: "T",
      meta: { channel: "image", width: 100, height: 100, format: "svg", alt: "A" },
      bindings: [{ slot: "s", copyId: "m" }],
      layout: {
        background: { background: "--color-surface-base" },
        slots: [{ key: "s", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 } }],
      },
    };

    const result = renderImageDocument(doc, { resolveCopyId: () => "" });
    expect(result.svg).toContain("<rect");
    expect(result.warnings.some((w) => w.includes('slot "s"'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// assetId — refusal paths (never a blank box) and the before/after proof
// ─────────────────────────────────────────────────────────────────────────

describe("assetId refusal paths (never a blank box)", () => {
  const assetDoc: ComposeDocument = {
    id: "acme-hero",
    channel: "image",
    template: "og-card",
    meta: { channel: "image", width: 400, height: 200, format: "svg", alt: "Acme hero" },
    layout: { slots: [{ key: "hero", element: "image", frame: { x: 0, y: 0, w: 1, h: 1 } }] },
    bindings: [{ slot: "hero", assetId: "marketing.hero" }],
  };

  it("REFUSES (empty-output) an unresolved assetId — no resolveAssetId given at all", () => {
    try {
      renderImageDocument(assetDoc);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as RenderError).message).toContain("marketing.hero");
    }
  });

  it("REFUSES (empty-output) when resolveAssetId returns undefined for a bound assetId", () => {
    expect(() => renderImageDocument(assetDoc, { resolveAssetId: () => undefined })).toThrow(RenderError);
  });

  it("REFUSES (empty-output) when resolveAssetId throws — caught and reported, never propagated raw", () => {
    try {
      renderImageDocument(assetDoc, {
        resolveAssetId: () => {
          throw new Error("registry down");
        },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as RenderError).message).toContain("could not even attempt to resolve: hero");
    }
  });

  it("REFUSES (empty-output) when resolveAssetId is not a function", () => {
    // Deliberately wrong-typed input — cast, not `@ts-expect-error`; a
    // *.test.ts file isn't part of this package's real tsc build, so that
    // directive would be inert and never actually checked.
    expect(() => renderImageDocument(assetDoc, { resolveAssetId: "nope" as unknown as () => unknown })).toThrow(RenderError);
  });

  it("REFUSES (empty-output) when resolveAssetId resolves to a value missing the required src/width/height/alt shape", () => {
    try {
      renderImageDocument(assetDoc, { resolveAssetId: () => ({ nope: true }) });
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as RenderError).message).toContain("marketing.hero");
    }
  });

  it("an unresolved assetId on a non-required slot is STILL fatal — no leniency the way an optional copyId gets", () => {
    expect(() => renderImageDocument(assetDoc, { resolveAssetId: () => undefined })).toThrow(RenderError);
  });
});

describe("before/after: an asset-only document — the empty-output bug this task fixes", () => {
  const assetOnlyDoc: ComposeDocument = {
    id: "asset-only-image",
    channel: "image",
    template: "T",
    meta: { channel: "image", width: 400, height: 200, format: "svg", alt: "A" },
    layout: { slots: [{ key: "hero", element: "image", frame: { x: 0, y: 0, w: 1, h: 1 } }] },
    bindings: [{ slot: "hero", assetId: "marketing.hero" }],
  };
  const asset = { id: "marketing.hero", src: "https://cdn.example/hero.png", width: 800, height: 400, alt: "Storefront photo" };

  it("BEFORE (still true without resolveAssetId): throws empty-output — nothing was resolved", () => {
    try {
      renderImageDocument(assetOnlyDoc);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
    }
  });

  it("AFTER: a document made ENTIRELY of assetId bindings renders successfully — never a false empty-output", () => {
    const result = renderImageDocument(assetOnlyDoc, {
      resolveAssetId: (assetId) => (assetId === "marketing.hero" ? asset : undefined),
    });
    expect(result.svg).toContain('href="https://cdn.example/hero.png"');
    expect(result.svg).toContain("Storefront photo");
    expect(result.warnings).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Non-fatal warnings — optional slot that matched but produced no text
// ─────────────────────────────────────────────────────────────────────────

describe("optional-slot warnings (non-fatal)", () => {
  it("warns, but still renders, when an OPTIONAL slot's copyId does not resolve", () => {
    const doc = baseDoc({
      bindings: [
        { slot: "eyebrow", copyId: "eyebrow.unresolvable" },
        { slot: "headline", value: "Ship faster with Acme" },
      ],
    });
    const result = renderImageDocument(doc);
    expect(result.svg).not.toContain("eyebrow.unresolvable");
    expect(result.warnings.some((w) => w.includes('slot "eyebrow"') && w.includes("no content"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// scale: 2 — hand-computed width/height vs. viewBox
// ─────────────────────────────────────────────────────────────────────────

describe("scale handling", () => {
  it("scale 2 doubles the emitted width/height attributes while viewBox stays at logical units", () => {
    const doc = baseDoc({ meta: { channel: "image", width: 1200, height: 630, format: "svg", scale: 2, alt: "Acme" } });
    const result = renderImageDocument(doc);
    expect(result.viewBox).toEqual({ width: 1200, height: 630 });
    expect(result.width).toBe(2400);
    expect(result.height).toBe(1260);
    expect(result.svg).toContain('width="2400"');
    expect(result.svg).toContain('height="1260"');
    expect(result.svg).toContain('viewBox="0 0 1200 630"');
  });

  it("scale omitted defaults to 1: attrs equal viewBox", () => {
    const doc = baseDoc({ meta: { channel: "image", width: 800, height: 400, format: "svg", alt: "Acme" } });
    const result = renderImageDocument(doc);
    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
    expect(result.viewBox).toEqual({ width: 800, height: 400 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Format declaration — never silently pretend to have rasterized
// ─────────────────────────────────────────────────────────────────────────

describe("requested format handling", () => {
  it("declares the requested non-svg format and warns that rasterization is the caller's job", () => {
    const doc = baseDoc();
    const result = renderImageDocument(doc);
    expect(result.requestedFormat).toBe("png");
    expect(result.svg.startsWith("<svg")).toBe(true);
    expect(result.warnings.some((w) => w.includes('"png"') && w.toLowerCase().includes("caller"))).toBe(true);
  });

  it("emits no rasterization warning when format is already svg", () => {
    const doc = baseDoc({ meta: { channel: "image", width: 1200, height: 630, format: "svg", alt: "Acme" } });
    const result = renderImageDocument(doc);
    expect(result.warnings.some((w) => w.toLowerCase().includes("rasteriz"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// alt text — required by the contract, must survive into <title>/aria-label
// ─────────────────────────────────────────────────────────────────────────

describe("alt text accessibility", () => {
  it("emits ImageMeta.alt as <title> and role=img/aria-label", () => {
    const doc = baseDoc({ meta: { channel: "image", width: 1200, height: 630, format: "svg", alt: 'A "quoted" alt & more' } });
    const result = renderImageDocument(doc);
    expect(result.svg).toContain('role="img"');
    expect(result.svg).toContain('aria-label="A &quot;quoted&quot; alt &amp; more"');
    expect(result.svg).toContain("<title>A &quot;quoted&quot; alt &amp; more</title>");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Geometry — hand-computed slot placement
// ─────────────────────────────────────────────────────────────────────────

describe("slot geometry", () => {
  it("places a slot at {x:0.25,y:0.5,w:0.5,h:0.25} on a 1920x1080 canvas at exactly x=480,y=540,w=960,h=270", () => {
    const doc: ComposeDocument = {
      id: "geometry-check",
      channel: "image",
      template: "geometry-check",
      meta: { channel: "image", width: 1920, height: 1080, format: "svg", alt: "geometry check" },
      layout: {
        slots: [{ key: "block", element: "fill", frame: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, style: { background: "--color-surface-raised" }, required: true }],
      },
      bindings: [{ slot: "block", value: "content" }],
    };
    const result = renderImageDocument(doc);
    expect(result.svg).toContain('x="480" y="540" width="960" height="270"');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// StyleBinding.typography — overrides the ElementKind default, never a
// silent fallback for an unknown role. See ../internal/typography.ts.
// ─────────────────────────────────────────────────────────────────────────

describe("StyleBinding.typography overrides the ElementKind default font size", () => {
  it("a \"body\" element (default --text-body=15px) with style.typography=\"--text-display-xl\" (72px) renders at 72px, not 15px", () => {
    const doc: ComposeDocument = {
      id: "typography-override",
      channel: "image",
      template: "T",
      meta: { channel: "image", width: 800, height: 400, format: "svg", alt: "override check" },
      layout: {
        slots: [
          { key: "plain", element: "body", frame: { x: 0, y: 0, w: 1, h: 0.5 }, required: true },
          {
            key: "hero",
            element: "body",
            frame: { x: 0, y: 0.5, w: 1, h: 0.5 },
            required: true,
            style: { typography: "--text-display-xl" },
          },
        ],
      },
      bindings: [
        { slot: "plain", value: "Plain body text" },
        { slot: "hero", value: "Hero body text" },
      ],
    };

    const result = renderImageDocument(doc);
    expect(result.svg).toContain('data-slot="plain"><text x="0" y="12" font-size="15"');
    expect(result.svg).toContain('data-slot="hero"><text x="0" y="257.6" font-size="72"');
  });

  it("an unknown style.typography role throws RenderError(\"unknown-style-role\"), never a silent fallback to the ElementKind default size", () => {
    const doc: ComposeDocument = {
      id: "typography-unknown-role",
      channel: "image",
      template: "T",
      meta: { channel: "image", width: 800, height: 400, format: "svg", alt: "unknown role check" },
      layout: {
        slots: [{ key: "s", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true, style: { typography: "--text-does-not-exist" } }],
      },
      bindings: [{ slot: "s", value: "text" }],
    };

    try {
      renderImageDocument(doc);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("unknown-style-role");
      expect((error as RenderError).message).toContain("--text-does-not-exist");
    }
  });
});
