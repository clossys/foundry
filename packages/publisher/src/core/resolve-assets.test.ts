import { describe, expect, it, vi } from "vitest";
import { resolveAssets } from "./resolve-assets.js";
import type { AssetLookup } from "./resolve-assets.js";
import { resolveDocument } from "./resolve.js";
import type { ComposeDocument, LayoutSpec, ResolveResult, ResolvedSlot } from "./types.js";

const twoSlotLayout: LayoutSpec = {
  slots: [
    { key: "hero", element: "image", frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.4 }, required: true },
    { key: "logo", element: "logo", frame: { x: 0.1, y: 0.6, w: 0.2, h: 0.1 } },
  ],
};

const baseDoc: ComposeDocument = {
  id: "acme-one-pager",
  channel: "print",
  template: "OnePagerTemplate",
  meta: {
    channel: "print",
    pageSize: "Letter",
    orientation: "portrait",
    margins: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
  },
  bindings: [
    { slot: "hero", assetId: "marketing.hero-banner" },
    { slot: "logo", assetId: "marketing.footer-logo" },
  ],
};

/** Builds a minimal `ResolveResult` directly, without going through `resolveDocument`, mirroring `resolve-copy.test.ts`'s own `resultOf`. */
function resultOf(resolved: ResolvedSlot[]): ResolveResult {
  return { ok: true, missingRequired: [], unknownBindings: [], resolved, bindingFindings: [] };
}

describe("resolveAssets — the happy path", () => {
  it("resolves every assetId binding to whatever the lookup returns", () => {
    const lookup = vi.fn((id: string) => ({ id, src: `/images/${id}.png` }));
    const result = resolveDocument(baseDoc, twoSlotLayout);
    const assetResult = resolveAssets(result, lookup);
    expect(assetResult.ok).toBe(true);
    expect(assetResult.assets).toHaveLength(2);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledWith("marketing.hero-banner");
    expect(lookup).toHaveBeenCalledWith("marketing.footer-logo");
    const hero = assetResult.assets.find((a) => a.key === "hero");
    expect(hero).toEqual({ key: "hero", assetId: "marketing.hero-banner", asset: { id: "marketing.hero-banner", src: "/images/marketing.hero-banner.png" } });
    expect(assetResult.unresolvedAssetIds).toEqual([]);
    expect(assetResult.unchecked).toEqual([]);
    expect(assetResult.deferredToCopy).toEqual([]);
  });
});

describe("resolveAssets — FIXTURE: an unresolvable lookup result must not be treated as resolved", () => {
  it("lookup returning undefined is UNRESOLVED", () => {
    const result = resultOf([{ key: "hero", spec: twoSlotLayout.slots[0], binding: { slot: "hero", assetId: "missing.id" } }]);
    const assetResult = resolveAssets(result, () => undefined);
    expect(assetResult.ok).toBe(false);
    expect(assetResult.unresolvedAssetIds).toEqual(["missing.id"]);
    expect(assetResult.assets).toEqual([]);
  });

  it("lookup returning null is UNRESOLVED", () => {
    const result = resultOf([{ key: "hero", spec: twoSlotLayout.slots[0], binding: { slot: "hero", assetId: "null.id" } }]);
    const assetResult = resolveAssets(result, () => null);
    expect(assetResult.ok).toBe(false);
    expect(assetResult.unresolvedAssetIds).toEqual(["null.id"]);
  });

  it("a falsy-but-not-nullish return value (0, \"\", false) IS treated as resolved — only undefined/null are UNRESOLVED", () => {
    const result = resultOf([{ key: "hero", spec: twoSlotLayout.slots[0], binding: { slot: "hero", assetId: "zero.id" } }]);
    const assetResult = resolveAssets(result, () => 0);
    expect(assetResult.unresolvedAssetIds).toEqual([]);
    expect(assetResult.assets).toEqual([{ key: "hero", assetId: "zero.id", asset: 0 }]);
  });
});

