import { createElement, type HTMLAttributes } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SemanticContentTag } from "../components/SemanticContent.js";
import { SectionFrame } from "./SectionFrame.js";
import { SectionHeader } from "./SectionHeader.js";
import { SectionIntro } from "./SectionIntro.js";

// Mark the declared part at its boundary, preserving its native semantics.
// A hand-built element in the section anatomy therefore remains unmarked.
vi.mock("../components/SemanticContent.js", () => ({
  SemanticContent: ({ as, ...props }: HTMLAttributes<HTMLElement> & { as: SemanticContentTag }) =>
    createElement(as, { ...props, "data-declared-content-part": "" }),
}));

describe("shared section anatomy parts", () => {
  it.each([
    ["band", <SectionFrame>本文</SectionFrame>],
    ["compact header", <SectionHeader eyebrow="分類" title="見出し" description="説明" stats="状態" actions="次へ" />],
    ["standard header", <SectionHeader density="standard" align="center" eyebrow="分類" title="見出し" description="説明" actions="次へ" />],
    ["display header", <SectionHeader density="display" eyebrow="分類" title="見出し" description="説明" actions="次へ" />],
    ["intro", <SectionIntro eyebrow="分類" heading="見出し" description="説明" actions="次へ" />],
  ])("composes every %s element through its declared content part", (_name, content) => {
    const { container } = render(content);
    const elements = Array.from(container.querySelectorAll("*"));
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.filter(element => !element.hasAttribute("data-declared-content-part"))).toEqual([]);
  });

  it.each(["compact", "standard", "display"] as const)("keeps a level 1 %s header in its declared content part", density => {
    const { container, getAllByRole, getByRole } = render(
      <SectionHeader level={1} density={density} eyebrow="分類" title="見出し" description="説明" stats="状態" actions="次へ" />,
    );
    const heading = getByRole("heading", { level: 1, name: "見出し" });
    expect(heading.tagName).toBe("H1");
    expect(heading).toHaveAttribute("data-declared-content-part");
    expect(getAllByRole("heading")).toHaveLength(1);
    expect(Array.from(container.querySelectorAll("*"))
      .filter(element => !element.hasAttribute("data-declared-content-part"))).toEqual([]);
  });

  it.each([
    ["band", <SectionFrame />],
    ["header", <SectionHeader />],
    ["intro", <SectionIntro />],
  ])("has no default copy or control in the %s", (_name, content) => {
    const { container } = render(content);
    expect(container.textContent).toBe("");
    expect(container.querySelector("a,button,input")).toBeNull();
    expect(container.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
  });
});
