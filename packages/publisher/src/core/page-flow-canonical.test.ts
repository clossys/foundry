import { describe, expect, it } from "vitest";
import { checkPageFlow, sectionWeight } from "./page-flow.js";
import { checkSectionVariety, desugarRecipe, resolveSectionedViewDocument, validateSectionedViewDocument } from "./sectioned-view.js";
import type { CopyResolution } from "@clossys/writer";
import type { SectionedViewContentBlock, SectionedViewContentSection, SectionedViewDocument, SectionedViewItemsBlock, SectionedViewMedia } from "./sectioned-view.js";
const ref = { id: "flow.heading" };
const items = (count: number, visual = false) => Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, heading: ref, description: ref, ...(visual ? { visual: part } : {}) }));
const part = { id: "fields", type: "fields" as const, label: ref, items: [{ id: "field", label: ref, value: ref }] };
const panel = { id: "panel", title: ref, parts: [part] };
const specimen: SectionedViewMedia = { type: "specimen", label: ref, panel };
const record: SectionedViewMedia = { type: "record", id: "record", head: { title: ref }, caption: ref, groups: [{ id: "group", label: ref, rows: [{ id: "row", label: ref }] }] };
const scene: SectionedViewMedia = { type: "scene", label: { id: "flow.scene-label" }, input: { template: "evidence-trail", seed: "example", sources: ["a", "b"].map((id) => ({ id, format: "pdf", title: ref, cites: "one", cite: ref })), result: { title: ref, rows: ["one", "two"].map((id) => ({ id, label: ref, value: ref })), status: { tone: "info", text: ref } } } };
const section = (fields: Partial<SectionedViewContentSection> = {}): SectionedViewContentSection => ({ id: "band", kind: "content-section", heading: ref, ...fields });
const document = (...bands: SectionedViewContentSection[]): SectionedViewDocument => ({ id: "page", sectionGroundRhythm: "view", sections: bands.map((band, i) => ({ ...band, id: `band-${i}` })) });
const resolveCopy = (value: { id: string }): CopyResolution => ({ ref: value, text: value.id === "flow.scene-label" ? "A sample view showing the source documents and their evidence for a clear result" : "Example", recordId: "flow", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: value.id });
const canonical = (block: SectionedViewItemsBlock): SectionedViewItemsBlock => { const { recipe: _recipe, ...axes } = desugarRecipe(block); return axes; };
const weightCases: [string, SectionedViewContentSection, "A" | "B" | "C", string][] = [
  ...(["stacked", "split-start", "split-end"] as const).flatMap((layout): [string, SectionedViewContentSection, "A" | "B" | "C", string][] => [
    [`${layout} record`, section({ layout, media: record }), "B", "table"],
    [`${layout} scene`, section({ layout, media: scene }), "A", "specimen"],
    [`${layout} specimen`, section({ layout, media: specimen }), layout === "stacked" ? "A" : "B", "specimen"],
  ]),
  ["stacked raw visual with eyebrow", section({ block: { type: "items", arrangement: "stacked", items: items(2, true).map((item) => ({ ...item, eyebrow: ref })) } }), "A", "specimen"],
  ...(["columns", "rows", "bento"] as const).map((arrangement): [string, SectionedViewContentSection, "A" | "B" | "C", string] => [`${arrangement} raw visual`, section({ block: { type: "items", arrangement, ...(arrangement === "columns" ? { columns: 2 } : {}), items: items(2, true) } }), "A", "grid"]),
  ["numbered text", section({ block: { type: "items", arrangement: "columns", columns: 3, order: "numbered", items: items(3) } }), "B", "sequence"],
  ["numbered visual", section({ block: { type: "items", arrangement: "columns", columns: 3, order: "numbered", items: items(3, true) } }), "A", "sequence"],
  ["statement numbered overlap", section({ block: { type: "items", arrangement: "columns", columns: 3, order: "numbered", scale: "statement", items: items(3) } }), "A", "statement"],
  ["statement connected overlap", section({ block: { type: "items", arrangement: "columns", columns: 3, order: "connected", scale: "statement", items: items(3) } }), "A", "statement"],
  ["record before visual block", section({ media: record, block: { type: "matrix", sides: ["a", "b"].map((id) => ({ id, label: ref, heading: ref, visual: panel })) } }), "B", "table"],
  ["scene before statement", section({ media: scene, block: { type: "items", recipe: "statement", items: items(3) } }), "A", "specimen"],
  ["split specimen visual Matrix", section({ layout: "split-start", media: specimen, block: { type: "matrix", sides: ["a", "b"].map((id) => ({ id, label: ref, heading: ref, visual: panel })) } }), "A", "compare"],
];
describe("canonical page-flow structure", () => {
  it.each(["split-start", "split-end"] as const)("preserves specimen fallback after structural A and disclosure on %s", (layout) => {
    const matrix = (visual = false): SectionedViewContentBlock => ({ type: "matrix", sides: ["before", "after"].map((id) => ({ id, label: ref, heading: ref, description: ref, ...(visual ? { visual: panel } : { points: [ref, ref] }) })) });
    const ordinary = section({ block: { type: "items", arrangement: "rows", order: "numbered", reveal: "disclose", items: items(4) } });
    expect(validateSectionedViewDocument(document(ordinary))).toEqual([]);
    expect(sectionWeight(ordinary)).toEqual({ weight: "B", shape: "sequence" });
    const cases: [SectionedViewContentBlock, "A" | "B" | "C", string][] = [
      [matrix(), "B", "specimen"], [matrix(true), "A", "compare"],
      [{ type: "items", arrangement: "rows", order: "numbered", reveal: "disclose", items: items(4) }, "B", "specimen"],
      [{ type: "items", recipe: "steps", items: items(3) }, "B", "specimen"],
      [{ type: "items", recipe: "steps", arrangement: "stacked", items: items(3) }, "B", "specimen"],
      [{ type: "items", recipe: "statement", items: items(3) }, "A", "statement"],
      [{ type: "items", arrangement: "columns", columns: 3, order: "numbered", items: items(3) }, "B", "specimen"],
      [{ type: "items", recipe: "steps", items: items(3, true) }, "A", "sequence"],
      [{ type: "items", arrangement: "columns", columns: 3, order: "numbered", items: items(3, true) }, "A", "sequence"],
      [{ type: "items", recipe: "faq", items: items(4) }, "C", "reference"],
    ];
    for (const [block, weight, shape] of cases) {
      const variants = block.type === "items" ? [block, canonical(block)] : [block, { ...block, recipe: "comparison" as const }];
      for (const variant of variants) {
        const band = section({ layout, media: specimen, block: variant }); const input = document(band);
        expect(validateSectionedViewDocument(input)).toEqual([]);
        expect(sectionWeight(band)).toEqual({ weight, shape });
        expect(sectionWeight(resolveSectionedViewDocument(input, resolveCopy).sections[0]!)).toEqual({ weight, shape });
      }
    }
  });

  it("distinguishes specimen record and scene media in variety", () => {
    const input = document(section({ media: specimen }), section({ media: record }), section({ media: scene }));
    expect(validateSectionedViewDocument(input)).toEqual([]);
    expect(checkSectionVariety(input).filter((finding) => finding.rule === "sectioned-view-variety-repeat")).toEqual([]);
    expect(checkSectionVariety(input).filter((finding) => finding.rule === "sectioned-view-variety-density")).toHaveLength(2);
  });
  it.each(weightCases)("derives %s from valid authored and resolved structure", (_name, band, weight, shape) => {
    const input = document(band); expect(validateSectionedViewDocument(input)).toEqual([]);
    expect(sectionWeight(band)).toEqual({ weight, shape });
    expect(sectionWeight(resolveSectionedViewDocument(input, resolveCopy).sections[0]!)).toEqual({ weight, shape });
  });
  it("gives raw recipe and resolved axes identical weights and variety warnings", () => {
    const recipes: [SectionedViewItemsBlock, "A" | "B" | "C", string][] = [
      [{ type: "items", recipe: "features", items: items(3) }, "C", "list"],
      [{ type: "items", recipe: "statement", items: items(3) }, "A", "statement"],
      [{ type: "items", recipe: "cards", items: items(2, true) }, "A", "grid"],
      [{ type: "items", recipe: "topics", items: items(2) }, "B", "list"],
      [{ type: "items", recipe: "faq", items: items(4) }, "C", "reference"],
      [{ type: "items", recipe: "steps", items: items(3, true) }, "A", "sequence"],
      [{ type: "items", recipe: "steps", arrangement: "stacked", items: items(3) }, "B", "sequence"],
      [{ type: "items", recipe: "specimen-stack", items: items(2, true) }, "A", "specimen"],
      [{ type: "items", recipe: "link-index", items: items(3).map((item, i) => ({ ...item, href: `/guide/${i}` })) }, "B", "grid"],
    ];
    for (const [recipe, weight, shape] of recipes) {
      const raw = canonical(recipe); const authored = section({ block: recipe }); const axes = section({ block: raw });
      expect(validateSectionedViewDocument(document(authored))).toEqual([]); expect(validateSectionedViewDocument(document(axes))).toEqual([]);
      expect(sectionWeight(authored)).toEqual({ weight, shape });
      expect(sectionWeight(axes)).toEqual({ weight, shape });
      expect(sectionWeight(resolveSectionedViewDocument(document(authored), resolveCopy).sections[0]!)).toEqual(sectionWeight(axes));
      expect(checkSectionVariety(document(authored, authored))).toEqual(checkSectionVariety(document(axes, axes)));
      const mixed = checkSectionVariety(document(authored, axes));
      expect(mixed.map((finding) => finding.rule)).toContain("sectioned-view-variety-repeat");
    }
  });
  it("keeps raw grouped links at flat source paths and counts each block once", () => {
    const block: SectionedViewItemsBlock = { type: "items", arrangement: "rows", items: items(4).map((item, i) => ({ ...item, href: `/guide/${i}` })), groups: [{ id: "first", label: ref, items: ["item-0", "item-1"] }, { id: "second", label: ref, items: ["item-2", "item-3"] }] };
    const input = document(section({ block }), section({ block }), section({ block }));
    input.sections.unshift({ id: "hero", kind: "hero", heading: ref });
    expect(validateSectionedViewDocument(input)).toEqual([]);
    const findings = checkPageFlow(input).filter((finding) => finding.rule.includes("link-"));
    expect(findings.filter((finding) => finding.rule.endsWith("link-groups"))).toHaveLength(1);
    expect(findings.filter((finding) => finding.rule.endsWith("link-repeat")).map((finding) => finding.path)).toEqual([1, 2].flatMap((i) => [0, 1, 2, 3].map((j) => `sections.${i + 1}.block.items.${j}.href`)));
  });
  it("uses equivalent raw and recipe row treatments including group membership", () => {
    const recipe: SectionedViewItemsBlock = { type: "items", recipe: "topics", items: items(4), groups: [{ id: "first", label: ref, items: ["item-0", "item-1"] }, { id: "second", label: ref, items: ["item-2", "item-3"] }] };
    const raw = canonical(recipe);
    expect(validateSectionedViewDocument(document(section({ block: recipe }), section({ block: raw })))).toEqual([]);
    expect(validateSectionedViewDocument(document(section({ block: raw }), section({ block: raw })))).toEqual([]);
    expect(checkSectionVariety(document(section({ block: recipe }), section({ block: raw })))).toEqual(checkSectionVariety(document(section({ block: raw }), section({ block: raw }))));
  });
});
