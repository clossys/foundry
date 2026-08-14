// @vitest-environment jsdom
//
// Issue #177 (Surface Media v2) — the web channel's own new rendering
// behavior: responsive `<picture>` output for an `ImageAssetEntry` with
// `sources`, real `<video>` output for a `VideoAssetEntry`, and the
// reduced-motion contract. `@vitest-environment jsdom` (see
// `web/views/AuthView.test.tsx` for the same per-file pragma) gives this
// file a REAL `window`/`window.matchMedia`, so the reduced-motion tests
// below are a genuine media-query-aware check against real rendered HTML
// (`renderToStaticMarkup`), never a documentation-only promise — see
// `renderWebDocument.ts`'s own doc comment, "Reduced motion is a
// rendering-time decision, not a build-time one."

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "../core/index.js";
import { RenderError } from "../internal/errors.js";
import { renderWebDocument } from "./renderWebDocument.js";

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

/** Sets `window.matchMedia` to a fixed answer for every query — the standard jsdom-doesn't-implement-this-itself workaround, scoped to one test via a local override rather than a global `beforeEach`, so each test states its own precondition explicitly. */
function mockPrefersReducedMotion(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// ─────────────────────────────────────────────────────────────────────────
// Responsive images — ImageAssetEntry.sources -> <picture>
// ─────────────────────────────────────────────────────────────────────────

describe("renderWebDocument — responsive images (issue #177)", () => {
  it("an image asset with NO sources renders the identical single <img> as before (regression)", () => {
    const { element } = renderWebDocument(assetDoc, {
      resolveAssetId: () => ({ type: "image", src: "https://cdn.example/logo.png", width: 120, height: 40, alt: "Acme logo" }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('<img src="https://cdn.example/logo.png" alt="Acme logo" width="120" height="40"');
    expect(html).not.toContain("<picture>");
  });

  it("an image asset WITH sources renders a <picture> with <source>/type attributes and a fallback <img>", () => {
    const { element } = renderWebDocument(assetDoc, {
      resolveAssetId: () => ({
        type: "image",
        src: "https://cdn.example/logo.png",
        width: 120,
        height: 40,
        alt: "Acme logo",
        sources: [
          { src: "https://cdn.example/logo.avif", width: 120, format: "image/avif" },
          { src: "https://cdn.example/logo.webp", width: 120, format: "image/webp" },
        ],
      }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("<picture>");
    expect(html).toContain('<source srcSet="https://cdn.example/logo.avif 120w" type="image/avif"');
    expect(html).toContain('<source srcSet="https://cdn.example/logo.webp 120w" type="image/webp"');
    // The trailing fallback <img> — same shape as the no-sources case.
    expect(html).toContain('<img src="https://cdn.example/logo.png" alt="Acme logo" width="120" height="40"');
  });

  it("groups multiple same-format sources into one <source> with a width-descriptor srcset", () => {
    const { element } = renderWebDocument(assetDoc, {
      resolveAssetId: () => ({
        type: "image",
        src: "https://cdn.example/logo.png",
        width: 120,
        height: 40,
        alt: "Acme logo",
        sources: [
          { src: "https://cdn.example/logo-400.png", width: 400 },
          { src: "https://cdn.example/logo-800.png", width: 800 },
        ],
      }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('<source srcSet="https://cdn.example/logo-400.png 400w, https://cdn.example/logo-800.png 800w"');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Video — VideoAssetEntry -> <video>
// ─────────────────────────────────────────────────────────────────────────

describe("renderWebDocument — video (issue #177)", () => {
  const videoAsset = () => ({
    type: "video",
    sources: [
      { src: "https://cdn.example/hero.mp4", mimeType: "video/mp4" },
      { src: "https://cdn.example/hero.webm", mimeType: "video/webm" },
    ],
    width: 1920,
    height: 1080,
    alt: "A product demo video",
    poster: "https://cdn.example/hero-poster.png",
    captions: [{ src: "https://cdn.example/en.vtt", srclang: "en", label: "English" }],
    reducedMotion: "no-autoplay" as const,
    autoplay: true,
    loop: true,
    muted: true,
  });

  it("renders a <video> with every <source>, every <track kind=captions>, and poster", () => {
    const { element } = renderWebDocument(assetDoc, { resolveAssetId: videoAsset });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("<video");
    expect(html).toContain('poster="https://cdn.example/hero-poster.png"');
    expect(html).toContain('width="1920"');
    expect(html).toContain('height="1080"');
    expect(html).toContain('controls=""');
    expect(html).toContain('<source src="https://cdn.example/hero.mp4" type="video/mp4"');
    expect(html).toContain('<source src="https://cdn.example/hero.webm" type="video/webm"');
    expect(html).toContain('<track kind="captions" src="https://cdn.example/en.vtt" srcLang="en" label="English"');
    expect(html).toContain('aria-label="A product demo video"');
  });

  it("carries alt text as fallback content inside <video> for browsers with no source support", () => {
    const { element } = renderWebDocument(assetDoc, { resolveAssetId: videoAsset });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("A product demo video</video>");
  });

  it("honours autoplay/loop/muted as authored when prefersReducedMotion is not supplied", () => {
    const { element } = renderWebDocument(assetDoc, { resolveAssetId: videoAsset });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('autoPlay=""');
    expect(html).toContain('loop=""');
    expect(html).toContain('muted=""');
  });

  it("throws RenderError('empty-output') for a video missing BOTH captions and transcript — never silently rendered without them", () => {
    // Fails isRenderVideoAsset — see internal/assets.ts — so it is
    // `invalid`, exactly like an unresolved id; never reaches the renderer.
    try {
      renderWebDocument(assetDoc, {
        resolveAssetId: () => ({
          type: "video",
          sources: [{ src: "https://cdn.example/hero.mp4", mimeType: "video/mp4" }],
          width: 1920,
          height: 1080,
          alt: "A product demo video",
          reducedMotion: "no-autoplay",
        }),
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Reduced motion — a REAL, media-query-aware contract (issue #177)
// ─────────────────────────────────────────────────────────────────────────

describe("renderWebDocument — reduced motion contract (issue #177)", () => {
  const autoplayVideoAsset = (reducedMotion: "pause" | "no-autoplay" | "static-poster") => ({
    type: "video",
    sources: [{ src: "https://cdn.example/hero.mp4", mimeType: "video/mp4" }],
    width: 1920,
    height: 1080,
    alt: "A product demo video",
    poster: "https://cdn.example/hero-poster.png",
    transcript: "A transcript.",
    reducedMotion,
    autoplay: true,
  });

  it("prefers-reduced-motion: reduce is NOT active (real window.matchMedia read) — autoplay renders exactly as authored", () => {
    mockPrefersReducedMotion(false);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    expect(prefersReducedMotion).toBe(false);

    const { element } = renderWebDocument(assetDoc, {
      resolveAssetId: () => autoplayVideoAsset("pause"),
      prefersReducedMotion,
    });
    expect(renderToStaticMarkup(element)).toContain('autoPlay=""');
  });

  it("prefers-reduced-motion: reduce IS active (real window.matchMedia read) — reducedMotion: 'pause' suppresses autoplay", () => {
    mockPrefersReducedMotion(true);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    expect(prefersReducedMotion).toBe(true);

    const { element } = renderWebDocument(assetDoc, {
      resolveAssetId: () => autoplayVideoAsset("pause"),
      prefersReducedMotion,
    });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("autoPlay");
    // Every other attribute still renders — a viewer can still press play.
    expect(html).toContain("<video");
    expect(html).toContain('poster="https://cdn.example/hero-poster.png"');
  });

  it("reduced motion active + reducedMotion: 'no-autoplay' also suppresses autoplay", () => {
    const { element } = renderWebDocument(assetDoc, {
      resolveAssetId: () => autoplayVideoAsset("no-autoplay"),
      prefersReducedMotion: true,
    });
    expect(renderToStaticMarkup(element)).not.toContain("autoPlay");
  });

  it("reduced motion active + reducedMotion: 'static-poster' replaces the ENTIRE <video> with a static <img>", () => {
    const { element } = renderWebDocument(assetDoc, {
      resolveAssetId: () => autoplayVideoAsset("static-poster"),
      prefersReducedMotion: true,
    });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("<video");
    expect(html).toContain('<img src="https://cdn.example/hero-poster.png" alt="A product demo video" width="1920" height="1080"');
  });

  it("reduced motion NOT active + reducedMotion: 'static-poster' still renders the real <video>", () => {
    const { element } = renderWebDocument(assetDoc, {
      resolveAssetId: () => autoplayVideoAsset("static-poster"),
      prefersReducedMotion: false,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("<video");
    expect(html).toContain('autoPlay=""');
  });
});
