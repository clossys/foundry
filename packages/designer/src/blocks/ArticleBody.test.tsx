import { SectionFrame as S4Frame } from "./SectionFrame.js";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ArticleBody } from "./ArticleBody.js";

describe("ArticleBody", () => {
  it("renders as a real <article> element", () => {
    const { container } = render(
      <ArticleBody>
        <p>Body copy goes here.</p>
      </ArticleBody>,
    );
    expect(container.querySelector("article")).not.toBeNull();
  });

  it("renders children exactly as given, adding no wrapper around each one", () => {
    const { container } = render(
      <ArticleBody>
        <h2>Section heading text</h2>
        <p>Body copy goes here.</p>
        <ul>
          <li>List item text</li>
        </ul>
      </ArticleBody>,
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.querySelector("h2")).toHaveTextContent("Section heading text");
    expect(article.querySelector("p")).toHaveTextContent("Body copy goes here.");
    expect(article.querySelector("li")).toHaveTextContent("List item text");
  });

  it("applies its own token-backed typography classes to child elements via descendant selectors", () => {
    const { container } = render(
      <ArticleBody>
        <h2>Section heading text</h2>
        <p>Body copy goes here.</p>
      </ArticleBody>,
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.className).toContain("[&_h2]:text-h2");
    expect(article.className).toContain("[&_p]:text-body");
  });

  it("does not parse or transform its children — an unknown/custom element renders untouched", () => {
    const { container } = render(
      <ArticleBody>
        <div data-testid="custom-region">Custom content</div>
      </ArticleBody>,
    );
    expect(container.querySelector('[data-testid="custom-region"]')).toHaveTextContent("Custom content");
  });

  it("forwards className onto the outer <article>, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(
      <ArticleBody className="gap-2xl">
        <p>Body copy goes here.</p>
      </ArticleBody>,
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.className).toContain("gap-2xl");
  });

  it("forwards a consumer style prop without imposing measure (SectionFrame owns width)", () => {
    const { container } = render(
      <ArticleBody style={{ marginTop: "8px" }}>
        <p>Body copy goes here.</p>
      </ArticleBody>,
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.marginTop).toBe("8px");
    expect(article.style.maxWidth).toBe("");
  });
});

it("S4-6 retains the bare root, direct children and host identity under one external band", () => {
  let clicks = 0;
  const view = render(<ArticleBody children={<p>Host copy</p>} id="bare" dir="rtl" data-host="bare" className="gap-xl" style={{ marginTop: 7 }} onClick={() => clicks++} />);
  const root = view.container.firstElementChild as HTMLElement;
  expect(root.tagName).toBe("ARTICLE");
  expect(root).toHaveAttribute("id", "bare");
  expect(root).toHaveAttribute("dir", "rtl");
  expect(root).toHaveAttribute("data-host", "bare");
  expect(root.style.marginTop).toBe("7px");
  expect(root).toHaveClass("gap-xl");
  expect(Array.from(root.children).every(child => child.tagName === "P")).toBe(true);
  expect(root.querySelector("section,header,h1,h2")).toBeNull();
  root.click(); expect(clicks).toBe(1);
  view.rerender(<S4Frame><ArticleBody children={<p>Host copy</p>} id="bare" /></S4Frame>);
  expect(view.container.querySelectorAll("[data-designer-section-frame]")).toHaveLength(1);
  expect(view.container.querySelector("#bare")?.tagName).toBe("ARTICLE");
});
