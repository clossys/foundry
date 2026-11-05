import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "../../components/internal/ui-vars.js";
import { Item } from "./Item.js";
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
    const { container } = render(<Item id="one" heading="Title" description="Body" visual={<img src="/example.png" alt="Example" />} treatment="plain" size="display" ground="base" />);
    const body = container.querySelector("[data-item]")!;
    const visual = body.querySelector("[data-item-visual]")!;
    expect(visual.parentElement).toBe(body);
    expect(visual).toHaveClass("mt-auto", "w-full", "min-w-0");
    expect(body.lastElementChild).toBe(visual);
    expect(visual.previousElementSibling).toHaveAttribute("data-item-description");
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

describe("canonical ground and linked frame successors", () => {
  for (const ground of ["base", "sunken", "inverse"] as const) {
    for (const treatment of ["plain", "rule", "plate"] as const) {
      it(`retains ${ground} ${treatment} title hit, ring and secondary copy`, () => {
        const { container } = render(<Item id="one" heading="Title" description="Body" icon={<svg data-testid="supplied-icon" />} href="/one" treatment={treatment} size="standard" ground={ground} />);
        const body = container.querySelector("[data-item]")!;
        if (treatment === "plate") {
          expect(body).toHaveAttribute("data-variant", "plate");
          expect(body).toHaveClass("rounded-panel", "p-lg", ground === "base" ? "bg-surface-sunken" : ground === "sunken" ? "bg-surface-raised" : "bg-surface-inverse-raised");
        }

        const link = screen.getByRole("link", { name: "Title" });
        expect(body).toHaveClass("relative", "isolate");
        expect((body as HTMLElement).style.minBlockSize).toBe(UI_LAYOUT_TAP_TARGET);
        expect(link).toHaveClass("after:absolute", "after:rounded-panel", "focus-visible:after:outline-2", "focus-visible:after:outline-offset-2", ground === "inverse" ? "focus-visible:after:outline-accent-on-inverse" : "focus-visible:after:outline-accent");
        expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
        expect(link.parentElement).toHaveClass(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
        const icon = screen.getByTestId("supplied-icon");
        expect(icon.parentElement).toHaveAttribute("aria-hidden", "true");
        expect(icon.parentElement).toHaveClass(ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
        expect(icon.closest("a")).toBeNull();
        expect(screen.getByText("Body").closest("a")).toBeNull();
        expect(screen.getByText("Body")).toHaveClass(ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
        if (treatment === "plate") {
          expect(link).toHaveClass("after:inset-0");
          expect(body).toHaveClass("border", "border-transparent");
          expect((body as HTMLElement).style.borderWidth).toBe(UI_BORDER_HAIRLINE);
        } else {
          expect(link).toHaveClass("after:-inset-x-sm", "tablet:after:-inset-x-md");
          expect(body).toHaveClass("before:-inset-x-sm", "tablet:before:-inset-x-md");
          if (treatment === "rule") {
            expect(link).toHaveClass("after:top-0", "after:-bottom-sm", "tablet:after:-bottom-md");
            expect(body).toHaveClass("border-t", "pt-lg", ground === "inverse" ? "border-line-on-inverse" : "border-line-strong");
            expect((body as HTMLElement).style.borderBlockStartWidth).toBe(UI_BORDER_HAIRLINE);
          }
        }
      });
    }
    it(`keeps an unlinked ${ground} item free of a hit context and action decoration`, () => {
      const { container } = render(<Item id="one" heading="Title" treatment="plain" size="standard" ground={ground} />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(container.querySelector("svg")).toBeNull();
      expect(container.querySelector("[data-item]")).not.toHaveClass("isolate");
    });
  }
});
