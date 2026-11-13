import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockItem as Item } from "./StockItem.js";
import { Items } from "./Items.js";
import type { ItemData, ItemSpan } from "./types.js";

const data = (count: number): ItemData[] => Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, heading: `Title ${index}` }));
const occupancy: readonly [readonly ItemSpan[], readonly number[]][] = [
  [["third", "third", "third"], [6, 6, 12]],
  [["two-thirds", "third"], [12, 12]],
  [["third", "two-thirds"], [12, 12]],
  [["two-thirds", "third", "third", "third", "third"], [12, 6, 6, 6, 6]],
  [["third", "third", "third", "third", "third", "third"], [6, 6, 6, 6, 6, 6]],
  [["half", "half"], [6, 6]],
];
describe("canonical successors to retired wrapper layout assertions", () => {
  it.each(occupancy)("preserves authored bento occupancy %s", (spans, expected) => {
    const items = data(spans.length).map((item, index) => ({ ...item, span: spans[index] }));
    const { container } = render(<Items arrangement="bento" items={items} />);
    const cells = [...container.querySelectorAll("li")];
    expect(cells).toHaveLength(spans.length);
    cells.forEach((cell, index) => {
      expect(cell).toHaveClass(`tablet:col-span-${expected[index]}`);
      const span = spans[index]!;
      if (span === "third") expect(cell).toHaveClass("tablet-lg:col-span-4");
      if (span === "two-thirds") expect(cell).toHaveClass("tablet-lg:col-span-8");
      expect(cell.textContent).toBe(items[index]!.heading);
    });
  });
  it.each([
    ["two-thirds", "third"], ["third", "two-thirds"], ["third", "third", "third"],
    ["half", "half"], ["full", "full"], ["two-thirds", "third", "third", "third", "third"],
  ] as readonly (readonly ItemSpan[])[])("accepts complete authored bento rows %s", (...spans) => {
    const { container } = render(<Items arrangement="bento" items={data(spans.length).map((item, index) => ({ ...item, span: spans[index] }))} />);
    expect(container.querySelectorAll("[data-item]")).toHaveLength(spans.length);
  });
  it.each([
    ["two-thirds", "half"], ["half", "third"], ["third", "third"], ["full"],
    ["third", "third", "third", "third", "third", "third", "full"],
  ] as readonly (readonly ItemSpan[])[])("refuses incomplete, overflowing or oversized bento rows %s", (...spans) => {
    expect(() => render(<Items arrangement="bento" items={data(spans.length).map((item, index) => ({ ...item, span: spans[index] }))} />)).toThrow(RangeError);
  });
  it("merges consumer collection gaps without exposing a compatibility frame", () => {
    const { container } = render(<Items arrangement="columns" items={data(3)} className="gap-y-lg" />);
    expect(container.querySelector("[data-items]")).toHaveClass("gap-y-lg");
    expect(container.querySelector("[data-items]")).not.toHaveClass("gap-y-3xl");
  });
  it("retains ordinary visual containment after authored copy", () => {
    const { container } = render(<Item id="one" heading="Title" description="Body" visual={<img src="/example.png" alt="Example" />} ground="base" />);
    const body = container.querySelector("[data-item]")!;
    const visual = body.querySelector("[data-item-visual]")!;
    expect(visual.parentElement).toBe(body);
    expect(visual).toHaveAttribute("data-slot", "item-footer");
    expect(body.lastElementChild).toBe(visual);
    expect(visual.previousElementSibling).toHaveAttribute("data-slot", "item-content");
    expect(visual.previousElementSibling!.lastElementChild).toHaveAttribute("data-item-description");
    expect(screen.getByRole("img", { name: "Example" })).not.toHaveAttribute("aria-hidden");
  });
  it.each([2, 3, 4])("keeps %s named groups with the canonical responsive rows policy", count => {
    const items = data(count * 2);
    const groups = Array.from({ length: count }, (_, index) => ({ id: `group-${index}`, label: `Group ${index}`, items: [`item-${index * 2 + 1}`, `item-${index * 2}`] }));
    const { container } = render(<Items arrangement="rows" columns={2} items={items} groups={groups} headingLevel={4} />);
    expect(container.querySelector("[data-items]")).toHaveClass("grid-cols-1", "tablet:grid-cols-2", "tablet:gap-x-3xl");
    const rendered = screen.getAllByRole("group");
    expect(rendered).toHaveLength(count);
    const names = new Set<string>();
    rendered.forEach((group, index) => {
      expect(group).toHaveAccessibleName(`Group ${index}`);
      const label = group.querySelector("p")!;
      expect(label).toHaveClass("text-caption", "font-mono");
      expect(group).toHaveAttribute("aria-labelledby", label.id);
      names.add(label.id);
      expect(within(group).getAllByRole("heading", { level: 4 }).map(node => node.textContent)).toEqual([`Title ${index * 2 + 1}`, `Title ${index * 2}`]);
      expect(within(group).getAllByRole("listitem")).toHaveLength(2);
    });
    expect(names.size).toBe(count);
  });
});

describe("canonical ground and linked stock Item successors", () => {
  for (const ground of ["base", "sunken", "inverse"] as const) {
    it(`renders a linked ${ground} item as the stock Item's single link with ground copy`, () => {
      const { container } = render(<Item id="one" heading="Title" description="Body" icon={<svg data-testid="supplied-icon" />} href="/one" ground={ground} />);
      const body = container.querySelector("[data-item]")!;
      const link = screen.getByRole("link");
      expect(screen.getAllByRole("link")).toHaveLength(1);
      expect(link).toBe(body);
      expect(link).toHaveAttribute("data-slot", "item");
      expect(link).toHaveAttribute("href", "/one");
      expect(link).toHaveTextContent("TitleBody");
      const icon = screen.getByTestId("supplied-icon");
      expect(icon.parentElement).toHaveAttribute("data-slot", "item-media");
      expect(icon.parentElement).toHaveAttribute("aria-hidden", "true");
      expect(icon.parentElement).toHaveClass(ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
      expect(screen.getByText("Title")).toHaveClass(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
      expect(screen.getByText("Body")).toHaveClass(ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
    });
    it(`keeps an unlinked ${ground} item free of a link and action decoration`, () => {
      const { container } = render(<Item id="one" heading="Title" ground={ground} />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(container.querySelector("svg")).toBeNull();
      expect(container.querySelector("[data-item]")!.tagName).toBe("DIV");
    });
  }
});
