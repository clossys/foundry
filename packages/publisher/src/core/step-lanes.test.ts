import { describe, expect, it } from "vitest";
import { createCopyResolver, type CopyRef } from "@clossys/writer";
import { checkSectionVariety, resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument, type SectionedViewItemsBlock, type ResolvedSectionedViewContentSection } from "./sectioned-view.js";
import { sectionWeight } from "./page-flow.js";

const ref = (id: string): CopyRef => ({ id: id === "steps.continues" ? id : `lanes.${id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}` });
const texts: Record<string, string> = { a: "Team", b: "Service", caption: "Sample data.", endLabel: "Repeats monthly", "steps.continues": "Consumer continuation", heading: "Process", ordinal: "1", itemHeading: "Share", panel: "Panel", label: "Field", value: "Value" };
const resolver = (extra: Record<string, string> = {}) => createCopyResolver({ id: "lane-test", locale: "en", revision: "1", source: { kind: "consumer", reference: "fixtures/lanes" }, entries: Object.entries({ ...texts, ...extra }).map(([id, text]) => ({ id: ref(id).id, text, context: "fixture", status: "approved" as const })) });
const block = (sequence = "aba", visual = false): SectionedViewItemsBlock => ({ type: "items", arrangement: "stacked", order: "connected", lanes: [{ id: "a", label: ref("a") }, { id: "b", label: ref("b") }], items: [...sequence].map((lane, index) => ({ id: `step-${index}`, lane, meta: ref("ordinal"), heading: ref("itemHeading"), ...(visual ? { visual: { id: `fields-${index}`, type: "fields" as const, label: ref("panel"), items: [{ id: "field", label: ref("label"), value: ref("value") }] } } : {}) })) });
const doc = (value: unknown, extra = {}): SectionedViewDocument => ({ id: "lanes", sections: [{ id: "process", kind: "content-section", ground: "base", heading: ref("heading"), block: value, ...extra }] } as SectionedViewDocument);
const rules = (value: unknown, extra = {}) => validateSectionedViewDocument(doc(value, extra)).map((f) => f.rule);
const laneCode = (suffix: string) => `sectioned-view-content-steps-${suffix}`;

