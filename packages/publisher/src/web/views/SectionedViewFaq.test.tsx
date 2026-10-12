// @vitest-environment jsdom
import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument } from "../../core/sectioned-view.js";
import { previewCopyResolver, previewSectionedDocument } from "../../preview/fixture-documents.js";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";

vi.mock("@clossys/designer/blocks", async importOriginal => ({
  ...await importOriginal<object>(),
  Faq: () => { throw new Error("Old Faq rendered"); },
}));
vi.mock("@clossys/designer/blocks/server", async importOriginal => ({
  ...await importOriginal<object>(),
  Faq: () => { throw new Error("Old Faq rendered"); },
}));

const copy = {
  eyebrow: "Questions",
  heading: "Before you start",
  description: "Answers about the content workflow.",
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
    [`question-${index}`, `Question ${index + 1}?`],
    [`answer-${index}`, `Answer ${index + 1}.`],
  ]).flat()),
};
const ref = (key: string) => ({ id: `faq-test.${key}` });
const registry: CopyRegistry = {
  id: "faq-test", locale: "en", revision: "1",
  source: { kind: "consumer", reference: "fixture" },
  entries: Object.entries(copy).map(([key, text]) => ({ id: ref(key).id, text, context: "FAQ rendering fixture", status: "approved" })),
};
const resolver = createCopyResolver(registry);
function authored(count: number, layout?: "stacked" | "split"): SectionedViewDocument {
  return {
    id: "faq-test",
    sections: [{
      id: "questions", kind: "faq", ground: "inverse", layout,
      eyebrow: ref("eyebrow"), heading: ref("heading"), description: ref("description"),
      items: Array.from({ length: count }, (_, index) => ({ id: `q-${index}`, question: ref(`question-${index}`), answer: ref(`answer-${index}`) })),
    }],
  };
}

describe("published FAQ uses the Index disclosure recipe", () => {
  it.each([undefined, "stacked", "split"] as const)("renders layout %s through Items in both entries and retains copy provenance", layout => {
    for (const count of [4, 6]) {
      const input = authored(count, layout);
      expect(validateSectionedViewDocument(input)).toEqual([]);
      const resolved = resolveSectionedViewDocument(input, resolver);
      const before = JSON.stringify(resolved);
      const resolutions = resolved.resolutions;
      const sources = resolutions.map(entry => entry.source);
      expect(resolutions.map(entry => entry.ref.id)).toEqual([
        ref("eyebrow").id, ref("heading").id, ref("description").id,
        ...Array.from({ length: count }).flatMap((_, index) => [ref(`question-${index}`).id, ref(`answer-${index}`).id]),
      ]);
      for (const [View, server] of [[SectionedView, false], [ServerSectionedView, true]] as const) {
        const root = document.createElement("div");
        root.innerHTML = renderToStaticMarkup(<View document={resolved} />);
        const section = root.querySelector("#questions")!;
        expect(section.matches("[data-content-section]")).toBe(true);
        expect(section.getAttribute("data-layout")).toBe(layout === "split" ? "split-end" : null);
        expect(section.className).toContain("bg-surface-inverse");
        const list = section.querySelector("[data-items]")!;
        expect(list.getAttribute("data-arrangement")).toBe("rows");
        expect(list.getAttribute("data-columns")).toBe("1");
        expect(list.getAttribute("data-treatment")).toBe("rule");
        expect(list.querySelectorAll("li")).toHaveLength(count);
        expect(list.querySelectorAll(server ? "summary" : "button")).toHaveLength(count);
        expect(list.querySelectorAll(server ? "button" : "summary")).toHaveLength(0);
        expect(section.querySelector("h2")?.textContent).toBe(copy.heading);
        expect(list.querySelectorAll("h3")).toHaveLength(count);
        for (let index = 0; index < count; index++) {
          expect(list.textContent).toContain(copy[`question-${index}` as keyof typeof copy]);
          expect(list.textContent).toContain(copy[`answer-${index}` as keyof typeof copy]);
        }
      }
      expect(resolved.resolutions).toBe(resolutions);
      resolutions.forEach((entry, index) => expect(entry.source).toBe(sources[index]));
      expect(JSON.stringify(resolved)).toBe(before);
    }
  });

  it("keeps the published FAQ gallery example on the canonical path", () => {
    const resolved = resolveSectionedViewDocument(previewSectionedDocument, previewCopyResolver);
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<ServerSectionedView document={resolved} />);
    expect(root.querySelector('#faq [data-items][data-arrangement=rows][data-columns="1"]')).not.toBeNull();
    expect(root.querySelectorAll("#faq details")).toHaveLength(4);
    expect(root.querySelector("#faq")?.textContent).toContain("Because it is validated.");
  });

  it("refuses unknown authored and resolved fields before rendering", () => {
    const input = authored(4);
    const invalid = { ...input, sections: [{ ...input.sections[0], block: { type: "items" } }] };
    expect(validateSectionedViewDocument(invalid)).not.toEqual([]);
    const resolved = resolveSectionedViewDocument(input, resolver);
    for (const View of [SectionedView, ServerSectionedView]) {
      for (const section of [
        { ...resolved.sections[0], layout: "grid" },
        { ...resolved.sections[0], items: [{ id: "a", question: "Question?", answer: "Answer.", href: "/other" }] },
      ]) expect(() => renderToStaticMarkup(<View document={{ ...resolved, sections: [section] } as typeof resolved} />)).toThrow(/invalid resolved document/);
    }
  });

  it.each([0, 1, 3, 7])("refuses %i rows at authored and resolved boundaries", count => {
    const input = authored(count);
    expect(validateSectionedViewDocument(input)).toContainEqual(expect.objectContaining({ severity: "error", path: "sections.0.items" }));
    const valid = resolveSectionedViewDocument(authored(4), resolver);
    const section = valid.sections[0]!;
    if (section.kind !== "faq") throw new Error("Expected FAQ fixture");
    const invalid = { ...valid, sections: [{ ...section, items: Array.from({ length: count }, (_, index) => ({ id: `q-${index}`, question: "Question?", answer: "Answer." })) }] };
    for (const View of [SectionedView, ServerSectionedView]) {
      expect(() => renderToStaticMarkup(<View document={invalid} />)).toThrow(/invalid resolved document.*sections\.0\.items/);
    }
  });
});
