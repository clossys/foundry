import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createCopyResolver } from "@clossys/writer";
import { resolveSectionedViewDocument, type SectionedViewDocument, type ResolvedSectionedViewContentSection } from "../../core/sectioned-view.js";
import { createContentSectionBlock } from "./SectionedViewContentSection.js";
import { assertRenderableSectionedViewDocument } from "./SectionedViewContent.js";
const Content = createContentSectionBlock(() => null);
const ref = (id: string) => ({ id: `topic-render.${id}` });
const copy = createCopyResolver({ id: "topic-render", locale: "en", revision: "1", source: { kind: "consumer", reference: "fixtures/topics" }, entries: Object.entries({ heading: "Coverage", label: "Category", topic: "A topic", description: "One line." }).map(([id, text]) => ({ id: ref(id).id, text, context: "fixture", status: "approved" as const })) });
const input: SectionedViewDocument = { id: "topics", sections: [{ id: "topics", kind: "content-section", ground: "inverse", heading: ref("heading"), block: { type: "topic-list", groups: [0, 1].map((g) => ({ id: `g ${g}`, label: ref("label"), items: [0, 1].map((i) => ({ id: `i-${g}-${i}`, heading: ref("topic"), description: ref("description"), icon: "file-text", href: `/topics/${g}/${i}` })) })) } }] };
describe("content section topic group plumbing", () => {
  it("renders resolved h3 group labels, inherited icons and whole-row links on ground", () => {
    const resolved = resolveSectionedViewDocument(input, copy);
    expect(() => assertRenderableSectionedViewDocument(resolved)).not.toThrow();
    const { container } = render(<Content section={resolved.sections[0] as ResolvedSectionedViewContentSection} />);
    expect(container.querySelectorAll("h3")).toHaveLength(2);
    expect(container.querySelectorAll("a[data-card-link]")).toHaveLength(4);
    expect(container.querySelectorAll("li > span[aria-hidden=true]")).toHaveLength(4);
    expect(container.querySelector("h3")).toHaveClass("text-ink-on-inverse-muted");
    container.querySelectorAll("[data-topic-list] > section").forEach((s) => expect(s).toHaveAttribute("aria-labelledby", s.querySelector("h3")!.id));
  });
  it("refuses forged resolved group columns, bounds, label length, ids, links and split", () => {
    const resolved = resolveSectionedViewDocument(input, copy); const section = resolved.sections[0] as ResolvedSectionedViewContentSection;
    if (section.block?.type !== "topic-list" || !section.block.groups) throw new Error("Expected groups");
    const b = section.block;
    const check = (block: unknown, extra = {}) => () => assertRenderableSectionedViewDocument({ ...resolved, sections: [{ ...section, block, ...extra }] });
    expect(check({ ...b, columns: 1 })).toThrow("sectioned-view-content-topics-groups-columns");
    expect(check({ ...b, items: [] })).toThrow("sectioned-view-content-topics-groups-shape");
    expect(check({ ...b, groups: b.groups.slice(0, 1) })).toThrow("sectioned-view-content-topics-groups-count");
    expect(check({ ...b, groups: b.groups.map((g) => ({ ...g, label: "x".repeat(25) })) })).toThrow("sectioned-view-content-topics-groups-text-length");
    expect(check({ ...b, groups: [b.groups[0], { ...b.groups[1], id: b.groups[0]!.id }] })).toThrow(/duplicates/);
    expect(check({ ...b, groups: [b.groups[0], { ...b.groups[1], items: [{ ...b.groups[1]!.items[0], id: b.groups[0]!.items[0]!.id }, b.groups[1]!.items[1]] }] })).toThrow(/duplicates/);
    expect(check({ ...b, groups: b.groups.map((g) => ({ ...g, items: g.items.map((item) => ({ ...item, href: "/same" })) })) })).toThrow(/link-duplicate|destination/);
    expect(check(b, { layout: "split" })).toThrow("sectioned-view-content-topics-groups-layout");
  });
});
