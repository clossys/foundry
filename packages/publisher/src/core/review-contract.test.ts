import { describe, expect, it } from "vitest";
import * as contract from "./sectioned-view.js";
import type { SectionedViewDocument } from "./sectioned-view.js";
const ref = (id = "copy") => ({ id });
const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, heading: ref(), description: ref() }));
const findings = (fields: Record<string, unknown>) => contract.validateSectionedViewDocument({ id: "page", sections: [{ id: "band", kind: "content-section", heading: ref(), ...fields }] } as SectionedViewDocument);
const errors = (block: unknown) => findings({ block }).filter((entry) => entry.severity === "error");
const part = { id: "fields", type: "fields", items: [{ id: "field", label: ref(), value: ref() }] };
const panel = { id: "panel", title: ref(), parts: [part] };
const sides = ["before", "after"].map((id) => ({ id, label: ref(), heading: ref() }));
describe("reviewed canonical contract boundaries", () => {
  it("reports only the first sparse hole", () => {
    expect(findings({ block: { type: "items", arrangement: "rows", items: new Array(8) } }).filter((entry) => entry.rule === "sectioned-view-array-hole")).toHaveLength(1);
  });
  it("bounds findings for a sparse length two million", () => {
    let calls = 0;
    const sparse = new Array(2_000_000);
    Object.defineProperty(sparse, 1_000_000, { enumerable: true, get() { calls++; throw new Error("must not read sparse getter"); } });
    const result = findings({ block: { type: "items", arrangement: "rows", items: sparse } });
    expect(calls).toBe(0);
    expect(result.filter((entry) => entry.rule === "sectioned-view-array-hole")).toHaveLength(1);
    expect(result.length).toBeLessThan(5);
  });
  it("exports all shared shape/count bounds", () => {
    expect(contract.SECTIONED_VIEW_CONTENT_CONTRACT.counts).toMatchObject({ columns: [2, 6], groups: [2, 4], groupItems: [2, 4], laneDefinitions: 2, matrix: 2, points: [2, 4] });
  });
  it("refuses five plain stacked items and seven disclosed items", () => {
    expect(errors({ type: "items", arrangement: "stacked", items: items(5) })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-count" }));
    expect(errors({ type: "items", arrangement: "rows", reveal: "disclose", items: items(7) })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-count" }));
  });
  it.each([4, 6])("accepts %i disclosed descriptions", (count) => {
    expect(errors({ type: "items", arrangement: "rows", reveal: "disclose", items: items(count) })).toEqual([]);
    expect(errors({ type: "items", recipe: "faq", items: items(count) })).toEqual([]);
  });
  it.each([2, 4])("accepts %i plain stacked items", (count) => {
    expect(errors({ type: "items", arrangement: "stacked", items: items(count) })).toEqual([]);
  });
  it.each([["stacked", "all", 1], ["rows", "disclose", 3]])("refuses the lower %s/%s boundary %i", (arrangement, reveal, count) => {
    expect(errors({ type: "items", arrangement, reveal, items: items(Number(count)) })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-count" }));
  });
  it.each([undefined, "faq"])("requires a description on every disclosed item for %s", (recipe) => {
    const entries = items(4); const { description: _description, ...headingOnly } = entries[2]!;
    expect(errors({ type: "items", arrangement: "rows", reveal: "disclose", ...(recipe === undefined ? {} : { recipe }), items: [...entries.slice(0, 2), headingOnly, entries[3]] })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-disclosure", path: "sections.0.block.items.2" }));
  });
  it.each([["href", undefined], ["visual", undefined], ["href", "faq"], ["visual", "faq"]])("refuses disclosed %s for %s", (slot, recipe) => {
    expect(errors({ type: "items", arrangement: "rows", reveal: "disclose", ...(recipe === undefined ? {} : { recipe }), items: items(4).map((item, index) => index === 2 ? { ...item, [slot!]: slot === "href" ? "/next" : part } : item) })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-disclosure" }));
  });
  it("refuses a featured statement item", () => {
    expect(errors({ type: "items", arrangement: "columns", columns: 3, scale: "statement", items: items(3).map((item, index) => ({ ...item, ...(index === 1 ? { featured: true } : {}) })) })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-item-shape" }));
  });
  it("refuses an unknown lane only in a later item", () => {
    const block = { type: "items", recipe: "steps", arrangement: "stacked", lanes: [{ id: "first", label: ref() }, { id: "second", label: ref() }], items: items(3).map((item, index) => ({ ...item, lane: index === 0 ? "first" : index === 1 ? "second" : "foreign" })) };
    expect(errors(block)).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-steps-lanes-shape" }));
  });
  it("bounds the previous meter marker by scaleMax", () => {
    const meter = { id: "meter", type: "meter", label: ref(), value: 40, scaleMax: 100, tone: "info", valueText: ref(), previousText: ref() };
    expect(findings({ media: { type: "specimen", label: ref(), panel: { ...panel, parts: [{ ...meter, previous: 101 }] } } })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-specimen-number", path: "sections.0.media.panel.parts.0.previous" }));
    expect(findings({ media: { type: "specimen", label: ref(), panel: { ...panel, parts: [{ ...meter, previous: 100 }] } } }).filter((entry) => entry.severity === "error")).toEqual([]);
    expect(findings({ media: { type: "specimen", label: ref(), panel: { ...panel, parts: [{ ...meter, previous: 100, value: 140, limit: 150 }] } } }).filter((entry) => entry.severity === "error")).toEqual([]);
  });
  it.each([
    ["raw", "sectioned-view-badge-shape", ""],
    [{}, "sectioned-view-badge-shape", ""],
    [{ label: "raw" }, "sectioned-view-copy-ref-shape", ".label"],
    [{ label: ref(), tone: "accent" }, "sectioned-view-badge-tone", ".tone"],
  ])("refuses an invalid panel badge %j", (badge, rule, suffix) => {
    expect(findings({ media: { type: "specimen", label: ref(), panel: { ...panel, badge } } })).toContainEqual(expect.objectContaining({ rule, path: `sections.0.media.panel.badge${suffix}` }));
  });
  it("fixes features emphasis to item", () => {
    expect(errors({ type: "items", recipe: "features", scale: "statement", items: items(3) })).toContainEqual(expect.objectContaining({ rule: "recipe-axis" }));
  });
  it("deep-freezes every recipe object and nested constraints", () => {
    for (const recipe of Object.values(contract.SECTIONED_VIEW_ITEM_RECIPES)) {
      expect(Object.isFrozen(recipe)).toBe(true);
      for (const value of Object.values(recipe)) if (value !== null && typeof value === "object") expect(Object.isFrozen(value)).toBe(true);
    }
  });
  it.each(["points", "visual", "description+points", "description+visual"])("supports matrix form %s", (form) => {
    const block = { type: "matrix", sides: sides.map((side) => ({ ...side, ...(form.includes("description") ? { description: ref() } : {}), ...(form.includes("points") ? { points: [ref(), ref()] } : {}), ...(form.includes("visual") ? { visual: panel } : {}) })) };
    expect(errors(block)).toEqual([]);
  });
  it("refuses empty matrix forms and points combined with visual", () => {
    for (const extra of [{}, { description: ref() }, { points: [ref(), ref()], visual: panel }, { description: ref(), points: [ref(), ref()], visual: panel }]) expect(errors({ type: "matrix", sides: sides.map((side) => ({ ...side, ...extra })) })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-matrix-form" }));
  });
  it("compares the primary visual/points form before optional description", () => {
    for (const extra of [{ points: [ref(), ref()] }, { visual: panel }]) expect(errors({ type: "matrix", sides: [{ ...sides[0], ...extra, description: ref() }, { ...sides[1], ...extra }] })).toEqual([]);
    for (const extra of [{ points: [ref(), ref()] }, { visual: panel }]) expect(errors({ type: "matrix", sides: [{ ...sides[0], description: ref(), ...extra }, { ...sides[1], description: ref() }] })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-matrix-form" }));
    expect(errors({ type: "matrix", sides: [{ ...sides[0], description: ref(), points: [ref(), ref()] }, { ...sides[1], description: ref(), visual: panel }] })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-matrix-form" }));
    expect(errors({ type: "matrix", sides: [{ ...sides[0], description: ref(), points: [ref(), ref()] }, { ...sides[1], description: ref(), points: [ref(), ref(), ref()] }] })).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-matrix-form" }));
  });
});
