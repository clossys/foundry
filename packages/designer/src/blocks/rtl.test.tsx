import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArticleBody } from "./ArticleBody.js";
import { SearchField } from "../atoms/SearchField.js";
import { Chip } from "../atoms/Chip.js";
import { Toolbar } from "./Toolbar.js";

describe("blocks and atoms RTL logical-direction utilities (#951)", () => {
  it("places SearchField's clear control at inline-end under dir=rtl", () => {
    render(
      <div dir="rtl">
        <SearchField label="Search" value="query" onChange={() => {}} />
      </div>,
    );
    const button = screen.getByRole("button");
    expect(button.className).toContain("end-sm");
    expect(button.className).not.toContain("right-sm");
  });

  it("uses logical padding on Chip remove affordance", () => {
    render(
      <div dir="rtl">
        <Chip onRemove={() => {}} removeLabel="Remove">Tag</Chip>
      </div>,
    );
    const chip = screen.getByText("Tag").closest("span.inline-flex") as HTMLElement;
    expect(chip.className).toContain("ps-sm");
    expect(chip.className).toContain("pe-xs");
    expect(chip.className).not.toMatch(/\bpl-/);
    expect(chip.className).not.toMatch(/\bpr-/);
  });

  it("pushes Toolbar trailing actions to inline-end with ms-auto", () => {
    render(
      <div dir="rtl">
        <Toolbar trailing={<span data-testid="trail">Trail</span>} />
      </div>,
    );
    const trail = screen.getByTestId("trail").closest("div.ms-auto") as HTMLElement;
    expect(trail.className).toContain("ms-auto");
    expect(trail.className).not.toContain("ml-auto");
  });

  it("styles ArticleBody lists with padding-inline-start, not padding-left", () => {
    const { container } = render(
      <div dir="rtl">
        <ArticleBody>
          <ul>
            <li>Item</li>
          </ul>
        </ArticleBody>
      </div>,
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.className).toContain("[&_ul]:ps-lg");
    expect(article.className).not.toContain("[&_ul]:pl-lg");
  });
});
