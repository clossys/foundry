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

  it("runs the connector from one ordinal to the next: a rail in the column, a hairline in the row", () => {
    const { container } = render(<OrderedStepSequence items={ITEMS} />);
    const connector = container.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(connector).toHaveAttribute("data-step-connector");
    expect(connector).toHaveClass("w-px", "flex-1", "tablet:h-px", "tablet:w-auto", "tablet:ms-md", "tablet:-me-md");
    expect(connector.previousElementSibling).toHaveTextContent("01");
    expect(connector.parentElement).toHaveClass("flex-col", "items-center", "tablet:flex-row");
    expect(container.querySelector("ol")).toHaveClass("tablet:flex-row", "tablet:gap-x-xl");
  });

  it("sets authored step headings in the body font and medium weight", () => {
    render(<OrderedStepSequence items={ITEMS} />);
    const heading = screen.getByRole("heading", { name: "Discover" });
    expect(heading).toHaveClass("text-body-l", "font-body", "font-medium");
    expect(heading.className).not.toMatch(/font-display|text-h\d/);
    expect(screen.getByText("Understand the need.")).toHaveClass("text-body", "text-pretty");
  });

  it("draws the connector in line-strong and the ordinal as an accent-tint disc on the light grounds", () => {
    const { container } = render(<OrderedStepSequence items={ITEMS} />);
    expect(container.querySelector("[data-step-connector]")).toHaveClass("bg-line-strong");
    expect(screen.getByText("01")).toHaveClass("bg-accent-tint", "text-accent-text", "rounded-pill", "size-2xl", "tabular-nums");
    expect(screen.getByText("01").className).not.toMatch(/\bborder\b/);
  });

  it("uses inverse ink and line tokens only when explicitly placed on the inverse ground", () => {
    const { container } = render(<OrderedStepSequence items={ITEMS} ground="inverse" />);
    expect((container.querySelector('span[aria-hidden="true"]') as HTMLElement).className).toContain("bg-line-on-inverse");
    expect(screen.getByRole("heading", { name: "Discover" }).className).toContain("text-ink-on-inverse");
  });

  it.each([
    ["base", "", "text-ink-primary", "bg-line-strong"],
    ["sunken", "bg-surface-sunken", "text-ink-primary", "bg-line-strong"],
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

describe("OrderedStepSequence eyebrow", () => {
  it("renders an optional eyebrow above the heading", () => {
    const { container } = render(<OrderedStepSequence eyebrow="Section label" heading="Process" items={ITEMS} />);
    const region = container.querySelector("h2")?.parentElement as HTMLElement;
    expect(region.children[0].tagName).toBe("P");
    expect(region.children[0].textContent).toBe("Section label");
    expect(region.children[1].tagName).toBe("H2");
  });

  it("renders no eyebrow element, and no heading region at all, when none is supplied", () => {
    const withHeading = render(<OrderedStepSequence heading="Process" items={ITEMS} />).container;
    expect(withHeading.querySelector("h2")?.parentElement?.children).toHaveLength(1);
    const bare = render(<OrderedStepSequence items={ITEMS} />).container;
    expect((bare.firstElementChild as HTMLElement).firstElementChild?.tagName).toBe("OL");
  });
});

// S4-2/S4-4: preserve the owner's presence predicate and ground on the shared region.
it("S4 preserves absent, supporting-only and falsy title regions with original root attributes", () => {
  const view = render(<OrderedStepSequence items={ITEMS} id="host" dir="rtl" data-host="yes" style={{ marginTop: 7 }} />);
  const root = view.container.firstElementChild as HTMLElement;
  expect(root.tagName).toBe("SECTION");
  expect(root).toHaveAttribute("id", "host");
  expect(root).toHaveAttribute("dir", "rtl");
  expect(root).toHaveAttribute("data-host", "yes");
  expect(root.style.marginTop).toBe("7px");
  expect(root.children).toHaveLength(1);
  expect(root.querySelectorAll("#host")).toHaveLength(0);
  for (const heading of [0, "", null, false]) {
    view.rerender(<OrderedStepSequence items={ITEMS} heading={heading} />);
    expect(view.container.firstElementChild?.firstElementChild).toHaveClass("gap-xs");
    expect(view.container.firstElementChild?.firstElementChild?.querySelector("h2")).toBeNull();
  }
  view.rerender(<OrderedStepSequence items={ITEMS} description="Support" ground="inverse" />);
  expect(view.getByText("Support")).toHaveClass("text-ink-on-inverse-muted");
  view.rerender(<OrderedStepSequence items={ITEMS} heading="Title" headingLevel={5} ground="inverse"  eyebrow="Label" />);
  expect(view.getByRole("heading", { name: "Title", level: 5 })).toHaveClass("text-h2", "text-ink-on-inverse");
});
