import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ActivityFeed } from "./ActivityFeed.js";
import { activityFeedSample } from "./activity-feed/sample.js";

describe("ActivityFeed", () => {
  it("AF1: renders one ordered list of EventItem rows in authored order, named by aria-label", () => {
    render(<ActivityFeed {...activityFeedSample} groups={undefined} />);
    const region = screen.getByRole("region", { name: "Recent activity" });
    const list = within(region).getByRole("list");
    expect(list.tagName).toBe("OL");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map(row => row.getAttribute("data-event-id"))).toEqual(["e1", "e2", "e3"]);
    for (const row of rows) expect(row.querySelector("[data-event-item]")).not.toBeNull();
    expect(within(rows[0]!).getByText("Unread")).toBeInTheDocument();
    expect(rows[1]!.querySelector("time")).toHaveAttribute("datetime", "2026-03-12T08:02:00Z");
  });

  it("AF2: groups events under visible group headings in the grouping order", () => {
    render(<ActivityFeed {...activityFeedSample} />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map(heading => heading.textContent)).toEqual(["Today", "Yesterday"]);
    const groups = document.querySelectorAll("[data-activity-group]");
    expect([...groups].map(group => [...group.querySelectorAll("[data-event-id]")].map(row => row.getAttribute("data-event-id")))).toEqual([["e1", "e2"], ["e3"]]);
  });

  it("AF3: refuses a grouping that names an unknown event or leaves an event ungrouped", () => {
    const { groups } = activityFeedSample;
    expect(() => renderToString(<ActivityFeed {...activityFeedSample} groups={[{ ...groups![0]!, eventIds: ["e1", "missing"] }, groups![1]!]} />)).toThrow(/unknown event missing/);
    expect(() => renderToString(<ActivityFeed {...activityFeedSample} groups={[groups![0]!]} />)).toThrow(/event e3 is in no group/);
  });

  it("AF4: renders the filters region before the list and the empty state when there are no events", () => {
    render(<ActivityFeed {...activityFeedSample} filters={<button type="button">Only mentions</button>} />);
    const filters = document.querySelector("[data-activity-filters]")!;
    expect(within(filters as HTMLElement).getByRole("button", { name: "Only mentions" })).toBeVisible();
    expect(filters.compareDocumentPosition(document.querySelector("ol")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const { container } = render(<ActivityFeed {...activityFeedSample} events={[]} groups={undefined} />);
    expect(within(container).getByText("No activity yet")).toBeVisible();
    expect(container.querySelector("ol")).toBeNull();
  });

  it("AF5: is server-renderable", () => {
    expect(renderToString(<ActivityFeed {...activityFeedSample} />)).toContain("data-activity-group");
  });
});
