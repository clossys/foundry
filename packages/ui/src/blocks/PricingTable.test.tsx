import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PricingTable, type PricingTier } from "./PricingTable.js";

const TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "Tier name one",
    price: "Price one",
    features: ["Feature one", "Feature two"],
    cta: <button type="button">CTA one</button>,
  },
  {
    id: "team",
    name: "Tier name two",
    price: "Price two",
    features: ["Feature three"],
    cta: <button type="button">CTA two</button>,
    isHighlighted: true,
    badge: "Badge text",
  },
];

describe("PricingTable", () => {
  it("renders an optional heading above the tier grid", () => {
    render(<PricingTable heading="Pricing heading" tiers={TIERS} />);
    expect(screen.getByRole("heading", { name: "Pricing heading" })).toBeInTheDocument();
  });

  it("defaults the heading to <h2>", () => {
    render(<PricingTable heading="Pricing heading" tiers={TIERS} />);
    expect(screen.getByRole("heading", { name: "Pricing heading" }).tagName).toBe("H2");
  });

  it("renders the heading at a custom level", () => {
    render(<PricingTable heading="Pricing heading" tiers={TIERS} headingLevel={3} />);
    expect(screen.getByRole("heading", { name: "Pricing heading" }).tagName).toBe("H3");
  });

  it("renders no heading region when heading/description are both omitted", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders each tier's name, price, and feature list", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.getByText("Tier name one")).toBeInTheDocument();
    expect(screen.getByText("Price one")).toBeInTheDocument();
    expect(screen.getByText("Feature one")).toBeInTheDocument();
    expect(screen.getByText("Feature two")).toBeInTheDocument();
  });

  it("renders each tier's cta slot", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.getByRole("button", { name: "CTA one" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CTA two" })).toBeInTheDocument();
  });

  it("renders a tier's badge only when given one", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.getByText("Badge text")).toBeInTheDocument();
  });

  it("omits a tier's badge and description when neither is given", () => {
    render(
      <PricingTable
        tiers={[{ id: "free", name: "Tier name", price: "Price", features: [], cta: <button type="button">Go</button> }]}
      />,
    );
    expect(screen.queryByText("Badge text")).not.toBeInTheDocument();
  });

  it("tier names are NOT real heading elements — a homogeneous repeat, not named regions", () => {
    render(<PricingTable heading="Pricing heading" tiers={TIERS} />);
    // Only the table's own heading is a real <hN> — the tiers add none.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("renders one tier per entry, as data", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("forwards className onto the root, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<PricingTable tiers={TIERS} className="gap-2xl" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-2xl");
  });

  it("forwards a consumer style prop onto the root", () => {
    const { container } = render(<PricingTable tiers={TIERS} style={{ marginTop: "8px" }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });
});