describe("step lane contract", () => {
  it("accepts three visual and five plain lanes", () => {
    expect(rules({ ...block("aba", true), caption: ref("caption"), end: "ends" })).toEqual([]);
    expect(rules({ ...block("abbaa"), end: "continues", endLabel: ref("endLabel") })).toEqual([]);
  });
  it("refuses malformed lane names with the exact lanes-shape finding", () => {
    for (const lanes of [null, [], { a: ref("a") }, { a: ref("a"), b: ref("b"), c: ref("a") }, { a: "Team", b: ref("b") }]) expect(rules({ ...block(), lanes })).toContain(laneCode("lanes-shape"));
  });
  it("refuses step lane omissions and stray lanes with exact lane finding", () => {
    expect(rules({ ...block(), items: block().items.map(({ lane: _lane, ...step }) => step) })).toContain(laneCode("lanes-shape"));
    expect(rules({ ...block(), lanes: undefined })).toContain(laneCode("lanes-shape"));
    expect(rules({ ...block(), items: block().items.map((step) => ({ ...step, lane: "c" })) })).toContain(laneCode("lanes-shape"));
  });
  it("refuses conflicting lane labels", () => expect(rules({ ...block(), items: block().items.map((step) => ({ ...step, label: ref("a") })) })).toContain("sectioned-view-item-shape"));
  it("refuses first-b and unused lane", () => { for (const sequence of ["baa", "aaa"]) expect(rules(block(sequence))).toContain(laneCode("lanes-shape")); });
  it("accepts four lanes with only the existing count advisory", () => expect(rules(block("abba"))).toEqual(["steps-count"]));
  it("accepts five visual lanes under the connected count override", () => expect(rules(block("abbaa", true))).toEqual([]));
  it("refuses split lanes and caption without a visual", () => {
    expect(rules(block(), { layout: "split-end" })).toContain(laneCode("lanes-layout"));
    expect(rules({ ...block(), caption: ref("caption") })).toContain(laneCode("caption"));
  });
  it("refuses unknown end with the inherited module-option finding", () => expect(rules({ ...block(), end: "later" })).toContain("sectioned-view-content-module-option"));
  it("resolves lane, end and caption text, travels lane and preserves provenance", () => {
    const resolved = resolveSectionedViewDocument(doc({ ...block("aba", true), endLabel: ref("endLabel"), caption: ref("caption") }), resolver());
    const b = (resolved.sections[0] as ResolvedSectionedViewContentSection).block;
    expect(b?.type === "items" && b.lanes).toEqual([{ id: "a", label: "Team" }, { id: "b", label: "Service" }]);
    expect(b?.type === "items" && b.items.map((step) => step.lane)).toEqual(["a", "b", "a"]);
    expect(b?.type === "items" && b.caption).toBe("Sample data.");
    expect(new Set(resolved.resolutions.map((r) => r.ref.id))).toEqual(new Set(["heading", "a", "b", "endLabel", "caption", "ordinal", "itemHeading", "panel", "label", "value"].map((id) => ref(id).id)));
  });
  it.each([["a", 20, "sectioned-view-content-steps-lanes-shape"], ["caption", 120, "sectioned-view-content-steps-caption"], ["endLabel", 40, "sectioned-view-content-module-option"]] as const)("refuses resolved %s beyond %i characters with %s", (id, max, code) => {
    const resolve = () => resolveSectionedViewDocument(doc({ ...block("aba", true), caption: ref("caption"), endLabel: ref("endLabel") }), resolver({ [id]: "x".repeat(max + 1) }));
    expect(resolve).toThrow(code); expect(resolve).toThrow(`${max + 1} characters`);
  });
  it("refuses missing lane copy", () => {
    expect(() => resolveSectionedViewDocument(doc({ ...block(), lanes: [{ id: "a", label: ref("absent") }, { id: "b", label: ref("b") }] }), resolver())).toThrow(/unresolved|could not resolve/);
  });
  it("resolves only new explicit continuation defaults and refuses unavailable default copy", () => {
    const input = doc({ ...block(), end: "continues" });
    const resolved = resolveSectionedViewDocument(input, resolver());
    const b = (resolved.sections[0] as ResolvedSectionedViewContentSection).block;
    expect(b?.type === "items" && b.continuesLabel).toBe("Consumer continuation");
    expect(resolved.resolutions.some((r) => r.ref.id === "steps.continues")).toBe(true);
    expect(() => resolveSectionedViewDocument(input, (r) => r.id === "steps.continues" ? undefined : resolver()(r))).toThrow(/could not resolve/);
    const ordinary = { type: "items", arrangement: "columns", order: "connected", items: block().items.map(({ lane: _lane, ...step }) => step) };
    const requested: string[] = [];
    resolveSectionedViewDocument(doc(ordinary), (r) => { requested.push(r.id); return resolver()(r); });
    expect(requested).not.toContain("steps.continues");
    expect(rules({ ...ordinary, items: [...ordinary.items, { ...ordinary.items[0]!, id: "four" }] })).toEqual(["steps-count"]);
  });
  it("warns for continuation without visible end copy", () => {
    expect(checkSectionVariety(doc({ ...block(), end: "continues" })).map((f) => f.rule)).toContain(laneCode("end-label"));
    expect(checkSectionVariety(doc(block())).map((f) => f.rule)).not.toContain(laneCode("end-label"));
  });
  it("checks sample caption text only in explicit catalog context", () => {
    const input = doc({ ...block("aba", true), caption: ref("caption") });
    const warning = laneCode("caption-sample");
    expect(checkSectionVariety(input).map((f) => f.rule)).not.toContain(warning);
    expect(checkSectionVariety(input, { catalog: true, copyResolver: resolver() }).map((f) => f.rule)).not.toContain(warning);
    for (const context of [{ catalog: true }, { catalog: true, copyResolver: resolver({ caption: "Measured results." }) }, { catalog: true, copyResolver: () => undefined }]) expect(checkSectionVariety(input, context).map((f) => f.rule)).toContain(warning);
  });
  it("keeps valid visual cards outside catalog sample-caption advice", () => {
    const items = block("aba", true).items.slice(0, 2).map(({ lane: _lane, meta: _meta, ...item }) => item);
    const cards = { type: "items", recipe: "cards", items } satisfies SectionedViewItemsBlock;
    expect(rules(cards)).toEqual([]);
    expect(checkSectionVariety(doc(cards), { catalog: true, copyResolver: resolver() }).map((f) => f.rule)).not.toContain(laneCode("caption-sample"));
    expect(rules({ ...cards, caption: ref("caption") })).toContain("sectioned-view-content-order");
  });
  it("leaves invalid recipe axes to validation in catalog context", () => {
    const items = block("aba", true).items.map(({ lane: _lane, ...item }) => item);
    const invalid = { type: "items", recipe: "steps", arrangement: "rows", order: "none", items } satisfies SectionedViewItemsBlock;
    expect(rules(invalid)).toContain("recipe-axis");
    expect(() => checkSectionVariety(doc(invalid), { catalog: true })).not.toThrow();
    expect(checkSectionVariety(doc(invalid), { catalog: true }).map((f) => f.rule)).not.toContain(laneCode("caption-sample"));
  });
  it.each(["direct", "recipe"] as const)("retains catalog sample-caption advice for %s connected visuals", (kind) => {
    const items = block("aba", true).items.map(({ lane: _lane, ...item }) => item);
    const connected: SectionedViewItemsBlock = kind === "direct"
      ? { type: "items", arrangement: "columns", order: "connected", items }
      : { type: "items", recipe: "steps", items };
    const warning = laneCode("caption-sample");
    const input = doc({ ...connected, caption: ref("caption") });
    expect(rules(connected)).toEqual([]);
    expect(rules({ ...connected, caption: ref("caption") })).toEqual([]);
    expect(checkSectionVariety(doc(connected), { catalog: true, copyResolver: resolver() }).map((f) => f.rule)).toContain(warning);
    for (const context of [
      { catalog: true, copyResolver: resolver({ caption: "Measured results." }) },
      { catalog: true, copyResolver: () => undefined },
      { catalog: true, copyResolver: () => { throw new Error("Copy unavailable"); } },
    ]) expect(checkSectionVariety(input, context).map((f) => f.rule)).toContain(warning);
    expect(checkSectionVariety(input, { catalog: true, copyResolver: resolver() }).map((f) => f.rule)).not.toContain(warning);
    expect(checkSectionVariety(input).map((f) => f.rule)).not.toContain(warning);
  });
  it("distinguishes lanes in variety and gives visuals A, plain B", () => {
    const ordinary = { type: "items", arrangement: "columns", order: "connected", items: block().items.map(({ lane: _lane, ...step }) => step) };
    const page = { ...doc(ordinary), sections: [...doc(ordinary).sections, { ...doc(block()).sections[0]!, id: "actors" }] };
    expect(checkSectionVariety(page).map((f) => f.rule)).not.toContain("sectioned-view-variety-repeat");
    expect(sectionWeight(doc(block("aba", true)).sections[0]!)).toEqual({ weight: "A", shape: "sequence" });
    expect(sectionWeight(doc(block("abbaa")).sections[0]!)).toEqual({ weight: "B", shape: "sequence" });
  });
});
