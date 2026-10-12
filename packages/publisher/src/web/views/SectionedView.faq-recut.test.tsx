// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { render, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCopyProvenance } from "../../core/output-manifest.js";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument, type SectionedViewGround, type ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";
import { assertRenderableSectionedViewDocument, renderSectionedViewSections } from "./SectionedViewContent.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.js";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";
import { LandingView } from "./LandingView.js";
import { LandingView as ServerLandingView } from "./LandingView.server.js";

const copy = { eyebrow: "Questions", heading: "Before you begin", description: "Answers supplied by the caller.", hero: "Example page", ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => [[`q${index}`, `Question ${index + 1}?`], [`a${index}`, `Answer ${index + 1}.`]]).flat()) };
const ref = (key: string) => ({ id: `example.faq.${key}` });
const registry: CopyRegistry = { id: "faq-recut", revision: "1", locale: "en", source: { kind: "consumer", reference: "test" }, entries: Object.entries(copy).map(([key, text]) => ({ id: ref(key).id, text, context: "FAQ recut fixture", status: "approved" })) };
const resolver = createCopyResolver(registry);
function authored(count = 4, layout?: "stacked" | "split", ground: SectionedViewGround = "base"): SectionedViewDocument {
  return { id: "faq-page", sections: [{ id: "questions", kind: "faq", ground, eyebrow: ref("eyebrow"), heading: ref("heading"), description: ref("description"), ...(layout === undefined ? {} : { layout }), items: Array.from({ length: count }, (_, index) => ({ id: `question-${index}`, question: ref(`q${index}`), answer: ref(`a${index}`) })) }] };
}
function canonical(document: ResolvedSectionedViewDocument): ResolvedSectionedViewDocument {
  return { ...document, sections: document.sections.map((section): ResolvedSectionedViewDocument["sections"][number] => {
    if (section.kind !== "faq") throw new Error("Expected FAQ fixture");
    return { id: section.id, kind: "content-section", ground: section.ground, eyebrow: section.eyebrow, heading: section.heading, description: section.description, size: "standard", layout: section.layout === "split" ? "split-end" : "stacked", block: { type: "items", recipe: "faq", arrangement: "rows", columns: 1, order: "none", reveal: "disclose", treatment: "rule", scale: "item", items: section.items.map(item => ({ id: item.id, heading: item.question, description: item.answer })) } };
  }) };
}
function dom(html: string) { const root = document.createElement("div"); root.innerHTML = html; return root; }
afterEach(cleanup);

