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
    ["base", "bg-surface-base", "text-ink-primary"],
    ["sunken", "bg-surface-sunken", "text-ink-primary"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse"],
  ] as const)("selects the complete %s ground policy", (ground, surface, primary) => {
    const { container } = render(<FeatureGrid heading="Grid heading" items={ITEMS} ground={ground} />);
    expect(container.firstElementChild).toHaveClass(surface);
    expect(screen.getByRole("heading")).toHaveClass(primary);
    expect(screen.getByText("Feature one heading")).toHaveClass(primary);
  });
});
