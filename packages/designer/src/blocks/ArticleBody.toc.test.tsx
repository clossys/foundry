import { renderToStaticMarkup } from "react-dom/server";
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArticleBody } from "./ArticleBody.js";
import { TableOfContents } from "./TableOfContents.js";

const TOC_ITEMS = [{ id: "intro", label: "Introduction" }, { id: "setup", label: "Setup", level: 3 as const }];
const toc = <TableOfContents label="On this page" items={TOC_ITEMS} trackCurrent={false} />;
const body = <><h2 id="intro">Introduction</h2><p>Body copy.</p><h3 id="setup">Setup</h3></>;

describe("ArticleBody toc region", () => {
  it("renders nothing extra without a toc: the article root still holds its children directly", () => {
    const html = renderToStaticMarkup(<ArticleBody>{body}</ArticleBody>);
    expect(html).toBe(renderToStaticMarkup(<ArticleBody toc={undefined}>{body}</ArticleBody>));
    expect(html).not.toContain("data-article-toc");
    expect(html).toMatch(/^<article [^>]*class="flex flex-col gap-md \[&amp;_h1\]:text-h1/);
  });

  it("lays a supplied table of contents beside the body, outside the body's typography", () => {
    const { container } = render(<ArticleBody toc={toc} className="host">{body}</ArticleBody>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("ARTICLE");
    expect(root).toHaveAttribute("data-ds-leaf", "sections.article");
    expect(root).toHaveClass("grid", "grid-cols-1", "desktop:grid-cols-4", "host");
    expect(root.className).not.toContain("[&_a]");
    const [region, prose] = Array.from(root.children) as HTMLElement[];
    expect(region).toHaveAttribute("data-article-toc", "");
    expect(within(region!).getByRole("navigation", { name: "On this page" })).toBeInTheDocument();
    expect(within(region!).getByRole("link", { name: "Setup" })).toHaveAttribute("href", "#setup");
    // The descendant typography scale applies to the body only, never to the composed navigation's links.
    expect(prose).toHaveAttribute("data-article-body", "");
    expect(prose).toHaveClass("desktop:col-span-3", "[&_a]:underline", "[&_h2]:text-h2");
    expect(region!.closest("[class*='[&_a]']")).toBeNull();
    expect(within(prose!).getByRole("heading", { level: 2, name: "Introduction" })).toHaveAttribute("id", "intro");
  });

  it("the toc prop changes the rendered structure", () => {
    expect(renderToStaticMarkup(<ArticleBody toc={toc}>{body}</ArticleBody>)).not.toBe(renderToStaticMarkup(<ArticleBody>{body}</ArticleBody>));
  });
});
