// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResolvedSectionedViewAction, ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";
import { SectionedView } from "./SectionedView.js";

const resolutions: ResolvedSectionedViewDocument["resolutions"] = [{ ref: { id: "page.heading" }, text: "Begin here", recordId: "page", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "page.heading" }];
const primary = { id: "start", label: "Start", href: "/start", emphasis: "primary" as const };
const secondary = { id: "read", label: "Read", href: "/guide", emphasis: "secondary" as const };
const quiet = { ...secondary, emphasis: "quiet" as const };
const documentWith = (actions: readonly ResolvedSectionedViewAction[], compact = false): ResolvedSectionedViewDocument => ({
  id: "page", resolutions, sections: [{ id: "hero", kind: "hero", heading: "Begin here", ground: "inverse", actions: [...actions], ...(compact ? { size: "compact" as const } : {}) }],
});
const dom = (markup: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
};
const size = (links: NodeListOf<HTMLAnchorElement>, expected: "md" | "lg") => {
  expect(links).toHaveLength(2);
  for (const link of links) {
    const classes = link.className.split(" ");
    expect(classes).toContain(expected === "lg" ? "text-body-l" : "text-body");
    if (expected === "md") expect(classes).not.toContain("text-body-l");
    if (link.dataset.actionEmphasis !== "quiet") expect(classes).toEqual(expect.arrayContaining(expected === "lg" ? ["px-lg", "py-md"] : ["px-md", "py-sm"]));
  }
};

describe("frame-owned uniform action group size", () => {

  it.each(["base", "sunken", "inverse"] as const)("uses md for primary and tertiary body actions on %s", ground => {
    const page: ResolvedSectionedViewDocument = { id: "page", resolutions, sections: [{ id: "body", kind: "content-section", size: "standard", layout: "stacked", heading: "Details", ground, actions: [primary, { ...secondary, emphasis: "tertiary" }] }] };
    const host = dom(renderToStaticMarkup(<SectionedView document={page} />));
    const links = host.querySelectorAll<HTMLAnchorElement>('[data-action-emphasis]');
    size(links, "md");
    expect(links[1]?.className.split(" ")).toContain(ground === "inverse" ? "bg-control-tonal-inverse" : "bg-control-tonal");
  });
});
