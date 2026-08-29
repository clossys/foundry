import { describe, expect, it } from "vitest";
import { resolveDocument } from "../core/index.js";
import type { ComposeDocument, LayoutSpec } from "../core/index.js";
import {
  describeAssetProblems,
  describeStaticAssetProblems,
  hasAssetProblems,
  isAllowedAssetUrl,
  isRenderAsset,
  isRenderImageAsset,
  isRenderVideoAsset,
  resolveDocumentAssets,
  resolveStaticAssets,
  toStaticRenderAsset,
} from "./assets.js";
import type { RenderAssetResolution, RenderImageAsset, RenderVideoAsset } from "./assets.js";

const LAYOUT: LayoutSpec = {
  slots: [
    { key: "hero", element: "image", frame: { x: 0, y: 0, w: 1, h: 0.5 } },
    { key: "caption", element: "body", frame: { x: 0, y: 0.5, w: 1, h: 0.5 } },
  ],
};

function docWithBindings(bindings: ComposeDocument["bindings"]): ComposeDocument {
  return {
    id: "asset-fixture",
    channel: "image",
    template: "T",
    meta: { channel: "image", width: 100, height: 100, format: "svg", alt: "A" },
    bindings,
  };
}

const REAL_ASSET = { id: "marketing.hero", type: "image", src: "https://cdn.example/hero.png", width: 800, height: 400, alt: "A hero shot" };

// ─────────────────────────────────────────────────────────────────────────
// isRenderAsset — shape validation
// ─────────────────────────────────────────────────────────────────────────

