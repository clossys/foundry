import { act } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TreeView, type TreeViewNode } from "./TreeView.js";

const nodes: TreeViewNode[] = [
  { id: "a", label: "Alpha", children: [{ id: "a1", label: "Alpha one" }, { id: "a2", label: "Alpha two" }] },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma", children: [{ id: "c1", label: "Gamma one" }] },
];
const row = (key: string) => document.querySelector<HTMLElement>(`[role="row"][data-key="${key}"]`)!;
const keys = () => screen.queryAllByRole("row").map(element => element.getAttribute("data-key"));

describe("TreeView", () => {
  it("T1 refuses a blank name and exposes a named tree of levelled rows", () => {
    expect(() => render(<TreeView nodes={nodes} aria-label=" " />)).toThrow(TypeError);
    render(<TreeView nodes={nodes} aria-label="Documents" />);
    expect(screen.getByRole("treegrid", { name: "Documents" })).toBeInTheDocument();
    expect(keys()).toEqual(["a", "b", "c"]);
    expect(row("a")).toHaveAttribute("aria-expanded", "false");
    expect(row("b")).not.toHaveAttribute("aria-expanded");
    expect(row("a")).toHaveAttribute("aria-level", "1");
  });

  it("T2 marks only currentId as selected and shows no other text than the labels", () => {
    const { container } = render(<TreeView nodes={nodes} aria-label="Documents" currentId="b" />);
    expect(row("b")).toHaveAttribute("aria-selected", "true");
    expect(row("a")).toHaveAttribute("aria-selected", "false");
    expect(row("c")).toHaveAttribute("aria-selected", "false");
    expect(container.textContent).toBe("AlphaBetaGamma");
  });

  it("T3 follows the tree keyboard pattern: Right, Down, Left, Home and End", async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    render(<TreeView nodes={nodes} aria-label="Documents" onExpandedChange={changed} />);
    act(() => row("a").focus());
    await user.keyboard("{ArrowRight}");
    expect(keys()).toEqual(["a", "a1", "a2", "b", "c"]);
    expect(changed).toHaveBeenLastCalledWith(new Set(["a"]));
    await user.keyboard("{ArrowDown}");
    expect(row("a1")).toHaveFocus();
    await user.keyboard("{End}");
    expect(row("c")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(row("a")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(keys()).toEqual(["a", "b", "c"]);
    expect(changed).toHaveBeenLastCalledWith(new Set());
  });

  it("T4 Enter on a leaf navigates once, and on a branch only toggles it", async () => {
    const navigate = vi.fn();
    const changed = vi.fn();
    const user = userEvent.setup();
    render(<TreeView nodes={nodes} aria-label="Documents" currentId="b" defaultExpandedIds={["a"]} onNavigate={navigate} onExpandedChange={changed} />);
    act(() => row("a").focus());
    await user.keyboard("{Enter}");
    expect(navigate).not.toHaveBeenCalled();
    expect(changed).toHaveBeenLastCalledWith(new Set());
    expect(keys()).toEqual(["a", "b", "c"]);
    await user.keyboard("{Enter}");
    expect(keys()).toEqual(["a", "a1", "a2", "b", "c"]);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(navigate).toHaveBeenCalledExactlyOnceWith("a1");
    act(() => row("b").focus());
    await user.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("T5 clicks navigate leaves, and a branch row or its chevron only toggles", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<TreeView nodes={nodes} aria-label="Documents" onNavigate={navigate} />);
    await user.click(screen.getByText("Gamma"));
    expect(keys()).toEqual(["a", "b", "c", "c1"]);
    expect(navigate).not.toHaveBeenCalled();
    await user.click(within(row("a")).getByRole("button", { hidden: true }));
    expect(keys()).toEqual(["a", "a1", "a2", "b", "c", "c1"]);
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByText("Gamma one"));
    expect(navigate).toHaveBeenCalledExactlyOnceWith("c1");
  });

  it("T6 supports controlled and default expansion", async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<TreeView nodes={nodes} aria-label="Documents" expandedIds={["c"]} onExpandedChange={changed} />);
    expect(keys()).toEqual(["a", "b", "c", "c1"]);
    await user.click(screen.getByText("Alpha"));
    expect(changed).toHaveBeenLastCalledWith(new Set(["c", "a"]));
    expect(keys()).toEqual(["a", "b", "c", "c1"]);
    rerender(<TreeView nodes={nodes} aria-label="Documents" expandedIds={["a", "c"]} onExpandedChange={changed} />);
    expect(keys()).toEqual(["a", "a1", "a2", "b", "c", "c1"]);
  });

  it("T7 mirrors only the collapsed chevron in right-to-left text", () => {
    render(<div dir="rtl"><TreeView nodes={nodes} aria-label="Documents" defaultExpandedIds={["a"]} /></div>);
    const collapsed = within(row("c")).getByRole("button", { hidden: true }).querySelector("svg")!;
    const expanded = within(row("a")).getByRole("button", { hidden: true }).querySelector("svg")!;
    expect(collapsed).toHaveClass("rtl:rotate-180");
    expect(expanded).not.toHaveClass("rtl:rotate-180");
  });

  it("T8 outlines the current row and the keyboard-focused row in forced colours", async () => {
    const user = userEvent.setup();
    render(<TreeView nodes={nodes} aria-label="Documents" currentId="b" />);
    expect(row("b")).toHaveClass("bg-surface-selected", "forced-colors:outline", "forced-colors:outline-solid");
    expect(row("a")).not.toHaveClass("forced-colors:outline");
    act(() => row("a").focus());
    await user.keyboard("{ArrowDown}");
    expect(row("b")).toHaveFocus();
    expect(row("b")).toHaveClass("forced-colors:outline-2", "forced-colors:-outline-offset-2");
    expect(row("b").style.boxShadow).toContain("var(--ui-ring-focus");
  });

  it("T9 merges a host className last", () => {
    render(<TreeView nodes={nodes} aria-label="Documents" className="host-tree" />);
    expect(screen.getByRole("treegrid")).toHaveClass("host-tree");
  });
});
