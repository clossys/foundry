import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TreeView, type TreeViewNode } from "./TreeView.js";

// Counts each preparation of the actual native Tree.Node; rendering delegates to the original RAC row.
const treeRows = vi.hoisted(() => ({ prepared: new Map<string, number>() }));
vi.mock("../components/Tree.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../components/Tree.js")>();
  const { createElement, forwardRef } = await import("react");
  const Node = forwardRef<HTMLDivElement, import("../components/Tree.js").TreeNodeProps>(function CountedNode(props, ref) {
    const id = String(props.id);
    treeRows.prepared.set(id, (treeRows.prepared.get(id) ?? 0) + 1);
    return createElement(actual.Tree.Node, { ...props, ref });
  });
  return { ...actual, Tree: Object.assign(forwardRef<HTMLDivElement, import("../components/Tree.js").TreeProps<object>>(function CountedTree(props, ref) { return createElement(actual.Tree, { ...props, ref }); }), { Node }) };
});

afterEach(() => { cleanup(); treeRows.prepared.clear(); });
const nodes = [{ id: "group", label: "Group", children: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] }];
const prepared = () => [...treeRows.prepared.values()].reduce((sum, count) => sum + count, 0);
it("uses the Foundry tree for expansion, selection and keyboard navigation", async () => {
  const navigate = vi.fn(), expanded = vi.fn(), user = userEvent.setup();
  render(<TreeView nodes={nodes} aria-label="Catalog" currentId="one" defaultExpandedIds={["group"]} onNavigate={navigate} onExpandedChange={expanded} />);
  expect(screen.getByRole("treegrid", {name:"Catalog"})).toBeInTheDocument();
  expect(screen.getByRole("row", {name:"One"})).toHaveAttribute("aria-selected", "true");
  await user.click(screen.getByRole("row", {name:"Two"}));
  expect(navigate).toHaveBeenCalledWith("two");
  await user.click(screen.getByRole("row", {name:"One"}));
  await user.keyboard("{ArrowDown}{Enter}");
  expect(navigate).toHaveBeenLastCalledWith("two");
  await user.click(screen.getByRole("button", {name:"Group"}));
  expect(expanded).toHaveBeenCalledWith(new Set());
  expect(screen.queryByRole("row", {name:"Two"})).not.toBeInTheDocument();
});
it("retains the required host label", () => {
  expect(() => render(<TreeView nodes={[]} aria-label="" />)).toThrow("TreeView requires aria-label");
});

