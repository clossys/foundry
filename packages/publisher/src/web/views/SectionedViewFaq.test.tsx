// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument } from "../../core/sectioned-view.js";
import { previewCopyResolver, previewSectionedDocument } from "../../preview/fixture-documents.js";
import { LandingView } from "./LandingView.js";
import { LandingView as ServerLandingView } from "./LandingView.server.js";
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

// Captured from the accepted FAQ recipe before adapter-only cleanup. Keep the
// generated IDs: their bytes and accessibility references belong to this proof.
const FAQ_MARKUP_SHA256 = {
  "sectioned-stacked": ["b7eeb935c83f79f7a4c628748325ff4dacf629674b735eebcf74521f3fca72f6", "f72069c29ece305ab4d69a80dd9dd444c68babe2309991a7e8af24392e151b58"],
  "sectioned-split": ["03d015060f47406c2de6c13c04030aab2630b265735da8c67c20c79d9c5d45a5", "f5c76a0ed7e21d0dc5d49a35b1bd664bbefcea9040886a27fd2b92e4991f804b"],
  "landing-stacked": ["b2bcac8358dca7d9a7e6572e0b9368be58d4e5cf7416a14af83de5e4b4d96461", "13210d8e1ed0c1ec75cdfb69b77be17f4aa84b786dc71f59fc09055650f8f838"],
  "landing-split": ["cb98ac8fb507c7e93bbf84bb26f37e2b3c9f40cbd0f7caf886d8936d999c38a9", "e445d1ac0afb7d3d2ce4e5a6b29e470e1e2bb27df05a77538ad8a43479790117"],
} as const;

// SectionFrame roots now carry their ground's primary ink; these bytes predate it.
// Require the ink on every framed root, then compare every other byte to the capture.
function withoutSectionFrameInk(html: string): string {
  for (const root of html.match(/data-designer-section-frame="" class="[^"]*"/g) ?? []) {
    expect(root).toMatch(/[" ]text-ink-(?:primary|on-inverse)[ "]/);
  }
  return html.replace(/(data-designer-section-frame="" class="(?:[^" ]+ )*?)text-ink-(?:primary|on-inverse) ?/g, "$1");
}

describe("published FAQ uses the Index disclosure recipe", () => {
  afterEach(cleanup);

  it("renders HTML-looking question and answer copy as text in both entries", () => {
    const question = '<a href="/example">Question?</a>';
    const answer = '<button type="button">Answer.</button>';
    const htmlResolver = createCopyResolver({
      ...registry,
      entries: registry.entries.map(entry => ({
        ...entry,
        text: entry.id === ref("question-0").id ? question : entry.id === ref("answer-0").id ? answer : entry.text,
      })),
    });
    const resolved = resolveSectionedViewDocument(authored(4), htmlResolver);
    for (const [View, selector] of [[SectionedView, "button"], [ServerSectionedView, "summary"]] as const) {
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(<View document={resolved} />);
      const row = root.querySelector("#questions [data-items] li")!;
      const trigger = row.querySelector(selector)!;
      expect(trigger.textContent).toBe(question);
      expect(row.textContent).toContain(answer);
      expect(trigger.querySelector("a, button")).toBeNull();
      expect(row.querySelectorAll("a, button")).toHaveLength(selector === "button" ? 1 : 0);
      expect(root.innerHTML).toContain("&lt;button");
    }
  });

  it("focuses the first disclosure with Tab and opens its answer with Enter", async () => {
    const user = userEvent.setup();
    const resolved = resolveSectionedViewDocument(authored(4), resolver);
    render(<SectionedView document={resolved} />);
    const trigger = screen.getByRole("button", { name: copy["question-0"] });
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(copy["answer-0"])).toBeVisible();
  });

  it("puts a final inverse FAQ on base before an inverse closing action in both landing entries", () => {
    const faq = resolveSectionedViewDocument(authored(4), resolver);
    const hero = resolveSectionedViewDocument({ id: "faq-intro", sections: [{ id: "intro", kind: "hero", ground: "base", heading: ref("heading") }] }, resolver);
    expect(faq.sections[0]!.ground).toBe("inverse");
    for (const View of [LandingView, ServerLandingView]) {
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(<View document={hero} trailing={[faq]} callToAction={{
        id: "close", heading: "Closing action", action: <a href="/go">Continue</a>,
      }} />);
      expect(root.querySelector("#questions")?.closest("[data-landing-ground]")?.getAttribute("data-landing-ground")).toBe("base");
      expect(root.querySelector("#close")?.getAttribute("data-landing-ground")).toBe("inverse");
    }
  });

  it.each(["stacked", "split"] as const)("pins FAQ recipe markup bytes for %s in both views and entries", layout => {
    const resolved = resolveSectionedViewDocument(authored(4, layout), resolver);
    const hero = resolveSectionedViewDocument({ id: "faq-intro", sections: [{ id: "intro", kind: "hero", ground: "base", heading: ref("heading") }] }, resolver);
    const afterSection = { questions: <p>After the questions.</p> };
    for (const [entry, [Sectioned, Landing]] of ([
      [SectionedView, LandingView],
      [ServerSectionedView, ServerLandingView],
    ] as const).entries()) {
      const markup = {
        sectioned: renderToStaticMarkup(<Sectioned document={resolved} />, { identifierPrefix: "faq-proof-" }),
        landing: renderToStaticMarkup(<Landing document={hero} trailing={[resolved]} afterSection={afterSection} />, { identifierPrefix: "faq-proof-" }),
      };
      for (const view of ["sectioned", "landing"] as const) {
        const hash = createHash("sha256").update(withoutSectionFrameInk(markup[view])).digest("hex");
        expect.soft(hash, `${view}-${layout} entry ${entry}: ${hash}`).toBe(FAQ_MARKUP_SHA256[`${view}-${layout}`][entry]);
      }
    }
  });

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
