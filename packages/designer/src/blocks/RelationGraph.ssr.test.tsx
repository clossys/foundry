import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RelationGraph } from "./RelationGraph.js";

it("renders the authored list and empty drawing on the server, then hydrates without a mismatch and cleans observers", async () => {
  const disconnect = vi.fn(); const observe = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = disconnect; });
  const tree = <RelationGraph label="Connections" kinds={["unit"]} nodes={[{ id: "a", label: "Alpha", kind: "unit" }, { id: "b", label: "Beta", kind: "unit" }]} edges={[{ from: "a", to: "b", label: "uses" }]} />;
  const html = renderToString(tree);
  expect(html).toContain("Alpha"); expect(html).toContain("Beta"); expect(html).not.toContain("<path");
  const container = document.createElement("div"); container.innerHTML = html; document.body.append(container);
  const onRecoverableError = vi.fn(); let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError }); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelectorAll("[data-relation-graph-node]")).toHaveLength(2);
    expect(container.querySelectorAll("path")).toHaveLength(1);
    expect(observe).toHaveBeenCalled();
    await act(async () => root?.unmount()); root = undefined;
    expect(disconnect).toHaveBeenCalledExactlyOnceWith();
  } finally { if (root) await act(async () => root?.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
