import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hero } from "./Hero.js";

describe("Hero", () => {
  it("renders the required heading as an <h1> by default", () => {
    render(<Hero heading="Heading text" />);
    const heading = screen.getByRole("heading", { name: "Heading text" });
    expect(heading.tagName).toBe("H1");
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
