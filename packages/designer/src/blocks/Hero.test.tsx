import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Hero } from "./Hero.js";

describe("Hero", () => {
  it("renders the required heading as an <h1> by default", () => {
    render(<Hero heading="Heading text" />);
    const heading = screen.getByRole("heading", { name: "Heading text" });
    expect(heading.tagName).toBe("H1");
  });

  it.each([[0, "0"], ["", ""], [null, ""], [undefined, ""], [false, ""]])("keeps one h1 for required heading %j", (heading, expectedText) => {
    const { container } = render(<Hero heading={heading} />);
    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(expectedText);
  });

  it("renders the heading as an <h2> when headingLevel={2}", () => {
    render(<Hero heading="Heading text" headingLevel={2} />);
    expect(screen.getByRole("heading", { name: "Heading text" }).tagName).toBe("H2");
  });

  it("renders an eyebrow when given one", () => {
    render(<Hero eyebrow="Eyebrow text" heading="Heading text" />);
    expect(screen.getByText("Eyebrow text")).toBeInTheDocument();
  });

  it("renders a description when given one", () => {
    render(<Hero heading="Heading text" description="Body copy goes here." />);
    expect(screen.getByText("Body copy goes here.")).toBeInTheDocument();
  });

  it("renders the actions slot's content", () => {
    render(<Hero heading="Heading text" actions={<button type="button">CTA label</button>} />);
    expect(screen.getByRole("button", { name: "CTA label" })).toBeInTheDocument();
  });

  it("omits eyebrow, description, and actions entirely when none are given", () => {
    const { container } = render(<Hero heading="Heading text" />);
    expect(container.querySelectorAll("p").length).toBe(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the media slot's content when given one", () => {
    render(<Hero heading="Heading text" media={<img src="/media.png" alt="Media description" />} />);
    expect(screen.getByRole("img", { name: "Media description" })).toBeInTheDocument();
  });

  it("defaults to editorial composition (no split grid when media is set)", () => {
    const { container } = render(
      <Hero heading="Heading text" media={<img src="/media.png" alt="Media description" />} />,
    );
    const section = container.querySelector("section") as HTMLElement;
    expect(section.className).not.toContain("tablet:grid-cols-2");
  });

  it("uses split grid only when composition is split", () => {
    const { container } = render(
      <Hero
        heading="Heading text"
        media={<img src="/media.png" alt="Media description" />}
        composition="split"
      />,
    );
    const section = container.querySelector("section") as HTMLElement;
    expect(section.className).toContain("tablet:grid-cols-2");
  });

  it("holds the copy to the prose measure, the heading at the display step with its own leading", () => {
    const { container } = render(<Hero heading="Heading text" />);
    const block = container.querySelector("section > div") as HTMLElement;
    expect(block).toHaveAttribute("data-section-intro", "display");
    expect(block.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
    expect(screen.getByRole("heading")).toHaveClass("text-display-m", "tablet:text-display-l", "font-display", "leading-display", "text-balance");
  });

  it("omits the media region entirely when none is given", () => {
    const { container } = render(<Hero heading="Heading text" />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders as a <section> element, not a <header>", () => {
    const { container } = render(<Hero heading="Heading text" />);
    expect(container.querySelector("section")).not.toBeNull();
    expect(container.querySelector("header")).toBeNull();
  });

  it("forwards className onto the outer <section>, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<Hero heading="Heading text" className="gap-2xl" />);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.className).toContain("gap-2xl");
  });

  it("forwards a consumer style prop", () => {
    const { container } = render(<Hero heading="Heading text" style={{ marginTop: "8px" }} />);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.style.marginTop).toBe("8px");
  });

  it("accepts arbitrary ReactNode as the heading, not just a string", () => {
    render(
      <Hero
        heading={
          <>
            Heading text <em>(beta)</em>
          </>
        }
      />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Heading text (beta)");
  });

  it.each([
    ["base", "", "text-ink-primary", "text-ink-secondary"],
    ["sunken", "bg-surface-sunken", "text-ink-primary", "text-ink-secondary"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse", "text-ink-on-inverse-muted"],
  ] as const)("selects the complete %s ground policy", (ground, surface, primary, secondary) => {
    const { container } = render(<Hero heading="Heading text" description="Description" ground={ground} />);
    const root = container.querySelector("section") as HTMLElement;
    if (surface) expect(root).toHaveClass(surface);
    else expect(root.className).not.toMatch(/\bbg-surface-/);
    expect(screen.getByRole("heading")).toHaveClass(primary);
    expect(screen.getByText("Description")).toHaveClass(secondary);
  });
});

describe("Hero align", () => {
  it("lines the text block up along the start edge by default", () => {
    const { container } = render(<Hero heading="Heading text" actions={<a href="/x">Action</a>} />);
    const block = container.querySelector("section > div") as HTMLElement;
    expect(block).toHaveClass("items-start");
    expect(block).not.toHaveClass("text-center");
    expect(block.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
  });

  it("centres every line and the actions row when align is center", () => {
    const { container } = render(<Hero heading="Heading text" description="Description" actions={<a href="/x">Action</a>} align="center" />);
    const block = container.querySelector("section > div") as HTMLElement;
    expect(block).toHaveClass("items-center", "text-center");
    expect(screen.getByRole("link").parentElement).toHaveClass("justify-center");
  });

  it("narrows a centred text block to the prose measure, balanced, so it wraps before the column does", () => {
    const { container } = render(<Hero heading="Heading text" description="Description" align="center" />);
    const block = container.querySelector("section > div") as HTMLElement;
    expect(block.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
    expect(block).toHaveClass("mx-auto");
    expect(screen.getByRole("heading")).toHaveClass("text-balance");
    expect(screen.getByText("Description")).toHaveClass("text-pretty");
  });
});

describe("Hero compact size", () => {
  it("uses the section heading ramp while retaining h1 and existing h2 compatibility", () => {
    const { container } = render(<Hero heading="Compact heading" size="compact" />);
    const heading = screen.getByRole("heading", { name: "Compact heading" });
    expect(heading.tagName).toBe("H1");
    expect(heading).toHaveClass("text-h1", "tablet:text-h0", "tablet-lg:text-display-m", "leading-heading");
    expect(heading).not.toHaveClass("leading-display");
    expect(container.querySelector("section")).not.toHaveAttribute("size");
  });
  it("keeps omitted and default size byte-identical", () => {
    expect(renderToStaticMarkup(<Hero heading="Sample heading" size="default" />)).toBe(renderToStaticMarkup(<Hero heading="Sample heading" />));
  });
  it("keeps an explicitly requested h2 with compact size", () => {
    render(<Hero heading="Later heading" size="compact" headingLevel={2} />);
    expect(screen.getByRole("heading").tagName).toBe("H2");
  });
});
