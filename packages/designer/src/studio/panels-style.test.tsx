import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TreeView } from "./TreeView.js";
import { InspectorChange } from "./Inspector.js";
import { StudioDataValue } from "./data-value.js";
import { SystemInspector } from "./system-canvas/inspector/Inspector.js";
import { ExplorerTree } from "./rail/ExplorerTree.js";
import { createRouteStudioLabels } from "./route-labels.js";
import { studioTestCopy } from "./__fixtures__/copy.js";
import { testPlacements } from "./system-canvas/__fixtures__/system.js";

afterEach(cleanup);
const labels = createRouteStudioLabels(studioTestCopy);
const long = "unbroken-fixture-data-".repeat(30);
function assertRowEllipsis(label: Element) {
  // Tailwind truncate = overflow:hidden; text-overflow:ellipsis; white-space:nowrap.
  expect(label).toHaveClass("min-w-0", "flex-1", "truncate");
}
it("constrains the real RAC rows and ellipsizes labels; the ellipsis-removal mutant fails", () => {
  const view = render(<TreeView aria-label="Fixture hierarchy" nodes={[{ id: "root", label: long, children: [{ id: "child", label: long }] }]} defaultExpandedIds={["root"]}/>);
  const rows = view.container.querySelectorAll('[role="row"]');
  expect(rows.length).toBe(2);
  for (const row of rows) expect(row).toHaveClass("min-w-0", "max-w-full");
  const names = view.container.querySelectorAll("[data-tree-label]");
  expect(names.length).toBe(2);
  for (const label of names) {
    assertRowEllipsis(label);
    expect(label).toHaveAttribute("title", long);
    label.classList.remove("truncate");
    expect(() => assertRowEllipsis(label), "removing ellipsis must fail the same assertion").toThrow();
    label.classList.add("truncate");
    assertRowEllipsis(label);
  }
});
it("wraps helper and long data values, uses mono for hashes and muted inspector labels", () => {
  const view = render(<><InspectorChange labels={{ ...labels, howToChange: long }}/><StudioDataValue kind="hash" value={long}/><StudioDataValue kind="path" value={long}/><SystemInspector copy={studioTestCopy} labels={labels} identity={{id:"components.fixture",layer:"components",path:[],status:"ready",fill:{pin:long}}} onNavigate={()=>{}} onClose={()=>{}} canNavigate={()=>false}/></>);
  expect(view.container.querySelector("[data-studio-inspector-change] p")).toHaveClass("min-w-0", "wrap-anywhere");
  for (const value of view.container.querySelectorAll("[data-studio-data-value]")) expect(value).toHaveClass("min-w-0", "wrap-anywhere");
  for (const hash of view.container.querySelectorAll('[data-studio-data-kind="hash"]')) expect(hash).toHaveClass("font-mono");
  for (const label of view.container.querySelectorAll('[data-studio-panel="inspector"] dt')) expect(label).toHaveClass("text-ink-muted");
});
it("uses the registered EmptyState for unselected inspector, empty tree and zero search results", () => {
  const view = render(<><SystemInspector copy={studioTestCopy} labels={labels} onNavigate={()=>{}} onClose={()=>{}} canNavigate={()=>false}/><ExplorerTree copy={studioTestCopy} labels={labels} placements={[]} onNavigate={()=>{}}/><ExplorerTree copy={studioTestCopy} labels={labels} placements={testPlacements} query="no-leaf-matches-this-query" onNavigate={()=>{}}/></>);
  expect(view.container.querySelectorAll('[data-ds-leaf="sections.empty-state"]')).toHaveLength(3);
});
