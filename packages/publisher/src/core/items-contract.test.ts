import { describe, expect, it } from "vitest";
import * as contract from "./sectioned-view.js";
import type { SectionedViewDocument } from "./sectioned-view.js";
const ref = (id = "copy") => ({ id });
const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, heading: ref(`heading-${index}`) }));
const document = (fields: Record<string, unknown>): SectionedViewDocument => ({ id: "page", sections: [{ id: "band", kind: "content-section", heading: ref(), ...fields }] }) as SectionedViewDocument;
const findings = (block: unknown) => contract.validateSectionedViewDocument(document({ block }));
const errors = (block: unknown) => findings(block).filter((entry) => entry.severity === "error");
const resolver = (value: { id: string }) => ({ ref: value, text: value.id === "scene-label" ? "A clear sample showing how source documents connect to the resolved result for this section" : value.id, recordId: "fixture", revision: "1", locale: "en", source: { kind: "consumer" as const, reference: "fixture" }, entryId: value.id });

describe("canonical items contract", () => {
  it("exports one closed enum/count table and desugars minimal recipes", () => {
    expect(contract.SECTIONED_VIEW_CONTENT_CONTRACT.arrangements).toEqual(["columns", "rows", "bento", "stacked"]);
    const result = contract.desugarRecipe({ type: "items", recipe: "features", items: items(3) });
    expect(result).toMatchObject({ arrangement: "columns", columns: 3, order: "none", reveal: "all", treatment: "plain", scale: "item" });
    expect(errors({ type: "items", recipe: "features", items: items(3) })).toEqual([]);
  });
  it.each(["features", "statement", "cards", "topics", "link-index", "faq", "steps", "specimen-stack"])("refuses an explicit conflicting axis for %s", (recipe) => {
    expect(findings({ type: "items", recipe, order: "invalid", items: items(3) }).some((entry) => entry.rule === "recipe-axis")).toBe(true);
  });
  it.each([[2, 2], [2, 4], [2, 6], [3, 3], [3, 6]])("accepts columns %i with %i items", (columns, count) => {
    expect(errors({ type: "items", arrangement: "columns", columns, items: items(count) })).toEqual([]);
  });
  it.each([[2, 3], [3, 4], [4, 4]])("refuses columns %i with %i items", (columns, count) => {
    expect(errors({ type: "items", arrangement: "columns", columns, items: items(count) }).length).toBeGreaterThan(0);
  });
  it("validates row/disclosure/connected counts, including the connected stacked override", () => {
    expect(errors({ type: "items", arrangement: "rows", columns: 2, items: items(6) })).toEqual([]);
    expect(errors({ type: "items", arrangement: "rows", columns: 2, items: items(3) }).length).toBeGreaterThan(0);
    expect(errors({ type: "items", arrangement: "rows", reveal: "disclose", items: items(4).map((item) => ({ ...item, description: ref() })) })).toEqual([]);
    expect(errors({ type: "items", arrangement: "columns", reveal: "disclose", items: items(3) }).length).toBeGreaterThan(0);
    expect(errors({ type: "items", arrangement: "stacked", order: "connected", items: items(5) })).toEqual([]);
    expect(findings({ type: "items", arrangement: "columns", order: "connected", items: items(4) })).toContainEqual(expect.objectContaining({ rule: "steps-count", severity: "warning" }));
    expect(() => contract.resolveSectionedViewDocument(document({ block: { type: "items", arrangement: "columns", order: "connected", items: items(4) } }), resolver)).not.toThrow();
  });
  it("treats explicitly undefined optional axes as omission without erasing canonical defaults", () => {
    for (const fields of [{ arrangement: "columns" }, { recipe: "features" }, { recipe: "cards", items: items(2) }]) {
      const block = { type: "items", items: items(3), order: undefined, reveal: undefined, treatment: undefined, scale: undefined, ...fields };
      expect(errors(block)).toEqual([]);
      expect(contract.desugarRecipe(block as contract.SectionedViewItemsBlock)).toMatchObject({ order: "none", reveal: "all", treatment: fields.recipe === "cards" ? "rule" : "plain", scale: "item" });
      const section = contract.resolveSectionedViewDocument(document({ block }), resolver).sections[0];
      expect(section?.kind === "content-section" ? section.block : undefined).toMatchObject({ order: "none", reveal: "all", scale: "item" });
    }
  });
  it("requires arrangement without a recipe and refuses every retired raw type with a named replacement", () => {
    expect(errors({ type: "items", items: items(3) }).length).toBeGreaterThan(0);
    for (const [type, recipe] of [["feature-grid", "features"], ["card-grid", "cards"], ["topic-list", "topics"], ["ordered-step-sequence", "steps"], ["faq", "faq"], ["comparison", "comparison"]]) {
      expect(findings({ type, items: items(3) }).some((entry) => entry.message.includes(recipe!))).toBe(true);
    }
  });
  it("refuses non-string recipe data without invoking property-key coercion", () => {
    let calls = 0;
    const recipe = { toString() { calls++; throw new Error("malicious recipe coercion"); } };
    expect(errors({ type: "items", recipe, items: items(3) }).length).toBeGreaterThan(0);
    expect(calls).toBe(0);
  });
  it("partitions flat row items by ids and refuses duplicate, missing and foreign membership", () => {
    const block = { type: "items", arrangement: "rows", items: items(4), groups: [{ id: "one", label: ref(), items: ["item-0", "item-1"] }, { id: "two", label: ref(), items: ["item-2", "item-3"] }] };
    expect(errors(block)).toEqual([]);
    for (const members of [["item-0", "item-2"], ["item-2"], ["item-2", "foreign"]]) expect(errors({ ...block, groups: [block.groups[0], { ...block.groups[1], items: members }] }).length).toBeGreaterThan(0);
    expect(errors({ ...block, arrangement: "columns", columns: 2 }).length).toBeGreaterThan(0);
  });
  it("retains two-to-four item ids per row group despite valid whole-block partition", () => {
    for (const counts of [[1, 3], [1, 7]]) {
      const flat = items(counts[0]! + counts[1]!);
      const block = { type: "items", arrangement: "rows", items: flat, groups: [{ id: "one", label: ref(), items: flat.slice(0, counts[0]).map((item) => item.id) }, { id: "two", label: ref(), items: flat.slice(counts[0]).map((item) => item.id) }] };
      expect(errors(block)).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-topics-groups-shape" }));
    }
  });
  it("refuses three declared lanes with the named lane-shape finding", () => {
    const ids = ["sender", "reviewer", "observer"];
    const block = { type: "items", recipe: "steps", arrangement: "stacked", lanes: ids.map((id) => ({ id, label: ref(id) })), items: items(3).map((item, index) => ({ ...item, lane: ids[index] })) };
    expect(errors(block)).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-steps-lanes-shape" }));
  });
  it("uses two authored lane ids, requires both, and refuses unknown ids while accepting four steps", () => {
    const block = { type: "items", recipe: "steps", arrangement: "stacked", lanes: [{ id: "sender", label: ref("Sender") }, { id: "reviewer", label: ref("Reviewer") }], items: items(3).map((item, index) => ({ ...item, lane: index === 1 ? "reviewer" : "sender" })) };
    expect(errors(block)).toEqual([]);
    expect(errors({ ...block, items: block.items.map((item) => ({ ...item, lane: "foreign" })) }).some((entry) => entry.rule === "sectioned-view-content-steps-lanes-shape")).toBe(true);
    expect(errors({ ...block, items: [...block.items, { ...block.items[0], id: "four" }] })).toEqual([]);
    expect(errors({ ...block, lanes: [block.lanes[0]] }).length).toBeGreaterThan(0);
    expect(errors({ ...block, arrangement: "columns" })).toEqual([]);
  });
  it("defaults omitted bento spans to half while requiring whole rows", () => {
    for (const count of [2, 4, 6]) {
      const block = { type: "items", arrangement: "bento", items: items(count) };
      expect(errors(block)).toEqual([]);
      const resolved = contract.resolveSectionedViewDocument(document({ block }), resolver).sections[0];
      expect(resolved?.kind === "content-section" && resolved.block?.type === "items" ? resolved.block.items.map((item) => item.span) : []).toEqual(Array(count).fill("half"));
    }
    for (const count of [3, 5]) expect(errors({ type: "items", arrangement: "bento", items: items(count) }).length).toBeGreaterThan(0);
  });
  it("keeps spans bento-only, validates complete explicit rows and featured placement", () => {
    expect(errors({ type: "items", arrangement: "bento", items: items(2).map((item) => ({ ...item, span: "half" })) })).toEqual([]);
    expect(errors({ type: "items", arrangement: "bento", items: items(2).map((item) => ({ ...item, span: "third" })) }).length).toBeGreaterThan(0);
    expect(errors({ type: "items", arrangement: "rows", items: items(2).map((item) => ({ ...item, span: "half" })) }).length).toBeGreaterThan(0);
    expect(errors({ type: "items", arrangement: "columns", items: items(3).map((item) => ({ ...item, featured: true })) }).length).toBeGreaterThan(0);
    expect(errors({ type: "items", arrangement: "stacked", items: items(2).map((item) => ({ ...item, featured: true })) }).length).toBeGreaterThan(0);
  });
  it("preserves normalized all-or-none destinations and refuses unsafe links", () => {
    const linked = items(2).map((item, index) => ({ ...item, href: `/place-${index}` }));
    expect(errors({ type: "items", arrangement: "rows", items: linked })).toEqual([]);
    for (const href of ["javascript:alert(1)", "/place-0/#same"]) expect(errors({ type: "items", arrangement: "rows", items: [linked[0], { ...linked[1], href }] }).length).toBeGreaterThan(0);
    expect(errors({ type: "items", arrangement: "rows", items: [linked[0], items(2)[1]] }).length).toBeGreaterThan(0);
  });
  it("accepts actual Badge tones independently of meta and resolves every item CopyRef", () => {
    for (const tone of ["neutral", "success", "warning", "danger", "info"]) {
      const block = { type: "items", arrangement: "rows", items: items(2).map((item) => ({ ...item, meta: ref("actor"), badge: { label: ref("Live"), tone } })) };
      expect(errors(block)).toEqual([]);
      const resolved = contract.resolveSectionedViewDocument(document({ block }), resolver);
      expect(resolved.resolutions.map((entry) => entry.ref.id)).toContain("Live");
      expect(resolved.resolutions.map((entry) => entry.ref.id)).toContain("actor");
    }
    for (const tone of ["accent", "muted"]) expect(errors({ type: "items", arrangement: "rows", items: items(2).map((item) => ({ ...item, badge: { label: ref(), tone } })) }).length).toBeGreaterThan(0);
  });
  it("enforces recipe slot restrictions rather than silently discarding authored data", () => {
    for (const recipe of ["statement", "faq"]) expect(errors({ type: "items", recipe, items: items(recipe === "faq" ? 4 : 3).map((item) => ({ ...item, icon: "clock" })) }).length).toBeGreaterThan(0);
    expect(errors({ type: "items", recipe: "link-index", items: items(3) }).length).toBeGreaterThan(0);
    expect(errors({ type: "items", recipe: "specimen-stack", items: items(2) }).length).toBeGreaterThan(0);
  });
});
