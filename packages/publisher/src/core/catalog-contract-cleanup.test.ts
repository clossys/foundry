import { describe, expect, it, vi } from "vitest";
import { desugarRecipe, SECTIONED_VIEW_CONTENT_CONTRACT, resolveSectionedViewDocument, validateSectionedViewDocument } from "./sectioned-view.js";

const ref = { id: "example.copy" };
const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, heading: ref, description: ref }));
const block = { type: "items", recipe: "features", items: items(3) };
const section = { id: "example", kind: "content-section", heading: ref, block };
const errors = (band: unknown) => validateSectionedViewDocument({ id: "example", sections: [band] }).filter(finding => finding.severity === "error");

describe("unreleased catalog contract cleanup", () => {
  it.each(["start", "center", undefined])("refuses authored content alignment %s", align => {
    expect(errors({ ...section, align })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-section-keys", path: "sections.0" })]));
  });
  it("refuses content compact while preserving the published compact hero", () => {
    expect(errors({ ...section, size: "compact" })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-content-size", path: "sections.0.size" })]));
    expect(errors({ id: "hero", kind: "hero", ground: "base", heading: ref, size: "compact" })).toEqual([]);
  });
  it.each([true, false, undefined])("refuses item featured even when it is %s", featured => {
    expect(errors({ ...section, block: { ...block, items: [{ ...items(3)[0], featured }, ...items(3).slice(1)] } })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-item-shape", path: "sections.0.block.items.0" })]));
  });
  it("renames the items axis without changing action emphasis", () => {
    expect(errors({ ...section, block: { ...block, emphasis: "item" } })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-content-block-shape", path: "sections.0.block" })]));
    expect(errors({ ...section, block: { type: "items", recipe: "statement", scale: "statement", items: items(3) } })).toEqual([]);
    expect(errors({ ...section, block: { ...block, scale: "unknown" } }).length).toBeGreaterThan(0);
    expect(errors({ ...section, layout: "split-start", actions: [{ id: "more", label: ref, href: "/more", emphasis: "secondary" }] })).toEqual([]);
    expect(desugarRecipe(block as any)).toMatchObject({ scale: "item" });
    expect(desugarRecipe(block as any)).not.toHaveProperty("emphasis");
    expect(() => desugarRecipe({ ...block, emphasis: undefined } as any)).toThrow(/scale/);
    expect(SECTIONED_VIEW_CONTENT_CONTRACT).toHaveProperty("scales", ["item", "statement"]);
    expect(SECTIONED_VIEW_CONTENT_CONTRACT).not.toHaveProperty("emphases");
  });
  it("refuses the retired flow recipe", () => {
    expect(errors({ ...section, block: { type: "items", recipe: "flow", items: items(3) } })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "recipe-axis" })]));
    expect(SECTIONED_VIEW_CONTENT_CONTRACT.recipes).not.toContain("flow");
  });
  it("fixes link-index to plate", () => {
    const links = { type: "items", recipe: "link-index", items: items(3).map((item, index) => ({ ...item, href: `/example-${index}` })) };
    expect(desugarRecipe(links as any)).toMatchObject({ treatment: "plate" });
    expect(() => desugarRecipe({ ...links, treatment: "plain" } as any)).toThrow(/fixes treatment/);
    expect(errors({ ...section, block: { ...links, treatment: "rule" } })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "recipe-axis" })]));
  });
  it.each([3, 4, 5])("allows %i lane steps in both connected arrangements", count => {
    for (const arrangement of ["columns", "stacked"]) {
      const steps = { type: "items", recipe: "steps", arrangement, lanes: [{ id: "first", label: ref }, { id: "second", label: ref }], items: items(count).map((item, index) => ({ ...item, lane: index % 2 === 0 ? "first" : "second" })) };
      expect(errors({ ...section, block: steps })).toEqual([]);
      expect(desugarRecipe(steps as any).arrangement).toBe(arrangement);
      if (arrangement === "stacked") expect(desugarRecipe(steps as any)).not.toHaveProperty("columns");
      else expect(desugarRecipe(steps as any).columns).toBe(3);
      expect(desugarRecipe(steps as any)).toMatchObject({ order: "connected", scale: "item" });
    }
  });
  it("refuses removed fields before asking for copy", () => {
    const copy = vi.fn(() => { throw new Error("copy must not be requested"); });
    expect(() => resolveSectionedViewDocument({ id: "example", sections: [{ ...section, align: undefined }] } as any, copy)).toThrow(/sections.0/);
    expect(copy).not.toHaveBeenCalled();
  });
  it("gives migration hints for retired frame and item fields", () => {
    expect(errors({ ...section, align: "center" }).map(finding => finding.message).join(" ")).toMatch(/Alignment is derived; remove align/);
    expect(errors({ ...section, size: "compact" }).map(finding => finding.message).join(" ")).toMatch(/use standard or display/);
    expect(errors({ ...section, block: { ...block, items: items(3).map(item => ({ ...item, featured: false })) } }).map(finding => finding.message).join(" ")).toMatch(/remove featured/);
    expect(() => desugarRecipe({ ...block, recipe: "flow" } as any)).toThrow(/use steps with arrangement: stacked/);
  });
  it.each([2, 6])("refuses %i lane steps", count => {
    const steps = { type: "items", recipe: "steps", arrangement: "stacked", lanes: [{ id: "first", label: ref }, { id: "second", label: ref }], items: items(count).map((item, index) => ({ ...item, lane: index % 2 === 0 ? "first" : "second" })) };
    expect(errors({ ...section, block: steps })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-content-count", path: "sections.0.block.items", message: `sections.0.block.items must hold 3-5 items; it holds ${count}.` })]));
  });
  it("allows comparison label omission and a description lead, retaining featured", () => {
    const matrix = { type: "matrix", recipe: "comparison", featured: "before", sides: ["before", "after"].map(id => ({ id, heading: ref, description: ref, points: [ref, ref] })) };
    expect(errors({ ...section, block: matrix })).toEqual([]);
    expect(errors({ ...section, block: { ...matrix, featured: "unknown" } }).length).toBeGreaterThan(0);
    expect(errors({ ...section, block: { ...matrix, sides: matrix.sides.map(({ points, ...side }) => side) } })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-content-matrix-form" })]));
  });
  it.each(["points", "visual"] as const)("requires both Matrix %s sides to have labels or neither", form => {
    const matrix = { type: "matrix", sides: ["before", "after"].map(id => ({ id, heading: ref, description: ref, ...(form === "points" ? { points: [ref, ref] } : { visual: { id: `${id}-panel`, title: ref, parts: [{ id: "fields", type: "fields", label: ref, items: [{ id: "value", label: ref, value: ref }] }] } }) })) };
    expect(errors({ ...section, block: matrix })).toEqual([]);
    expect(errors({ ...section, block: { ...matrix, sides: matrix.sides.map(side => ({ ...side, label: ref })) } })).toEqual([]);
    for (const labeledSide of [0, 1]) {
      const mixed = { ...matrix, sides: matrix.sides.map((side, index) => index === labeledSide ? { ...side, label: ref } : side) };
      expect(errors({ ...section, block: mixed })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-content-matrix-labels", path: "sections.0.block.sides" })]));
    }
  });
  it("refuses description as the primary Matrix body even when labels are supplied", () => {
    const matrix = { type: "matrix", sides: ["before", "after"].map(id => ({ id, label: ref, heading: ref, description: ref })) };
    expect(errors({ ...section, block: matrix })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-content-matrix-form" })]));
  });
  it.each(["end", "below", undefined])("refuses the authored specimen key side %s", side => {
    const media = { type: "specimen", label: ref, panel: { id: "panel", title: ref, parts: [{ id: "fields", type: "fields", label: ref, items: [{ id: "value", label: ref, value: ref }] }], footer: { note: ref } }, key: { label: ref, side, items: ["header", "fields", "footer"].map(target => ({ id: target, target, heading: ref, description: ref })) } };
    expect(errors({ ...section, block: undefined, media })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-specimen-key-shape", path: "sections.0.media.key" })]));
    expect(errors({ ...section, block: undefined, media }).map(finding => finding.message).join(" ")).toMatch(/Key placement is derived; remove side/);
  });
});

  it.each(["base", "sunken"])("refuses authored canonical %s while legacy grounds remain valid", ground => {
    expect(errors({ ...section, ground })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-ground", path: "sections.0.ground" })]));
    expect(errors({ id: "hero", kind: "hero", ground, heading: ref })).toEqual([]);
    expect(errors({ ...section, ground: "inverse" })).toEqual([]);
    const { ground: omitted, ...automatic } = section;
    expect(errors(automatic)).toEqual([]);
  });
  it("keeps the Item retirement hint out of Matrix-side unknown fields", () => {
    const matrix = { type: "matrix", sides: ["before", "after"].map(id => ({ id, heading: ref, points: [ref, ref], featured: false })) };
    const findings = errors({ ...section, block: matrix });
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-item-shape", path: "sections.0.block.sides.0" })]));
    expect(findings.map(finding => finding.message).join(" ")).not.toMatch(/Item featured is retired/);
    expect(errors({ ...section, block: { ...block, items: items(3).map(item => ({ ...item, featured: false })) } }).map(finding => finding.message).join(" ")).toMatch(/Item featured is retired/);
  });
