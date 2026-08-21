import { describe, expect, it } from "vitest";
import { resolveDocument } from "./resolve.js";
import type { ComposeDocument, LayoutSpec } from "./types.js";

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

const twoSlotLayout: LayoutSpec = {
  slots: [
    { key: "heading", element: "heading", frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.15 }, required: true },
    { key: "body", element: "body", frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.5 } },
  ],
};

describe("resolveDocument — the happy path", () => {
  it("resolves every binding against its matching slot, ok: true", () => {
    const result = resolveDocument(baseDoc, twoSlotLayout);
    expect(result.ok).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.unknownBindings).toEqual([]);
    expect(result.resolved).toHaveLength(2);
    expect(result.resolved.map((r) => r.key).sort()).toEqual(["body", "heading"]);
    // Each resolved entry pairs the real spec with the binding that filled it.
    const headingEntry = result.resolved.find((r) => r.key === "heading");
    expect(headingEntry?.spec.element).toBe("heading");
    expect(headingEntry?.binding.copyId).toBe("one-pager.heading");
  });
});

describe("resolveDocument — THE BAR: resolving nothing is never a clean pass", () => {
  it("reports ok: false for an empty layout (slots: [])", () => {
    const result = resolveDocument(baseDoc, { slots: [] });
    expect(result.ok).toBe(false);
    expect(result.resolved).toEqual([]);
    // Every binding is unknown — there are no slots for any of them to match.
    expect(result.unknownBindings).toHaveLength(2);
  });

  it("reports ok: false for an empty bindings list", () => {
    const result = resolveDocument({ ...baseDoc, bindings: [] }, twoSlotLayout);
    expect(result.ok).toBe(false);
    expect(result.resolved).toEqual([]);
    expect(result.unknownBindings).toEqual([]);
    // The required "heading" slot got no binding at all.
    expect(result.missingRequired).toEqual(["heading"]);
  });

  it("reports ok: false when every binding names a slot that doesn't exist in the layout", () => {
    const result = resolveDocument(
      { ...baseDoc, bindings: [{ slot: "does-not-exist", copyId: "x" }] },
      twoSlotLayout,
    );
    expect(result.ok).toBe(false);
    expect(result.resolved).toEqual([]);
    expect(result.unknownBindings).toHaveLength(1);
    expect(result.unknownBindings[0]).toEqual({ slot: "does-not-exist", copyId: "x" });
  });

  it("reports ok: false for a document with both an empty layout and an empty bindings list — the maximally-empty case", () => {
    const result = resolveDocument({ ...baseDoc, bindings: [] }, { slots: [] });
    expect(result).toEqual({
      ok: false,
      missingRequired: [],
      unknownBindings: [],
      resolved: [],
      bindingFindings: [],
    });
  });
});

