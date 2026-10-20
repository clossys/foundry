import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArticleBody } from "./ArticleBody.js";
import { SECTION_FRAME_DATA_ATTR } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
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

  it("applies each ground's primary foreground ink on the section root", () => {
    const grounds = Object.keys(SECTION_GROUND_CLASSES) as SectionGround[];
    expect(grounds.length).toBeGreaterThan(0);
    for (const ground of grounds) {
      const { container, unmount } = render(<SectionFrame ground={ground}>Content</SectionFrame>);
      const section = container.querySelector("section") as HTMLElement;
      const classes = section.className.split(/\s+/);
      expect(classes).toContain(SECTION_GROUND_CLASSES[ground].primary);
      unmount();
    }
  });

  it("gives raw children on an inverse ground the on-inverse ink, not the base ink", () => {
    const { container } = render(
      <SectionFrame ground="inverse">
        <p>Raw child copy</p>
      </SectionFrame>,
    );
    const section = container.querySelector("section") as HTMLElement;
    const classes = section.className.split(/\s+/);
    expect(classes).toContain("text-ink-on-inverse");
    expect(classes).not.toContain("text-ink-primary");
  });

  it("keeps a consumer className after the ground classes", () => {
    const { container } = render(
      <SectionFrame ground="inverse" className="consumer-class">
        Content
      </SectionFrame>,
    );
    const section = container.querySelector("section") as HTMLElement;
    const classes = section.className.split(/\s+/);
    expect(classes).toContain("text-ink-on-inverse");
    expect(classes.indexOf("consumer-class")).toBeGreaterThan(classes.indexOf("text-ink-on-inverse"));
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
