import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarDate, getLocalTimeZone, today } from "@internationalized/date";
import { I18nProvider } from "react-aria-components";
import { Calendar } from "./Calendar.js";
import { GlyphProvider } from "./glyph-context.js";
import type { IconNode } from "../icons/types.js";

/** A day cell by its full accessible date ("Tuesday, January 14, 2025", plus any state suffix). */
const day = (date: string) => screen.getByRole("button", { name: new RegExp(`(^|, )\\w+, ${date}`) });
/** The visible previous/next control (react-aria also renders a visually hidden pager for screen readers). */
const nav = (name: "Previous" | "Next") => screen.getAllByRole("button", { name }).find(el => el.getAttribute("slot"))!;
const classes = (element: HTMLElement) => element.className.split(/\s+/);
const JAN_2025 = new CalendarDate(2025, 1, 15);

describe("Foundry Calendar", () => {
  it("renders a labelled month grid with weekday headers, a heading and previous/next controls", () => {
    render(<Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} />);
    const grid = screen.getByRole("grid");
    expect(within(grid).getAllByRole("columnheader", { hidden: true })).toHaveLength(7);
    expect(within(grid).getAllByRole("row").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByRole("heading")).toHaveTextContent("January 2025");
    expect(nav("Previous")).toBeInTheDocument();
    expect(nav("Next")).toBeInTheDocument();
    for (const header of within(grid).getAllByRole("columnheader", { hidden: true })) {
      expect(classes(header)).toEqual(expect.arrayContaining(["text-caption", "text-ink-muted"]));
    }
  });

  it("previous and next page the visible month", async () => {
    const user = userEvent.setup();
    render(<Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} />);
    await user.click(nav("Next"));
    expect(screen.getByRole("heading")).toHaveTextContent("February 2025");
    await user.click(nav("Previous"));
    await user.click(nav("Previous"));
    expect(screen.getByRole("heading")).toHaveTextContent("December 2024");
  });

  it("single selection: a pressed day is selected, reported, and filled with the action colour (C12)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} onChange={onChange} />);
    await user.click(day("January 20, 2025"));
    expect(onChange).toHaveBeenCalledWith(new CalendarDate(2025, 1, 20));
    const selected = day("January 20, 2025");
    expect(selected.closest("td")).toHaveAttribute("aria-selected", "true");
    expect(classes(selected)).toEqual(expect.arrayContaining(["bg-action", "text-ink-on-action"]));
    expect(classes(day("January 21, 2025"))).not.toContain("bg-action");
  });

  it("keyboard: arrows move focus by day and week, Enter selects", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} onChange={onChange} autoFocus />);
    expect(day("January 15, 2025")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(day("January 16, 2025")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(day("January 23, 2025")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(new CalendarDate(2025, 1, 23));
  });

  it("focus-visible: keyboard focus draws the focus-shadow ring, never an outline offset or width", async () => {
    const user = userEvent.setup();
    render(<Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} autoFocus />);
    await user.keyboard("{ArrowRight}");
    const focused = day("January 16, 2025");
    expect(focused).toHaveAttribute("data-focus-visible", "true");
    const style = focused.getAttribute("style") ?? "";
    expect(style).toContain("--ui-ring-focus");
    expect(style).not.toMatch(/outline-offset|--ui-focus-offset|--ui-border-focus/);
    expect(day("January 15, 2025").getAttribute("style") ?? "").not.toContain("--ui-ring-focus");
  });

  it("today is marked with the accent ink", () => {
    render(<Calendar aria-label="Due date" />);
    const now = today(getLocalTimeZone());
    const cell = screen.getAllByRole("button").find(el => el.getAttribute("data-today") === "true");
    expect(cell).toBeDefined();
    expect(cell).toHaveTextContent(String(now.day));
    expect(classes(cell!)).toEqual(expect.arrayContaining(["text-accent", "font-semibold"]));
  });

  it("disabled days (outside minValue/maxValue) are dimmed and cannot be selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} minValue={new CalendarDate(2025, 1, 10)} onChange={onChange} />);
    const early = day("January 5, 2025");
    expect(early).toHaveAttribute("aria-disabled", "true");
    expect(early.getAttribute("style") ?? "").toContain("opacity");
    await user.click(early);
    expect(onChange).not.toHaveBeenCalled();
    expect(day("January 12, 2025").getAttribute("style") ?? "").not.toContain("opacity");
  });

  it("unavailable days are struck through and cannot be selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} isDateUnavailable={date => date.day === 17} onChange={onChange} />);
    const blocked = day("January 17, 2025");
    expect(blocked).toHaveAttribute("data-unavailable", "true");
    expect(classes(blocked)).toEqual(expect.arrayContaining(["line-through", "text-ink-muted"]));
    await user.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
    expect(classes(day("January 18, 2025"))).not.toContain("line-through");
  });

  it("days outside the visible month keep their cell but are not shown", () => {
    render(<Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} />);
    const outside = screen.getAllByRole("button", { hidden: true }).filter(el => el.getAttribute("data-outside-month") === "true");
    expect(outside.length).toBeGreaterThan(0);
    for (const cell of outside) expect(classes(cell)).toContain("invisible");
  });

  it("range selection: start and end take the action fill, days between take the sunken surface", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Calendar selection="range" aria-label="Stay" defaultFocusedValue={JAN_2025} onChange={onChange} />);
    await user.click(day("January 10, 2025"));
    await user.click(day("January 14, 2025"));
    expect(onChange).toHaveBeenCalledWith({ start: new CalendarDate(2025, 1, 10), end: new CalendarDate(2025, 1, 14) });
    expect(classes(day("January 10, 2025"))).toEqual(expect.arrayContaining(["bg-action", "text-ink-on-action"]));
    expect(classes(day("January 14, 2025"))).toEqual(expect.arrayContaining(["bg-action", "text-ink-on-action"]));
    const middle = day("January 12, 2025");
    expect(classes(middle)).toContain("bg-surface-sunken");
    expect(classes(middle)).not.toContain("bg-action");
  });

  it("RTL: previous points right, next points left, and arrow keys follow reading order", async () => {
    const user = userEvent.setup();
    const left: IconNode = [["path", { d: "M1 1h1", "data-test-glyph": "left" }]];
    const right: IconNode = [["path", { d: "M2 2h1", "data-test-glyph": "right" }]];
    render(
      <I18nProvider locale="he-IL">
        <GlyphProvider glyphs={{ "assets.icon-chevron-left": left, "assets.icon-chevron-right": right }}>
          <Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} autoFocus />
        </GlyphProvider>
      </I18nProvider>,
    );
    const [previous, next] = screen.getAllByRole("button").filter(el => el.getAttribute("slot") === "previous" || el.getAttribute("slot") === "next");
    expect(previous).toHaveAttribute("slot", "previous");
    expect(previous.querySelector('[data-test-glyph="right"]')).not.toBeNull();
    expect(next.querySelector('[data-test-glyph="left"]')).not.toBeNull();
    const start = document.activeElement as HTMLElement;
    expect(start.textContent).toBe("15");
    await user.keyboard("{ArrowLeft}");
    expect((document.activeElement as HTMLElement).textContent).toBe("16");
  });

  it("LTR uses the left chevron for previous and the right chevron for next", () => {
    const left: IconNode = [["path", { d: "M1 1h1", "data-test-glyph": "left" }]];
    const right: IconNode = [["path", { d: "M2 2h1", "data-test-glyph": "right" }]];
    render(
      <GlyphProvider glyphs={{ "assets.icon-chevron-left": left, "assets.icon-chevron-right": right }}>
        <Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} />
      </GlyphProvider>,
    );
    expect(nav("Previous").querySelector('[data-test-glyph="left"]')).not.toBeNull();
    expect(nav("Next").querySelector('[data-test-glyph="right"]')).not.toBeNull();
  });

  it("merges a consumer className onto the root", () => {
    const { container } = render(<Calendar aria-label="Due date" defaultFocusedValue={JAN_2025} className="mt-lg" />);
    expect(container.firstElementChild).toHaveClass("mt-lg");
  });
});
