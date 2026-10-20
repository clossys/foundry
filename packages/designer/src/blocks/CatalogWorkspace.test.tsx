import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useState } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogWorkspace } from "./CatalogWorkspace.js";
import { extractStyleCandidates, scanStyleSources } from "../style-scan.js";
import { checkTokenPurity } from "../token-gate.js";
import { TOKENS } from "../tokens/tokens.js";
import { contrastRatio } from "../tokens/color.js";
import { parseRootDeclarations, parseDeclarationsForSelector } from "../tokens/internal/parse-css.js";

const second = Object.freeze({ id: " host:two ", label: "Second", kind: "component", badge: "Ready", tag: "v2" });
const first = Object.freeze({ id: "one", label: "First", kind: "component" });
const items = Object.freeze([{ id: "group", label: "Library", kind: "collection", children: [{ id: "nested", label: "Nested", kind: "collection", children: [first, second] }] }, { id: "last", label: "Last", kind: "component" }]);
const labels = { browse: "Browse library", preview: "Preview", inspector: "Inspector", resizeBrowse: "Resize browse", resizeInspector: "Resize inspector" };
const preview = vi.fn((item) => <input aria-label="Preview editor" defaultValue={item.label} />);
const inspector = vi.fn((item) => <button>Inspect {item.label}</button>);
const base = { items, selectedId: null, onSelect: vi.fn(), label: "Catalog", labels, preview, inspector, emptyState: <p>No selection</p> };
function media(wide = true) {
  let listener: ((event: { matches: boolean }) => void) | undefined;
  const remove = vi.fn();
  const query = { matches: !wide, media: "(width < 1024px)", addEventListener: vi.fn((_type, callback) => { listener = callback; }), removeEventListener: remove };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return { query, remove, change: (stacked: boolean) => act(() => { query.matches = stacked; listener?.({ matches: stacked }); }) };
}
async function openTree() {
  await userEvent.click(screen.getByRole("treeitem", { name: "Library" }));
  await userEvent.click(screen.getByRole("treeitem", { name: "Nested" }));
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("CatalogWorkspace", () => {
  it("requests exact host IDs on leaf pointer activation without committing selection locally", async () => {
    media(); const onSelect = vi.fn(); render(<CatalogWorkspace {...base} onSelect={onSelect} />);
    await openTree();
    await userEvent.click(screen.getByRole("treeitem", { name: "Second" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(second.id);
    expect(screen.getByText("No selection")).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "Second" })).toHaveAttribute("aria-selected", "false");
    expect(preview).not.toHaveBeenCalled(); expect(inspector).not.toHaveBeenCalled();
  });
  it("passes original selected leaf objects into both slots and follows host rerenders without remount", async () => {
    media(); const { rerender } = render(<CatalogWorkspace {...base} selectedId={second.id} />);
    expect(preview).toHaveBeenLastCalledWith(second); expect(inspector).toHaveBeenLastCalledWith(second);
    const input = screen.getByRole("textbox", { name: "Preview editor" });
    await userEvent.clear(input); await userEvent.type(input, "Draft");
    rerender(<CatalogWorkspace {...base} selectedId={first.id} />);
    expect(preview).toHaveBeenLastCalledWith(first); expect(inspector).toHaveBeenLastCalledWith(first);
    expect(screen.getByRole("textbox", { name: "Preview editor" })).toBe(input);
    expect(input).toHaveValue("Draft");
    await openTree();
    expect(screen.getByRole("treeitem", { name: "First" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("treeitem", { name: "Second" })).toHaveAttribute("aria-selected", "false");
  });
  it("uses visible preorder for arrows, group toggles, boundaries and leaf Enter/Space selection", async () => {
    media(); const onSelect = vi.fn(); render(<CatalogWorkspace {...base} onSelect={onSelect} />);
    const library = screen.getByRole("treeitem", { name: "Library" }); act(() => library.focus());
    await userEvent.keyboard("{ArrowRight}"); expect(library).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowRight}"); expect(screen.getByRole("treeitem", { name: "Nested" })).toHaveFocus();
    await userEvent.keyboard("{Enter}"); expect(onSelect).not.toHaveBeenCalled();
    const nested = screen.getByRole("treeitem", { name: "Nested" });
    expect(nested).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard(" "); expect(nested).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard(" "); expect(nested).toHaveAttribute("aria-expanded", "true");
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}"); expect(screen.getByRole("treeitem", { name: "First" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Enter}"); expect(onSelect).toHaveBeenLastCalledWith(second.id);
    await userEvent.keyboard(" "); expect(onSelect).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{ArrowLeft}"); expect(screen.getByRole("treeitem", { name: "Nested" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}"); expect(screen.getByRole("treeitem", { name: "Nested" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{End}"); expect(screen.getByRole("treeitem", { name: "Last" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}"); expect(screen.getByRole("treeitem", { name: "Last" })).toHaveFocus();
    await userEvent.keyboard("{Home}{ArrowUp}"); expect(library).toHaveFocus();
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
  it("has one tree tab stop and explicit group ownership, with focus recovery after host removal", async () => {
    media(); const { rerender } = render(<CatalogWorkspace {...base} />); await openTree();
    const tree = screen.getByRole("tree", { name: labels.browse });
    const row = screen.getByRole("treeitem", { name: "Second" }); await userEvent.click(row);
    expect(within(tree).getAllByRole("treeitem").filter(node => node.tabIndex === 0)).toEqual([row]);
    const nested = screen.getByRole("treeitem", { name: "Nested" });
    const group = document.getElementById(nested.getAttribute("aria-owns")!)!;
    expect(group).toHaveAttribute("role", "group"); expect(group).toHaveAttribute("aria-labelledby", nested.id); expect(group).toContainElement(row);
    expect(nested).not.toHaveAttribute("aria-selected"); expect(row).not.toHaveAttribute("aria-expanded");
    rerender(<CatalogWorkspace {...base} items={[{ id: "last", label: "Last", kind: "component" }]} />);
    expect(screen.getByRole("treeitem", { name: "Last" })).toHaveFocus();
    expect(screen.getAllByRole("treeitem").filter(node => node.tabIndex === 0)).toHaveLength(1);
  });
  it("does not reclaim focus after an intentional blur with no related target", () => {
    media(); const { rerender } = render(<CatalogWorkspace {...base} />);
    const row = screen.getByRole("treeitem", { name: "Library" });
    act(() => row.focus()); expect(row).toHaveFocus();
    act(() => row.blur()); expect(document.body).toHaveFocus();
    rerender(<CatalogWorkspace {...base} items={[{ id: "replacement", label: "Replacement", kind: "component" }]} />);
    expect(document.body).toHaveFocus();
    expect(screen.getByRole("treeitem", { name: "Replacement" })).not.toHaveFocus();
  });
  it("keeps DOM and tab order browse then preview then inspector, with both real separators operable", async () => {
    media(); render(<CatalogWorkspace {...base} selectedId={second.id} />);
    const browse = screen.getByRole("region", { name: labels.browse });
    const previewRegion = screen.getByRole("region", { name: labels.preview });
    const inspectorRegion = screen.getByRole("region", { name: labels.inspector });
    expect(browse.compareDocumentPosition(previewRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(previewRegion.compareDocumentPosition(inspectorRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(previewRegion).toHaveAttribute("data-panel");
    const left = screen.getByRole("separator", { name: labels.resizeBrowse });
    const right = screen.getByRole("separator", { name: labels.resizeInspector });
    act(() => screen.getByRole("treeitem", { name: "Library" }).focus()); await userEvent.tab(); expect(left).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}"); expect(left).toHaveAttribute("aria-valuenow", "256"); expect(browse.style.inlineSize).toBe("256px");
    await userEvent.tab(); expect(screen.getByRole("textbox")).toHaveFocus();
    await userEvent.tab(); expect(right).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}"); expect(right).toHaveAttribute("aria-valuenow", "256"); expect(inspectorRegion.style.inlineSize).toBe("256px");
    await userEvent.tab(); expect(screen.getByRole("button", { name: "Inspect Second" })).toHaveFocus();
  });
  it("stacks below the token breakpoint and preserves focus, slot instances and independent dimensions", async () => {
    const m = media(); const { unmount } = render(<CatalogWorkspace {...base} selectedId={second.id} />);
    const input = screen.getByRole("textbox"); await userEvent.type(input, " draft");
    const right = screen.getByRole("separator", { name: labels.resizeInspector }); act(() => right.focus()); await userEvent.keyboard("{ArrowLeft}");
    const root = screen.getByRole("region", { name: "Catalog" });
    expect(root).toHaveClass("flex-row");
    m.change(true); expect(root).toHaveClass("flex-col"); expect(right).toHaveFocus();
    expect(right).toHaveAttribute("aria-orientation", "horizontal"); expect(right).toHaveAttribute("aria-valuenow", "240");
    await userEvent.keyboard("{ArrowUp}"); expect(right).toHaveAttribute("aria-valuenow", "256");
    expect(screen.getByRole("textbox")).toBe(input); expect(input).toHaveValue("Second draft");
    m.change(false); expect(right).toHaveAttribute("aria-valuenow", "256");
    m.change(true); expect(right).toHaveAttribute("aria-valuenow", "256");
    const callback = m.query.addEventListener.mock.calls[0]![1]; unmount(); expect(m.remove).toHaveBeenCalledExactlyOnceWith("change", callback);
  });
  it("hydrates the deterministic stacked server layout then adopts the media preference", async () => {
    const m = media(); const errors: unknown[] = []; const container = document.createElement("div"); document.body.append(container);
    container.innerHTML = renderToString(<CatalogWorkspace {...base} selectedId={first.id} />);
    expect(container.firstElementChild).toHaveClass("flex-col");
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, <CatalogWorkspace {...base} selectedId={first.id} />, { onRecoverableError: error => errors.push(error) }); });
    expect(errors).toEqual([]); expect(container.firstElementChild).toHaveClass("flex-row");
    await act(async () => root!.unmount()); container.remove(); expect(m.remove).toHaveBeenCalledTimes(1);
  });
  it.each([null, "missing", "group"])("renders one visible empty state for absent or nonleaf selection %s", selectedId => {
    media(); render(<CatalogWorkspace {...base} selectedId={selectedId} />);
    expect(screen.getAllByText("No selection")).toHaveLength(1); expect(screen.getByText("No selection")).toBeVisible();
    expect(preview).not.toHaveBeenCalled(); expect(inspector).not.toHaveBeenCalled();
  });
  it("accepts an empty forest and empty group without inventing a selection", async () => {
    media(); const { rerender } = render(<CatalogWorkspace {...base} items={[]} />);
    expect(screen.getByText("No selection")).toBeVisible(); expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    rerender(<CatalogWorkspace {...base} items={[{ id: "empty", label: "Empty", kind: "collection", children: [] }]} />);
    await userEvent.click(screen.getByRole("treeitem", { name: "Empty" })); expect(base.onSelect).not.toHaveBeenCalled();
  });
  it.each([
    [{ id: "x", label: "X", kind: "leaf" }, { id: "x", label: "Y", kind: "leaf" }],
    [{ id: " ", label: "X", kind: "leaf" }],
    [{ id: "x", label: "", kind: "leaf" }],
    [{ id: "x", label: "X", kind: "" }],
    [{ id: "a", label: "A", kind: "group", children: [{ id: "b", label: "B", kind: "group", children: [{ id: "c", label: "C", kind: "group", children: [{ id: "d", label: "D", kind: "leaf" }] }] }] }],
    Array.from({ length: 1001 }, (_, i) => ({ id: String(i), label: String(i), kind: "leaf" })),
  ].map(forest => [forest]))("refuses invalid identity, text, depth or node bounds before rendering", invalid => {
    expect(() => render(<CatalogWorkspace {...base} items={invalid} />)).toThrow(TypeError);
  });
  it("refuses cyclic/sparse input and invalid pane bounds", () => {
    const cyclic: any = { id: "c", label: "Cycle", kind: "group" }; cyclic.children = [cyclic];
    expect(() => render(<CatalogWorkspace {...base} items={[cyclic]} />)).toThrow(TypeError);
    expect(() => render(<CatalogWorkspace {...base} items={Array(1)} />)).toThrow(TypeError);
    expect(() => render(<CatalogWorkspace {...base} browseSize={{ min: 300, max: 100, defaultValue: 200 }} />)).toThrow(TypeError);
  });
  it("accepts the documented depth and count bounds without changing caller data", () => {
    media();
    const forest = Array.from({ length: 1000 }, (_, index) => Object.freeze({ id: `leaf-${index}`, label: `Leaf ${index}`, kind: "component" }));
    Object.freeze(forest); const before = JSON.stringify(forest);
    const { rerender } = render(<CatalogWorkspace {...base} items={forest} selectedId="leaf-999" />);
    expect(preview).toHaveBeenLastCalledWith(forest[999]); expect(JSON.stringify(forest)).toBe(before);
    rerender(<CatalogWorkspace {...base} selectedId={second.id} />);
    expect(preview).toHaveBeenLastCalledWith(second);
  });
  it("preserves the focused row across responsive layout and external selection changes", async () => {
    const m = media(); const { rerender } = render(<CatalogWorkspace {...base} />); await openTree();
    const row = screen.getByRole("treeitem", { name: "Second" }); act(() => row.focus());
    m.change(true); expect(row).toHaveFocus();
    rerender(<CatalogWorkspace {...base} selectedId={first.id} />); expect(row).toHaveFocus();
    expect(row).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByRole("treeitem").filter(item => item.tabIndex === 0)).toEqual([row]);
  });
  it("uses the same token-bound surfaces in light and dark with analytical text contrast", () => {
    media(); const { container, rerender } = render(<div data-theme="light"><CatalogWorkspace {...base} selectedId={first.id} /></div>);
    const panel = screen.getByRole("region", { name: labels.preview }); expect(panel).toHaveClass("bg-surface-raised", "rounded-panel", "p-lg");
    const classes = panel.className;
    rerender(<div data-theme="dark"><CatalogWorkspace {...base} selectedId={first.id} /></div>);
    expect(screen.getByRole("region", { name: labels.preview }).className).toBe(classes);
    expect(container.querySelector('[data-theme="dark"]')).toContainElement(panel);
    const css = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
    for (const declarations of [parseRootDeclarations(css), parseDeclarationsForSelector(css, ':root[data-theme="dark"]')]) {
      expect(contrastRatio(declarations.get("--color-ink-primary")!, declarations.get("--color-surface-raised")!)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps shipped source inside the native token-purity gate without ignore markers", () => {
    const main = extractStyleCandidates(readFileSync(resolve(import.meta.dirname, "CatalogWorkspace.tsx"), "utf8"), "CatalogWorkspace.tsx");
    const nested = scanStyleSources(resolve(import.meta.dirname, "catalog-workspace"));
    const result = checkTokenPurity([...main.candidates, ...nested.candidates], TOKENS, nested.filesScanned + 1, [...main.unchecked, ...nested.unchecked]);
    expect(result.findings).toEqual([]); expect(result.ignored).toEqual([]); expect(result.unchecked).toEqual([]);
  });
});
