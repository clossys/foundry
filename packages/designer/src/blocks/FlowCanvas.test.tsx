import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowCanvas } from "./FlowCanvas.js";
import type { FlowCanvasEdge, FlowCanvasNode } from "./flow-canvas-layout.js";

const nodes: readonly FlowCanvasNode[] = [
  { id: "draft", label: "Draft", kind: "Step" },
  { id: "review", label: "Review", kind: "Gate", status: { tone: "warning", label: "Waiting" } },
  { id: "publish", label: "Publish", kind: "Step" },
  { id: "archive", label: "Archive" },
];
const edges: readonly FlowCanvasEdge[] = [
  { from: "draft", to: "review" },
  { from: "review", to: "publish", label: "Approves" },
  { from: "review", to: "archive", label: "Rejects" },
];
const copy = { label: "Release flow", emptyMessage: "No steps yet", outgoingLabel: "Leads to" };
const button = (name: string) => screen.getByRole("button", { name });

afterEach(() => { document.documentElement.dir = ""; });

describe("FlowCanvas", () => {
  it("exposes an ordered list of named nodes whose descriptions carry kind, status and outgoing edges", () => {
    render(<FlowCanvas nodes={nodes} edges={edges} {...copy} />);
    const list = screen.getByRole("list", { name: "Release flow" });
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem").filter(item => item.parentElement === list);
    expect(items.map(item => item.getAttribute("data-flowchart-node"))).toEqual(["draft", "review", "publish", "archive"]);
    expect(button("Review")).toHaveAccessibleDescription(/Gate.*Waiting.*Leads to.*Publish, Approves.*Archive, Rejects/);
    expect(button("Draft")).toHaveAccessibleDescription(/Step.*Leads to.*Review/);
    expect(button("Archive")).toHaveAccessibleDescription("");
    expect(items[1]).toHaveAttribute("data-kind", "Gate");
  });

  it("draws one path and one arrowhead per edge in an svg hidden from assistive technology", () => {
    const { container } = render(<FlowCanvas nodes={nodes} edges={edges} {...copy} />);
    const svg = container.querySelector("svg[data-flowchart-drawing]")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg.querySelectorAll("[data-flowchart-edge]")).toHaveLength(3);
    const arrows = svg.querySelectorAll("[data-flowchart-arrow]");
    expect(arrows).toHaveLength(3);
    for (const arrow of arrows) expect(arrow.getAttribute("d")).toMatch(/Z$/);
    const labels = container.querySelector("[data-flowchart-region='edge-labels']")!;
    expect(labels).toHaveAttribute("aria-hidden", "true");
    expect(labels.textContent).toContain("Approves");
    expect(labels.textContent).toContain("Rejects");
  });

  it("moves a roving tab stop along edges and between siblings", async () => {
    const user = userEvent.setup();
    render(<FlowCanvas nodes={nodes} edges={edges} {...copy} />);
    const tabStops = screen.getAllByRole("button").filter(item => item.tabIndex === 0);
    expect(tabStops).toEqual([button("Draft")]);
    await user.tab();
    expect(button("Draft")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(button("Review")).toHaveFocus();
    expect(button("Review").tabIndex).toBe(0);
    expect(button("Draft").tabIndex).toBe(-1);
    await user.keyboard("{ArrowRight}");
    expect(button("Publish")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(button("Archive")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(button("Archive")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(button("Publish")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(button("Review")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(button("Draft")).toHaveFocus();
    await user.keyboard("{End}");
    expect(button("Archive")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(button("Draft")).toHaveFocus();
  });

  it("leaves arrow keys with Alt, Control or Meta to the browser", () => {
    render(<FlowCanvas nodes={nodes} edges={edges} {...copy} />);
    button("Draft").focus();
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "Home", "End"]) {
        expect(fireEvent.keyDown(button("Draft"), { key, [modifier]: true }), modifier + " " + key).toBe(true);
        expect(button("Draft")).toHaveFocus();
      }
    }
    expect(fireEvent.keyDown(button("Draft"), { key: "ArrowRight" })).toBe(false);
    expect(button("Review")).toHaveFocus();
  });

  it("returns along the remembered trail when stepping back", async () => {
    const user = userEvent.setup();
    const joined: FlowCanvasEdge[] = [{ from: "draft", to: "publish" }, { from: "review", to: "publish" }];
    render(<FlowCanvas nodes={nodes.slice(0, 3)} edges={joined} {...copy} />);
    button("Review").focus();
    await user.keyboard("{ArrowRight}");
    expect(button("Publish")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(button("Review")).toHaveFocus();
  });

  it("follows the vertical axis and mirrors the inline keys in right-to-left documents", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FlowCanvas nodes={nodes} edges={edges} orientation="vertical" {...copy} />);
    button("Draft").focus();
    await user.keyboard("{ArrowDown}");
    expect(button("Review")).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowRight}");
    expect(button("Archive")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(button("Review")).toHaveFocus();
    unmount();

    document.documentElement.dir = "rtl";
    render(<FlowCanvas nodes={nodes} edges={edges} {...copy} />);
    button("Draft").focus();
    await user.keyboard("{ArrowRight}");
    expect(button("Draft")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(button("Review")).toHaveFocus();
  });

  it("selects with Enter, Space or a click, never on focus alone", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<FlowCanvas nodes={nodes} edges={edges} onSelect={onSelect} {...copy} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(onSelect).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("review");
    await user.keyboard("{ArrowRight} ");
    expect(onSelect).toHaveBeenLastCalledWith("publish");
    await user.click(button("Archive"));
    expect(onSelect).toHaveBeenLastCalledWith("archive");
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("reflects the controlled selection and highlights its edges", () => {
    const { container, rerender } = render(<FlowCanvas nodes={nodes} edges={edges} selectedId="review" {...copy} />);
    expect(button("Review")).toHaveAttribute("aria-current", "true");
    expect(button("Draft")).not.toHaveAttribute("aria-current");
    // Forced colors flatten the border colours, so selection also carries an outline there.
    expect(button("Review")).toHaveClass("forced-colors:outline-solid", "forced-colors:outline-2", "forced-colors:outline-current");
    expect(button("Draft")).not.toHaveClass("forced-colors:outline-solid");
    expect(button("Review").tabIndex).toBe(0);
    expect(container.querySelectorAll("[data-flowchart-edge][data-selected]")).toHaveLength(3);
    rerender(<FlowCanvas nodes={nodes} edges={edges} selectedId="archive" {...copy} />);
    expect(button("Archive")).toHaveAttribute("aria-current", "true");
    expect(button("Review")).not.toHaveAttribute("aria-current");
    expect(container.querySelectorAll("[data-flowchart-edge][data-selected]")).toHaveLength(1);
    rerender(<FlowCanvas nodes={nodes} edges={edges} selectedId="missing" {...copy} />);
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(0);
    expect(button("Draft").tabIndex).toBe(0);
  });

  it("shows the host's empty message and a single node without a drawing", () => {
    const { container, rerender } = render(<FlowCanvas nodes={[]} edges={[]} {...copy} />);
    expect(screen.getByText("No steps yet")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    expect(container.querySelector("[data-flowchart-region='content']")).not.toBeNull();
    rerender(<FlowCanvas nodes={[{ id: "only", label: "Only" }]} edges={[]} {...copy} />);
    expect(screen.queryByText("No steps yet")).toBeNull();
    expect(screen.getAllByRole("button")).toEqual([button("Only")]);
    expect(button("Only").tabIndex).toBe(0);
    expect(container.querySelectorAll("[data-flowchart-edge]")).toHaveLength(0);
  });

  it("renders a large graph inside a scrollable viewport sized in spacing tokens", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: "n" + i, label: "Node " + i }));
    const links = many.slice(1).map((item, i) => ({ from: "n" + Math.floor(i / 2), to: item.id }));
    const { container } = render(<FlowCanvas nodes={many} edges={links} {...copy} />);
    expect(screen.getAllByRole("button")).toHaveLength(120);
    const viewport = container.querySelector("[data-flowchart-region='viewport']") as HTMLElement;
    expect(viewport.className).toMatch(/\boverflow-auto\b/);
    expect(viewport.className).toMatch(/\bmax-w-full\b/);
    const canvas = viewport.firstElementChild as HTMLElement;
    expect(canvas.style.inlineSize).toMatch(/^calc\(\d+(\.\d+)? \* var\(--spacing-xs, 4px\)\)$/);
  });

  it("keeps motion, raw colours and fixed copy out of the source", () => {
    const source = readFileSync(resolve(import.meta.dirname, "FlowCanvas.tsx"), "utf8");
    expect(source).not.toMatch(/\b(transition|animate)-/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
    const { container } = render(<FlowCanvas nodes={nodes} edges={edges} selectedId="review" {...copy} />);
    for (const element of container.querySelectorAll("[class]")) expect(element.getAttribute("class")).not.toMatch(/\b(transition|animate)/);
  });
});