it("TreeView keeps prepared rows when only currentId or expansion changes", async () => {
  const user = userEvent.setup(), navigate = vi.fn(), expanded = vi.fn();
  const view = render(<TreeView nodes={nodes} aria-label="Catalog" currentId="one" defaultExpandedIds={["group"]} onNavigate={navigate} onExpandedChange={expanded} />);
  expect([...treeRows.prepared.values()]).toEqual([1, 1, 1]);
  view.rerender(<TreeView nodes={nodes} aria-label="Catalog" currentId="two" defaultExpandedIds={["group"]} onNavigate={navigate} onExpandedChange={expanded} />);
  expect(screen.getByRole("row", { name: "Two" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("row", { name: "One" })).toHaveAttribute("aria-selected", "false");
  await user.click(screen.getByRole("button", { name: "Group" }));
  expect(expanded).toHaveBeenLastCalledWith(new Set());
  expect(screen.queryByRole("row", { name: "One" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Group" }));
  expect(expanded).toHaveBeenLastCalledWith(new Set(["group"]));
  expect(screen.getByRole("row", { name: "One" })).toBeVisible();
  expect(prepared()).toBe(3);
  // Selection after the currentId change uses the current value, not the mounted one.
  await user.click(screen.getByRole("row", { name: "One" }));
  expect(navigate).toHaveBeenLastCalledWith("one");
  expect(prepared()).toBe(3);
});

it("prepares rows again for changed nodes, labels and filtered (query) nodes", () => {
  const view = render(<TreeView nodes={nodes} aria-label="Catalog" defaultExpandedIds={["group"]} />);
  const relabelled = [{ ...nodes[0]!, children: [{ id: "one", label: "First" }, nodes[0]!.children[1]!] }];
  view.rerender(<TreeView nodes={relabelled} aria-label="Catalog" defaultExpandedIds={["group"]} />);
  expect(screen.getByRole("row", { name: "First" })).toBeVisible();
  expect(screen.queryByRole("row", { name: "One" })).not.toBeInTheDocument();
  expect(treeRows.prepared.get("one")).toBe(2);
  const added: TreeViewNode[] = [{ ...nodes[0]!, children: [...nodes[0]!.children, { id: "three", label: "Three" }] }, { id: "other", label: "Other", children: [{ id: "four", label: "Four" }] }];
  view.rerender(<TreeView nodes={added} aria-label="Catalog" defaultExpandedIds={["group"]} />);
  expect(screen.getByRole("row", { name: "Three" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Other" })).toBeVisible();
  const filtered = [{ ...nodes[0]!, children: nodes[0]!.children.filter(node => node.id.includes("tw")) }];
  view.rerender(<TreeView nodes={filtered} aria-label="Catalog" defaultExpandedIds={["group"]} />);
  expect(screen.getByRole("row", { name: "Two" })).toBeVisible();
  expect(screen.queryByRole("row", { name: "One" })).not.toBeInTheDocument();
  expect(screen.queryByRole("row", { name: "Three" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Other" })).not.toBeInTheDocument();
});

it("calls the current navigation and expansion callbacks after a host revision", async () => {
  const user = userEvent.setup(), firstNavigate = vi.fn(), firstExpanded = vi.fn(), nextNavigate = vi.fn(), nextExpanded = vi.fn();
  const view = render(<TreeView nodes={nodes} aria-label="Catalog" currentId="one" defaultExpandedIds={["group"]} onNavigate={firstNavigate} onExpandedChange={firstExpanded} />);
  view.rerender(<TreeView nodes={nodes} aria-label="Catalog" currentId="one" defaultExpandedIds={["group"]} onNavigate={nextNavigate} onExpandedChange={nextExpanded} />);
  expect(prepared()).toBe(3);
  await user.click(screen.getByRole("row", { name: "Two" }));
  expect(nextNavigate).toHaveBeenCalledWith("two");
  await user.click(screen.getByRole("row", { name: "One" }));
  await user.keyboard("{ArrowDown}{Enter}");
  expect(nextNavigate).toHaveBeenLastCalledWith("two");
  await user.click(screen.getByRole("button", { name: "Group" }));
  expect(nextExpanded).toHaveBeenCalledWith(new Set());
  expect(firstNavigate).not.toHaveBeenCalled(); expect(firstExpanded).not.toHaveBeenCalled();
});

it("keeps a second independent mount's expansion and selection separate", async () => {
  const user = userEvent.setup(), firstNavigate = vi.fn(), secondNavigate = vi.fn();
  render(<><div data-testid="first"><TreeView nodes={nodes} aria-label="First" currentId="one" defaultExpandedIds={["group"]} onNavigate={firstNavigate} /></div>
    <div data-testid="second"><TreeView nodes={nodes} aria-label="Second" currentId="two" defaultExpandedIds={["group"]} onNavigate={secondNavigate} /></div></>);
  const first = within(screen.getByRole("treegrid", { name: "First" })), second = within(screen.getByRole("treegrid", { name: "Second" }));
  expect(first.getByRole("row", { name: "One" })).toHaveAttribute("aria-selected", "true");
  expect(second.getByRole("row", { name: "Two" })).toHaveAttribute("aria-selected", "true");
  await user.click(first.getByRole("button", { name: "Group" }));
  expect(first.queryByRole("row", { name: "One" })).not.toBeInTheDocument();
  expect(second.getByRole("row", { name: "One" })).toBeVisible();
  await user.click(second.getByRole("row", { name: "One" }));
  expect(secondNavigate).toHaveBeenCalledWith("one"); expect(firstNavigate).not.toHaveBeenCalled();
});
