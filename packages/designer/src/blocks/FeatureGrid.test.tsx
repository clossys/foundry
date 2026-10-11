import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureGrid, type FeatureGridItem } from "./FeatureGrid.js";

const ITEMS: FeatureGridItem[] = [
  { id: "one", heading: "Feature one heading", description: "Feature one description." },
  { id: "two", heading: "Feature two heading", description: "Feature two description." },
];

describe("FeatureGrid", () => {
  it("renders an optional heading above the grid", () => {
    render(<FeatureGrid heading="Grid heading" items={ITEMS} />);
    expect(screen.getByRole("heading", { name: "Grid heading" })).toBeInTheDocument();
  });

  it("defaults the heading to <h2>", () => {
    render(<FeatureGrid heading="Grid heading" items={ITEMS} />);
    expect(screen.getByRole("heading", { name: "Grid heading" }).tagName).toBe("H2");
  });

  it("renders the heading at a custom level", () => {
    render(<FeatureGrid heading="Grid heading" items={ITEMS} headingLevel={3} />);
    expect(screen.getByRole("heading", { name: "Grid heading" }).tagName).toBe("H3");
  });

  it("renders an eyebrow and description alongside the heading", () => {
    render(
      <FeatureGrid eyebrow="Eyebrow text" heading="Grid heading" description="Grid description." items={ITEMS} />,
    );
    expect(screen.getByText("Eyebrow text")).toBeInTheDocument();
    expect(screen.getByText("Grid description.")).toBeInTheDocument();
  });

  it("renders no heading region when heading/description/eyebrow are all omitted", () => {
    render(<FeatureGrid items={ITEMS} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders one entry per item, with its own heading and description text", () => {
    render(<FeatureGrid items={ITEMS} />);
    expect(screen.getByText("Feature one heading")).toBeInTheDocument();
    expect(screen.getByText("Feature one description.")).toBeInTheDocument();
    expect(screen.getByText("Feature two heading")).toBeInTheDocument();
  });

  it("item headings are NOT real heading elements — a homogeneous repeat, not named regions", () => {
    render(<FeatureGrid heading="Grid heading" items={ITEMS} />);
    // Only the grid's own heading is a real <hN> — the two items add none.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("renders an item's icon as aria-hidden — decorative, not a second accessible name source", () => {
    render(
      <FeatureGrid
        items={[{ id: "one", heading: "Feature heading", icon: <svg data-testid="feature-icon" /> }]}
      />,
    );
    const icon = screen.getByTestId("feature-icon");
    expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("omits an item's description when none is given", () => {
    render(<FeatureGrid items={[{ id: "one", heading: "Feature heading" }]} />);
    expect(screen.queryByText(/description/)).not.toBeInTheDocument();
  });

  it("forwards className onto the root, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<FeatureGrid items={ITEMS} className="gap-2xl" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-2xl");
  });

  it("forwards a consumer style prop onto the root", () => {
    const { container } = render(<FeatureGrid items={ITEMS} style={{ marginTop: "8px" }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });

  it.each([
    ["base", "", "text-ink-primary"],
    ["sunken", "bg-surface-sunken", "text-ink-primary"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse"],
  ] as const)("selects the complete %s ground policy", (ground, surface, primary) => {
    const { container } = render(<FeatureGrid heading="Grid heading" items={ITEMS} ground={ground} />);
    const root = container.firstElementChild as HTMLElement;
    if (surface) expect(root).toHaveClass(surface);
    else expect(root.className).not.toMatch(/\bbg-surface-/);
    expect(screen.getByRole("heading")).toHaveClass(primary);
    expect(screen.getByText("Feature one heading")).toHaveClass(primary);
  });
});

describe("FeatureGrid catalog layout", () => {
  const three: FeatureGridItem[] = [
    { id: "a", heading: "First principle", description: "A line of support.", icon: <svg data-testid="icon-a" /> },
    { id: "b", heading: "Second principle", description: "A line of support.", icon: <svg data-testid="icon-b" /> },
    { id: "c", heading: "Third principle", description: "A line of support.", icon: <svg data-testid="icon-c" /> },
  ];

  it("keeps the original grid byte for byte when no catalog prop is set", () => {
    const { container } = render(<FeatureGrid items={ITEMS} />);
    const grid = container.firstElementChild?.lastElementChild as HTMLElement;
    expect(grid.className).toBe("grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3");
    expect(container.querySelector("[data-item]")).toBeNull();
  });

  it("uses canonical two or three columns and refuses four", () => {
    const { container, unmount } = render(<FeatureGrid items={three} columns={3} />);
    expect(container.querySelector("[data-items]")).toHaveClass("tablet:grid-cols-2", "tablet-lg:grid-cols-3");
    unmount();
    render(<FeatureGrid items={[...three, { id: "d", heading: "Fourth" }]} columns={2} />);
    expect(() => render(<FeatureGrid items={three} columns={4 as 2} />)).toThrow(RangeError);
  });

  it("marks catalog items with a secondary icon and sets item copy for reading", () => {
    const { unmount } = render(<FeatureGrid items={three} columns={3} />);
    expect(screen.getByTestId("icon-a").parentElement).toHaveClass("text-ink-secondary");
    expect(screen.getByText("First principle")).toHaveClass("text-body-l", "font-semibold");
    expect(screen.getAllByText("A line of support.")[0]).toHaveClass("text-body");
    unmount();
    render(<FeatureGrid items={three} columns={3} ground="inverse" />);
    expect(screen.getByTestId("icon-a").parentElement).toHaveClass("text-ink-on-inverse-muted");
  });

  it("tops each item with a hairline and retains secondary icons", () => {
    const { container } = render(<FeatureGrid items={three} treatment="rule" />);
    const items = container.querySelectorAll<HTMLElement>("[data-item]");
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item).toHaveClass("border-t", "border-line-strong", "pt-lg");
      expect(item.style.borderBlockStartWidth).toBe("var(--ui-border-hairline, 1px)");
    }
    expect(screen.getByTestId("icon-a").parentElement).toHaveClass("text-ink-secondary");
  });

  it("uses the inverse line for the rule on an inverse ground", () => {
    const { container } = render(<FeatureGrid items={three} treatment="rule" ground="inverse" />);
    expect(container.querySelector("[data-item]")).toHaveClass("border-line-on-inverse");
  });

  it("sets each item on a plate of the other ground in plate treatment, icons kept and hidden", () => {
    const { container } = render(<FeatureGrid items={three} treatment="plate" ground="sunken" />);
    const item = container.querySelector("[data-item]") as HTMLElement;
    expect(item).toHaveAttribute("data-variant", "plate");
    expect(item).toHaveClass("bg-surface-raised", "rounded-panel");
    expect(screen.getByTestId("icon-a").parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("spaces plates the same both ways, plain items keep the wider row gap", () => {
    const { container, rerender } = render(<FeatureGrid items={three} treatment="plate" ground="sunken" />);
    const grid = () => container.querySelector("[data-items]") as HTMLElement;
    expect(grid()).toHaveClass("gap-x-2xl", "gap-y-2xl");
    expect(grid()).not.toHaveClass("gap-y-3xl");
    rerender(<FeatureGrid items={three} treatment="plain" />);
    expect(grid()).toHaveClass("gap-x-2xl", "gap-y-3xl");
  });

  it("sets statement visual scale at h2 with semantic h3 items", () => {
    render(<FeatureGrid items={three.map(({ icon: _icon, ...item }) => item)} emphasis="statement" treatment="rule" />);
    const heading = screen.getByText("First principle");
    expect(heading.tagName).toBe("H3");
    expect(heading).toHaveClass("text-h2", "font-display", "leading-heading");
  });
});


describe("FeatureGrid item eyebrow", () => {
  const items: FeatureGridItem[] = [
    { id: "one", eyebrow: "Intake", heading: "Documents in one place", description: "Every file lands against its record." },
    { id: "two", heading: "Dates tracked", description: "Each due date carries an owner." },
  ];

  it("sets the eyebrow as a small label above the item heading, grouped tightly with it", () => {
    render(<FeatureGrid items={items} columns={2} />);
    const eyebrow = screen.getByText("Intake");
    expect(eyebrow.tagName).toBe("P");
    expect(eyebrow).toHaveClass("text-body-s", "font-medium", "uppercase", "tracking-label", "text-ink-secondary");
    expect(eyebrow.parentElement?.nextElementSibling).toHaveTextContent("Documents in one place");
    expect(eyebrow.parentElement).toHaveAttribute("data-item-meta");
    expect(eyebrow.parentElement).toHaveClass("flex", "flex-wrap", "gap-sm");
  });

  it("emits an item without an eyebrow exactly as before", () => {
    const { container } = render(<FeatureGrid items={items} columns={2} />);
    const withoutEyebrow = render(<FeatureGrid items={[{ id: "other", heading: "Other" }, items[1]!]} columns={2} />).container;
    const second = container.querySelectorAll("[data-item]")[1] as HTMLElement;
    expect(second.outerHTML).toBe((withoutEyebrow.querySelectorAll("[data-item]")[1] as HTMLElement).outerHTML);
    expect(second.querySelector("[data-item-eyebrow]")).toBeNull();
  });

  it("uses the inverse secondary ink on an inverse ground and works in the original grid", () => {
    render(<FeatureGrid items={items} ground="inverse" treatment="plate" columns={2} />);
    expect(screen.getByText("Intake")).toHaveClass("text-ink-on-inverse-muted");
    const { getAllByText } = render(<FeatureGrid items={items} />);
    expect(getAllByText("Intake").at(-1)?.nextElementSibling).toHaveTextContent("Documents in one place");
  });
});
