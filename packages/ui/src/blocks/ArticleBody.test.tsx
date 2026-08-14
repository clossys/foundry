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

  it("forwards a consumer style prop, merged with the internal max-width", () => {
    const { container } = render(
      <ArticleBody style={{ marginTop: "8px" }}>
        <p>Body copy goes here.</p>
      </ArticleBody>,
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.marginTop).toBe("8px");
    expect(article.style.maxWidth).toBeTruthy();
  });
});
