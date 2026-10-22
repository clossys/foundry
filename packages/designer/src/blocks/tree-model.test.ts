import { describe, expect, it, vi } from "vitest";
import * as model from "./tree-model.js";
import { getAppNavigationAncestry, validateAppNavigationTree, type AppNavigationNode } from "./app-navigation-tree.js";
import { catalogIndex } from "./catalog-workspace/model.js";
import type { CatalogWorkspaceItem } from "./catalog-workspace/types.js";

function chain(count: number): model.TreeNode[] {
  let node: model.TreeNode = { id: String(count), label: `Level ${count}`, href: "/leaf" };
  for (let level = count - 1; level > 0; level--) node = { id: String(level), label: `Level ${level}`, children: [node] };
  return [node];
}

describe("shared tree model", () => {
  it("resolves duplicate hrefs in caller preorder, preserving the AppNavigation facade", () => {
    const tree = [{ id: "folder", label: "Folder", children: [{ id: "earlier", label: "Earlier", href: "/same" }] }, { id: "later", label: "Later", href: "/same" }];
    expect([...model.indexTree(tree).nodes.keys()]).toEqual(["folder", "earlier", "later"]);
    expect(model.getTreeAncestry(tree, { href: "/same" }).map(node => node.id)).toEqual(["folder", "earlier"]);
    expect(getAppNavigationAncestry(tree, { href: "/same" }).map(node => node.id)).toEqual(["folder", "earlier"]);
  });
  it("indexes unrestricted depth and derives exact ancestry and breadcrumbs without mutation", () => {
    const tree = chain(120); const before = JSON.stringify(tree);
    expect(model.indexTree(tree).nodes.size).toBe(120);
    expect(model.getTreeAncestry(tree, { href: "/leaf" })).toHaveLength(120);
    expect(model.getTreeAncestry(tree, { id: "missing", href: "/leaf" })).toEqual([]);
    expect(model.getTreeBreadcrumbs(tree, { id: "120" }).at(-1)).toEqual({ id: "120", label: "Level 120", href: "/leaf" });
    expect(JSON.stringify(tree)).toBe(before);
    expect(() => model.indexTree(chain(3), { maxDepth: 2 })).toThrow(/depth|levels/i);
  });
  it("refuses duplicates, cycles, sparse children and ambiguous destinations", () => {
    expect(() => model.indexTree([{ id: "a", label: "A" }, { id: "a", label: "B" }])).toThrow(/duplicate/i);
    const cyclic: model.TreeNode = { id: "cycle", label: "Cycle" }; cyclic.children = [cyclic];
    expect(() => model.indexTree([cyclic])).toThrow(/cycle/i);
    expect(() => model.indexTree([{ id: "a", label: "A", children: Array(1) }])).toThrow(/node|id/i);
    expect(() => model.indexTree([{ id: "a", label: "A", href: "/a", onSelect: () => {} }])).toThrow(/destination/i);
  });
  it("keeps AppNavigation at two levels while both existing blocks use the shared validator", () => {
    const validate = vi.spyOn(model, "indexTree");
    try {
      expect(() => validateAppNavigationTree(chain(3) as AppNavigationNode[])).toThrow(/two levels/i);
      expect(validate).toHaveBeenCalled(); validate.mockClear();
      // All catalog nodes carry their original kind metadata.
      const addKind = (nodes: readonly model.TreeNode[]): CatalogWorkspaceItem[] => nodes.map(({ children, ...node }) => ({ ...node, kind: "entry", ...(children ? { children: addKind(children) } : {}) }));
      expect(catalogIndex(addKind(chain(12))).nodes.size).toBe(12);
      expect(validate).toHaveBeenCalled();
    } finally { validate.mockRestore(); }
  });
  it("uses 10,000 as the catalog's only size bound and accepts empty folders", () => {
    const forest = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), label: String(i), kind: "entry" }));
    expect(catalogIndex(forest).nodes.size).toBe(10000);
    expect(() => catalogIndex([...forest, { id: "extra", label: "Extra", kind: "entry" }])).toThrow(/10,000/);
    expect(catalogIndex([{ id: "empty", label: "Empty", kind: "folder", children: [] }]).nodes.size).toBe(1);
  });
  it("indexes a 10,000-level catalog and its ancestry without a recursive stack limit", () => {
    let item: CatalogWorkspaceItem = { id: "10000", label: "Leaf", kind: "file" };
    for (let level = 9999; level > 0; level--) item = { id: String(level), label: `Folder ${level}`, kind: "folder", children: [item] };
    expect(catalogIndex([item]).nodes.size).toBe(10000);
    expect(model.getTreeAncestry([item], { id: "10000" })).toHaveLength(10000);
  });
});
