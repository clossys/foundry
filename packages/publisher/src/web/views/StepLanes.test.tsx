import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createCopyResolver } from "@clossys/writer";
import { resolveSectionedViewDocument, type SectionedViewDocument, type ResolvedSectionedViewContentSection } from "../../core/sectioned-view.js";
import { assertRenderableSectionedViewDocument } from "./SectionedViewContent.js";
import { createContentSectionBlock } from "./SectionedViewContentSection.js";

const Content = createContentSectionBlock(() => null);
const ref = (id: string) => ({ id: id === "steps.continues" ? id : `render-lanes.${id}` });
const copy = createCopyResolver({ id: "render-lanes", locale: "en", revision: "1", source: { kind: "consumer", reference: "fixtures/lanes" }, entries: Object.entries({ heading: "Handover process", a: "Team", b: "Service", step: "Share", ordinal: "1", caption: "Sample data.", end: "Repeats monthly", "steps.continues": "Consumer continuation", panel: "Panel", field: "Field", value: "Value" }).map(([id, text]) => ({ id: ref(id).id, text, context: "fixture", status: "approved" as const })) });
const section = (sequence: string, visual: boolean, withEndLabel: boolean) => {
  const input: SectionedViewDocument = { id: "lanes", sections: [{ id: "handover", kind: "content-section", ground: "sunken", heading: ref("heading"), block: { type: "ordered-step-sequence", lanes: { a: ref("a"), b: ref("b") }, end: "continues", ...(withEndLabel ? { endLabel: ref("end") } : {}), ...(visual ? { caption: ref("caption") } : {}), items: [...sequence].map((lane, i) => ({ id: `step-${i}`, ordinal: ref("ordinal"), heading: ref("step"), lane: lane as "a" | "b", ...(visual ? { visual: { id: `panel-${i}`, title: ref("panel"), parts: [{ id: "fields", type: "fields" as const, items: [{ id: "field", label: ref("field"), value: ref("value") }] }] } } : {}) })) } }] };
  return resolveSectionedViewDocument(input, copy).sections[0] as ResolvedSectionedViewContentSection;
};
describe("content section lane plumbing", () => {
  it("names the ordered list by the real SectionIntro h2, resolves actors and forwards caption/end copy", () => {
    const { container } = render(<Content section={section("aba", true, true)} />);
    const heading = container.querySelector("h2")!;
    const list = container.querySelector("ol")!;
    expect(heading.id).not.toBe("");
    expect(list).toHaveAttribute("aria-labelledby", heading.id);
    expect(heading.textContent).toBe("Handover process");
    expect([...container.querySelectorAll("[data-step-lane-label]")].map((p) => p.textContent)).toEqual(["Team", "Service", "Team"]);
    expect(container.querySelector("[data-step-end-label]")).toHaveTextContent("Repeats monthly");
    expect(container.querySelector("[data-step-caption]")).toHaveTextContent("Sample data.");
    expect(container.querySelectorAll("[data-step-visual]")).toHaveLength(3);
  });
  it("keeps two-band heading names distinct from authored section IDs", () => {
    const first = section("aba", true, true);
    const second = { ...section("abbaa", false, false), id: "handover-heading" };
    const { container } = render(<><Content section={first} /><Content section={second} /></>);
    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const headings = [...container.querySelectorAll("h2")];
    const lists = [...container.querySelectorAll("ol")];
    expect(headings.map((heading) => heading.id)).toEqual(["handover:heading", "handover-heading:heading"]);
    lists.forEach((list, i) => expect(list).toHaveAttribute("aria-labelledby", headings[i]!.id));
  });
  it("refuses forged resolved lane shapes, counts, layouts, labels and copy budgets", () => {
    const resolved = section("aba", true, true);
    if (resolved.block?.type !== "ordered-step-sequence") throw new Error("Expected steps");
    const b = resolved.block;
    const check = (block: unknown, extra = {}) => () => assertRenderableSectionedViewDocument({ id: "forged", resolutions: [copy(ref("heading"))!], sections: [{ ...resolved, block, ...extra }] });
    expect(check(b)).not.toThrow();
    for (const [value, code] of [
      [{ ...b, lanes: { a: "x".repeat(21), b: "Service" } }, "lanes-shape"],
      [{ ...b, lanes: { a: "Team", b: "Service", c: "Other" } }, "lanes-shape"],
      [{ ...b, caption: "x".repeat(121) }, "caption"],
      [{ ...b, items: b.items.map((step) => ({ ...step, lane: "b" })) }, "lane-use"],
      [{ ...b, items: b.items.slice(0, 2) }, "lanes-count"],
      [{ ...b, items: [...b.items, { ...b.items[0]!, id: "four" }] }, "lanes-count"],
      [{ ...b, items: [...b.items, ...b.items] }, "lanes-count"],
      [{ ...b, items: b.items.map((step) => ({ ...step, label: "Other" })) }, "lane-label"],
    ] as const) expect(check(value)).toThrow(`sectioned-view-content-steps-${code}`);
    expect(check({ ...b, endLabel: "x".repeat(41) })).toThrow("sectioned-view-content-module-option");
    expect(check(b, { layout: "split" })).toThrow("sectioned-view-content-steps-lanes-layout");
  });
  it("renders five plain lanes at desktop and resolved consumer continuation copy hidden", () => {
    const { container } = render(<Content section={section("abbaa", false, false)} />);
    expect(container.querySelector("ol")).toHaveClass("desktop:grid-cols-5");
    expect(container.querySelector("[data-step-end-label]")).toHaveTextContent("Consumer continuation");
    expect(container.querySelector("[data-step-end-label]")).toHaveClass("sr-only");
    expect(container.querySelectorAll("[data-step-connector]")).toHaveLength(5);
  });
});
