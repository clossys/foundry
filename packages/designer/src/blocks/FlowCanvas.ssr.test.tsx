import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FlowCanvas } from "./FlowCanvas.js";
import * as blocks from "./index.js";

const props = {
  nodes: [{ id: "a", label: "Intake", kind: "Step" }, { id: "b", label: "Check", status: { tone: "info" as const, label: "Running" } }, { id: "c", label: "Done" }],
  edges: [{ from: "a", to: "b", label: "Sends" }, { from: "b", to: "c" }, { from: "a", to: "c" }],
  label: "Pipeline",
  emptyMessage: "Nothing to show",
  outgoingLabel: "Next",
  selectedId: "b",
};

describe("FlowCanvas server rendering", () => {
  it("draws the whole diagram on the server and hydrates twice without mismatch or id collisions", async () => {
    const tree = <><FlowCanvas {...props} /><FlowCanvas {...props} /></>;
    const html = renderToString(tree);
    expect(renderToString(tree)).toBe(html);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const recover = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      expect(host.querySelectorAll("[data-flowchart-edge]")).toHaveLength(6);
      expect(host.querySelectorAll("[data-flowchart-arrow]")).toHaveLength(6);
      expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(2);
      const ids = [...host.querySelectorAll("[id]")].map(node => node.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const element of host.querySelectorAll("[aria-labelledby],[aria-describedby]")) {
        for (const ref of `${element.getAttribute("aria-labelledby") ?? ""} ${element.getAttribute("aria-describedby") ?? ""}`.trim().split(/\s+/)) {
          expect(host.querySelector(`[id="${ref}"]`)).not.toBeNull();
        }
      }
      await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recover }); });
      expect(recover).not.toHaveBeenCalled();
      expect(host.querySelectorAll("[data-flowchart-edge]")).toHaveLength(6);
    } finally { await act(async () => root?.unmount()); host.remove(); }
  });

  it("renders the empty state on the server", () => {
    expect(renderToString(<FlowCanvas {...props} nodes={[]} edges={[]} />)).toContain("Nothing to show");
  });

  it("publishes the client component and a source-backed Material outside the server subsets", () => {
    expect((blocks as any).FlowCanvas).toBe(FlowCanvas);
    const material = blocks.APP_FRAME_MATERIALS.find(entry => entry.id === "flow-canvas" as any);
    expect(material?.component).toBe(FlowCanvas);
    for (const layer of ["components", "blocks", "shell"]) {
      expect(readFileSync(resolve(import.meta.dirname, `../${layer}/server.ts`), "utf8")).not.toMatch(/FlowCanvas|flow-canvas/);
    }
  });
});
