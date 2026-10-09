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

  it("sets step headings as item headings, the same type as FeatureGrid and TopicList items", () => {
    render(<OrderedStepSequence items={ITEMS} />);
    const heading = screen.getByRole("heading", { name: "Discover" });
    expect(heading).toHaveClass("text-body", "font-body", "font-medium");
    expect(heading.className).not.toMatch(/font-display|text-h\d/);
    expect(screen.getByText("Understand the need.")).toHaveClass("text-body-s", "text-pretty");
  });

  it("draws the connector and the ordinal ring in line-strong on the light grounds", () => {
    const { container } = render(<OrderedStepSequence items={ITEMS} />);
    expect(container.querySelector("[data-step-connector]")).toHaveClass("bg-line-strong");
    expect(screen.getByText("01")).toHaveClass("border-line-strong", "tabular-nums");
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

describe("OrderedStepSequence visuals", () => {
  const steps = [
    { id: "one", ordinal: "01", label: "Your team", heading: "Send", description: "Share the documents you have." },
    { id: "two", ordinal: "02", label: "The reviewer", heading: "Check", description: "Each item is checked.", visual: <div data-testid="visual-two">VISUAL</div> },
    { id: "three", ordinal: "03", label: "Your team", heading: "Decide", description: "Act on the findings." },
  ];

  it("keeps the tablet row when no step has a visual", () => {
    const { container } = render(<OrderedStepSequence items={steps.map(({ visual: _visual, ...step }) => step)} />);
    expect(container.querySelector("ol")).toHaveClass("tablet:flex-row");
    expect(container.querySelector("ol")?.className).not.toMatch(/items-start/);
    expect(container.querySelector("[data-step-visual]")).toBeNull();
  });

  it("moves the row to tablet-lg and puts every visual on one top line through subgrid rows", () => {
    const { container } = render(<OrderedStepSequence items={steps} />);
    const list = container.querySelector("ol") as HTMLElement;
    expect(list).toHaveAttribute("data-step-layout", "visual");
    expect(list).toHaveClass("flex", "flex-col", "tablet-lg:grid", "tablet-lg:grid-flow-col", "tablet-lg:auto-cols-fr", "tablet-lg:gap-x-xl");
    expect(list.className).not.toMatch(/(^|\s)tablet:/);
    for (const item of Array.from(list.children)) {
      expect(item).toHaveClass("tablet-lg:row-span-3", "tablet-lg:grid", "tablet-lg:grid-rows-subgrid");
    }
    const visual = container.querySelector("[data-step-visual]") as HTMLElement;
    expect(visual).toHaveClass("w-full", "min-w-0");
    expect(visual).not.toHaveClass("mt-auto");
    // The text and the visual share a wrapper that becomes display: contents in the row,
    // so each is its own subgrid row: ordinal, text, visual.
    const body = visual.parentElement as HTMLElement;
    expect(body).toHaveClass("tablet-lg:contents");
    expect(body.firstElementChild).toHaveAttribute("data-step-text");
    expect(body.parentElement?.tagName).toBe("LI");
    const connector = container.querySelector("li [data-step-connector]") as HTMLElement;
    expect(connector).toHaveClass("tablet-lg:h-px", "tablet-lg:w-auto");
  });

  it("degrades to stacked parts in source order: marker, text, visual", () => {
    const { container } = render(<OrderedStepSequence items={steps} />);
    const second = container.querySelectorAll("ol > li")[1] as HTMLElement;
    expect(second.firstElementChild?.textContent).toBe("02");
    const parts = Array.from((second.children[1] as HTMLElement).children).map((child) => child.getAttribute("data-step-text") !== null ? "text" : child.getAttribute("data-step-visual") !== null ? "visual" : "other");
    expect(parts).toEqual(["text", "visual"]);
  });

  it("renders the actor label above the step heading", () => {
    render(<OrderedStepSequence items={steps} headingLevel={2} />);
    const heading = screen.getByRole("heading", { name: "Check" });
    expect(heading.tagName).toBe("H3");
    expect(heading.previousElementSibling).toHaveTextContent("The reviewer");
  });
});