describe("resolveAssets — FIXTURE: lookup is not a function", () => {
  it("every assetId-only slot lands in unchecked, ok: false, lookup never invoked", () => {
    const result = resolveDocument(baseDoc, twoSlotLayout);
    const badLookup = "not-a-function" as unknown as AssetLookup;
    const assetResult = resolveAssets(result, badLookup);
    expect(assetResult.ok).toBe(false);
    expect(assetResult.assets).toEqual([]);
    expect(assetResult.unchecked).toEqual(["hero", "logo"]);
  });

  it("a mixed resolved list still defers the copy-only slots even when lookup is broken", () => {
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "one-pager.heading" } },
      { key: "hero", spec: twoSlotLayout.slots[0], binding: { slot: "hero", assetId: "marketing.hero-banner" } },
    ]);
    const assetResult = resolveAssets(result, undefined as unknown as AssetLookup);
    expect(assetResult.deferredToCopy).toEqual(["heading"]);
    expect(assetResult.unchecked).toEqual(["hero"]);
    expect(assetResult.ok).toBe(false);
  });
});

describe("resolveAssets — FIXTURE: a throwing lookup is caught per-slot, not fatal to the whole document", () => {
  it("one bad assetId's throw lands only that slot in unchecked; the rest still resolve", () => {
    const result = resultOf([
      { key: "hero", spec: twoSlotLayout.slots[0], binding: { slot: "hero", assetId: "throws.id" } },
      { key: "logo", spec: twoSlotLayout.slots[1], binding: { slot: "logo", assetId: "fine.id" } },
    ]);
    const lookup = (id: string) => {
      if (id === "throws.id") throw new Error("asset registry exploded");
      return { id };
    };
    const assetResult = resolveAssets(result, lookup);
    expect(assetResult.unchecked).toEqual(["hero"]);
    expect(assetResult.assets).toEqual([{ key: "logo", assetId: "fine.id", asset: { id: "fine.id" } }]);
    expect(assetResult.ok).toBe(false);
  });
});

describe("resolveAssets — 0.3.0: a copyId/value binding is deferred, never treated as a failed asset lookup", () => {
  it("a binding whose only source is copyId lands in deferredToCopy, not unchecked, and lookup is never called for it", () => {
    const lookup = vi.fn(() => ({ should: "not be used" }));
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "one-pager.heading" } },
    ]);
    const assetResult = resolveAssets(result, lookup);
    expect(assetResult.deferredToCopy).toEqual(["heading"]);
    expect(assetResult.unchecked).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("a binding whose only source is a literal value is also deferred to copy", () => {
    const result = resultOf([{ key: "body", spec: twoSlotLayout.slots[1], binding: { slot: "body", value: "A literal." } }]);
    const assetResult = resolveAssets(result, () => ({ unused: true }));
    expect(assetResult.deferredToCopy).toEqual(["body"]);
  });

  it("a text-only document (no assetId bindings at all) correctly reports ok: false from resolveAssets's own point of view", () => {
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "one-pager.heading" } },
      { key: "body", spec: twoSlotLayout.slots[1], binding: { slot: "body", value: "A literal." } },
    ]);
    const assetResult = resolveAssets(result, () => ({ unused: true }));
    expect(assetResult.deferredToCopy).toEqual(["heading", "body"]);
    expect(assetResult.assets).toEqual([]);
    // Symmetric counterpart to resolveCopy reporting ok: true for an
    // asset-only document — this function checked nothing that was
    // actually its job, so it is honestly ok: false, not a manufactured pass.
    expect(assetResult.ok).toBe(false);
  });
});

describe("resolveAssets — ambiguous / empty bindings land in unchecked, same as resolveDocument's bindingFindings would flag", () => {
  it("a binding with none of copyId/value/assetId lands in unchecked", () => {
    const result = resultOf([{ key: "hero", spec: twoSlotLayout.slots[0], binding: { slot: "hero" } }]);
    const assetResult = resolveAssets(result, () => ({ unused: true }));
    expect(assetResult.unchecked).toEqual(["hero"]);
    expect(assetResult.deferredToCopy).toEqual([]);
  });

  it("a binding with BOTH copyId and assetId lands in unchecked, and lookup is never called for it", () => {
    const lookup = vi.fn(() => ({ should: "not be used" }));
    const result = resultOf([
      { key: "hero", spec: twoSlotLayout.slots[0], binding: { slot: "hero", copyId: "x", assetId: "y" } },
    ]);
    const assetResult = resolveAssets(result, lookup);
    expect(assetResult.unchecked).toEqual(["hero"]);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("resolveAssets — an empty resolved list is ok: false, never a clean pass on resolving nothing", () => {
  it("reports ok: false with every list empty", () => {
    const assetResult = resolveAssets(resultOf([]), () => ({ unused: true }));
    expect(assetResult).toEqual({ ok: false, assets: [], unresolvedAssetIds: [], unchecked: [], deferredToCopy: [] });
  });
});
