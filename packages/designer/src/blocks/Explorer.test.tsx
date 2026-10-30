// @vitest-environment jsdom
import "../../vitest.setup.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Explorer } from "./Explorer.js";
import type { TreeNode } from "./tree-model.js";
import { Browse } from "./catalog-workspace/Browse.js";
import { catalogIndex } from "./catalog-workspace/model.js";
import { extractStyleCandidates } from "../style-scan.js";
import { checkTokenPurity } from "../token-gate.js";
import { TOKENS } from "../tokens/tokens.js";

function chain(count: number): TreeNode[] {
  let node: TreeNode = { id: String(count), label: `Level ${count}` };
  for (let level = count - 1; level > 0; level--) node = { id: String(level), label: `Level ${level}`, children: [node] };
  return [node];
}

describe("Explorer", () => {
  it("places a protected link-out beside the treeitem without selecting or disclosing its node", async () => {
    const onSelect = vi.fn();
    render(<Explorer tree={[{ id: "folder", label: "Folder", children: [] }]} label="Files" onSelect={onSelect}
      externalAction={() => ({ href: "#standalone", label: "Open Folder in a new tab", icon: <span>↗</span> })} />);
    const row = screen.getByRole("treeitem", { name: "Folder" });
    const action = screen.getByRole("link", { name: "Open Folder in a new tab" });
    expect(action.parentElement).toBe(row.parentElement);
    expect(row.contains(action)).toBe(false);
    expect(action.closest("button, [role=treeitem]")).toBeNull();
    expect(action).toHaveAttribute("href", "#standalone");
    expect(action).toHaveAttribute("target", "_blank");
    expect(action).toHaveAttribute("rel", "noopener noreferrer");
    await userEvent.click(action);
    expect(action).toHaveFocus();
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("keeps visible sibling actions in native tab order while arrows retain tree navigation", async () => {
    const onSelect = vi.fn();
    render(<Explorer tree={[{ id: "one", label: "One" }, { id: "two", label: "Two" }]} label="Files" onSelect={onSelect}
      externalAction={node => ({ href: `#${node.id}`, label: `Open ${node.label}`, icon: <span>↗</span> })} />);
    const one = screen.getByRole("treeitem", { name: "One" }), two = screen.getByRole("treeitem", { name: "Two" });
    const actionOne = screen.getByRole("link", { name: "Open One" }), actionTwo = screen.getByRole("link", { name: "Open Two" });
    expect(actionOne.tabIndex).toBe(0); expect(actionTwo.tabIndex).toBe(0);
    act(() => one.focus());
    await userEvent.tab(); expect(actionOne).toHaveFocus();
    await userEvent.tab(); expect(actionTwo).toHaveFocus();
    await userEvent.tab({ shift: true }); expect(actionOne).toHaveFocus();
    await userEvent.tab({ shift: true }); expect(one).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}"); expect(two).toHaveFocus();
    expect(actionOne.tabIndex).toBe(0); expect(actionTwo.tabIndex).toBe(0);
    await userEvent.tab(); expect(actionTwo).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("removes collapsed descendants' actions and preserves the row href independently", async () => {
    render(<Explorer tree={[{ id: "folder", label: "Folder", children: [{ id: "leaf", label: "Leaf", href: "#selected" }] }]} label="Files" defaultExpandedIds={["folder"]}
      externalAction={node => node.id === "leaf" ? { href: "#standalone", label: "Open Leaf", icon: <span>↗</span> } : null} />);
    expect(screen.getByRole("treeitem", { name: "Leaf" })).toHaveAttribute("href", "#selected");
    expect(screen.getByRole("link", { name: "Open Leaf" })).toHaveAttribute("href", "#standalone");
    await userEvent.click(screen.getByRole("treeitem", { name: "Folder" }));
    expect(screen.queryByRole("link", { name: "Open Leaf" })).toBeNull();
  });
  it("honors controlled folder selection and both callbacks once per activation while arrows only disclose", async () => {
    const action = vi.fn(); const onSelect = vi.fn();
    const tree = [{ id: "folder", label: "Folder", onSelect: action, children: [] }];
    const view = render(<Explorer tree={tree} label="Files" selectedId="folder" onSelect={onSelect} />);
    const folder = screen.getByRole("treeitem", { name: "Folder" });
    expect(folder).toHaveAttribute("aria-selected", "true");
    expect(folder).toHaveClass("bg-surface-raised", "border-line-control");
    await userEvent.click(folder); expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(action).toHaveBeenCalledTimes(1); expect(onSelect).toHaveBeenCalledExactlyOnceWith("folder");
    await userEvent.keyboard("{ArrowLeft}{ArrowRight}"); expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(action).toHaveBeenCalledTimes(1); expect(onSelect).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Enter} ");
    expect(action).toHaveBeenCalledTimes(3); expect(onSelect.mock.calls).toEqual([["folder"], ["folder"], ["folder"]]);
    expect(folder).toHaveAttribute("aria-expanded", "true");
    view.rerender(<Explorer tree={tree} label="Files" selectedId={null} onSelect={onSelect} />);
    expect(folder).toHaveAttribute("aria-selected", "false"); expect(action).toHaveBeenCalledTimes(3);
    expect(folder).not.toHaveClass("bg-surface-raised");
  });
  it("renders twelve levels, token branch guides, distinct Icon components and capped indentation", () => {
    const { container } = render(<Explorer tree={chain(12)} label="Files" defaultExpandedIds={Array.from({ length: 11 }, (_, i) => String(i + 1))} />);
    const rows = screen.getAllByRole("treeitem"); expect(rows).toHaveLength(12);
    rows.forEach((row, i) => {
      expect(row).toHaveAttribute("aria-level", String(i + 1));
      expect(row.querySelectorAll("[data-explorer-guide]")).toHaveLength(i);
      expect(row.querySelectorAll("svg[data-explorer-icon]")).toHaveLength(1);
      if (i < 11) expect(row).toHaveAttribute("aria-expanded", "true");
    });
    expect(rows[0]!.querySelector("[data-explorer-icon]")?.innerHTML).not.toBe(rows[11]!.querySelector("[data-explorer-icon]")?.innerHTML);
    expect(rows[7]!.style.paddingInlineStart).toBe(rows[11]!.style.paddingInlineStart);
    expect(rows[1]!.style.paddingInlineStart).not.toBe(rows[7]!.style.paddingInlineStart);
    expect(container.querySelectorAll("[data-explorer-guide].border-line-base")).toHaveLength(66);
    expect(screen.getByRole("tree")).toHaveAttribute("aria-multiselectable", "false");
  });
  it("allows every folder to collapse independently, including the deepest folder and empty folders", async () => {
    render(<Explorer tree={chain(12)} label="Files" defaultExpandedIds={Array.from({ length: 11 }, (_, i) => String(i + 1))} />);
    for (let level = 11; level > 0; level--) {
      const folder = screen.getByRole("treeitem", { name: `Level ${level}` });
      await userEvent.click(folder); expect(folder).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("treeitem", { name: `Level ${level + 1}` })).not.toBeInTheDocument();
      await userEvent.click(folder); expect(folder).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("treeitem", { name: "Level 12" })).toBeVisible();
    }
  });
  it("follows visible preorder, Home/End and parent/child arrows without selecting on focus", async () => {
    const onSelect = vi.fn();
    render(<Explorer tree={[{ id: "folder", label: "Folder", children: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] }, { id: "last", label: "Last" }]} label="Files" onSelect={onSelect} selectedId="two" />);
    const folder = screen.getByRole("treeitem", { name: "Folder" }); act(() => folder.focus());
    await userEvent.keyboard("{ArrowRight}"); expect(folder).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowRight}"); expect(screen.getByRole("treeitem", { name: "One" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}"); const two = screen.getByRole("treeitem", { name: "Two" }); expect(two).toHaveFocus();
    expect(two).toHaveAttribute("aria-selected", "true"); expect(onSelect).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter} "); expect(onSelect.mock.calls).toEqual([["two"], ["two"]]);
    await userEvent.keyboard("{ArrowLeft}"); expect(folder).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}"); expect(folder).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{End}{ArrowDown}"); expect(screen.getByRole("treeitem", { name: "Last" })).toHaveFocus();
    await userEvent.keyboard("{Home}{ArrowUp}"); expect(folder).toHaveFocus();
    expect(screen.getAllByRole("treeitem").filter(row => row.tabIndex === 0)).toEqual([folder]);
  });
  it("preserves original hrefs and custom icons, invokes leaf actions, and handles empty folders", async () => {
    const action = vi.fn(); render(<Explorer label="Files" tree={[{ id: "link", label: "Link", href: "/exact?x=1", icon: <span data-testid="custom-icon" /> }, { id: "action", label: "Action", onSelect: action }, { id: "empty", label: "Empty", children: [] }]} />);
    expect(screen.getByRole("treeitem", { name: "Link" })).toHaveAttribute("href", "/exact?x=1");
    expect(screen.getByTestId("custom-icon")).toBeVisible(); await userEvent.click(screen.getByRole("treeitem", { name: "Action" })); expect(action).toHaveBeenCalledOnce();
    const empty = screen.getByRole("treeitem", { name: "Empty" }); await userEvent.click(empty); expect(empty).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(empty); expect(empty).toHaveAttribute("aria-expanded", "false");
  });
  it("activates a native href leaf exactly once with Space and preserves its authored href", async () => {
    const onSelect = vi.fn();
    render(<Explorer label="Files" tree={[{ id: "link", label: "Link", href: "#exact?x=1" }]} onSelect={onSelect} />);
    const link = screen.getByRole("treeitem", { name: "Link" }); act(() => link.focus());
    await userEvent.keyboard(" ");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("link"); expect(link).toHaveAttribute("href", "#exact?x=1");
  });
  it("refuses duplicate IDs and cycles before rendering", () => {
    expect(() => render(<Explorer label="Files" tree={[{ id: "same", label: "A" }, { id: "same", label: "B" }]} />)).toThrow(/duplicate/i);
    const cycle: TreeNode = { id: "cycle", label: "Cycle" }; cycle.children = [cycle];
    expect(() => render(<Explorer label="Files" tree={[cycle]} />)).toThrow(/cycle/i);
  });
  it("makes CatalogWorkspace Browse use Explorer at arbitrary depth with metadata retained", async () => {
    const toCatalog = (nodes: readonly TreeNode[]): any[] => nodes.map(node => ({ ...node, kind: "entry", tag: "v2", badge: "Ready", ...(node.children ? { children: toCatalog(node.children) } : {}) }));
    const items = toCatalog(chain(12)); const onSelect = vi.fn();
    const { container } = render(<Browse items={items} index={catalogIndex(items)} selectedId="12" onSelect={onSelect} label="Browse" />);
    expect(container.querySelector("[data-explorer]")).toBe(screen.getByRole("tree"));
    for (let i = 1; i < 12; i++) await userEvent.click(screen.getByRole("treeitem", { name: `Level ${i}` }));
    const leaf = screen.getByRole("treeitem", { name: "Level 12" }); expect(within(leaf).getByText("Ready")).toBeVisible();
    expect(leaf).toHaveAccessibleDescription("entry · v2 Ready");
    await userEvent.click(leaf); expect(onSelect).toHaveBeenCalledExactlyOnceWith("12");
    fireEvent.keyDown(leaf, { key: "ArrowLeft" }); expect(screen.getByRole("treeitem", { name: "Level 11" })).toHaveFocus();
  });
  it("keeps Catalog folders out of host selection callbacks and selected tree rows", async () => {
    const items = [{ id: "folder", label: "Folder", kind: "collection", children: [] }]; const onSelect = vi.fn();
    render(<Browse items={items} index={catalogIndex(items)} selectedId="folder" onSelect={onSelect} label="Browse" />);
    const folder = screen.getByRole("treeitem", { name: "Folder" });
    expect(folder).toHaveAttribute("aria-selected", "false"); expect(folder).not.toHaveClass("bg-surface-raised");
    await userEvent.click(folder); expect(folder).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Enter} "); expect(onSelect).not.toHaveBeenCalled();
  });
  it("keeps Explorer styles inside the native token-purity gate", () => {
    const source = readFileSync(resolve(import.meta.dirname, "Explorer.tsx"), "utf8");
    const scan = extractStyleCandidates(source, "Explorer.tsx");
    const result = checkTokenPurity(scan.candidates, TOKENS, 1, scan.unchecked);
    expect(result.findings).toEqual([]); expect(result.ignored).toEqual([]); expect(result.unchecked).toEqual([]);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|\b\d+px\b|["'][−+]["']/i);
  });
  it("ships the actual rendered deep, selected and collapsed row classes in canonical CSS", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
    const classes = new Set<string>();
    for (const expanded of [[], Array.from({ length: 11 }, (_, i) => String(i + 1))]) {
      const view = render(<Explorer tree={chain(12)} label="Files" selectedId="12" defaultExpandedIds={expanded} renderDetails={() => "Metadata"} />);
      for (const element of view.container.querySelectorAll("*")) for (const name of element.classList) classes.add(name);
      view.unmount();
    }
    expect(classes.size).toBeGreaterThan(20);
    const missing = [...classes].filter(name => {
      const selector = "." + name.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      return ![`${selector} {`, `${selector}:`, `${selector},`].some(form => css.includes(form));
    });
    expect(missing).toEqual([]);
  });

  it("lays out a host list region beside the tree and keeps the tree semantics unchanged", () => {
    const view = render(<Explorer tree={chain(2)} label="Files" list={<ul aria-label="Folder contents"><li>Report.pdf</li></ul>} listLabel="Contents" />);
    const tree = screen.getByRole("tree", { name: "Files" });
    const list = screen.getByRole("region", { name: "Contents" });
    expect(within(list).getByRole("list", { name: "Folder contents" })).toBeInTheDocument();
    expect(tree.contains(list)).toBe(false);
    const root = view.container.firstElementChild!;
    expect(root).toHaveAttribute("data-explorer-layout", "panes");
    expect(root.contains(tree) && root.contains(list)).toBe(true);
    for (const name of (root.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) expect(name, name).not.toMatch(/^\[|\[.*\]./);
  });
  it("renders the bare tree when no list region is supplied", () => {
    const view = render(<Explorer tree={chain(2)} label="Files" />);
    expect(view.container.firstElementChild).toHaveAttribute("role", "tree");
    expect(screen.queryByRole("region")).toBeNull();
  });
});
