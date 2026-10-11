// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";
import { LandingView } from "./LandingView.js";
import { RenderError } from "../../internal/errors.js";
import { planLandingViewGrounds } from "./landingViewGrounds.js";
import type { LandingViewProps } from "./LandingView.js";
import * as webEntry from "../index.js";
import * as webServerEntry from "../server.js";

// Placeholder markers only: every string is an obviously-fake sentinel.

const RESOLUTIONS: ResolvedSectionedViewDocument["resolutions"] = [
  { ref: { id: "acme.home" }, text: "HERO-SENTINEL", recordId: "acme", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "acme.home" },
];

const PAGE: ResolvedSectionedViewDocument = {
  id: "acme-page",
  resolutions: RESOLUTIONS,
  sections: [
    { id: "hero", kind: "hero", ground: "inverse", eyebrow: "EYEBROW-SENTINEL", heading: "HERO-SENTINEL", description: "LEDE-SENTINEL" },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: "FEATURES-SENTINEL", items: [{ id: "one", heading: "ONE-SENTINEL" }] },
  ],
};

const SHARED: ResolvedSectionedViewDocument = {
  id: "acme-shared",
  resolutions: RESOLUTIONS,
  sections: [{ id: "faq", kind: "faq", ground: "base", heading: "FAQ-SENTINEL", items: [{ id: "q", question: "QUESTION-SENTINEL", answer: "ANSWER-SENTINEL" }] }],
};

function dom(props: LandingViewProps): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<LandingView {...props} />);
  return host;
}

describe("pending ordered content anatomy compatibility", () => {
  it("renders a content-section band as its own anatomy: no nested section, the band paints its ground, afterSection in the text column", () => {
    const faqItems = ["q1", "q2", "q3", "q4"].map((id) => ({ id, question: `Q-${id}-SENTINEL`, answer: `A-${id}-SENTINEL` }));
    const content: ResolvedSectionedViewDocument = {
      ...SHARED,
      id: "acme-content",
      sections: [
        { id: "topics", kind: "content-section", ground: "sunken", heading: "TOPICS-SENTINEL", block: { type: "topic-list", columns: 1, items: [{ id: "a", heading: "A-SENTINEL" }, { id: "b", heading: "B-SENTINEL" }] } },
        { id: "questions", kind: "content-section", ground: "base", heading: "QUESTIONS-SENTINEL", actions: [{ id: "more", label: "MORE-SENTINEL", href: "/more" }], layout: "split", block: { type: "faq", items: faqItems } },
      ],
    };
    const root = dom({ document: PAGE, trailing: [content], afterSection: { topics: <p data-after="">AFTER</p>, questions: <p data-after="">AFTER</p> } });
    const topics = root.querySelector("#topics") as HTMLElement;
    const frame = topics.closest("[data-landing-ground]") as HTMLElement;
    expect(frame.getAttribute("data-landing-ground")).toBe("sunken");
    expect(frame.className.split(/\s+/).filter((name) => /(^|:)py-/.test(name))).toEqual(["py-4xl", "tablet-lg:py-5xl"]);
    expect(topics.closest("[data-content-section]")).toBe(topics);
    expect(topics.parentElement?.closest("[data-content-section]")).toBeNull();
    expect(topics.className).not.toContain("bg-surface-");
    expect(topics.querySelector("a")).toBeNull();
    expect((topics.querySelector("[data-content-section-modules]") as HTMLElement).lastElementChild?.hasAttribute("data-after")).toBe(true);
    const questions = root.querySelector("#questions") as HTMLElement;
    // A split keeps its actions in the text column.
    const more = questions.querySelector('[data-content-section-text] a[href="/more"]') as HTMLElement;
    expect(more.getAttribute("data-action-emphasis")).toBe("quiet");
    expect(more.className.split(" ")).toEqual(expect.arrayContaining(["text-body", "text-control-quiet", "quiet-action"]));
    expect(more.className.split(" ")).not.toContain("underline");
    expect(questions.getAttribute("data-layout")).toBe("split");
    expect(questions.querySelectorAll("[data-content-section-media] details")).toHaveLength(4);
    expect(questions.querySelector("[data-content-section-text] [data-after]")).not.toBeNull();
  });

});
