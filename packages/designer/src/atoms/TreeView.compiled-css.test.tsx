import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { TreeView, type TreeViewNode } from "./TreeView.js";

const nodes: TreeViewNode[] = [
  { id: "a", label: "Alpha", children: [{ id: "a1", label: "Alpha one", children: [{ id: "a1x", label: "Deep" }] }, { id: "a2", label: "Alpha two" }] },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma", children: [{ id: "c1", label: "Gamma one" }] },
];

it("ships every rendered TreeView class, including selected and keyboard-focus states, in canonical compiled CSS", async () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
  const user = userEvent.setup();
  const { container } = render(<TreeView nodes={nodes} aria-label="Documents" currentId="b" defaultExpandedIds={["a", "a1"]} className="host-tree" />);
  act(() => container.querySelector<HTMLElement>('[data-key="a"]')!.focus());
  await user.keyboard("{ArrowDown}{ArrowDown}");
  const classes = new Set<string>();
  for (const node of container.querySelectorAll("*")) for (const token of node.classList) classes.add(token);
  classes.delete("host-tree");
  expect(classes.size).toBeGreaterThan(15);
  for (const required of ["bg-surface-selected", "forced-colors:outline-2", "forced-colors:-outline-offset-2", "rtl:rotate-180"]) expect(classes.has(required), required).toBe(true);
  const missing = [...classes].filter(token => {
    const selector = `.${token.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
    return ![`${selector} {`, `${selector}:`, `${selector},`].some(form => css.includes(form));
  });
  expect(missing).toEqual([]);
});
