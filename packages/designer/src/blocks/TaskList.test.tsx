import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { TaskList, type TaskListItem } from "./TaskList.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "../components/internal/ui-vars.js";

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

  it("S2-5 T3: preserves supplied empty content, root attributes and handlers with no meter or ordered list", () => {
    const clicked = vi.fn();
    const { container } = render(<TaskList {...props} items={[]} emptyState={{ ...props.emptyState,
      id: "empty-tasks", role: "status", "aria-label": "Task availability", className: "host-empty",
      "data-testid": "empty-tasks", onClick: clicked, icon: <span data-testid="host-icon">Host icon</span>,
      action: <button>Find tasks</button>, children: <span>Ignored children</span>,
    }} />);
    const root = screen.getByRole("status", { name: "Task availability" });
    expect(root).toHaveAttribute("id", "empty-tasks");
    expect(root).toHaveAttribute("data-testid", "empty-tasks");
    expect(root).toHaveClass("host-empty");
    expect(container.querySelectorAll("#empty-tasks")).toHaveLength(1);
    expect(within(root).getByRole("heading", { name: props.emptyState.title, level: 2 })).toBeInTheDocument();
    expect(screen.getByText(props.emptyState.description)).toBeVisible();
    expect(within(root).getByTestId("host-icon")).toHaveTextContent("Host icon");
    fireEvent.click(within(root).getByRole("button", { name: "Find tasks" }));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Ignored children")).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
    expect(container.querySelector('[data-part="fill"]')).toBeNull();
  });

  it.each([undefined, null, false, "", 0])("S2-5 omits optional empty content and wrappers for %s", optional => {
    const { container } = render(<TaskList {...props} items={[]} emptyState={{ title: "Nothing pending", icon: optional, description: optional, action: optional, id: "empty-minimal" }} />);
    const root = container.querySelector("#empty-minimal")!;
    expect(within(root).getByRole("heading", { level: 2, name: "Nothing pending" })).toBeInTheDocument();
    expect(root.children).toHaveLength(1);
    expect(root.querySelector("p")).toBeNull();
    expect(root.textContent).toBe("Nothing pending");
    expect(screen.queryByRole("meter")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
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
      const empty = renderToString(<TaskList {...props} items={[]} emptyState={{ ...props.emptyState, icon: <span>Server icon</span>, action: <a href="/tasks">Find tasks</a> }} />);
      expect(empty).toContain("No tasks remain");
      expect(empty).toContain("New tasks will appear here.");
      expect(empty).toContain("Server icon");
      expect(empty).toContain('href="/tasks"');
      expect(empty).not.toContain("<ol");
      expect(empty).not.toContain('role="meter"');
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
