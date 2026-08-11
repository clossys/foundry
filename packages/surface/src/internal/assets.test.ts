import { describe, expect, it } from "vitest";
import { resolveDocument } from "../core/index.js";
import type { ComposeDocument, LayoutSpec } from "../core/index.js";
import {
  describeAssetProblems,
  hasAssetProblems,
  isRenderAsset,
  resolveDocumentAssets,
} from "./assets.js";

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

const REAL_ASSET = { id: "marketing.hero", src: "https://cdn.example/hero.png", width: 800, height: 400, alt: "A hero shot" };

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

  it("rejects a missing or whitespace-only alt — the identical bar @vespeneventures/surface/media' own schema.ts holds", () => {
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
