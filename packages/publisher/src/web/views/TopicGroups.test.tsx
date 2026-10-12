// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createCopyResolver } from "@clossys/writer";
import { resolveSectionedViewDocument, type SectionedViewDocument, type ResolvedSectionedViewContentSection } from "../../core/sectioned-view.js";
import { createContentSectionBlock } from "./SectionedViewContentSection.js";
import { assertRenderableSectionedViewDocument } from "./SectionedViewContent.js";
const Content = createContentSectionBlock(() => null);
const ref = (id: string) => ({ id: `topic-render.${id}` });
const copy = createCopyResolver({ id: "topic-render", locale: "en", revision: "1", source: { kind: "consumer", reference: "fixtures/topics" }, entries: Object.entries({ heading: "Coverage", label: "Category", topic: "A topic", description: "One line." }).map(([id, text]) => ({ id: ref(id).id, text, context: "fixture", status: "approved" as const })) });
const input: SectionedViewDocument = { id: "topics", sections: [{ id: "topics", kind: "content-section", ground: "inverse", heading: ref("heading"), block: { type: "items", arrangement: "rows", columns: 2, order: "none", reveal: "all", treatment: "rule", emphasis: "item", items: [0, 1].flatMap((g) => [0, 1].map((i) => ({ id: `i-${g}-${i}`, heading: ref("topic"), description: ref("description"), icon: "file-text", href: `/topics/${g}/${i}` }))), groups: [0, 1].map((g) => ({ id: `g ${g}`, label: ref("label"), items: [0, 1].map((i) => `i-${g}-${i}`) })) } }] };
describe("content section topic group plumbing", () => {
  it("renders locally labelled groups, item headings, inherited icons and whole-row links on ground", () => {
    const resolved = resolveSectionedViewDocument(input, copy);
    expect(() => assertRenderableSectionedViewDocument(resolved)).not.toThrow();
    const first=resolved.sections[0];if(first?.kind!=="content-section")throw new Error("Expected content section");
    const { container } = render(<Content section={first} />);
    expect(container.querySelectorAll("h3")).toHaveLength(4);
    expect(container.querySelectorAll("[data-item-heading] > a[data-card-link]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-item] > span[aria-hidden=true]")).toHaveLength(4);
    expect(container.querySelector("[role=group] > p")).toHaveClass("text-ink-on-inverse-muted");
    const groups = [...container.querySelectorAll("[role=group]")];
    expect(groups).toHaveLength(2);
    groups.forEach((group, index) => {
      const label = group.querySelector("p")!;
      expect(group).toHaveAttribute("aria-labelledby", label.id);
      expect(container.querySelectorAll(`[id="${label.id}"]`)).toHaveLength(1);
      expect(label.textContent).toBe("Category");
      expect([...group.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([`/topics/${index}/0`, `/topics/${index}/1`]);
    });
  });
  it("refuses forged resolved group columns, bounds, label length, ids, links and split", () => {
    const resolved = resolveSectionedViewDocument(input, copy); const section = resolved.sections[0];if(section?.kind!=="content-section")throw new Error("Expected content section");
    if (section.block?.type !== "items" || !section.block.groups) throw new Error("Expected groups");
    const b = section.block;
    const check = (block: unknown, extra = {}) => () => assertRenderableSectionedViewDocument({ ...resolved, sections: [{ ...section, block, ...extra }] });
    expect(check({ ...b, columns: 3 })).toThrow(/sections\.0\.block\.columns/);
    expect(check({ ...b, columns: 1 })).not.toThrow();
    expect(check(b, { layout: "split-end" })).not.toThrow();
    expect(check({ ...b, items: [] })).toThrow(/sections\.0\.block\.items.*must be a non-empty array/);
    expect(check({ ...b, groups: [{ ...b.groups[0],items:b.items.map(item=>item.id) }] })).toThrow(/sections\.0\.block\.groups.*must hold 2-4 items; it holds 1/);
    expect(check({ ...b, groups: b.groups.map((g) => ({ ...g, label: "x".repeat(25) })) })).toThrow(/groups\.0\.label holds at most 24/);
    expect(check({ ...b, groups: [b.groups[0], { ...b.groups[1], id: b.groups[0]!.id }] })).toThrow(/duplicates/);
    expect(check({ ...b, groups: [b.groups[0], { ...b.groups[1], items: [b.groups[0]!.items[0], b.groups[1]!.items[1]] }] })).toThrow(/partition/);
    expect(check({ ...b, items: b.items.map((item) => ({ ...item, href: "/same" })) })).toThrow(/sections\.0\.block\.items.*links "\/same" more than once/);
    expect(check({...b,groups:[{...b.groups[0],items:b.groups[0]!.items.slice(0,1)},b.groups[1]]})).toThrow(/groups\.0\.items.*A group needs two to four item ids/);
    expect(check({...b,items:b.items.map((item,index)=>({...item,id:index===1?b.items[0]!.id:item.id}))})).toThrow(/items\.1\.id.*duplicates/);
    expect(check(b, { layout: "split" })).toThrow(/sections\.0\.layout/);
  });
});
