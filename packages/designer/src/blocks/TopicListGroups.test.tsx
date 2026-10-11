import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { TopicList, type TopicListProps } from "./TopicList.js";
const groups = (count = 4, rows = 2) => Array.from({ length: count }, (_, g) => ({ id: `group ${g}`, label: `Category ${g}`, items: Array.from({ length: rows }, (_, i) => ({ id: `item-${g}-${i}`, heading: `Topic ${g}-${i}`, description: "One short line." })) }));
const unsafe = (value: unknown) => value as TopicListProps;
describe("TopicList groups", () => {
  it("names each group with a real heading and preserves DOM reading order", () => {
    const { container } = render(<TopicList groups={groups()} />);
    const sections = [...container.querySelectorAll("section")];
    expect(sections).toHaveLength(4);
    expect(sections.map((s) => s.querySelector("h3")?.textContent)).toEqual(groups().map((g) => g.label));
    sections.forEach((s) => { expect(s.getAttribute("aria-labelledby")).toBe(s.querySelector("h3")?.id); expect(s.querySelectorAll("ul > li")).toHaveLength(2); });
    expect(container.querySelectorAll("li")).toHaveLength(8);
  });
  it("keeps four groups in two columns from tablet and never four across (M-TG1)", () => {
    const { container } = render(<TopicList groups={groups()} />);
    const root = container.querySelector("[data-topic-list]")!;
    expect(root).toHaveAttribute("data-groups", "4"); expect(root).toHaveClass("grid-cols-1", "tablet:grid-cols-2"); expect(root.className).not.toMatch(/grid-cols-4/);
  });
  it("stacks three groups until tablet-lg and uses two columns for two", () => {
    const three = renderToStaticMarkup(<TopicList groups={groups(3)} />);
    expect(three).toContain("tablet-lg:grid-cols-3"); expect(three).not.toContain("tablet:grid-cols-");
    expect(renderToStaticMarkup(<TopicList groups={groups(2)} />)).toContain("tablet:grid-cols-2");
  });
  it("has no first-row hairline or final-row bottom padding on every ground", () => {
    for (const ground of ["base", "sunken", "inverse"] as const) {
      const { container, unmount } = render(<TopicList groups={groups(2)} ground={ground} />);
      for (const section of container.querySelectorAll("section")) {
        expect(section.style.borderBlockStartWidth).toBe("var(--ui-border-rule, 2px)");
        expect(section).toHaveClass(ground === "inverse" ? "border-ink-on-inverse" : "border-ink-primary");
        expect(section.querySelector("h3")).toHaveClass("font-mono", "text-caption", "uppercase", "tracking-label", ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
        const rows = section.querySelectorAll("li"); expect(rows[0]).not.toHaveClass("border-t"); expect(rows[0]!.style.borderBlockStartWidth).toBe(""); expect(rows[1]).toHaveClass("border-t", "pb-0");
      }
      unmount();
    }
  });
  it("supports h4 without leaking headingLevel and assigns unique names across two lists", () => {
    const { container } = render(<><TopicList groups={groups(2)} /><TopicList groups={groups(2)} headingLevel={4} /></>);
    const headings = [...container.querySelectorAll("h3,h4")]; expect(new Set(headings.map((h) => h.id)).size).toBe(4);
    expect(container.querySelectorAll("h4")).toHaveLength(2); expect(container.innerHTML).not.toContain("headingLevel");
    container.querySelectorAll("section").forEach((s) => expect(container.querySelectorAll(`[id="${s.getAttribute("aria-labelledby")}"]`)).toHaveLength(1));
  });
  it("refuses both/neither, columns and invalid grouped counts", () => {
    for (const value of [{}, { items: [], groups: groups() }, { groups: groups(), columns: 1 }]) expect(() => renderToStaticMarkup(<TopicList {...unsafe(value)} />)).toThrow(TypeError);
    for (const value of [groups(1), groups(5), groups(2, 1), groups(2, 5), groups(4, 4)]) expect(() => renderToStaticMarkup(<TopicList groups={value} />)).toThrow(RangeError);
  });
  it("keeps legacy items SSR byte-identical", () => {
    expect(renderToStaticMarkup(<TopicList items={[{ id: "a", heading: "Alpha" }, { id: "b", heading: "Beta", description: "One line." }]} />)).toBe('<ul data-topic-list="" data-columns="2" class="grid grid-cols-1 tablet:grid-cols-2 tablet:gap-x-3xl"><li class="flex min-w-0 items-start gap-md border-t py-lg border-line-base" style="border-block-start-width:var(--ui-border-hairline, 1px)"><div class="flex min-w-0 flex-col gap-xs"><p class="text-body-l font-body font-medium text-ink-primary">Alpha</p></div></li><li class="flex min-w-0 items-start gap-md border-t py-lg border-line-base" style="border-block-start-width:var(--ui-border-hairline, 1px)"><div class="flex min-w-0 flex-col gap-xs"><p class="text-body-l font-body font-medium text-ink-primary">Beta</p><p class="text-body text-pretty text-ink-secondary">One line.</p></div></li></ul>');
  });
});
