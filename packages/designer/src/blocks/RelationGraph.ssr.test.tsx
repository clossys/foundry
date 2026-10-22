import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RelationGraph } from "./RelationGraph.js";

it("renders the authored list and empty drawing on the server, then hydrates without a mismatch and cleans observers", async () => {
  const disconnect = vi.fn(); const observe = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = disconnect; });
  const tree = <RelationGraph label="Connections" kinds={["unit"]} nodes={[{ id: "a", label: "Alpha", kind: "unit" }, { id: "b", label: "Beta", kind: "unit" }, { id: "c", label: "Gamma", kind: "unit" }]} edges={[{ from: "a", to: "b", label: "uses" }]} />;
  const html = renderToString(tree);
  expect(html).toContain("Alpha"); expect(html).toContain("Beta"); expect(html).not.toContain("<path");
  const container = document.createElement("div"); container.innerHTML = html; document.body.append(container);
  const controls = () => [...container.querySelectorAll<HTMLElement>("[data-relation-graph-control]")];
  expect(controls().map(control => control.tabIndex)).toEqual([0, -1, -1]);
  const onRecoverableError = vi.fn(); let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError }); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelectorAll("[data-relation-graph-node]")).toHaveLength(3);
    expect(controls().map(control => control.tabIndex)).toEqual([0, -1, -1]);
    expect(container.querySelectorAll("path")).toHaveLength(1);
    expect(observe).toHaveBeenCalled();
    await act(async () => controls()[0]!.focus());
    for (const name of ["Beta", "Gamma", "Alpha"]) {
      const event = new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true });
      await act(async () => { document.activeElement!.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toHaveAccessibleName(name);
      expect(controls().filter(control => control.tabIndex === 0)).toEqual([document.activeElement]);
    }
    await act(async () => root?.unmount()); root = undefined;
    expect(disconnect).toHaveBeenCalledExactlyOnceWith();
  } finally { if (root) await act(async () => root?.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
