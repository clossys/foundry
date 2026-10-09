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

describe("ContentSection layouts", () => {
  it("adds a stacked visual after the text module, in the same column", () => {
    const { container } = render(
      <ContentSection heading="Heading" media={<div data-testid="visual">VISUAL</div>}>
        <p data-testid="module">Module</p>
      </ContentSection>,
    );
    const modules = container.querySelector("[data-content-section-modules]") as HTMLElement;
    expect(modules.lastElementChild).toHaveAttribute("data-content-section-media");
    expect(modules.firstElementChild).toBe(screen.getByTestId("module"));
    expect(container.querySelector("[data-content-section]")).not.toHaveAttribute("data-layout");
  });

  it("splits text 5/12 and visual 7/12 from tablet-lg, stacked below", () => {
    const { container } = render(
      <ContentSection layout="split" eyebrow="Eyebrow" heading="Heading" media={<div>VISUAL</div>}>
        <p>Module</p>
      </ContentSection>,
    );
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    expect(root).toHaveAttribute("data-layout", "split");
    expect(root).toHaveClass("grid", "grid-cols-1", "gap-y-2xl", "tablet-lg:grid-cols-12", "tablet-lg:gap-x-4xl", "tablet-lg:items-center");
    const text = container.querySelector("[data-content-section-text]") as HTMLElement;
    const media = container.querySelector("[data-content-section-media]") as HTMLElement;
    expect(text).toHaveClass("tablet-lg:col-span-5");
    expect(media).toHaveClass("tablet-lg:col-span-7", "min-w-0");
    expect(text.querySelector("[data-content-section-header]")).not.toBeNull();
    expect(text.querySelector("[data-content-section-modules]")).not.toBeNull();
  });

  it("keeps header, text module, visual in DOM order when the visual moves to the start", () => {
    const { container } = render(
      <ContentSection layout="split" mediaSide="start" heading="Heading" media={<div>VISUAL</div>}>
        <p>Module</p>
      </ContentSection>,
    );
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    expect(root).toHaveAttribute("data-media-side", "start");
    expect(root.firstElementChild).toHaveAttribute("data-content-section-text");
    expect(root.lastElementChild).toHaveAttribute("data-content-section-media");
    expect(root.firstElementChild).toHaveClass("tablet-lg:col-start-8", "tablet-lg:row-start-1");
    expect(root.lastElementChild).toHaveClass("tablet-lg:col-start-1", "tablet-lg:row-start-1");
  });

  it("refuses a split without media", () => {
    expect(() =>
      render(
        // @ts-expect-error a split requires media
        <ContentSection layout="split" heading="Heading" />,
      ),
    ).toThrow(TypeError);
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
