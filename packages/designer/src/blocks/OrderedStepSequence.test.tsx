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

describe("OrderedStepSequence visuals", () => {
  const steps = [
    { id: "one", ordinal: "01", label: "Your team", heading: "Send", description: "Share the documents you have." },
    { id: "two", ordinal: "02", label: "The reviewer", heading: "Check", description: "Each item is checked.", visual: <div data-testid="visual-two">VISUAL</div> },
    { id: "three", ordinal: "03", label: "Your team", heading: "Decide", description: "Act on the findings." },
  ];

  it("keeps the tablet row when no step has a visual", () => {
    const { container } = render(<OrderedStepSequence items={steps.map(({ visual: _visual, ...step }) => step)} />);
    expect(container.querySelector("ol")).toHaveClass("tablet:flex-row");
    expect(container.querySelector("[data-step-visual]")).toBeNull();
  });

  it("moves the row to tablet-lg and pins each visual to the bottom of its step", () => {
    const { container } = render(<OrderedStepSequence items={steps} />);
    const list = container.querySelector("ol") as HTMLElement;
    expect(list).toHaveClass("flex-col", "tablet-lg:flex-row");
    expect(list.className).not.toMatch(/(^|\s)tablet:/);
    const visual = container.querySelector("[data-step-visual]") as HTMLElement;
    expect(visual).toHaveClass("mt-auto", "min-w-0");
    expect(visual.parentElement).toHaveClass("flex-1");
    const connector = container.querySelector("li span[aria-hidden]") as HTMLElement;
    expect(connector).toHaveClass("tablet-lg:h-px", "tablet-lg:w-lg");
  });

  it("renders the actor label above the step heading", () => {
    render(<OrderedStepSequence items={steps} headingLevel={2} />);
    const heading = screen.getByRole("heading", { name: "Check" });
    expect(heading.tagName).toBe("H3");
    expect(heading.previousElementSibling).toHaveTextContent("The reviewer");
  });
});

