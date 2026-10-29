import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArticleBody } from "./ArticleBody.js";
import { ARTICLE_PROGRESS_CSS, articleTocCss, readingTarget } from "./ArticleReading.js";
import { TableOfContents } from "./TableOfContents.js";

const items = [{ id: "overview", label: "Overview" }, { id: "details", label: "Details" }];
describe("article reading draft", () => {
  it("renders editorial parts and bidirectional footnote links without default copy", () => {
    const view = render(<ArticleBody dropCap><p>Example copy.</p><ArticleBody.PullQuote attribution="Example attribution">Example quote.</ArticleBody.PullQuote><figure><ArticleBody.FigureCaption>Example caption.</ArticleBody.FigureCaption></figure><ArticleBody.FootnoteReference id="reference-one" noteId="note-one">1</ArticleBody.FootnoteReference><ArticleBody.Footnotes label="Notes" items={[{ id: "note-one", referenceId: "reference-one", body: "Example note.", backlink: "Return to reference" }]} /></ArticleBody>);
    expect(view.container.querySelector("blockquote")).toHaveTextContent("Example quote.");
    expect(view.container.querySelector("figcaption")).toHaveTextContent("Example caption.");
    expect(view.container.querySelector('[data-footnote-reference]')).toHaveAttribute("href", "#note-one");
    expect(view.container.querySelector('[data-footnote-backlink]')).toHaveAttribute("href", "#reference-one");
    expect(view.container.querySelector("article")?.className).toContain("first-letter");
  });
  it("keeps the initial opt-in and rejects duplicate footnote ids", () => {
    expect(renderToStaticMarkup(<ArticleBody><p>Example.</p></ArticleBody>)).not.toContain("first-letter");
    expect(() => renderToStaticMarkup(<ArticleBody.Footnotes label="Notes" items={[{id:"a",referenceId:"b",body:"One",backlink:"Back"},{id:"a",referenceId:"c",body:"Two",backlink:"Back"}]} />)).toThrow(/unique/);
  });
  it("uses CSS timelines with native anchor fallback and never installs an observer in CSS mode", () => {
    const observer = vi.fn(); vi.stubGlobal("IntersectionObserver", observer);
    try {
      const view = render(<ArticleBody toc={<TableOfContents label="Contents" items={items} trackCurrent="css" />}><section id="overview">Overview</section><section id="details">Details</section></ArticleBody>);
      expect(observer).not.toHaveBeenCalled();
      expect(view.getByRole("link", { name: "Details" })).toHaveAttribute("href", "#details");
      expect(view.container.querySelector("style")?.textContent).toContain("animation-timeline:");
      expect(view.container.querySelector("nav")).toHaveClass("desktop:sticky");
      expect(articleTocCss(items)).toContain("@supports(animation-timeline:scroll())");
    } finally { vi.unstubAllGlobals(); }
  });
  it("provides static/reduced-motion fallbacks for both motion paths", () => {
    expect(ARTICLE_PROGRESS_CSS).toMatch(/prefers-reduced-motion:reduce\)\{\[data-article-progress\]\{display:none!important;animation:none!important/);
    expect(articleTocCss(items)).toMatch(/prefers-reduced-motion:reduce\)\{\[data-reading-target\]\{animation:none!important/);
    const html = renderToStaticMarkup(<ArticleBody.Progress><span>Visual progress</span></ArticleBody.Progress>);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animation-timeline:scroll(root block)");
  });
  it("escapes arbitrary heading ids and adds no scroll listener", () => {
    const target=readingTarget('x\"</style><script>');
    expect(target.name).toMatch(/^--article-[a-f0-9-]+$/);
    expect(articleTocCss([{id:'x\"</style><script>'}])).not.toContain("<script>");
    const source=readFileSync(resolve(import.meta.dirname, "ArticleReading.tsx"), "utf8");
    expect(source).not.toMatch(/addEventListener|onScroll|requestAnimationFrame/);
  });
});
