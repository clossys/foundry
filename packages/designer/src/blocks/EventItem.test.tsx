import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { EventItem, type EventLabels, type EventRecord } from "./EventItem.js";

const labels: EventLabels = { unread: "Unread", changedFrom: "changed from", changedTo: "to", cleared: "cleared" };
const event: EventRecord = {
  id: "evt_1042", at: "2026-10-19T14:32:00Z", timeText: "Oct 19, 14:32 UTC",
  actor: { name: "Priya Nair" },
  summary: <><strong>Priya Nair</strong> moved invoice 1042 to <strong>Approved</strong></>,
  changes: [{ id: "c1", field: "Status", from: "In review", to: "Approved" }, { id: "c2", field: "Approver", from: "Unassigned" }],
  unread: true,
};

describe("EventItem", () => {
  it("E1: describes each field with screen-reader from/to labels, not only an arrow", () => {
    const { container } = render(<EventItem event={event} labels={labels} />);
    const list = container.querySelector("dl")!;
    expect([...list.querySelectorAll("dt")].map(node => node.textContent)).toEqual(["Status", "Approver"]);
    for (const dd of list.querySelectorAll("dd")) {
      expect(within(dd).getByText(labels.changedFrom)).toHaveClass("sr-only");
      expect(within(dd).getByText(labels.changedTo)).toHaveClass("sr-only");
    }
    expect(within(list).getByText("In review")).toHaveClass("line-through", "text-ink-muted");
    expect(list.querySelector("dd")).toHaveTextContent("changed from In review to Approved");
    expect(list.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(list.querySelector("svg")).toHaveClass("rtl:rotate-180");
    expect(list).toHaveClass("tablet:flex", "tablet:flex-wrap", "tablet:gap-x-md");
  });

  it("E2: pairs unread decoration with authored sr-only text and semibold summary, and omits all three when read", () => {
    const { container, rerender } = render(<EventItem event={event} labels={labels} />);
    expect(screen.getByText(labels.unread)).toHaveClass("sr-only");
    expect(container.querySelector("p")).toHaveClass("font-semibold");
    const dot = container.querySelector("p > span[aria-hidden]");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveClass("size-2", "rounded-pill", "bg-accent", "forced-colors:bg-current");
    rerender(<EventItem event={{ ...event, unread: false }} labels={labels} />);
    expect(screen.queryByText(labels.unread)).toBeNull();
    expect(container.querySelector("p")).not.toHaveClass("font-semibold");
    expect(container.querySelector("p > span[aria-hidden]")).toBeNull();
  });

  it("E3: announces a cleared destination and omits a missing source", () => {
    const { container } = render(<EventItem event={{ ...event, changes: [{ id: "clear", field: "Approver", from: "Unassigned" }, { id: "new", field: "Status", to: "Approved" }] }} labels={labels} />);
    const descriptions = container.querySelectorAll("dd");
    expect(descriptions[0]).toHaveTextContent(labels.cleared);
    expect(descriptions[1].querySelector(".line-through")).toBeNull();
    expect(within(descriptions[1]).queryByText(labels.changedFrom)).toBeNull();
    expect(within(descriptions[1]).getByText(labels.changedTo)).toHaveClass("sr-only");
  });

  it("E4: system actors use a decorative Settings icon even with an avatar source; people retain image alt text", () => {
    const { container, rerender } = render(<EventItem event={{ ...event, actor: { name: "Automation", kind: "system", avatarSrc: "/automation.png" }, changes: [] }} labels={labels} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")?.parentElement).toHaveClass("rounded-pill", "bg-surface-sunken", "size-6");
    rerender(<EventItem event={{ ...event, actor: { name: "Priya Nair", avatarSrc: "/priya.png" } }} labels={labels} />);
    expect(screen.getByRole("img", { name: "Priya Nair" })).toHaveAttribute("src", "/priya.png");
  });

  it("E5: preserves ISO dateTime separately from the host-formatted time", () => {
    const { container } = render(<EventItem event={event} labels={labels} />);
    expect(container.querySelector("time")).toHaveAttribute("dateTime", event.at);
    expect(container.querySelector("time")).toHaveTextContent(event.timeText);
  });

  it("E6: renders detail and actions only when supplied", () => {
    const { container, rerender } = render(<EventItem event={event} labels={labels} />);
    expect(container.querySelector('[data-event-detail]')).toBeNull();
    expect(container.querySelector('[data-event-actions]')).toBeNull();
    rerender(<EventItem event={{ ...event, detail: "Approved by the finance team.", actions: <a href="/invoices/1042">View invoice</a> }} labels={labels} />);
    expect(container.querySelector('[data-event-detail]')).toHaveTextContent("Approved by the finance team.");
    expect(container.querySelector('[data-event-actions]')).toContainElement(screen.getByRole("link", { name: "View invoice" }));
  });

  it("E7: renders to HTML without reading browser globals", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(renderToString(<EventItem event={event} labels={labels} />)).toContain('data-event-item=""');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("E8: lets unbroken names and summaries wrap within the text column", () => {
    const long = "Priya".repeat(80);
    const { container } = render(<EventItem event={{ ...event, actor: { name: long }, summary: long }} labels={labels} />);
    expect(container.querySelector("time")?.parentElement).toHaveClass("min-w-0", "break-words");
  });
});
