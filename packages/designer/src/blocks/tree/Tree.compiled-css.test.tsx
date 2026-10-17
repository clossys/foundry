import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Tree, type TreeNodeData, type TreeProps } from "./Tree.js";

function chain(depth: number): TreeNodeData[] {
  const nodes: TreeNodeData[] = [{ id: "root", heading: "Root" }];
  let parent = "root";
  for (let level = 1; level <= depth; level++) {
    const id = `branch-${level}`;
    nodes.push({ id, parent, heading: id }, { id: `leaf-${level}`, parent, heading: "Leaf" });
    parent = id;
  }
  return nodes;
}

it("ships every rendered Tree layout and connector class in canonical compiled CSS", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../../styles/compiled.css"), "utf8");
  const fixtures: TreeProps[] = [
    ...[1, 2, 3].map(depth => ({ nodes: chain(depth), orientation: "right" as const })),
    { nodes: chain(2), orientation: "down" },
    ...[2, 3, 4, 5, 6].map(count => ({
      orientation: "down" as const,
      nodes: [{ id: "root", heading: "Root" }, ...Array.from({ length: count }, (_, index) => ({ id: `child-${index}`, parent: "root", heading: "Child" }))],
    })),
  ];
  const classes = new Set<string>();
  for (const ground of ["base", "sunken", "inverse"] as const) for (const props of fixtures) {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(Tree, { ...props, ground }));
    for (const node of host.querySelectorAll("[data-tree], ul, li, [data-tree-node], [data-tree-connector]")) for (const token of node.classList) classes.add(token);
  }
  expect(classes.size).toBeGreaterThan(20);
  const missing = [...classes].filter(token => {
    const selector = `.${token.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
    return ![`${selector} {`, `${selector}:`, `${selector},`].some(form => css.includes(form));
  });
  expect(missing).toEqual([]);
});
