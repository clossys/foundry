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
    const { container } = render(<CardGrid items={cards(["two-thirds", "third", "third", "third", "third"])} />);
    const [wide, ...thirds] = Array.from(container.querySelectorAll<HTMLElement>("[data-card-grid-item]"));
    expect(wide).toHaveClass("tablet:col-span-12", "tablet-lg:col-span-8");
    for (const third of thirds) expect(third).toHaveClass("tablet:col-span-6", "tablet-lg:col-span-4");
    const full = render(<CardGrid items={cards(["full", "half", "half"])} />);
    const items = full.container.querySelectorAll<HTMLElement>("[data-card-grid-item]");
    expect(items[0]).toHaveClass("tablet:col-span-12");
    expect(items[1]).toHaveClass("tablet:col-span-6");
    expect(items[1]!.className).not.toMatch(/tablet-lg:col-span/);
  });

  it("gives a third left alone in its tablet row the full row, never an orphan beside an empty half", () => {
    const spans = (pattern: CardGridSpan[]) =>
      Array.from(render(<CardGrid items={cards(pattern)} />).container.querySelectorAll<HTMLElement>("[data-card-grid-item]")).map((item) =>
        item.classList.contains("tablet:col-span-12") ? 12 : 6,
      );
    expect(spans(["third", "third", "third"])).toEqual([6, 6, 12]);
    expect(spans(["two-thirds", "third"])).toEqual([12, 12]);
    expect(spans(["third", "two-thirds"])).toEqual([12, 12]);
    expect(spans(["two-thirds", "third", "third", "third", "third"])).toEqual([12, 6, 6, 6, 6]);
    expect(spans(["third", "third", "third", "third", "third", "third"])).toEqual([6, 6, 6, 6, 6, 6]);
    expect(spans(["half", "half"])).toEqual([6, 6]);
  });

  it("sets card copy for reading and marks the card with an accent icon", () => {
    const items: CardGridItem[] = [
      { id: "a", icon: <svg data-testid="icon" />, eyebrow: "Eyebrow", heading: "One", description: "Body copy.", span: "half" },
      { id: "b", heading: "Two", span: "half" },
    ];
    const { unmount } = render(<CardGrid items={items} />);
    expect(screen.getByText("Body copy.")).toHaveClass("text-body", "text-ink-secondary");
    expect(screen.getByText("Eyebrow")).toHaveClass("text-body-s", "font-medium");
    expect(screen.getByTestId("icon").parentElement).toHaveClass("text-accent");
    unmount();
    render(<CardGrid items={items} ground="inverse" />);
    expect(screen.getByTestId("icon").parentElement).toHaveClass("text-accent-on-inverse");
  });

  it("sets every card on a plate of the other ground", () => {
    const { container } = render(<CardGrid items={cards(["half", "half"])} ground="sunken" />);
    const plate = container.querySelector("[data-card-grid-item] > div") as HTMLElement;
    expect(plate).toHaveAttribute("data-variant", "plate");
    expect(plate).toHaveClass("bg-surface-raised", "rounded-panel", "flex-col");
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

it("uses unboxed rule cards, tablet halves and a wide-card internal split without changing plate defaults", () => {
  const { container } = render(<CardGrid treatment="rule" items={cards(["two-thirds", "third"]).map((item, index) => index === 0 ? { ...item, visual: <div>Static visual</div> } : item)} />);
  expect(container.querySelector('[data-variant="plate"]')).toBeNull();
  expect(container.querySelector("[data-card-grid]")).toHaveAttribute("data-treatment", "rule");
  const [wide, narrow] = container.querySelectorAll("[data-card-grid-item]");
  expect(wide).toHaveClass("tablet:col-span-6", "tablet-lg:col-span-8", "ledger-rule-wide");
  expect(narrow).toHaveClass("tablet:col-span-6", "tablet-lg:col-span-4");
  expect(wide).toHaveStyle({ borderBlockStartWidth: "var(--ui-border-hairline, 1px)" });
});

it("gives linked rule cards the rule hit frame and one title link", () => {
  const { container } = render(<CardGrid treatment="rule" items={cards(["half", "half"]).map(item => ({ ...item, href: "/record" }))} />);
  expect(container.querySelectorAll("a")).toHaveLength(2);
  for (const anchor of container.querySelectorAll("a")) expect(anchor).toHaveClass("after:top-0", "after:-bottom-sm", "tablet:after:-bottom-md");
  for (const p of container.querySelectorAll("p,h3")) expect(p).toHaveClass("m-0");
});


it("keeps an icon and copy in one text region beside a wide rule visual and leaves text-only cards unsplit", () => {
  const { container } = render(<CardGrid treatment="rule" items={[
    { id: "wide", span: "two-thirds", heading: "Linked heading", href: "/record", icon: <svg data-testid="rule-icon" />, visual: <figure>Static record</figure> },
    { id: "narrow", span: "third", heading: "Other", href: "/other" },
  ]} />);
  const wide = container.querySelector('[data-span="two-thirds"]')!;
  expect(wide.children).toHaveLength(2);
  expect(wide.children[0]).toHaveAttribute("data-card-grid-text");
  expect(wide.children[0]!.querySelector("svg[data-testid=rule-icon]")).not.toBeNull();
  expect(wide.children[0]!.querySelector("h3 a")).not.toBeNull();
  expect(wide.children[1]).toHaveAttribute("data-card-grid-visual");
  const textOnly = render(<CardGrid treatment="rule" items={cards(["two-thirds", "third"])} />);
  expect(textOnly.container.querySelector('[data-span="two-thirds"]')).not.toHaveClass("ledger-rule-wide");
});
