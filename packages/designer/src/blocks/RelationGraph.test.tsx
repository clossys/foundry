import { act, useLayoutEffect, useRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RelationGraph } from "./RelationGraph.js";

const nodes = [
  { id: "a", label: "Alpha", kind: "unit", description: "First node", status: "Ready" },
  { id: "b", label: "Beta", kind: "unit", href: "/beta" },
  { id: "c", label: "Gamma", kind: "unit" },
];
const edges = [{ from: "a", to: "b", label: "uses" }, { from: "b", to: "c", label: "produces" }];
const props = { nodes, edges, kinds: ["unit"], label: "Relationships" };
const controls = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-relation-graph-control]")];

describe("RelationGraph", () => {
  it("ignores an obsolete observer after refs change and after unmount", () => {
    const callbacks: Array<() => void> = []; let staleError: unknown;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} disconnect() {} });
    const replacement = [{ id: "replacement", label: "Replacement", kind: "unit" }];
    function Probe({ current }: { current: typeof nodes | typeof replacement }) {
      useLayoutEffect(() => {
        if (current === replacement) try { callbacks[0]!(); } catch (error) { staleError = error; }
      }, [current]);
      return <RelationGraph {...props} nodes={current} edges={current === nodes ? edges : []} />;
    }
    try {
      const view = render(<Probe current={nodes} />);
      view.rerender(<Probe current={replacement} />);
      expect(staleError).toBeUndefined();
      expect(screen.getByRole("button", { name: "Replacement" })).toBeVisible();
      view.unmount();
      expect(() => callbacks[0]!()).not.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
  it("never replays a previous edge drawing during a new input commit", () => {
    const snapshots: number[] = [];
    function Probe({ relations }: { relations: typeof edges }) {
      const host = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => { snapshots.push(host.current!.querySelectorAll("path").length); }, [relations]);
      return <div ref={host}><RelationGraph {...props} edges={relations} /></div>;
    }
    const view = render(<Probe relations={edges} />);
    expect(view.container.querySelectorAll("path")).toHaveLength(2);
    view.rerender(<Probe relations={[]} />);
    expect(snapshots).toEqual([0, 0]);
    expect(view.container.querySelectorAll("path")).toHaveLength(0);
  });
  it("exposes exactly authored nodes, kinds, status and labelled incoming/outgoing neighbours", () => {
    const { container } = render(<RelationGraph {...props} />);
    const rows = container.querySelectorAll("[data-relation-graph-node]");
    expect(rows).toHaveLength(3);
    expect(controls(container).map(node => node.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(within(rows[0] as HTMLElement).getByText("First node")).toBeVisible();
    expect(within(rows[0] as HTMLElement).getByText("Ready")).toBeVisible();
    expect(within(rows[0] as HTMLElement).getByRole("list", { name: "Outgoing" })).toHaveTextContent("Betauses");
    expect(within(rows[1] as HTMLElement).getByRole("list", { name: "Incoming" })).toHaveTextContent("Alphauses");
    expect(within(rows[1] as HTMLElement).getByRole("list", { name: "Outgoing" })).toHaveTextContent("Gammaproduces");
    expect(within(rows[2] as HTMLElement).getByRole("list", { name: "Incoming" })).toHaveTextContent("Betaproduces");
  });
  it("follows directed edges, Home/End and no-op leaves with exactly one tab stop", async () => {
    const user = userEvent.setup(); const { container } = render(<RelationGraph {...props} />);
    const check = (name: string) => {
      expect(document.activeElement).toHaveAccessibleName(name);
      expect(controls(container).filter(node => node.tabIndex === 0)).toHaveLength(1);
      expect(document.activeElement).toHaveAttribute("tabindex", "0");
    };
    await user.tab(); check("Alpha");
    for (const [key, name] of [["{ArrowRight}", "Beta"], ["{ArrowDown}", "Gamma"], ["{ArrowRight}", "Gamma"], ["{ArrowLeft}", "Beta"], ["{ArrowUp}", "Alpha"], ["{End}", "Gamma"], ["{Home}", "Alpha"]]) {
      await user.keyboard(key!); check(name!);
    }
  });
  it("uses first authored edge order and separates focus from controlled selection", () => {
    const onSelectionChange = vi.fn();
    const view = render(<RelationGraph {...props} edges={[{ from: "a", to: "c" }, ...edges]} selectedId="b" onSelectionChange={onSelectionChange} />);
    const beta = screen.getByRole("link", { name: "Beta" });
    expect(beta).toHaveAttribute("aria-current", "true");
    act(() => screen.getByRole("button", { name: "Alpha" }).focus());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toHaveAccessibleName("Gamma");
    expect(beta).toHaveAttribute("aria-current", "true");
    expect(onSelectionChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Gamma" }));
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith("c");
    view.rerender(<RelationGraph {...props} selectedId="a" />);
    expect(view.container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-current", "true");
  });
  it.each([
    { shape: "disconnected nodes", authored: nodes, relations: [] },
    { shape: "branching edges", authored: [...nodes, { id: "d", label: "Delta", kind: "unit" }], relations: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "a", to: "d" }] },
  ])("provides complete authored-order keyboard traversal for $shape", async ({ authored, relations }) => {
    const user = userEvent.setup(); const onSelectionChange = vi.fn();
    const { container } = render(<><RelationGraph {...props} nodes={authored} edges={relations} selectedId="a" onSelectionChange={onSelectionChange} /><button>After graph</button></>);
    const check = (name: string) => {
      expect(document.activeElement).toHaveAccessibleName(name);
      expect(controls(container).filter(node => node.tabIndex === 0)).toEqual([document.activeElement]);
    };
    await user.tab(); check("Alpha");
    for (const node of [...authored.slice(1), authored[0]!]) {
      await user.keyboard("{PageDown}"); check(node.label);
    }
    for (const node of [...authored.slice(1).reverse(), authored[0]!]) {
      await user.keyboard("{PageUp}"); check(node.label);
    }
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-current", "true");
    expect(onSelectionChange).not.toHaveBeenCalled();
    await user.tab(); expect(document.activeElement).toHaveAccessibleName("After graph");
  });
  it("activates a button once with Enter", async () => {
    const user = userEvent.setup(); const onSelectionChange = vi.fn();
    render(<RelationGraph {...props} onSelectionChange={onSelectionChange} />);
    await user.tab(); await user.keyboard("{Enter}");
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith("a");
  });
  it.each(["javascript:alert(1)", "data:text/html,x", "http://example.com", "//example.com", "/\\host", "", "/bad\n"])("keeps refused href %s a named non-link and records its subject", href => {
    render(<RelationGraph {...props} nodes={[{ ...nodes[0]!, href }]} edges={[]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Alpha" })).not.toHaveAttribute("href");
    expect(screen.getByRole("list", { name: "Refused links" })).toHaveTextContent("Alpha");
  });
  it("preserves valid href bytes", () => {
    render(<RelationGraph {...props} />);
    expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute("href", "/beta");
  });
  it("forwards custom neighbour and refusal labels without changing authored facts", () => {
    render(<RelationGraph {...props} nodes={nodes.map(node => ({ ...node, href: "javascript:void(0)" }))} incomingLabel="Sources" outgoingLabel="Targets" refusedLabel="Unusable destinations" />);
    expect(screen.getAllByRole("list", { name: "Sources" })).toHaveLength(2);
    expect(screen.getAllByRole("list", { name: "Targets" })).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Unusable destinations" })).toHaveTextContent("AlphaBetaGamma");
  });
  it("never invents an empty node and has no empty-state keyboard target", () => {
    const { container } = render(<RelationGraph {...props} nodes={[]} edges={[]} emptyMessage="Nothing authored" />);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing authored");
    expect(controls(container)).toEqual([]);
    fireEvent.keyDown(container.firstChild!, { key: "End" });
    expect(container.querySelectorAll("path")).toHaveLength(0);
  });
  it("retains all facts but refuses drawing any part of a cycle", () => {
    const { container } = render(<RelationGraph {...props} edges={[...edges, { from: "c", to: "a" }]} unavailableMessage="Cycle prevents drawing" />);
    expect(screen.getByRole("status")).toHaveTextContent("Cycle prevents drawing");
    expect(controls(container)).toHaveLength(3);
    expect(container.querySelectorAll("path")).toHaveLength(0);
  });
  it("uses direct component dependencies without data access or external graph capabilities", () => {
    for (const name of ["RelationGraph.tsx", "relation-graph-layout.ts"]) {
      const source = readFileSync(new URL(name, import.meta.url), "utf8");
      expect(source).not.toMatch(/\b(?:fetch|localStorage|sessionStorage|XMLHttpRequest)\b/);
      const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/g)].map(match => match[1]);
      expect(source).not.toMatch(/\b(?:import|require)\s*\(\s*(?![\s"'])/);
      expect(imports.every(name => name === "react" || name!.startsWith("../components/") || name!.startsWith("./relation-graph-"))).toBe(true);
    }
  });
});