describe("isRenderAsset", () => {
  it("accepts a real, well-shaped asset", () => {
    expect(isRenderAsset(REAL_ASSET)).toBe(true);
  });

  it("accepts extra fields (structural typing — a real AssetEntry has licence/credit/mimeType too)", () => {
    expect(isRenderAsset({ ...REAL_ASSET, mimeType: "image/png", licence: "CC-BY-4.0", credit: "Jane Doe" })).toBe(true);
  });

  it("rejects null/undefined/non-object", () => {
    expect(isRenderAsset(null)).toBe(false);
    expect(isRenderAsset(undefined)).toBe(false);
    expect(isRenderAsset("a string")).toBe(false);
    expect(isRenderAsset(42)).toBe(false);
  });

  it("rejects a missing/empty src", () => {
    expect(isRenderAsset({ ...REAL_ASSET, src: undefined })).toBe(false);
    expect(isRenderAsset({ ...REAL_ASSET, src: "" })).toBe(false);
  });

  it("rejects a non-positive or non-finite width/height", () => {
    expect(isRenderAsset({ ...REAL_ASSET, width: 0 })).toBe(false);
    expect(isRenderAsset({ ...REAL_ASSET, width: -10 })).toBe(false);
    expect(isRenderAsset({ ...REAL_ASSET, height: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isRenderAsset({ ...REAL_ASSET, width: Number.NaN })).toBe(false);
  });

  it("rejects a missing or whitespace-only alt — the identical bar @clossys/publisher/media' own schema.ts holds", () => {
    expect(isRenderAsset({ ...REAL_ASSET, alt: undefined })).toBe(false);
    expect(isRenderAsset({ ...REAL_ASSET, alt: "" })).toBe(false);
    expect(isRenderAsset({ ...REAL_ASSET, alt: "   " })).toBe(false);
  });

  it("rejects a non-string mimeType when present", () => {
    expect(isRenderAsset({ ...REAL_ASSET, mimeType: 12345 })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveDocumentAssets — the resolveAssets wrapper
// ─────────────────────────────────────────────────────────────────────────

describe("resolveDocumentAssets", () => {
  it("resolves a real assetId binding into byKey, validated", () => {
    const result = resolveDocument(docWithBindings([{ slot: "hero", assetId: "marketing.hero" }]), LAYOUT);
    const assets = resolveDocumentAssets(result, (id) => (id === "marketing.hero" ? REAL_ASSET : undefined));
    expect(assets.byKey.get("hero")).toEqual(REAL_ASSET);
    expect(hasAssetProblems(assets)).toBe(false);
  });

  it("treats an omitted lookup exactly like one that resolves nothing — every assetId lands in unchecked/unresolved, never silently ignored", () => {
    const result = resolveDocument(docWithBindings([{ slot: "hero", assetId: "marketing.hero" }]), LAYOUT);
    const assets = resolveDocumentAssets(result, undefined);
    expect(assets.byKey.size).toBe(0);
    expect(hasAssetProblems(assets)).toBe(true);
  });

  it("records an unresolved assetId (lookup returns undefined) in unresolvedAssetIds", () => {
    const result = resolveDocument(docWithBindings([{ slot: "hero", assetId: "marketing.hero" }]), LAYOUT);
    const assets = resolveDocumentAssets(result, () => undefined);
    expect(assets.unresolvedAssetIds).toEqual(["marketing.hero"]);
    expect(hasAssetProblems(assets)).toBe(true);
    expect(describeAssetProblems(assets).join(" ")).toContain("marketing.hero");
  });

  it("records a lookup that throws in `unchecked`, and does not propagate the throw", () => {
    const result = resolveDocument(docWithBindings([{ slot: "hero", assetId: "marketing.hero" }]), LAYOUT);
    const assets = resolveDocumentAssets(result, () => {
      throw new Error("boom");
    });
    expect(assets.unchecked).toEqual(["hero"]);
    expect(hasAssetProblems(assets)).toBe(true);
  });

  it("records a lookup that is not a function the same way — every assetId slot lands in unchecked", () => {
    const result = resolveDocument(docWithBindings([{ slot: "hero", assetId: "marketing.hero" }]), LAYOUT);
    // Deliberately wrong-typed input, matching this module's own runtime
    // contract (a real caller might pass anything at the JS boundary) —
    // cast rather than `@ts-expect-error`, since a *.test.ts file is not
    // part of this package's real tsc build, so that directive would be
    // inert and never actually checked.
    const assets = resolveDocumentAssets(result, "not a function" as unknown as Parameters<typeof resolveDocumentAssets>[1]);
    expect(assets.unchecked).toEqual(["hero"]);
    expect(hasAssetProblems(assets)).toBe(true);
  });

  it("records a lookup result that resolves but fails shape validation as `invalid` — never silently used, never confused with `unresolvedAssetIds`", () => {
    const result = resolveDocument(docWithBindings([{ slot: "hero", assetId: "marketing.hero" }]), LAYOUT);
    const assets = resolveDocumentAssets(result, () => ({ wrong: "shape" }));
    expect(assets.byKey.size).toBe(0);
    expect(assets.unresolvedAssetIds).toEqual([]);
    expect(assets.invalid).toEqual([{ key: "hero", assetId: "marketing.hero" }]);
    expect(hasAssetProblems(assets)).toBe(true);
    expect(describeAssetProblems(assets).join(" ")).toContain("marketing.hero (slot \"hero\")");
  });

  it("defers a copyId/value-only binding to deferredToCopy, never a problem", () => {
    const result = resolveDocument(docWithBindings([{ slot: "caption", value: "hello" }]), LAYOUT);
    const assets = resolveDocumentAssets(result, () => undefined);
    expect(assets.deferredToCopy).toEqual(["caption"]);
    expect(hasAssetProblems(assets)).toBe(false);
    expect(assets.byKey.size).toBe(0);
  });

  it("a mixed document resolves the assetId slot and defers the value slot, with zero problems", () => {
    const result = resolveDocument(
      docWithBindings([
        { slot: "hero", assetId: "marketing.hero" },
        { slot: "caption", value: "A caption" },
      ]),
      LAYOUT,
    );
    const assets = resolveDocumentAssets(result, (id) => (id === "marketing.hero" ? REAL_ASSET : undefined));
    expect(assets.byKey.get("hero")).toEqual(REAL_ASSET);
    expect(assets.deferredToCopy).toEqual(["caption"]);
    expect(hasAssetProblems(assets)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// hasAssetProblems / describeAssetProblems — shared refusal helpers
// ─────────────────────────────────────────────────────────────────────────

describe("hasAssetProblems / describeAssetProblems", () => {
  it("describeAssetProblems is empty when there is nothing wrong", () => {
    const result = resolveDocument(docWithBindings([{ slot: "hero", assetId: "marketing.hero" }]), LAYOUT);
    const assets = resolveDocumentAssets(result, (id) => (id === "marketing.hero" ? REAL_ASSET : undefined));
    expect(describeAssetProblems(assets)).toEqual([]);
    expect(hasAssetProblems(assets)).toBe(false);
  });

  it("describeAssetProblems reports every distinct kind of problem when several occur across a document", () => {
    const layout: LayoutSpec = {
      slots: [
        { key: "a", element: "image", frame: { x: 0, y: 0, w: 1, h: 0.33 } },
        { key: "b", element: "image", frame: { x: 0, y: 0.33, w: 1, h: 0.33 } },
      ],
    };
    const result = resolveDocument(
      docWithBindings([
        { slot: "a", assetId: "unresolvable" },
        { slot: "b", assetId: "wrong-shape" },
      ]),
      layout,
    );
    const assets = resolveDocumentAssets(result, (id) => (id === "wrong-shape" ? { nope: true } : undefined));
    const problems = describeAssetProblems(assets);
    expect(problems.some((p) => p.includes("unresolvable"))).toBe(true);
    expect(problems.some((p) => p.includes("wrong-shape"))).toBe(true);
    expect(hasAssetProblems(assets)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// isAllowedAssetUrl — scheme checking (issue #177)
// ─────────────────────────────────────────────────────────────────────────

describe("isAllowedAssetUrl", () => {
  it("accepts https:/http: absolute URLs", () => {
    expect(isAllowedAssetUrl("https://cdn.example/hero.png")).toBe(true);
    expect(isAllowedAssetUrl("http://cdn.example/hero.png")).toBe(true);
  });

  it("rejects a dangerous scheme (parsed, never string-matched)", () => {
    expect(isAllowedAssetUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedAssetUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isAllowedAssetUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedAssetUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects a protocol-relative URL — it reads as same-site and is not", () => {
    expect(isAllowedAssetUrl("//evil.example/hero.png")).toBe(false);
  });

  it("accepts a build-resolved relative path — v1's own documented allowance, unchanged", () => {
    expect(isAllowedAssetUrl("./hero.png")).toBe(true);
    expect(isAllowedAssetUrl("assets/hero.png")).toBe(true);
    expect(isAllowedAssetUrl("/images/hero.png")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// isRenderImageAsset / isRenderVideoAsset — the v2 discriminated shapes
// ─────────────────────────────────────────────────────────────────────────

const REAL_IMAGE_ASSET: RenderImageAsset = {
  type: "image",
  src: "https://cdn.example/hero.png",
  width: 800,
  height: 400,
  alt: "A hero shot",
};

const REAL_VIDEO_ASSET: RenderVideoAsset = {
  type: "video",
  sources: [{ src: "https://cdn.example/hero.mp4", mimeType: "video/mp4" }],
  width: 1920,
  height: 1080,
  alt: "A product demo",
  transcript: "A transcript.",
  reducedMotion: "no-autoplay",
};

describe("isRenderImageAsset", () => {
  it("accepts a real image asset with no sources", () => {
    expect(isRenderImageAsset(REAL_IMAGE_ASSET)).toBe(true);
    expect(isRenderAsset(REAL_IMAGE_ASSET)).toBe(true);
  });

  it("accepts a real image asset WITH well-formed sources", () => {
    const withSources: RenderImageAsset = {
      ...REAL_IMAGE_ASSET,
      sources: [
        { src: "https://cdn.example/hero.avif", width: 800, format: "image/avif" },
        { src: "https://cdn.example/hero-400.png", width: 400 },
      ],
    };
    expect(isRenderImageAsset(withSources)).toBe(true);
  });

  it("rejects a wrong type discriminator", () => {
    expect(isRenderImageAsset({ ...REAL_IMAGE_ASSET, type: "video" })).toBe(false);
    expect(isRenderImageAsset({ ...REAL_IMAGE_ASSET, type: undefined })).toBe(false);
  });

  it("rejects a malformed sources entry — a plausible-looking wrong value is still fatal", () => {
    expect(isRenderImageAsset({ ...REAL_IMAGE_ASSET, sources: [{ src: "x.png", width: 0 }] })).toBe(false);
    expect(isRenderImageAsset({ ...REAL_IMAGE_ASSET, sources: [{ width: 400 }] })).toBe(false);
    expect(isRenderImageAsset({ ...REAL_IMAGE_ASSET, sources: "not an array" })).toBe(false);
  });

  it("rejects a source whose src fails the URL scheme check", () => {
    expect(isRenderImageAsset({ ...REAL_IMAGE_ASSET, sources: [{ src: "javascript:alert(1)", width: 400 }] })).toBe(false);
  });

  it("rejects a src that fails the URL scheme check", () => {
    expect(isRenderImageAsset({ ...REAL_IMAGE_ASSET, src: "javascript:alert(1)" })).toBe(false);
  });

  it("rejects missing/whitespace-only alt, non-positive dimensions — unchanged from v1", () => {
    expect(isRenderImageAsset({ ...REAL_IMAGE_ASSET, alt: "   " })).toBe(false);
    expect(isRenderImageAsset({ ...REAL_IMAGE_ASSET, width: 0 })).toBe(false);
  });
});

describe("isRenderVideoAsset", () => {
  it("accepts a real, well-shaped video asset (transcript only)", () => {
    expect(isRenderVideoAsset(REAL_VIDEO_ASSET)).toBe(true);
    expect(isRenderAsset(REAL_VIDEO_ASSET)).toBe(true);
  });

  it("accepts a video asset with captions only (no transcript)", () => {
    const { transcript: _drop, ...rest } = REAL_VIDEO_ASSET;
    const withCaptions: RenderVideoAsset = { ...rest, captions: [{ src: "https://cdn.example/en.vtt", srclang: "en", label: "English" }] };
    expect(isRenderVideoAsset(withCaptions)).toBe(true);
  });

  it("rejects a video asset with NEITHER captions nor transcript — the render-time accessibility bar, independent of schema", () => {
    const { transcript: _drop, ...rest } = REAL_VIDEO_ASSET;
    expect(isRenderVideoAsset(rest)).toBe(false);
  });

  it("rejects a video asset with a malformed captions array — malformed never counts as satisfying the requirement", () => {
    const { transcript: _drop, ...rest } = REAL_VIDEO_ASSET;
    expect(isRenderVideoAsset({ ...rest, captions: [{ src: "x.vtt" }] })).toBe(false);
  });

  it("rejects zero sources", () => {
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, sources: [] })).toBe(false);
  });

  it("rejects a source with no mimeType", () => {
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, sources: [{ src: "https://cdn.example/hero.mp4" }] })).toBe(false);
  });

  it("rejects a source whose src fails the URL scheme check", () => {
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, sources: [{ src: "javascript:alert(1)", mimeType: "video/mp4" }] })).toBe(false);
  });

  it("rejects a missing/unknown reducedMotion", () => {
    const { reducedMotion: _drop, ...rest } = REAL_VIDEO_ASSET;
    expect(isRenderVideoAsset(rest)).toBe(false);
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, reducedMotion: "sometimes" })).toBe(false);
  });

  it("rejects reducedMotion: static-poster with no poster", () => {
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, reducedMotion: "static-poster" })).toBe(false);
  });

  it("accepts reducedMotion: static-poster WITH a poster", () => {
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, reducedMotion: "static-poster", poster: "https://cdn.example/poster.png" })).toBe(true);
  });

  it("rejects a poster that fails the URL scheme check", () => {
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, poster: "javascript:alert(1)" })).toBe(false);
  });

  it("rejects a non-boolean autoplay/loop/muted", () => {
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, autoplay: "yes" })).toBe(false);
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, loop: "yes" })).toBe(false);
    expect(isRenderVideoAsset({ ...REAL_VIDEO_ASSET, muted: "yes" })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// toStaticRenderAsset / resolveStaticAssets — the non-web channels' shared
// video decision (issue #177)
// ─────────────────────────────────────────────────────────────────────────

describe("toStaticRenderAsset", () => {
  it("reduces an image asset to exactly itself, dropping sources", () => {
    const withSources: RenderImageAsset = { ...REAL_IMAGE_ASSET, sources: [{ src: "https://cdn.example/hero.avif", width: 800 }] };
    expect(toStaticRenderAsset(withSources)).toEqual({
      src: REAL_IMAGE_ASSET.src,
      width: REAL_IMAGE_ASSET.width,
      height: REAL_IMAGE_ASSET.height,
      alt: REAL_IMAGE_ASSET.alt,
    });
  });

  it("reduces a video asset WITH a poster to that poster", () => {
    const withPoster: RenderVideoAsset = { ...REAL_VIDEO_ASSET, poster: "https://cdn.example/poster.png" };
    expect(toStaticRenderAsset(withPoster)).toEqual({
      src: "https://cdn.example/poster.png",
      width: REAL_VIDEO_ASSET.width,
      height: REAL_VIDEO_ASSET.height,
      alt: REAL_VIDEO_ASSET.alt,
    });
  });

  it("returns undefined for a video asset with NO poster — nothing this channel can paint", () => {
    expect(toStaticRenderAsset(REAL_VIDEO_ASSET)).toBeUndefined();
  });
});

describe("resolveStaticAssets / describeStaticAssetProblems", () => {
  function resolutionOf(byKey: Map<string, RenderImageAsset | RenderVideoAsset>): RenderAssetResolution {
    return { byKey, unresolvedAssetIds: [], unchecked: [], invalid: [], deferredToCopy: [] };
  }

  it("flattens every image entry into byKey", () => {
    const resolution = resolutionOf(new Map([["hero", REAL_IMAGE_ASSET]]));
    const staticAssets = resolveStaticAssets(resolution);
    expect(staticAssets.byKey.get("hero")).toEqual({
      src: REAL_IMAGE_ASSET.src,
      width: REAL_IMAGE_ASSET.width,
      height: REAL_IMAGE_ASSET.height,
      alt: REAL_IMAGE_ASSET.alt,
    });
    expect(staticAssets.posterlessVideo).toEqual([]);
    expect(describeStaticAssetProblems(staticAssets)).toEqual([]);
  });

  it("flattens a poster-bearing video entry into byKey too", () => {
    const withPoster: RenderVideoAsset = { ...REAL_VIDEO_ASSET, poster: "https://cdn.example/poster.png" };
    const resolution = resolutionOf(new Map([["hero", withPoster]]));
    const staticAssets = resolveStaticAssets(resolution);
    expect(staticAssets.byKey.get("hero")?.src).toBe("https://cdn.example/poster.png");
    expect(staticAssets.posterlessVideo).toEqual([]);
  });

  it("records a posterless video's key in posterlessVideo, never in byKey", () => {
    const resolution = resolutionOf(new Map([["hero", REAL_VIDEO_ASSET]]));
    const staticAssets = resolveStaticAssets(resolution);
    expect(staticAssets.byKey.has("hero")).toBe(false);
    expect(staticAssets.posterlessVideo).toEqual(["hero"]);
    const problems = describeStaticAssetProblems(staticAssets);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("hero");
    expect(problems[0]).toMatch(/no poster/);
  });

  it("handles a mix of image, poster-video, and posterless-video slots in one resolution", () => {
    const withPoster: RenderVideoAsset = { ...REAL_VIDEO_ASSET, poster: "https://cdn.example/poster.png" };
    const resolution = resolutionOf(
      new Map<string, RenderImageAsset | RenderVideoAsset>([
        ["a", REAL_IMAGE_ASSET],
        ["b", withPoster],
        ["c", REAL_VIDEO_ASSET],
      ]),
    );
    const staticAssets = resolveStaticAssets(resolution);
    expect([...staticAssets.byKey.keys()].sort()).toEqual(["a", "b"]);
    expect(staticAssets.posterlessVideo).toEqual(["c"]);
  });
});
