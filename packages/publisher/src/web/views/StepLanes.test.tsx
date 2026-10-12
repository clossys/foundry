// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
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
  const input: SectionedViewDocument = { id: "lanes", sections: [{ id: "handover", kind: "content-section", ground: "sunken", heading: ref("heading"), block: { type: "items", arrangement: "stacked", order: "connected", lanes: [{ id: "a", label: ref("a") }, { id: "b", label: ref("b") }], end: "continues", ...(withEndLabel ? { endLabel: ref("end") } : {}), ...(visual ? { caption: ref("caption") } : {}), items: [...sequence].map((lane, i) => ({ id: `step-${i}`, heading: ref("step"), lane, ...(visual ? { visual: { id: `panel-${i}`, type: "fields" as const, label: ref("panel"), items: [{ id: "field", label: ref("field"), value: ref("value") }] } } : {}) })) } }] };
  const resolved=resolveSectionedViewDocument(input, copy).sections[0]; if(resolved?.kind!=="content-section")throw new Error("Expected content section"); return resolved;
};
describe("content section lane plumbing", () => {
  it("names the ordered list by the real SectionIntro h2, resolves actors and forwards caption/end copy", () => {
    const { container } = render(<Content section={section("aba", true, true)} />);
    const heading = container.querySelector("h2")!;
    const list = container.querySelector("ol")!;
    expect(heading.id).not.toBe("");
    expect(list).toHaveAttribute("aria-labelledby", heading.id);
    expect(heading.textContent).toBe("Handover process");
    expect([...container.querySelectorAll("[data-item-lane-label]")].map((p) => p.textContent)).toEqual(["Team", "Service", "Team"]);
    expect(container.querySelector("[data-item-end-label]")).toHaveTextContent("Repeats monthly");
    expect(container.querySelector("[data-item-caption]")).toHaveTextContent("Sample data.");
    expect(container.querySelectorAll("[data-item-visual]")).toHaveLength(3);
  });
  it("keeps two-band heading names distinct from authored section IDs", () => {
    const first = section("aba", true, true);
    const second = { ...section("abbaa", false, false), id: "handover-heading" };
    const { container } = render(<><Content section={first} /><Content section={second} /></>);
    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const headings = [...container.querySelectorAll("h2")];
    const lists = [...container.querySelectorAll("ol")];
    expect(headings).toHaveLength(2); expect(lists).toHaveLength(2);
    expect(headings.map((heading) => heading.id)).toEqual(["handover:heading", "handover-heading:heading"]);
    lists.forEach((list, i) => { expect(list).toHaveAttribute("aria-labelledby", headings[i]!.id); expect(container.querySelectorAll(`[id="${headings[i]!.id}"]`)).toHaveLength(1); });
  });
  it("refuses forged resolved lane shapes, counts, layouts, labels and copy budgets", () => {
    const resolved = section("aba", true, true);
    if (resolved.block?.type !== "items") throw new Error("Expected steps");
    const b = resolved.block;
    const check = (block: unknown, extra = {}) => () => assertRenderableSectionedViewDocument({ id: "forged", resolutions: [copy(ref("heading"))!], sections: [{ ...resolved, block, ...extra }] });
    expect(check(b)).not.toThrow();
    for (const [value, reason] of [
      [{ ...b, lanes: [{ id: "a", label: "x".repeat(21) }, { id: "b", label: "Service" }] }, /sections\.0\.block\.lanes\.0\.label holds at most 20 characters/],
      [{ ...b, lanes: [{ id: "a", label: "Team" }, { id: "b", label: "Service" }, { id: "c", label: "Other" }] }, /sections\.0\.block\.lanes.*must hold exactly 2 items; it holds 3/],
      [{ ...b, caption: "x".repeat(121) }, /sections\.0\.block\.caption holds at most 120 characters/],
      [{ ...b, items: b.items.map((step) => ({ ...step, lane: "b" })) }, /sections\.0\.block\.items.*Every step names a known lane; start in the first lane and use both lanes/],
      [{ ...b, items: b.items.slice(0, 2) }, /sections\.0\.block\.items.*must hold 3-5 items; it holds 2/],
      [{ ...b, items: [...b.items, { ...b.items[0]!, id: "four" }] }, /sections\.0\.block\.lanes.*Two lanes require stacked connected items with three or five steps/],
      [{ ...b, items: Array.from({length:6},(_,index)=>({...b.items[index%3]!,id:`six-${index}`})) }, /sections\.0\.block\.items.*must hold 3-5 items; it holds 6/],
      [{ ...b, items: b.items.map((step) => ({ ...step, label: "Other" })) }, /sections\.0\.block\.items\.0.*must be a plain item with a non-whitespace id/],
    ] as const) expect(check(value)).toThrow(reason);
    expect(check({ ...b, items:b.items.map((step,index)=>({...step,id:index===1?b.items[0]!.id:step.id})) })).toThrow(/sections\.0\.block\.items\.1\.id.*duplicates another item id/);
    expect(check({ ...b, endLabel: "x".repeat(41) })).toThrow(/sections\.0\.block\.endLabel holds at most 40 characters/);
    expect(check(b, { layout: "split-end" })).toThrow(/sections\.0\.block.*A lanes block needs a stacked frame/);
  });
  it("renders five plain lanes at desktop and resolved consumer continuation copy hidden", () => {
    const { container } = render(<Content section={section("abbaa", false, false)} />);
    expect(container.querySelector("ol")).toHaveClass("desktop:grid-cols-5");
    expect(container.querySelector("[data-item-end-label]")).toBeNull();
    expect(container.querySelector("[data-content-continuation]")).toHaveTextContent("Consumer continuation");
    expect(container.querySelector("[data-content-continuation]")).toHaveClass("sr-only");
    expect(container.querySelector("[data-content-continuation]")?.previousElementSibling?.tagName).toBe("OL");
    expect(container.querySelectorAll("[data-item-connector]")).toHaveLength(5);
  });
});
