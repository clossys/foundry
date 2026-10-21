import { act } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-aria-components";
import { Badge } from "../atoms/Badge.js";
import { ResourceList, type ResourceListItem } from "./ResourceList.js";

const items: ResourceListItem[] = [
  { id: "r1", textValue: "Quarterly planning notes", title: "Quarterly planning notes", description: "Shared with the leadership group.", meta: "Edited 2 days ago", status: <Badge variant="info">Draft</Badge>, href: "#planning-note", actions: [{ id: "dup", label: "Duplicate", onAction: () => {} }, { id: "del", label: "Delete note", onAction: () => {}, isDestructive: true }] },
  { id: "r2", textValue: "Vendor onboarding checklist", title: "Vendor onboarding checklist", meta: "Edited last week", status: <Badge variant="success">Published</Badge> },
  { id: "r3", textValue: "Archived roadmap", title: "Archived roadmap", isDisabled: true, meta: "Read only" },
];
const emptyState = { title: "No notes yet", description: "Add a note to begin." };
const selectRowLabel = (text: string) => `Choose ${text}`;
const actionsLabel = (text: string) => `Options for ${text}`;
const base = { "aria-label": "Notes", items, emptyState, actionsLabel };

describe("ResourceList", () => {
  it("R1 requires host selection copy and uses textValue for checkbox names", () => {
    expect(() => render(<ResourceList {...base} selectionMode="multiple" />)).toThrow(TypeError);
    render(<ResourceList {...base} items={[{ id: "one", textValue: "Record identity", title: <strong>Display title</strong> }]} selectionMode="multiple" selectRowLabel={selectRowLabel} />);
    expect(screen.getByRole("checkbox")).toHaveAccessibleName("Choose Record identity");
  });

  it("R2 gives error priority over empty and loading while preserving toolbar", () => {
    const { rerender } = render(<ResourceList {...base} items={[]} error={<p>Notes unavailable</p>} toolbar={<p>Filter notes</p>} />);
    expect(screen.getByText("Notes unavailable")).toBeVisible();
    expect(screen.getByText("Filter notes")).toBeVisible();
    expect(screen.queryByText("No notes yet")).not.toBeInTheDocument();
    rerender(<ResourceList {...base} items={[]} isLoading loadingLabel="Fetching notes" error={<p>Notes unavailable</p>} />);
    expect(screen.getByText("Notes unavailable")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("R3 requires host action copy and names each overflow trigger from textValue", () => {
    expect(() => render(<ResourceList {...base} actionsLabel={undefined} />)).toThrow(TypeError);
    render(<ResourceList {...base} />);
    expect(screen.getAllByRole("button", { name: "Options for Quarterly planning notes" }).length).toBeGreaterThan(0);
  });

  it("R4 replaces the grid with hidden skeleton rows and a host loading announcement", () => {
    expect(() => render(<ResourceList {...base} isLoading />)).toThrow(TypeError);
    const { container } = render(<ResourceList {...base} isLoading loadingLabel="Fetching notes" loadingRowCount={3} />);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Fetching notes");
    expect(container.querySelectorAll('[aria-hidden="true"] .bg-skeleton-fill')).toHaveLength(3);
  });

  it("R5 follows href by Enter and press with empty selection without selecting", async () => {
    const navigate = vi.fn(); const change = vi.fn(); const user = userEvent.setup();
    render(<RouterProvider navigate={navigate}><ResourceList {...base} selectionMode="multiple" selectRowLabel={selectRowLabel} selectedKeys={new Set()} onSelectionChange={change} /></RouterProvider>);
    const linkRow = screen.getByRole("row", { name: /Quarterly planning notes/ });
    act(() => linkRow.focus()); await user.keyboard("{Enter}"); await user.click(linkRow);
    expect(navigate.mock.calls.map(call => call[0])).toEqual(["#planning-note", "#planning-note"]);
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Choose Quarterly planning notes" })).not.toBeChecked();
  });

  it("R5 preserves peer href behavior during active selection: press toggles without routing", async () => {
    const selected = new Set(["r2"]);
    const change = vi.fn(); const navigate = vi.fn();
    const user = userEvent.setup();
    render(<RouterProvider navigate={navigate}><ResourceList {...base} selectionMode="multiple" selectRowLabel={selectRowLabel} selectedKeys={selected} onSelectionChange={change} /></RouterProvider>);
    const linkRow = screen.getByRole("row", { name: /Quarterly planning notes/ });
    act(() => linkRow.focus());
    await user.keyboard("{Enter}");
    const afterEnter = { navigation: navigate.mock.calls.map(call => call[0]), selection: change.mock.calls.map(call => [...call[0]]) };
    await user.click(linkRow);
    const afterClick = { navigation: navigate.mock.calls.map(call => call[0]), selection: change.mock.calls.map(call => [...call[0]]) };
    expect({ afterEnter, afterClick }).toEqual({
      afterEnter: { navigation: [], selection: [] },
      afterClick: { navigation: [], selection: [["r2", "r1"]] },
    });
    expect(screen.getByRole("checkbox", { name: "Choose Vendor onboarding checklist" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Choose Quarterly planning notes" })).not.toBeChecked();
  });

  it("R6 Space toggles bulk content and Enter performs one row action", async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(<ResourceList {...base} items={[items[1]!]} onAction={action} selectionMode="multiple" selectRowLabel={selectRowLabel} bulkBar={<p>Bulk actions</p>} footer={<p>More notes</p>} />);
    expect(screen.queryByText("Bulk actions")).not.toBeInTheDocument();
    const row = screen.getByRole("row");
    act(() => row.focus()); await user.keyboard(" ");
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Bulk actions")).toBeVisible();
    await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledExactlyOnceWith("r2");
    expect(row).toHaveAttribute("aria-selected", "true");
    await user.keyboard(" ");
    expect(screen.queryByText("Bulk actions")).not.toBeInTheDocument();
    expect(screen.getByText("More notes")).toBeVisible();
  });

  it("R7 prevents disabled row selection and associates disabled action reasons", async () => {
    const change = vi.fn(); const action = vi.fn(); const user = userEvent.setup();
    render(<ResourceList {...base} items={[{ ...items[2]!, actions: [{ id: "edit", label: "Edit note", onAction: action, disabledReason: "This archive is read only." }] }]} selectionMode="multiple" selectRowLabel={selectRowLabel} onSelectionChange={change} />);
    const row = screen.getByRole("row");
    expect(row).toHaveAttribute("aria-disabled", "true");
    await user.click(row);
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    const button = screen.getByRole("button", { name: "Edit note" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("This archive is read only.");
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    await user.click(button); expect(action).not.toHaveBeenCalled();
  });

  it("R8 renders a destructive menu action and invokes it once", async () => {
    const action = vi.fn(); const rowAction = vi.fn(); const selection = vi.fn(); const user = userEvent.setup();
    render(<ResourceList {...base} items={[{ ...items[0]!, href: undefined, actions: [{ id: "del", label: "Delete note", onAction: action, isDestructive: true }] }]}
      onAction={rowAction} selectionMode="multiple" selectRowLabel={selectRowLabel} onSelectionChange={selection} />);
    await user.click(screen.getAllByRole("button", { name: "Options for Quarterly planning notes" })[0]!);
    const item = await screen.findByRole("menuitem", { name: "Delete note" });
    expect(item).toHaveClass("text-status-danger-text");
    await user.click(item);
    expect(action).toHaveBeenCalledExactlyOnceWith();
    expect(rowAction).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("R9 places EmptyState within the section and truncates long titles by text identity", () => {
    const { rerender } = render(<ResourceList {...base} items={[]} />);
    const section = screen.getByRole("region", { name: "Notes" });
    expect(within(section).getByRole("heading", { name: "No notes yet" })).toBeInTheDocument();
    expect(within(section).queryAllByRole("row").filter(row => row.hasAttribute("data-key"))).toHaveLength(0);
    const long = "Planning notes with a detailed title that should fit a narrow record list";
    rerender(<ResourceList {...base} items={[{ id: "long", textValue: long, title: long }]} />);
    expect(screen.getByText(long)).toHaveClass("truncate");
    expect(screen.getByText(long)).toHaveAttribute("title", long);
  });
});
