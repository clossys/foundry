import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordCards } from "./RecordCards.js";
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import { foundrySourceTokenReads, tokenPropertyIndex, type EmittingSlot } from "../importers/foundry-source-reads.js";

describe("RecordCards full content", () => {
  it("keeps the real section's source token reads within its existing Cards contract", () => {
    const source = readFileSync(resolve(import.meta.dirname, "RecordCards.tsx"), "utf8");
    const reads = foundrySourceTokenReads(source, tokenPropertyIndex(tokenSlots as unknown as readonly EmittingSlot[]));
    const allowed = sectionSlots.find(slot => slot.id === "sections.cards")!.contract.allowedReads.tokens;
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter(token => !allowed.includes(token))).toEqual([]);
  });

  it("names selectable groups from their native headings when titles contain linked React content", () => {
    const records = [{ id: "direction", title: <><a href="#segment">Segment</a> Direction</> }];
    const { rerender } = render(<><RecordCards records={records} headingLevel={4} onSelect={vi.fn()} /><RecordCards records={records} headingLevel={4} onSelect={vi.fn()} /></>);
    const cards = screen.getAllByRole("group", { name: "Segment Direction" });
    const labels = cards.map(card => card.getAttribute("aria-labelledby"));
    expect(new Set(labels).size).toBe(2);
    for (const card of cards) expect(within(card).getByRole("heading", { level: 4, name: "Segment Direction" })).toHaveAttribute("id", card.getAttribute("aria-labelledby"));
    rerender(<RecordCards records={[...records].reverse()} headingLevel={4} onSelect={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Segment Direction" })).toBeInTheDocument();
  });

  it("preserves a complete body with interactive descendants between supporting copy and metadata", async () => {
    const action = vi.fn();
    const select = vi.fn();
    const user = userEvent.setup();
    render(<RecordCards selectedId="record" onSelect={select} records={[{
      id: "record", title: "Record", description: "Supporting copy", meta: "Record metadata",
      body: <section aria-label="Bound specimen"><h4>Detailed content</h4><p>All of the bound content.</p><button onClick={action}>Run action</button></section>,
    }]} />);
    const card = screen.getByRole("group", { name: "Record" });
    const body = within(card).getByRole("region", { name: "Bound specimen" });
    expect(within(body).getByRole("heading", { name: "Detailed content", level: 4 })).toBeInTheDocument();
    expect(body).toHaveTextContent("All of the bound content.");
    expect([...card.children].map(child => child.textContent)).toEqual(["Record", "Supporting copy", "Detailed contentAll of the bound content.Run action", "Record metadata"]);
    const button = within(body).getByRole("button", { name: "Run action" });
    expect(button.parentElement?.closest("button, [role=button]")).toBeNull();
    await user.click(button);
    expect(action).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith("record");
  });

  it("packs each declared width in the native grid and keeps the list full width", () => {
    const records = [
      { id: "full", title: "Full", span: "full" as const },
      { id: "half", title: "Half", span: "half" as const },
      { id: "third", title: "Third", span: "third" as const },
      { id: "default", title: "Default" },
    ];
    const { rerender } = render(<RecordCards records={records} />);
    const list = screen.getByRole("list");
    expect(list).toHaveClass("grid-cols-1", "tablet:grid-cols-2", "desktop:grid-cols-6");
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-span", "full");
    expect(items[0]).toHaveClass("col-span-full");
    expect(items[1]).toHaveClass("desktop:col-span-3");
    expect(items[2]).toHaveClass("desktop:col-span-2");
    expect(items[3]).toHaveAttribute("data-span", "third");
    expect(items[3]).toHaveClass("desktop:col-span-2");
    rerender(<RecordCards records={records} layout="list" />);
    expect(screen.getByRole("list")).toHaveClass("flex-col");
    for (const item of screen.getAllByRole("listitem")) expect(item.className).not.toMatch(/col-span/);
  });

  it("reports pointer and card keyboard selection while preserving the body's own keyboard events", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const action = vi.fn();
    const records = [
      { id: "a", title: "Alpha", body: <button onClick={action}>Nested action</button> },
      { id: "b", title: "Beta" },
    ];
    const { rerender } = render(<RecordCards records={records} selectedId="a" onSelect={select} />);
    const alpha = screen.getByRole("group", { name: "Alpha" });
    const beta = screen.getByRole("group", { name: "Beta" });
    expect(alpha).toHaveAttribute("aria-current", "true");
    expect(alpha).toHaveAttribute("data-selected", "");
    expect(beta).not.toHaveAttribute("aria-current");
    await user.click(beta);
    expect(select).toHaveBeenLastCalledWith("b");
    select.mockClear();
    alpha.focus();
    await user.keyboard("{Enter} ");
    expect(select.mock.calls).toEqual([["a"], ["a"]]);
    select.mockClear();
    screen.getByRole("button", { name: "Nested action" }).focus();
    await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledTimes(1);
    expect(select.mock.calls).toEqual([["a"]]);
    rerender(<RecordCards records={records} selectedId="b" onSelect={select} />);
    expect(alpha).not.toHaveAttribute("data-selected");
    expect(beta).toHaveAttribute("aria-current", "true");
  });

  it("keeps static cards outside the keyboard tab order", () => {
    render(<RecordCards records={[{ id: "static", title: "Static", body: 0 }]} />);
    const item = screen.getByRole("listitem");
    expect(item.textContent).toBe("Static0");
    expect(item.firstElementChild).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("group")).toBeNull();
  });
});