describe("resolveDocument — issue #43: a binding that matched a slot but produces no actual text must not be ok: true", () => {
  it("FIXTURE: a binding with neither copyId nor value — reports ok: false via bindingFindings, not a silent ok: true", () => {
    const doc: ComposeDocument = { ...baseDoc, bindings: [{ slot: "heading" }, { slot: "body", value: "ok" }] };
    const result = resolveDocument(doc, twoSlotLayout);
    // The binding still matched a real slot key, so it's still in `resolved` —
    // resolveDocument narrows nothing out of `resolved`, it flags instead.
    expect(result.resolved).toHaveLength(2);
    expect(result.ok).toBe(false);
    const finding = result.bindingFindings.find((f) => f.rule === "binding-source-exclusive");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("none are present");
  });

  it("FIXTURE: a binding with BOTH copyId and value (ambiguous) — reports ok: false via bindingFindings", () => {
    const doc: ComposeDocument = {
      ...baseDoc,
      bindings: [{ slot: "heading", copyId: "one-pager.heading", value: "A literal too" }, { slot: "body", value: "ok" }],
    };
    const result = resolveDocument(doc, twoSlotLayout);
    expect(result.resolved).toHaveLength(2);
    expect(result.ok).toBe(false);
    const finding = result.bindingFindings.find((f) => f.rule === "binding-source-exclusive");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("2 are present");
  });

  it("FIXTURE: value: \"\" (empty string) — reports ok: false via bindingFindings", () => {
    const doc: ComposeDocument = { ...baseDoc, bindings: [{ slot: "heading", copyId: "x" }, { slot: "body", value: "" }] };
    const result = resolveDocument(doc, twoSlotLayout);
    expect(result.ok).toBe(false);
    expect(result.bindingFindings.some((f) => f.rule === "binding-value-shape")).toBe(true);
  });

  it("FIXTURE: value: \"   \" (whitespace-only) — reports ok: false via bindingFindings, not a clean pass", () => {
    const doc: ComposeDocument = { ...baseDoc, bindings: [{ slot: "heading", copyId: "x" }, { slot: "body", value: "   " }] };
    const result = resolveDocument(doc, twoSlotLayout);
    expect(result.ok).toBe(false);
    const finding = result.bindingFindings.find((f) => f.rule === "binding-value-shape");
    expect(finding).toBeDefined();
    expect(finding?.path).toBe("bindings.1.value");
  });

  it("FIXTURE: copyId: \"\" (empty string) — reports ok: false via bindingFindings", () => {
    const doc: ComposeDocument = { ...baseDoc, bindings: [{ slot: "heading", copyId: "" }, { slot: "body", value: "ok" }] };
    const result = resolveDocument(doc, twoSlotLayout);
    expect(result.ok).toBe(false);
    expect(result.bindingFindings.some((f) => f.rule === "binding-copy-id-shape")).toBe(true);
  });

  it("a well-formed binding (copyId only, or value only) reports no bindingFindings and can be ok: true", () => {
    const result = resolveDocument(baseDoc, twoSlotLayout);
    expect(result.bindingFindings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("a binding matching an UNKNOWN slot is never run through bindingFindings — it's already reported via unknownBindings", () => {
    // A malformed binding (neither copyId nor value) targeting a slot that
    // doesn't exist in the layout at all must not ALSO produce a
    // bindingFindings entry — that would double-report the same input.
    const result = resolveDocument({ ...baseDoc, bindings: [{ slot: "does-not-exist" }] }, twoSlotLayout);
    expect(result.unknownBindings).toEqual([{ slot: "does-not-exist" }]);
    expect(result.bindingFindings).toEqual([]);
    expect(result.ok).toBe(false); // still false — missingRequired + unknownBindings alone already force it
  });
});

describe("resolveDocument — missingRequired", () => {
  it("names a required slot with no binding, and never drops it silently", () => {
    const result = resolveDocument({ ...baseDoc, bindings: [{ slot: "body", value: "only the body" }] }, twoSlotLayout);
    expect(result.ok).toBe(false);
    expect(result.missingRequired).toEqual(["heading"]);
    expect(result.resolved).toHaveLength(1);
  });

  it("does not flag an optional slot (required !== true) as missing", () => {
    const result = resolveDocument({ ...baseDoc, bindings: [{ slot: "heading", copyId: "x" }] }, twoSlotLayout);
    expect(result.missingRequired).toEqual([]);
    // "body" has no binding but isn't required, so this is a clean (if partial) resolution.
    expect(result.ok).toBe(true);
  });
});

describe("resolveDocument — unknownBindings", () => {
  it("collects a binding whose slot matches nothing, without dropping the matching ones", () => {
    const result = resolveDocument(
      { ...baseDoc, bindings: [...baseDoc.bindings, { slot: "footer", value: "stray" }] },
      twoSlotLayout,
    );
    expect(result.ok).toBe(false);
    expect(result.resolved).toHaveLength(2);
    expect(result.unknownBindings).toEqual([{ slot: "footer", value: "stray" }]);
  });
});

describe("resolveDocument — duplicate bindings for the same slot", () => {
  it("resolves every binding for a slot, rather than picking a winner", () => {
    const result = resolveDocument(
      { ...baseDoc, bindings: [{ slot: "heading", copyId: "a" }, { slot: "heading", copyId: "b" }] },
      twoSlotLayout,
    );
    expect(result.resolved.filter((r) => r.key === "heading")).toHaveLength(2);
    // "body" got no binding at all and isn't required, so this is still ok: true.
    expect(result.ok).toBe(true);
  });
});
