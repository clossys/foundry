import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrderedStepSequence, type OrderedStepSequenceItem } from "./OrderedStepSequence.js";

const ITEMS: OrderedStepSequenceItem[] = [
  { id: "discover", ordinal: "01", label: "First", heading: "Discover", description: "Understand the need." },
  { id: "decide", ordinal: "02", label: "Second", heading: "Decide", description: "Choose a path." },
  { id: "deliver", ordinal: "03", heading: "Deliver" },
];

describe("OrderedStepSequence", () => {
  it("uses a real ordered list and exposes every authored ordinal as text", () => {
    const { container } = render(<OrderedStepSequence items={ITEMS} />);
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelectorAll("ol > li")).toHaveLength(3);
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
  });

  it("renders labels, semantic item headings, and optional body copy", () => {
    render(<OrderedStepSequence heading="Process" items={ITEMS} headingLevel={3} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Process" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Discover" }).tagName).toBe("H4");
    expect(screen.getByText("Understand the need.")).toBeInTheDocument();
    expect(screen.queryByText("description")).not.toBeInTheDocument();
  });

  it("caps item heading rank at h6", () => {
    render(<OrderedStepSequence heading="Process" items={ITEMS} headingLevel={6} />);
    expect(screen.getByRole("heading", { name: "Process" }).tagName).toBe("H6");
    expect(screen.getByRole("heading", { name: "Discover" }).tagName).toBe("H6");
  });

  it("renders a connector only between adjacent items, never after the last", () => {
    const { container } = render(<OrderedStepSequence items={ITEMS} />);
    const connectors = container.querySelectorAll('span[aria-hidden="true"]');
    expect(connectors).toHaveLength(2);
  });

  it("changes the decorative connector axis with the same responsive breakpoint as the list", () => {
    const { container } = render(<OrderedStepSequence items={ITEMS} />);
    const connector = container.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(connector.className).toContain("h-lg");
    expect(connector.className).toContain("w-px");
    expect(connector.className).toContain("tablet:h-px");
    expect(connector.className).toContain("tablet:w-lg");
    expect((container.querySelector("ol") as HTMLElement).className).toContain("tablet:flex-row");
  });

  it("uses inverse ink and line tokens only when explicitly placed on the inverse ground", () => {
    const { container } = render(<OrderedStepSequence items={ITEMS} ground="inverse" />);
    expect((container.querySelector('span[aria-hidden="true"]') as HTMLElement).className).toContain("bg-line-on-inverse");
    expect(screen.getByRole("heading", { name: "Discover" }).className).toContain("text-ink-on-inverse");
  });

  it.each([
    ["base", "", "text-ink-primary", "bg-line-base"],
    ["sunken", "bg-surface-sunken", "text-ink-primary", "bg-line-base"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse", "bg-line-on-inverse"],
  ] as const)("selects the complete %s ground policy", (ground, surface, primary, line) => {
    const { container } = render(<OrderedStepSequence items={ITEMS} ground={ground} />);
    const root = container.querySelector("section") as HTMLElement;
    if (surface) expect(root).toHaveClass(surface);
    else expect(root.className).not.toMatch(/\bbg-surface-/);
    expect(screen.getByRole("heading", { name: "Discover" })).toHaveClass(primary);
    expect(container.querySelector('span[aria-hidden="true"]')).toHaveClass(line);
  });

  it("forwards className and style to its section root", () => {
    const { container } = render(<OrderedStepSequence items={ITEMS} className="gap-2xl" style={{ marginTop: "8px" }} />);
    const root = container.querySelector("section") as HTMLElement;
    expect(root.className).toContain("gap-2xl");
    expect(root.style.marginTop).toBe("8px");
  });
});
