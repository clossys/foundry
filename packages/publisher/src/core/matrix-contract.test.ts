import { describe, expect, it } from "vitest";
import * as contract from "./sectioned-view.js";
import type { SectionedViewDocument } from "./sectioned-view.js";
const ref = (id = "copy") => ({ id });
const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, heading: ref(`heading-${index}`) }));
const document = (fields: Record<string, unknown>): SectionedViewDocument => ({ id: "page", sections: [{ id: "band", kind: "content-section", ground: "base", heading: ref(), ...fields }] }) as SectionedViewDocument;
const findings = (block: unknown) => contract.validateSectionedViewDocument(document({ block }));
const errors = (block: unknown) => findings(block).filter((entry) => entry.severity === "error");
const resolver = (value: { id: string }) => ({ ref: value, text: value.id === "scene-label" ? "A clear sample showing how source documents connect to the resolved result for this section" : value.id, recordId: "fixture", revision: "1", locale: "en", source: { kind: "consumer" as const, reference: "fixture" }, entryId: value.id });

describe("canonical matrix", () => {
  const sides = ["before", "after"].map((id) => ({ id, label: ref(id), heading: ref(), points: [ref("one"), ref("two")] }));
  it("accepts two equal-form sides with a known featured id and resolves their copy", () => {
    const block = { type: "matrix", recipe: "comparison", sides, featured: "after" };
    expect(errors(block)).toEqual([]);
    expect(contract.resolveSectionedViewDocument(document({ block }), resolver).resolutions.map((entry) => entry.ref.id)).toContain("after");
  });
  it("refuses missing ids/headings, duplicate/foreign ids, extra sides and mismatched forms/counts", () => {
    for (const block of [
      { type: "matrix", sides: [sides[0]] }, { type: "matrix", sides: [...sides, { ...sides[0], id: "third" }] },
      { type: "matrix", sides: [sides[0], sides[0]] }, { type: "matrix", sides, featured: "foreign" },
      { type: "matrix", sides: [sides[0], { id: "after", label: ref(), heading: ref(), description: ref() }] },
      { type: "matrix", sides: [sides[0], { ...sides[1], points: [ref(), ref(), ref()] }] },
      { type: "matrix", sides: sides.map(({ heading: _heading, ...side }) => side) },
    ]) expect(errors(block).length).toBeGreaterThan(0);
  });
  it("allows exactly one description, points or visual on each side", () => {
    const panel = { id: "panel", title: ref(), parts: [{ id: "fields", type: "fields", items: [{ id: "field", label: ref(), value: ref() }] }] };
    expect(errors({ type: "matrix", sides: sides.map(({ points: _points, ...side }) => ({ ...side, visual: panel })) })).toEqual([]);
    expect(errors({ type: "matrix", sides: sides.map((side) => ({ ...side, visual: panel })) }).length).toBeGreaterThan(0);
  });
});