describe("published FAQ shape projected onto the catalog FAQ recipe", () => {
  it.each([4, 5, 6])("preserves %i questions, answers and their original resolution evidence", count => {
    const input = authored(count), resolved = resolveSectionedViewDocument(input, resolver);
    expect(validateSectionedViewDocument(input)).toEqual([]);
    expect(resolved.sections[0]).toMatchObject({ kind: "faq", items: input.sections[0]!.kind === "faq" ? input.sections[0]!.items.map((item, index) => ({ id: item.id, question: `Question ${index + 1}?`, answer: `Answer ${index + 1}.` })) : [] });
    const entries = ["eyebrow", "heading", "description", ...Array.from({ length: count }, (_, index) => [`q${index}`, `a${index}`]).flat()].map(key => ref(key).id);
    expect(resolved.resolutions.map(entry => entry.entryId)).toEqual(entries);
    expect(collectCopyProvenance(resolved.resolutions)).toEqual([{ recordId: registry.id, revision: "1", locale: "en", source: registry.source, entryIds: [...entries].sort() }]);
    for (const View of [SectionedView, ServerSectionedView]) {
      const list = dom(renderToStaticMarkup(<View document={resolved} />)).querySelector("[data-items]"); expect(list).not.toBeNull();
      expect([...list!.querySelectorAll("[data-item-heading]")].map(node => node.textContent)).toEqual(Array.from({ length: count }, (_, index) => `Question ${index + 1}?`));
      expect([...list!.querySelectorAll("[data-item-description]")].map(node => node.textContent)).toEqual(Array.from({ length: count }, (_, index) => `Answer ${index + 1}.`));
    }
  });
  it.each(([undefined, "stacked", "split"] as const).flatMap(layout => (["base", "sunken", "inverse"] as const).map(ground => ({ layout, ground }))))("renders the actual new Index disclosure on $ground with $layout layout in both entries", ({ layout, ground }) => {
    const resolved = resolveSectionedViewDocument(authored(4, layout, ground), resolver), before = JSON.stringify(resolved);
    for (const [View, server] of [[SectionedView, false], [ServerSectionedView, true]] as const) {
      const markup = renderToStaticMarkup(<View document={resolved} />);
      expect(markup).toBe(renderToStaticMarkup(<View document={canonical(resolved)} />));
      const root = dom(markup), list = root.querySelector('[data-items]')!;
      expect(list).not.toBeNull(); expect(list.tagName).toBe("UL"); expect(list.getAttribute("aria-labelledby")).toBe("questions:heading");
      expect(list.getAttribute("data-arrangement")).toBe("rows"); expect(list.getAttribute("data-columns")).toBe("1"); expect(list.getAttribute("data-treatment")).toBe("rule");
      expect(root.querySelector("#questions h2")?.textContent).toBe(copy.heading);
      expect([...list.querySelectorAll("[data-item-heading]")].map(node => node.textContent)).toEqual(["Question 1?", "Question 2?", "Question 3?", "Question 4?"]);
      expect([...list.querySelectorAll("[data-item-description]")].map(node => node.textContent)).toEqual(["Answer 1.", "Answer 2.", "Answer 3.", "Answer 4."]);
      expect(list.querySelectorAll(server ? "details > summary" : "h3 > button")).toHaveLength(4);
      expect(root.querySelector("[data-content-section-faq]")).toBeNull();
    }
    expect(JSON.stringify(resolved)).toBe(before);
  });
  it.each([undefined, "stacked", "split"] as const)("never calls the old Faq or publishedFaq bridge for %s", layout => {
    const resolved = resolveSectionedViewDocument(authored(4, layout), resolver), Faq = vi.fn(() => null), ContentSection = vi.fn((_props: unknown) => null);
    const rendered = renderSectionedViewSections(resolved, { ...sectionedViewBlocks, Faq, ContentSection }, {});
    renderToStaticMarkup(<>{rendered.map(entry => entry.node)}</>);
    expect(Faq).not.toHaveBeenCalled(); expect(ContentSection).toHaveBeenCalledOnce();
    const props = ContentSection.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(props).not.toHaveProperty("publishedFaq"); expect(props.section).toMatchObject({ kind: "content-section", layout: layout === "split" ? "split-end" : "stacked", block: { type: "items", recipe: "faq", arrangement: "rows", columns: 1, order: "none", reveal: "disclose", treatment: "rule", scale: "item" } });
  });
  it.each([1, 3, 7])("refuses %i questions before copy resolution and either renderer", count => {
    const input = authored(count), unused = vi.fn(resolver);
    expect(validateSectionedViewDocument(input)).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-faq-count", path: "sections.0.items" })]));
    expect(() => resolveSectionedViewDocument(input, unused)).toThrow("sections.0.items"); expect(unused).not.toHaveBeenCalled();
    const valid = resolveSectionedViewDocument(authored(), resolver), section = valid.sections[0]!;
    if (section.kind !== "faq") throw new Error("Expected FAQ");
    const forged = { ...valid, sections: [{ ...section, items: Array.from({ length: count }, (_, index) => ({ ...section.items[index % 4]!, id: `forged-${index}` })) }] };
    const ContentSection = vi.fn((_props: unknown) => null), Faq = vi.fn(() => null);
    expect(() => renderSectionedViewSections(forged, { ...sectionedViewBlocks, ContentSection, Faq }, {})).toThrow("sections.0.items");
    expect(ContentSection).not.toHaveBeenCalled(); expect(Faq).not.toHaveBeenCalled();
    for (const View of [SectionedView, ServerSectionedView]) expect(() => renderToStaticMarkup(<View document={forged} />)).toThrow("sections.0.items");
  });
  it.each(["href", "recipe", "node", "answer-node", "sparse", "duplicate", "layout"])("refuses a forged %s at the closed data boundary", name => {
    const resolved = structuredClone(resolveSectionedViewDocument(authored(), resolver)), section = resolved.sections[0]!;
    if (section.kind !== "faq") throw new Error("Expected FAQ");
    const target: any = section;
    if (name === "href") target.items[0].href = "/more";
    if (name === "recipe") target.recipe = "faq";
    if (name === "node") target.items[0].question = <button>Nested control</button>;
    if (name === "answer-node") target.items[0].answer = <a href="/more">Nested link</a>;
    if (name === "sparse") delete target.items[1];
    if (name === "duplicate") target.items[1].id = target.items[0].id;
    if (name === "layout") target.layout = "grid";
    const Faq = vi.fn(() => null), ContentSection = vi.fn((_props: unknown) => null);
    expect(() => assertRenderableSectionedViewDocument(resolved)).toThrow();
    expect(() => renderSectionedViewSections(resolved, { ...sectionedViewBlocks, Faq, ContentSection }, {})).toThrow();
    expect(Faq).not.toHaveBeenCalled(); expect(ContentSection).not.toHaveBeenCalled();
  });
  it("treats caller HTML-looking copy as text, never as nested controls", () => {
    const resolved = resolveSectionedViewDocument(authored(), resolver), section = resolved.sections[0]!;
    if (section.kind !== "faq") throw new Error("Expected FAQ");
    const input = { ...resolved, sections: [{ ...section, items: section.items.map((item, index) => index ? item : { ...item, question: '<button>Question</button>', answer: '<a href="/more">Answer</a>' }) }] };
    for (const View of [SectionedView, ServerSectionedView]) { const list = dom(renderToStaticMarkup(<View document={input} />)).querySelector('[data-items]')!; expect(list.querySelectorAll("a")).toHaveLength(0); expect(list.querySelector('[data-item-heading]')?.textContent).toBe('<button>Question</button>'); expect(list.querySelector('[data-item-description]')?.textContent).toBe('<a href="/more">Answer</a>'); }
  });
  it("opens the new ordinary disclosure with keyboard focus and Enter", async () => {
    const user = userEvent.setup(); render(<SectionedView document={resolveSectionedViewDocument(authored(), resolver)} />);
    const trigger = screen.getByRole("button", { name: "Question 1?" }); await user.tab(); expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false"); await user.keyboard("{Enter}"); expect(trigger).toHaveAttribute("aria-expanded", "true"); expect(screen.getByText("Answer 1.")).toBeVisible();
  });
  it("keeps a final FAQ on base before the inverse closing action in both entries", () => {
    const resolved = resolveSectionedViewDocument(authored(4, "split", "inverse"), resolver);
    const input: ResolvedSectionedViewDocument = { ...resolved, sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: copy.hero }, ...resolved.sections] };
    for (const View of [LandingView, ServerLandingView]) {
      const root = dom(renderToStaticMarkup(<View document={input} peek={false} callToAction={{ id: "close", heading: "Continue", action: <a href="/start">Start</a> }} />));
      expect(root.querySelector("#questions")?.closest("[data-landing-ground]")?.getAttribute("data-landing-ground")).toBe("base");
      expect(root.querySelector("#close")?.getAttribute("data-landing-ground")).toBe("inverse");
      expect(root.querySelectorAll("#questions [data-items] > li")).toHaveLength(4);
      expect(input.sections[1]!.ground).toBe("inverse");
    }
  });
  it.each(["stacked", "split"] as const)("uses the same new FAQ recipe in both LandingView entries with %s", layout => {
    const resolved = resolveSectionedViewDocument(authored(4, layout), resolver);
    const input: ResolvedSectionedViewDocument = { ...resolved, sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: copy.hero }, ...resolved.sections] };
    for (const View of [LandingView, ServerLandingView]) { const root = dom(renderToStaticMarkup(<View document={input} peek={false} afterSection={{ questions: <p data-after-faq="">Caller appendix</p> }} />)); expect(root.querySelectorAll("[data-items] > li")).toHaveLength(4); expect(root.querySelector("#questions [data-after-faq]")?.textContent).toBe("Caller appendix"); expect(root.querySelector("#questions h2")?.textContent).toBe(copy.heading); expect(root.querySelector("[data-content-section-faq]")).toBeNull(); const inner = root.querySelector<HTMLElement>("#questions")!; expect(Number.parseFloat(inner.style.scrollMarginTop)).toBe(0); expect(Number.parseFloat(inner.closest<HTMLElement>("[data-landing-ground]")!.style.paddingBlock)).toBe(0); }
  });
});
