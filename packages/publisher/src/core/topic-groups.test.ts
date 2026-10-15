import { describe, expect, it } from "vitest";
import { createCopyResolver, type CopyRef } from "@clossys/writer";
import { checkSectionVariety, resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument, type SectionedViewItemsBlock, type ResolvedSectionedViewContentSection } from "./sectioned-view.js";
import { checkPageFlow, sectionWeight } from "./page-flow.js";
const ref = (id: string): CopyRef => ({ id: `topics.${id}` });
const groups = (counts = [2, 2]) => counts.map((count, g) => ({ id: `group ${g}`, label: ref(`label-${g}`), items: Array.from({ length: count }, (_, i) => ({ id: `topic-${g}-${i}`, heading: ref("item"), description: ref("description") })) }));
const fromGroups = (value: ReturnType<typeof groups>): SectionedViewItemsBlock => ({ type: "items", recipe: "topics", items: value.flatMap((group) => group.items), groups: value.map((group) => ({ ...group, items: group.items.map((item) => item.id) })) });
const block = (counts?: number[]): SectionedViewItemsBlock => fromGroups(groups(counts));
const doc = (value: unknown, extra = {}): SectionedViewDocument => ({ id: "topics", sections: [{ id: "topics", kind: "content-section", heading: ref("heading"), block: value, ...extra }] } as SectionedViewDocument);
const rules = (value: unknown, extra = {}) => validateSectionedViewDocument(doc(value, extra)).map((f) => f.rule);
const code = (suffix: string) => `sectioned-view-content-topics-groups-${suffix}`;
const resolver = (label = "Category") => createCopyResolver({ id: "topics", locale: "en", revision: "1", source: { kind: "consumer", reference: "fixtures/topics" }, entries: ["heading", "item", "description", "footnote", "label-0", "label-1", "label-2", "label-3"].map((id) => ({ id: ref(id).id, text: id.startsWith("label-") ? label : "Short copy", context: "fixture", status: "approved" as const })) });
const linked = (counts: number[], href: (g: number, i: number) => string | undefined) => fromGroups(groups(counts).map((g, n) => ({ ...g, items: g.items.map((item, i) => ({ ...item, ...(href(n, i) === undefined ? {} : { href: href(n, i) }) })) })));
describe("topic groups contract", () => {
  it("accepts two, three and four groups with inherited icons", () => {
    for (const counts of [[2, 2], [2, 2, 2], [2, 2, 2, 2]]) expect(rules(block(counts))).toEqual([]);
    const value = groups(); value[0]!.items[0] = { ...value[0]!.items[0]!, icon: "file-text" } as typeof value[number]["items"][number];
    expect(rules(fromGroups(value))).toEqual([]);
  });
  it("requires flat items and closed id-reference groups", () => {
    for (const value of [{ type: "items", recipe: "topics" }, { ...block(), items: [] }, { ...block(), groups: null }, { ...block(), groups: [{ id: "a", label: ref("label-0"), items: [], unknown: true }] }, { ...block(), groups: [{ id: "a", items: [] }] }]) expect(rules(value).length).toBeGreaterThan(0);
  });
  it("accepts columns with row groups and refuses a columns arrangement", () => {
    for (const columns of [1, 2]) expect(rules({ ...block(), columns })).toEqual([]);
    expect(rules({ ...block(), recipe: undefined, arrangement: "columns", columns: 2 })).toContain(code("shape"));
  });
  it("refuses group count bounds and total above eight", () => {
    for (const counts of [[2], [2, 2, 2, 2, 2], [4, 3, 3]]) expect(rules(block(counts))).toContain("sectioned-view-content-count");
    expect(rules(block([1, 1]))).toContain(code("shape"));
  });
  it("keeps row groups valid in either canonical split direction", () => {
    for (const layout of ["split-start", "split-end"]) expect(rules(block(), { layout })).toEqual([]);
    expect(rules(block(), { layout: "split" })).toContain("sectioned-view-content-layout");
  });
  it("inherits closed item fields, CopyRefs, recipe slots, href and id rules", () => {
    const value = block(); const replaceItem = (extra: object) => ({ ...value, items: value.items.map((item, index) => index === 0 ? { ...item, ...extra } : item) });
    expect(rules(replaceItem({ eyebrow: ref("item") }))).toContain("recipe-slot");
    expect(rules(replaceItem({ unknown: true }))).toContain("sectioned-view-item-shape");
    expect(rules(replaceItem({ heading: "Literal" }))).toContain("sectioned-view-copy-ref-shape");
    expect(rules(replaceItem({ href: "javascript:alert(1)" }))).toContain("sectioned-view-content-item-href");
    expect(rules({ ...value, groups: [value.groups?.[0], { ...value.groups?.[1], id: value.groups?.[0]?.id }] })).toContain("sectioned-view-item-id-duplicate");
    expect(rules(replaceItem({ id: value.items[1]?.id }))).toContain("sectioned-view-item-id-duplicate");
    const spaced = { ...value, items: value.items.map((item, index) => index === 0 ? { ...item, id: "item with spaces" } : item), groups: value.groups?.map((group, index) => index === 0 ? { ...group, items: ["item with spaces", group.items[1]] } : group) };
    expect(rules(spaced)).toEqual([]);
  });
  it("validates one flat link group, including seven links across groups (M-TG3)", () => {
    expect(rules(linked([2, 2], (g, i) => g === 0 ? `/guide/${i}` : undefined))).toContain("sectioned-view-content-link-partial");
    expect(rules(linked([3, 4], (g, i) => `/guide/${g}/${i}`))).toContain("sectioned-view-content-link-count");
    expect(rules(linked([2, 2], (g, i) => i === 0 ? `/guide/${g}` : "/same/" + (g === 0 ? "#one" : "#two")))).toContain("sectioned-view-content-link-duplicate");
    expect(rules(linked([2, 2, 2], (g, i) => `/guide/${g}/${i}`))).toEqual([]);
  });
  it("resolves flat items before group labels and all block copy before footnote", () => {
    const output = resolveSectionedViewDocument(doc(block(), { footnote: { text: ref("footnote") } }), resolver());
    const b = (output.sections[0] as ResolvedSectionedViewContentSection).block;
    expect(b?.type === "items" && b.groups?.[0]?.label).toBe("Category");
    expect(output.resolutions.map((r) => r.ref.id)).toEqual(["heading", "item", "description", "item", "description", "item", "description", "item", "description", "label-0", "label-1", "footnote"].map((id) => ref(id).id));
    expect(() => resolveSectionedViewDocument(doc(block()), (r) => r.id === ref("label-1").id ? undefined : resolver()(r))).toThrow(/could not resolve/);
  });
  it("refuses resolved labels beyond 24 characters with exact text-length code", () => {
    expect(() => resolveSectionedViewDocument(doc(block()), resolver("x".repeat(24)))).not.toThrow();
    expect(() => resolveSectionedViewDocument(doc(block()), resolver("x".repeat(25)))).toThrow(code("text-length"));
    expect(() => resolveSectionedViewDocument(doc(block()), resolver("x".repeat(25)))).toThrow("25 characters");
  });
  it("warns only for unequal counts in a shared responsive row", () => {
    for (const counts of [[2, 2], [2, 2, 2, 2], [2, 2, 2]]) expect(checkSectionVariety(doc(block(counts))).map((f) => f.rule)).not.toContain(code("balance"));
    for (const counts of [[2, 3], [2, 2, 3]]) { expect(rules(block(counts))).toEqual([]); expect(checkSectionVariety(doc(block(counts))).filter((f) => f.rule === code("balance"))).toMatchObject([{ severity: "warning" }]); }
    const undersized = block([1, 2, 2, 2]);
    expect(rules(undersized)).toContain(code("shape"));
    expect(checkSectionVariety(doc(undersized)).filter((f) => f.rule === code("balance"))).toMatchObject([{ severity: "warning" }]);
  });
  it("keeps B/list weight and airy density", () => {
    expect(sectionWeight(doc(block()).sections[0]!)).toEqual({ weight: "B", shape: "list" });
    const input = doc(block()); input.sections.push({ ...input.sections[0]!, id: "second" });
    expect(checkSectionVariety(input).map((f) => f.rule)).not.toContain("sectioned-view-variety-density");
  });
  it("recognizes grouped linked items in the existing variety predicate", () => {
    const input = doc(linked([2, 2], (g, i) => `/guide/${g}/${i}`), { actions: [{ id: "next", label: ref("item"), href: "/next" }] });
    expect(checkSectionVariety(input).map((f) => f.rule)).toContain("sectioned-view-variety-link-competing");
  });
  it("counts each grouped block once and detects cross-block and footnote repeats", () => {
    const input = doc(linked([2, 2], (g, i) => `/guide/${g}/${i}`), { footnote: { text: ref("footnote"), link: { label: ref("item"), href: "/guide/0/0#note" } } });
    input.sections.push(...["second", "third"].map((id) => ({ ...doc(linked([2, 2], (g, i) => `/guide/${g}/${i}`)).sections[0]!, id })));
    input.sections.unshift({ id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") });
    const warnings = checkPageFlow(input).filter((f) => f.rule.includes("link-"));
    expect(warnings.filter((f) => f.rule.endsWith("link-groups"))).toHaveLength(1);
    expect(warnings.some((f) => f.rule.endsWith("link-repeat") && f.path.includes("footnote"))).toBe(true);
    expect(warnings.some((f) => f.rule.endsWith("link-repeat") && f.path.includes("block.items.0.href"))).toBe(true);
  });
});
