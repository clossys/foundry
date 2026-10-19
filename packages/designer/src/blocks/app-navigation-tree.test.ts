import { describe, expect, it, vi } from "vitest";
import {
  getAppNavigationAncestry, getAppNavigationBreadcrumbs, validateAppNavigationTree,
  type AppNavigationNode,
} from "./app-navigation-tree.js";

const tree: readonly AppNavigationNode[] = Object.freeze([
  { id: "home", label: "Home", href: "/" },
  { id: "catalogs", label: "Catalogs", href: "/catalogs", children: [
    { id: "blocks", label: "Blocks", href: "/catalogs/blocks" },
    { id: "actions", label: "Actions", onAction: vi.fn() },
  ] },
]);

describe("host navigation tree", () => {
  it("accepts two immutable levels, a destination parent and action leaves", () => {
    const before = JSON.stringify(tree);
    expect(() => validateAppNavigationTree(tree)).not.toThrow();
    expect(JSON.stringify(tree)).toBe(before);
    expect(() => validateAppNavigationTree([])).not.toThrow();
    expect(() => validateAppNavigationTree([{ id: "group", label: "Group", children: [tree[0]!] as any }])).not.toThrow();
  });

  it.each([
    ["duplicate", [{ id: "a", label: "A", href: "/a" }, { id: "a", label: "B", href: "/b" }]],
    ["duplicate", [{ id: "a", label: "A", children: [{ id: "a", label: "B", href: "/b" }] }]],
    ["two levels", [{ id: "a", label: "A", children: [{ id: "b", label: "B", children: [{ id: "c", label: "C", href: "/c" }] }] }]],
    ["destination", [{ id: "a", label: "A", children: [] }]],
    ["destination", [{ id: "a", label: "A" }]],
    ["destination", [{ id: "a", label: "A", href: "/a", onAction: () => {} }]],
    ["destination", [{ id: "a", label: "A", href: " " }]],
    ["label", [{ id: "a", label: " ", href: "/a" }]],
    ["id", [{ id: " ", label: "A", href: "/a" }]],
  ])("rejects invalid %s input before rendering", (message, nodes) => {
    expect(() => validateAppNavigationTree(nodes as any)).toThrow(new RegExp(message, "i"));
  });

  it("resolves exact route ancestry by stable id or href without mutating the tree", () => {
    expect(getAppNavigationAncestry(tree, { id: "blocks" }).map(node => node.id)).toEqual(["catalogs", "blocks"]);
    expect(getAppNavigationAncestry(tree, { href: "/catalogs/blocks" }).map(node => node.id)).toEqual(["catalogs", "blocks"]);
    expect(getAppNavigationAncestry(tree, { id: "home", href: "/catalogs/blocks" }).map(node => node.id)).toEqual(["home"]);
    expect(getAppNavigationAncestry(tree, { id: "unknown", href: "/" })).toEqual([]);
    expect(getAppNavigationAncestry(tree, { href: "/catalogs/blocks/selection" })).toEqual([]);
  });

  it("derives breadcrumbs only from route ancestry, never a view's internal selection", () => {
    expect(getAppNavigationBreadcrumbs(tree, { id: "blocks", selection: "Selected token" } as any)).toEqual([
      { id: "catalogs", label: "Catalogs", href: "/catalogs" },
      { id: "blocks", label: "Blocks", href: "/catalogs/blocks" },
    ]);
    expect(getAppNavigationBreadcrumbs(tree, { id: "actions" }).map(node => node.label)).toEqual(["Catalogs", "Actions"]);
    expect(getAppNavigationBreadcrumbs(tree, { id: "unknown" })).toEqual([]);
  });
});
