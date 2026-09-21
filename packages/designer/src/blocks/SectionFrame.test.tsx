import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArticleBody } from "./ArticleBody.js";
import { SECTION_FRAME_DATA_ATTR } from "./internal/block-vars.js";
import { SectionFrame } from "./SectionFrame.js";
import { Stat } from "./Stat.js";

describe("SectionFrame", () => {
  it("marks the outer section as a designer section frame", () => {
    const { container } = render(<SectionFrame>Content</SectionFrame>);
    const section = container.querySelector("section");
    expect(section?.hasAttribute(SECTION_FRAME_DATA_ATTR)).toBe(true);
  });

  it("applies inverse ground classes on the section root", () => {
    const { container } = render(<SectionFrame ground="inverse">Content</SectionFrame>);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.className).toContain("bg-surface-inverse");
  });

  it("constrains the inner column to the prose measure token", () => {
    const { container } = render(
      <SectionFrame measure="prose">
        <ArticleBody>
          <p>Body</p>
        </ArticleBody>
      </SectionFrame>,
    );
    const inner = container.querySelector("section > div") as HTMLElement;
    expect(inner.style.maxWidth).toContain("--ui-width-prose-max");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("is the intended parent for Stat rows on a marketing page", () => {
    render(
      <SectionFrame measure="wide">
        <Stat label="Users" value="1,024" />
      </SectionFrame>,
    );
    expect(screen.getByText("1,024")).toBeInTheDocument();
  });
});
