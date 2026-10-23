import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { TaskList, type TaskListItem } from "./TaskList.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "../atoms/internal/ui-vars.js";

const items: TaskListItem[] = [
  { id: "t1", title: "Invite your team", description: "Add at least two colleagues.", status: "done" },
  { id: "t2", title: "Connect a data source", status: "in-progress", href: "/settings/sources", meta: "Step 2 of 3" },
  { id: "t3", title: "Review billing details", status: "blocked", description: "Waiting on an administrator." },
  { id: "t4", title: "Publish your first report", status: "todo" },
];
const statusLabels = { todo: "To do", "in-progress": "In progress", blocked: "Blocked", done: "Done" };
const props = { "aria-label": "Getting started", items, statusLabels, progressText: "1 of 4 done", emptyState: { title: "No tasks remain", description: "New tasks will appear here." } };

describe("TaskList", () => {
  it("T1: renders an ordered checklist with a visible label for each status", () => {
    const { container } = render(<TaskList {...props} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(items.length);
    items.forEach((item, index) => {
      expect(rows[index]).toHaveTextContent(String(item.title));
      expect(within(rows[index]).getByText(statusLabels[item.status])).toBeVisible();
      expect(rows[index]).toHaveAttribute("data-status", item.status);
    });
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(screen.getByRole("region", { name: props["aria-label"] })).toBeInTheDocument();
  });

  it("T2: measures only done tasks against the full item count and shows authored progress text", () => {
    const { container } = render(<TaskList {...props} />);
    const meter = screen.getByRole("meter", { name: props.progressText });
    expect(meter).toHaveAttribute("aria-valuenow", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "4");
    expect(meter).toHaveAttribute("aria-valuetext", props.progressText);
    expect(meter).toHaveTextContent(props.progressText);
    expect(container.querySelector('[data-part="fill"]')).toHaveStyle({ inlineSize: "25%" });
  });

  it("T3: shows the supplied empty state with no meter or ordered list", () => {
    const { container } = render(<TaskList {...props} items={[]} />);
    expect(screen.getByRole("heading", { name: props.emptyState.title })).toBeInTheDocument();
    expect(screen.getByText(props.emptyState.description)).toBeVisible();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
    expect(container.querySelector('[data-part="fill"]')).toBeNull();
  });

  it("T4: gives linked rows one title-named stretched anchor and a token-sized target; unlinked rows stay unfocusable", () => {
    const { container } = render(<TaskList {...props} />);
    const rows = container.querySelectorAll("li");
    const link = within(rows[1]).getByRole("link", { name: "Connect a data source" });
    expect(link).toHaveAttribute("href", "/settings/sources");
    expect(rows[1].querySelectorAll("a[href]")).toHaveLength(1);
    expect(link).toHaveAttribute("data-card-link", "");
    expect(link).toHaveClass("focus-visible:after:outline-accent");
    expect(rows[1]).toHaveClass("relative", "isolate");
    expect(rows[1].closest("section")).toHaveClass("px-sm", "tablet:px-md");
    expect((rows[1] as HTMLElement).style.minBlockSize).toBe(UI_LAYOUT_TAP_TARGET);
    expect((rows[1] as HTMLElement).style.borderBlockStartWidth).toBe(UI_BORDER_HAIRLINE);
    expect(rows[0].querySelector("a")).toBeNull();
    expect(rows[0]).not.toHaveAttribute("tabindex");
  });

  it("T5: maps each status to its semantic StatusMark tone and shape", () => {
    const { container } = render(<TaskList {...props} />);
    const tones = ["success", "info", "danger", "neutral"];
    [...container.querySelectorAll("li")].forEach((row, index) => {
      expect(row.querySelector("[data-tone]")).toHaveAttribute("data-tone", tones[index]);
      expect(row.querySelector('[data-part="mark"]')).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("T6: renders to HTML without reading browser globals", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(renderToString(<TaskList {...props} />)).toContain("<ol");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("T7: renders supplied description and metadata, omitting absent wrappers", () => {
    const { container } = render(<TaskList {...props} />);
    const rows = container.querySelectorAll("li");
    expect(rows[0].querySelector('[data-description]')).toHaveTextContent("Add at least two colleagues.");
    expect(rows[1].querySelector('[data-metadata]')).toHaveTextContent("Step 2 of 3");
    expect(rows[3].querySelector('[data-description]')).toBeNull();
    expect(rows[3].querySelector('[data-metadata]')).toBeNull();
  });
});
