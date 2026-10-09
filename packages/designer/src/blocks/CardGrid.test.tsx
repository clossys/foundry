import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardGrid, assertCardGridSpans, type CardGridItem, type CardGridSpan } from "./CardGrid.js";

function cards(spans: CardGridSpan[]): CardGridItem[] {
  return spans.map((span, index) => ({
    id: `card-${index}`,
    heading: `Card ${index + 1}`,
    description: "A short line about this card.",
    span,
  }));
}

describe("CardGrid", () => {
  it("renders each card as an article with a real heading one level below the section", () => {
    render(<CardGrid items={cards(["two-thirds", "third"])} />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Card 1" }).tagName).toBe("H3");
  });

  it("honours a custom heading level", () => {
    render(<CardGrid items={cards(["half", "half"])} headingLevel={4} />);
    expect(screen.getByRole("heading", { name: "Card 2" }).tagName).toBe("H4");
  });

  it("is one column below tablet and a 12-unit grid with gap-lg from tablet", () => {
    const { container } = render(<CardGrid items={cards(["third", "third", "third"])} />);
    const grid = container.querySelector("[data-card-grid]") as HTMLElement;
    expect(grid).toHaveClass("grid", "grid-cols-1", "gap-lg", "tablet:grid-cols-12");
  });

  it("maps spans: two-thirds is full at tablet, thirds are halves at tablet", () => {
    const { container } = render(<CardGrid items={cards(["two-thirds", "third"])} />);
    const [wide, narrow] = Array.from(container.querySelectorAll<HTMLElement>("[data-card-grid-item]"));
    expect(wide).toHaveClass("tablet:col-span-12", "tablet-lg:col-span-8");
    expect(narrow).toHaveClass("tablet:col-span-6", "tablet-lg:col-span-4");
    const full = render(<CardGrid items={cards(["full", "half", "half"])} />);
    const items = full.container.querySelectorAll<HTMLElement>("[data-card-grid-item]");
    expect(items[0]).toHaveClass("tablet:col-span-12");
    expect(items[1]).toHaveClass("tablet:col-span-6");
    expect(items[1]!.className).not.toMatch(/tablet-lg:col-span/);
  });

  it("sets every card on a plate of the other ground", () => {
    const { container } = render(<CardGrid items={cards(["half", "half"])} ground="sunken" />);
    const plate = container.querySelector("[data-card-grid-item] > div") as HTMLElement;
    expect(plate).toHaveAttribute("data-variant", "plate");
    expect(plate).toHaveClass("bg-surface-raised", "rounded-surface", "flex-col");
  });

  it("pins a visual to the bottom of its card and hides the icon", () => {
    const items: CardGridItem[] = [
      { id: "a", icon: <svg data-testid="icon" />, eyebrow: "Eyebrow", heading: "With visual", span: "two-thirds", visual: <div data-testid="visual" /> },
      { id: "b", heading: "Without", span: "third" },
    ];
    const { container } = render(<CardGrid items={items} />);
    const visual = container.querySelector("[data-card-grid-visual]") as HTMLElement;
    expect(visual).toHaveClass("mt-auto", "min-w-0");
    expect(visual).toContainElement(screen.getByTestId("visual"));
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Eyebrow")).toHaveClass("uppercase", "tracking-label");
  });

  it("accepts every allowed row pattern", () => {
    for (const spans of [
      ["two-thirds", "third"],
      ["third", "two-thirds"],
      ["third", "third", "third"],
      ["half", "half"],
      ["full", "full"],
      ["two-thirds", "third", "third", "third", "third"],
    ] as CardGridSpan[][]) {
      expect(() => assertCardGridSpans(spans)).not.toThrow();
    }
  });

  it("rejects rows that overflow or stay unfilled, and card counts outside 2-6", () => {
    for (const spans of [
      ["two-thirds", "half"],
      ["half", "third"],
      ["third", "third"],
      ["full"],
      ["third", "third", "third", "third", "third", "third", "full"],
    ] as CardGridSpan[][]) {
      expect(() => assertCardGridSpans(spans)).toThrow(RangeError);
    }
    expect(() => render(<CardGrid items={cards(["half", "third"])} />)).toThrow(RangeError);
  });
});
