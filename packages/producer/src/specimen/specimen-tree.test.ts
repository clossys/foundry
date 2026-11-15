/**
 * Fixture element trees may name exports of the candidate's own npm dependencies, and nothing else
 * outside the candidate's module.
 */
import { describe, expect, it } from "vitest";
import { dependencyPart, itemDependencies, specimenTreeIssues, treeDependencyParts } from "./specimen-tree.js";

const tree = {
  $component: "recharts.BarChart",
  props: { data: [{ month: "Jan", visitors: 186 }] },
  children: [{ $component: "recharts.Bar", props: { dataKey: "visitors" } }, { $component: "ChartTooltip" }],
};

describe("specimen element trees", () => {
  it("splits a dependency element name and reads an item's package names without versions", () => {
    expect(dependencyPart("recharts.BarChart")).toEqual({ module: "recharts", export: "BarChart" });
    expect(dependencyPart("@scope/charts.Area")).toEqual({ module: "@scope/charts", export: "Area" });
    expect(dependencyPart("ChartContainer")).toBeUndefined();
    expect([...itemDependencies({ dependencies: ["recharts@3.8.0", "@scope/charts@^1", "sonner"] })]).toEqual(["recharts", "@scope/charts", "sonner"]);
    expect(treeDependencyParts(tree)).toEqual(["recharts.BarChart", "recharts.Bar"]);
  });

  it("accepts dependency exports only for packages the candidate depends on", () => {
    const exports = new Set(["ChartContainer", "ChartTooltip"]);
    expect(specimenTreeIssues(tree, exports, {}, new Set(["recharts"]))).toEqual([]);
    expect(specimenTreeIssues(tree, exports, {})).toEqual([
      "children: the candidate depends on no package recharts",
      "children.children[0]: the candidate depends on no package recharts",
    ]);
    expect(specimenTreeIssues({ $component: "recharts.not-a-name" }, exports, {}, new Set(["recharts"]))).toEqual(["children: $component is an export name or <package>.<Export>"]);
    expect(specimenTreeIssues({ $component: "Missing" }, exports, {}, new Set(["recharts"]))).toEqual(["children: the candidate exports no component Missing"]);
  });
});
