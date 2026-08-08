import { describe, expect, it, vi } from "vitest";
import { resolveCopy } from "./resolve-copy.js";
import type { CopyLookup } from "./resolve-copy.js";
import { resolveDocument } from "./resolve.js";
import type { ComposeDocument, LayoutSpec, ResolveResult, ResolvedSlot } from "./types.js";

const twoSlotLayout: LayoutSpec = {
  slots: [
    { key: "heading", element: "heading", frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.15 }, required: true },
    { key: "body", element: "body", frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.5 } },
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
    { slot: "heading", copyId: "one-pager.heading" },
    { slot: "body", value: "A literal body paragraph." },
  ],
};

/** Builds a minimal `ResolveResult` directly, without going through `resolveDocument`, for tests that only care about `resolveCopy`'s own behavior over a given `resolved` list. */
function resultOf(resolved: ResolvedSlot[]): ResolveResult {
  return { ok: true, missingRequired: [], unknownBindings: [], resolved, bindingFindings: [] };
}

describe("resolveCopy — the happy path", () => {
  it("resolves a literal value without ever calling lookup", () => {
    const lookup = vi.fn(() => "Real Heading Text");
    const result = resolveDocument(baseDoc, twoSlotLayout);
    const copyResult = resolveCopy(result, lookup);
    expect(copyResult.ok).toBe(true);
    expect(copyResult.texts).toHaveLength(2);
    const bodyText = copyResult.texts.find((t) => t.key === "body");
    expect(bodyText).toEqual({ key: "body", text: "A literal body paragraph.", source: "literal" });
    // lookup is only ever called for copyId-sourced bindings.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("one-pager.heading");
    expect(copyResult.literalCount).toBe(1);
    expect(copyResult.lookupCount).toBe(1);
    expect(copyResult.unresolvedCopyIds).toEqual([]);
    expect(copyResult.unchecked).toEqual([]);
  });

  it("resolves a copyId to real text via lookup", () => {
    const result = resolveDocument(baseDoc, twoSlotLayout);
    const copyResult = resolveCopy(result, (id) => (id === "one-pager.heading" ? "Real Heading Text" : undefined));
    const headingText = copyResult.texts.find((t) => t.key === "heading");
    expect(headingText).toEqual({ key: "heading", text: "Real Heading Text", source: "copy", copyId: "one-pager.heading" });
    expect(copyResult.ok).toBe(true);
  });
});

describe("resolveCopy — FIXTURE: an unresolvable lookup result must not be treated as resolved", () => {
  it("lookup returning undefined is UNRESOLVED, not a fallback to the copyId or the slot key", () => {
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "missing.id" } },
    ]);
    const copyResult = resolveCopy(result, () => undefined);
    expect(copyResult).toEqual({
      ok: false,
      texts: [],
      unresolvedCopyIds: ["missing.id"],
      unchecked: [],
      literalCount: 0,
      lookupCount: 0,
    });
    // Never falls back to the copyId string itself, nor the slot key, nor "".
    expect(copyResult.texts.some((t) => t.text === "missing.id" || t.text === "heading" || t.text === "")).toBe(false);
  });

  it("lookup returning \"\" is UNRESOLVED", () => {
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "empty.id" } },
    ]);
    const copyResult = resolveCopy(result, () => "");
    expect(copyResult.ok).toBe(false);
    expect(copyResult.unresolvedCopyIds).toEqual(["empty.id"]);
    expect(copyResult.texts).toEqual([]);
  });

  it("lookup returning a whitespace-only string is UNRESOLVED", () => {
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "ws.id" } },
    ]);
    const copyResult = resolveCopy(result, () => "   \n\t  ");
    expect(copyResult.ok).toBe(false);
    expect(copyResult.unresolvedCopyIds).toEqual(["ws.id"]);
    expect(copyResult.texts).toEqual([]);
  });
});

describe("resolveCopy — FIXTURE: ok is true ONLY when texts.length > 0 AND unresolvedCopyIds is empty AND unchecked is empty", () => {
  it("an empty resolved list is ok: false, never a clean pass on resolving nothing", () => {
    const copyResult = resolveCopy(resultOf([]), () => "text nobody asked for");
    expect(copyResult).toEqual({
      ok: false,
      texts: [],
      unresolvedCopyIds: [],
      unchecked: [],
      literalCount: 0,
      lookupCount: 0,
    });
  });

  it("mixing one resolved text with one unresolved copyId still reports ok: false overall", () => {
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "good.id" } },
      { key: "body", spec: twoSlotLayout.slots[1], binding: { slot: "body", copyId: "bad.id" } },
    ]);
    const copyResult = resolveCopy(result, (id) => (id === "good.id" ? "Resolved" : undefined));
    expect(copyResult.texts).toHaveLength(1);
    expect(copyResult.unresolvedCopyIds).toEqual(["bad.id"]);
    // texts.length > 0 is true here, but ok must still be false — this is
    // the exact case a naive "texts.length > 0" check would get wrong.
    expect(copyResult.ok).toBe(false);
  });
});

