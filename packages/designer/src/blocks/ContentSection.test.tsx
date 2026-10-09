import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContentSection } from "./ContentSection.js";
import { FeatureGrid } from "./FeatureGrid.js";
import { MediaFigure } from "./MediaFigure.js";

describe("ContentSection", () => {
  it("renders the header group at marketing scale, the heading at the requested level", () => {
    render(<ContentSection eyebrow="Eyebrow" heading="Heading" description="Description" headingLevel={3} />);
    const heading = screen.getByRole("heading", { name: "Heading" });
    expect(heading.tagName).toBe("H3");
    expect(heading).toHaveClass("text-h1", "tablet:text-h0", "tablet-lg:text-display-m", "font-display", "leading-heading", "text-balance");
    expect(heading).not.toHaveClass("text-h2");
    expect(screen.getByText("Description")).toHaveClass("text-body-l");
    expect(screen.getByText("Description")).toHaveClass("text-body-l", "text-pretty");
  });

  it("holds the header group to the prose measure and sets one step between it and every module", () => {
    const { container } = render(
      <ContentSection heading="Heading">
        <FeatureGrid items={[{ id: "a", heading: "A" }]} />
        <MediaFigure caption="Caption">
          <div>MEDIA</div>
        </MediaFigure>
      </ContentSection>,
    );
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    const header = container.querySelector("[data-content-section-header]") as HTMLElement;
    const modules = container.querySelector("[data-content-section-modules]") as HTMLElement;
    expect(header.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
    expect(root).toHaveClass("gap-2xl", "tablet-lg:gap-3xl");
    expect(modules).toHaveClass("gap-2xl", "tablet-lg:gap-3xl", "w-full");
    expect(modules.children).toHaveLength(2);
  });

  it("lines the header group up at the start by default and centres it on request", () => {
    const { container, rerender } = render(<ContentSection heading="Heading" actions={<a href="/x">Go</a>} />);
    expect(container.querySelector("[data-content-section-header]")).toHaveClass("items-start");
    rerender(<ContentSection heading="Heading" actions={<a href="/x">Go</a>} align="center" />);
    expect(container.querySelector("[data-content-section-header]")).toHaveClass("items-center", "text-center");
    expect(screen.getByRole("link").parentElement).toHaveClass("justify-center");
  });

  it("omits the header group or the module slot when it has nothing to hold", () => {
    const { container } = render(
      <ContentSection>
        <p>Only a module</p>
      </ContentSection>,
    );
    expect(container.querySelector("[data-content-section-header]")).toBeNull();
    const bare = render(
      <ContentSection heading="Only a header">
        {null}
        {false}
      </ContentSection>,
    );
    expect(bare.container.querySelector("[data-content-section-modules]")).toBeNull();
  });

  it("takes the header ink from the ground", () => {
    render(<ContentSection ground="inverse" eyebrow="Eyebrow" heading="Heading" description="Description" />);
    expect(screen.getByRole("heading")).toHaveClass("text-ink-on-inverse");
  });
});

describe("MediaFigure", () => {
  it("puts the media straight on the ground by default and captions it underneath", () => {
    const { container } = render(
      <MediaFigure caption="Caption">
        <div data-media="">MEDIA</div>
      </MediaFigure>,
    );
    const figure = container.querySelector("figure") as HTMLElement;
    const media = figure.firstElementChild as HTMLElement;
    expect(figure.lastElementChild?.tagName).toBe("FIGCAPTION");
    expect(media.className).toBe("w-full");
    expect(`${figure.className} ${media.className}`).not.toMatch(/(^|\s)(border|rounded-\S+|shadow\S*|bg-\S+|p[xy]?-\S+)(\s|$)/);
    expect(figure.style.maxWidth).toBe("");
  });

  it("draws one hairline around the media when framed", () => {
    const { container } = render(
      <MediaFigure framed ground="sunken">
        <div>MEDIA</div>
      </MediaFigure>,
    );
    const media = container.querySelector("figure")?.firstElementChild as HTMLElement;
    expect(media).toHaveClass("rounded-control", "border", "border-line-base");
    expect(media.className).not.toMatch(/(^|\s)(shadow\S*|bg-\S+|p[xy]?-\S+)(\s|$)/);
  });

  it("runs at the content measure on request, and unframed", () => {
    const { container } = render(
      <MediaFigure measure="content" framed={false}>
        <div>MEDIA</div>
      </MediaFigure>,
    );
    const figure = container.querySelector("figure") as HTMLElement;
    expect(figure.style.maxWidth).toBe("var(--ui-width-content-max, 64rem)");
    expect(figure.firstElementChild).not.toHaveClass("border");
    expect(container.querySelector("figcaption")).toBeNull();
  });
});
