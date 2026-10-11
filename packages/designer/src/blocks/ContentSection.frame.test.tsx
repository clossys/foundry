import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentSection } from "./ContentSection.js";
import { Hero } from "./Hero.js";

describe("ContentSection frame", () => {
  it.each([
    ["compact", "py-3xl", "tablet:py-4xl", "desktop:py-5xl"],
    ["standard", "py-4xl", "tablet:py-5xl", "desktop:py-6xl"],
    ["display", "py-5xl", "tablet:py-6xl", "desktop:py-frame-display"],
  ] as const)("owns the %s padding only when size is explicit", (size, phone, tablet, desktop) => {
    const { container } = render(<ContentSection size={size} heading="Heading" />);
    expect(container.querySelector("[data-content-section]")).toHaveClass(phone, tablet, desktop);
    expect(container.querySelector("[data-content-section]")).not.toHaveAttribute("size");
  });

  it("preserves the unsized caller's spacing and heading scale", () => {
    const { container } = render(<ContentSection heading="Heading" />);
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    expect(root.className).toBe("flex w-full flex-col gap-2xl tablet-lg:gap-3xl items-start");
    expect(screen.getByRole("heading")).toHaveClass("text-h1", "tablet:text-h0", "tablet-lg:text-display-m");
    expect(root).not.toHaveAttribute("data-size");
  });

  it("lets caller padding override the derived display step", () => {
    const { container } = render(<ContentSection size="display" heading="Heading" className="desktop:py-5xl desktop:px-5xl" />);
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    expect(root).toHaveClass("desktop:py-5xl", "desktop:px-5xl", "py-5xl", "tablet:py-6xl");
    expect(root).not.toHaveClass("desktop:py-frame-display");
  });

  it.each(["compact", "standard", "display"] as const)("derives heading emphasis from explicit %s size", (size) => {
    render(<ContentSection size={size} heading="Heading" headingLevel={3} />);
    const heading = screen.getByRole("heading");
    expect(heading.tagName).toBe("H3");
    if (size === "display") expect(heading).toHaveClass("text-display-m", "tablet:text-display-l", "leading-display");
    else expect(heading).toHaveClass("text-h1", "tablet:text-h0", "leading-heading");
  });

  it.each(["split-start", "split-end"] as const)("puts media on the %s side without changing reading order", (layout) => {
    const { container } = render(
      <ContentSection layout={layout} heading="Heading" media={<p>Visual</p>}>
        <p>Module</p>
      </ContentSection>,
    );
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    const text = root.querySelector("[data-content-section-text]") as HTMLElement;
    const media = root.querySelector("[data-content-section-media]") as HTMLElement;
    expect(root).toHaveAttribute("data-layout", layout);
    expect(root).toHaveClass("grid-cols-1", "tablet-lg:grid-cols-12");
    expect(text).toHaveClass("tablet-lg:col-span-5");
    expect(media).toHaveClass("tablet-lg:col-span-7");
    expect(root.firstElementChild).toBe(text);
    expect(root.lastElementChild).toBe(media);
    if (layout === "split-start") {
      expect(text).toHaveClass("tablet-lg:col-start-8", "tablet-lg:row-start-1");
      expect(media).toHaveClass("tablet-lg:col-start-1", "tablet-lg:row-start-1");
    }
  });

  it.each(["split-start", "split-end"] as const)("splits a header-only %s frame into message and support", (layout) => {
    const { container } = render(
      <ContentSection layout={layout} size="standard" eyebrow="Eyebrow" heading="Heading" description="Description" actions={<a href="/go">Action</a>} footnote="Footnote">
        {null}{false}
      </ContentSection>,
    );
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    const text = root.querySelector("[data-content-section-text]") as HTMLElement;
    const support = root.querySelector("[data-content-section-support]") as HTMLElement;
    expect(text).toHaveClass("tablet-lg:col-span-5");
    expect(support).toHaveClass("tablet-lg:col-span-7");
    expect(text.textContent).toBe("EyebrowHeading");
    expect(support.textContent).toBe("DescriptionActionFootnote");
    expect(root.textContent).toBe("EyebrowHeadingDescriptionActionFootnote");
    expect(root.firstElementChild).toBe(text);
    expect(root.lastElementChild).toBe(support);
    expect(root.querySelector("[data-content-section-media]")).toBeNull();
    expect(root.querySelector("[data-content-section-modules]")).toBeNull();
    expect(support.lastElementChild).toHaveAttribute("data-content-section-footnote");
    expect(screen.getByRole("link", { name: "Action" })).toHaveAttribute("href", "/go");
    if (layout === "split-start") {
      expect(text).toHaveClass("tablet-lg:col-start-8");
      expect(support).toHaveClass("tablet-lg:col-start-1");
    }
  });

  it("uses a block as the companion when a canonical split has no media", () => {
    const { container } = render(
      <ContentSection layout="split-end" heading="Heading" description="Description" footnote="Footnote">
        <p>Module</p>
      </ContentSection>,
    );
    const text = container.querySelector("[data-content-section-text]") as HTMLElement;
    const modules = container.querySelector("[data-content-section-modules]") as HTMLElement;
    expect(text.textContent).toBe("HeadingDescriptionFootnote");
    expect(modules).toHaveClass("tablet-lg:col-span-7");
    expect(modules.textContent).toBe("Module");
  });

  it.each([
    {},
    { description: null, actions: false, footnote: null },
    { description: "", actions: null, footnote: false },
  ])("omits an empty header-only support column and its mobile row gap", (regions) => {
    const { container } = render(<ContentSection layout="split-end" size="standard" heading="Heading" {...regions} />);
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    expect(root.querySelector("[data-content-section-support]")).toBeNull();
    expect(root.children).toHaveLength(1);
    expect(root.textContent).toBe("Heading");
  });

  it.each(["description", "actions", "footnote"] as const)("keeps numeric zero as %s support", (region) => {
    const { container } = render(<ContentSection layout="split-end" size="standard" heading="Heading" {...{ [region]: 0 }} />);
    expect(container.querySelector("[data-content-section-support]")).toHaveTextContent("0");
  });

  it("keeps the temporary legacy split and side aliases in their existing DOM", () => {
    const { container } = render(<ContentSection layout="split" mediaSide="start" heading="Heading" media={<p>Visual</p>} />);
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    expect(root).toHaveAttribute("data-layout", "split");
    expect(root).toHaveAttribute("data-media-side", "start");
    expect(root.className).toBe("grid w-full grid-cols-1 gap-y-2xl tablet-lg:grid-cols-12 tablet-lg:items-center tablet-lg:gap-x-4xl tablet-lg:gap-y-0");
  });

  it("ships the derived display padding through generated CSS", () => {
    const css = readFileSync("styles/compiled.css", "utf8");
    expect(css).toContain(".desktop\\:py-frame-display");
    expect(css).toMatch(/padding-block:\s*calc\(var\(--spacing-6xl,\s*128px\)\s*\+\s*var\(--spacing-2xl,\s*32px\)\)/);
  });
});

describe("Hero frame size", () => {
  it("keeps display, default and omitted sizes byte-identical", () => {
    const base = renderToStaticMarkup(<Hero heading="Heading" description="Description" />);
    expect(renderToStaticMarkup(<Hero size="display" heading="Heading" description="Description" />)).toBe(base);
    expect(renderToStaticMarkup(<Hero size="default" heading="Heading" description="Description" />)).toBe(base);
  });

  it("keeps compact at the section ramp and retains its semantic level", () => {
    render(<Hero size="compact" heading="Heading" headingLevel={2} />);
    const heading = screen.getByRole("heading");
    expect(heading.tagName).toBe("H2");
    expect(heading).toHaveClass("text-h1", "tablet:text-h0", "leading-heading");
  });
});