describe("resolveCopy — FIXTURE: lookup is not a function", () => {
  it("every slot goes to unchecked, ok: false, and lookup is never called on anything", () => {
    const result = resolveDocument(baseDoc, twoSlotLayout);
    // Deliberately wrong shape, passed through `unknown` — not a
    // `@ts-expect-error`, which this repository's `check:typechecked-assertions`
    // gate refuses inside a `*.test.ts` file (see `ledger`'s `schema.test.ts`
    // for the identical pattern).
    const badLookup = "not-a-function" as unknown as CopyLookup;
    const copyResult = resolveCopy(result, badLookup);
    expect(copyResult).toEqual({
      ok: false,
      texts: [],
      unresolvedCopyIds: [],
      unchecked: ["heading", "body"],
      literalCount: 0,
      lookupCount: 0,
    });
  });

  it("undefined lookup also lands every slot in unchecked, not a crash", () => {
    const result = resolveDocument(baseDoc, twoSlotLayout);
    const undefinedLookup = undefined as unknown as CopyLookup;
    const copyResult = resolveCopy(result, undefinedLookup);
    expect(copyResult.ok).toBe(false);
    expect(copyResult.unchecked).toEqual(["heading", "body"]);
  });
});

describe("resolveCopy — FIXTURE: a throwing lookup is caught per-slot, not fatal to the whole document", () => {
  it("one bad copyId's throw lands only that slot in unchecked; the rest still resolve", () => {
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "throws.id" } },
      { key: "body", spec: twoSlotLayout.slots[1], binding: { slot: "body", copyId: "fine.id" } },
    ]);
    const lookup = (id: string) => {
      if (id === "throws.id") throw new Error("copy registry exploded");
      return "Body Text";
    };
    const copyResult = resolveCopy(result, lookup);
    expect(copyResult.unchecked).toEqual(["heading"]);
    expect(copyResult.texts).toEqual([{ key: "body", text: "Body Text", source: "copy", copyId: "fine.id" }]);
    // unchecked is non-empty, so ok must be false even though one slot resolved cleanly.
    expect(copyResult.ok).toBe(false);
  });

  it("a throw is not silently swallowed — it still shows up as an explicit unchecked entry, not just absent from texts", () => {
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "throws.id" } },
    ]);
    const copyResult = resolveCopy(result, () => {
      throw new Error("boom");
    });
    expect(copyResult.unchecked).toEqual(["heading"]);
    expect(copyResult.ok).toBe(false);
  });
});

describe("resolveCopy — FIXTURE: unchecked is a real third state, distinct from both texts and unresolvedCopyIds", () => {
  it("a binding with neither copyId nor value lands in unchecked, not silently skipped and not in unresolvedCopyIds", () => {
    const result = resultOf([{ key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading" } }]);
    const copyResult = resolveCopy(result, () => "should never be called");
    expect(copyResult.unchecked).toEqual(["heading"]);
    expect(copyResult.unresolvedCopyIds).toEqual([]);
    expect(copyResult.texts).toEqual([]);
    expect(copyResult.ok).toBe(false);
  });

  it("a binding with BOTH copyId and value (ambiguous) lands in unchecked, and lookup is never called for it", () => {
    const lookup = vi.fn(() => "should not be used");
    const result = resultOf([
      { key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading", copyId: "x", value: "y" } },
    ]);
    const copyResult = resolveCopy(result, lookup);
    expect(copyResult.unchecked).toEqual(["heading"]);
    expect(lookup).not.toHaveBeenCalled();
    expect(copyResult.ok).toBe(false);
  });

  it("a caller reading only `ok` cannot be fooled by an all-unchecked result that looks superficially like a pass", () => {
    // Every list except `unchecked` is empty here, which is exactly the shape
    // a naive implementation might mistakenly treat as "nothing went wrong".
    const result = resultOf([{ key: "heading", spec: twoSlotLayout.slots[0], binding: { slot: "heading" } }]);
    const copyResult = resolveCopy(result, () => undefined);
    expect(copyResult.texts).toEqual([]);
    expect(copyResult.unresolvedCopyIds).toEqual([]);
    expect(copyResult.unchecked.length).toBeGreaterThan(0);
    expect(copyResult.ok).toBe(false);
  });
});

describe("resolveCopy — literalCount / lookupCount", () => {
  it("counts literal and lookup-sourced text separately, and both correctly with a mix", () => {
    const result = resolveDocument(baseDoc, twoSlotLayout);
    const copyResult = resolveCopy(result, () => "Resolved Heading");
    expect(copyResult.literalCount).toBe(1); // "body"
    expect(copyResult.lookupCount).toBe(1); // "heading"
  });
});
