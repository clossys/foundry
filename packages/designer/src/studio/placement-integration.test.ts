import { expect, it } from "vitest";
import { loadBuildCatalog, loadCatalog, type LibraryData } from "../catalog-core/index.js";
import { matrixBoards, purePlacementTree, type MatrixRow } from "./matrix-model.js";
import type { SlotTreeNode } from "./model.js";
import { boardMatches, canvasDomains } from "./canvas-model.js";

it.each(["themes", "assets", "components", "sections", "frames"] as const)("carries real %s placements through Studio at exactly group > family > leaf depth", layer => {
  const loaded = loadBuildCatalog();
  // Build-only layers supply real placements and leaf identities, without asking the runtime engine to evaluate them.
  const catalog = { ...loadCatalog(), placements: loaded.placements.filter(placement => placement.layer === layer) };
  const tree = purePlacementTree(catalog.placements);
  const leavesOf = (node: SlotTreeNode): string[] => node.children ? node.children.flatMap(leavesOf) : [node.id];
  const expectedLeaves = new Set(loaded.slots.filter(slot => slot.layer === layer).map(slot => slot.id));
  const count = expectedLeaves.size;
  const treeLeaves = tree.flatMap(leavesOf);
  expect(treeLeaves).toHaveLength(count);
  expect(new Set(treeLeaves).size).toBe(count);
  expect(new Set(treeLeaves)).toEqual(expectedLeaves);
  for (const placement of catalog.placements) for (const group of placement.nodes) {
    expect("children" in group).toBe(true); expect("leaves" in group).toBe(false);
    if ("children" in group) for (const family of group.children) {
      expect("leaves" in family).toBe(true); expect("children" in family).toBe(false);
    }
  }
  for (const group of tree) {
    expect(group.children?.length).toBeGreaterThan(0);
    for (const family of group.children ?? []) {
      expect(family.children?.length).toBeGreaterThan(0);
      for (const leaf of family.children ?? []) {
        expect(leaf.children).toBeUndefined(); expect(expectedLeaves.has(leaf.id)).toBe(true);
      }
    }
  }
  if (layer === "themes") {
    expect(tree.map(node => node.id)).toEqual(["color", "type", "space", "shape", "depth", "motion", "interaction"].map(id => `tokens/${id}`));
    const tiers = loaded.slots.flatMap(slot => slot.contract.kind === "token" ? [slot.contract.tier] : []);
    expect(new Set(tiers)).toEqual(new Set(["scale", "role"]));
    expect(tree.some(node => node.id === "tokens/scale" || node.id === "tokens/role")).toBe(false);
  }
  // Prepared rows exercise Studio board grouping without any candidate operations.
  const rowsOf = (node: SlotTreeNode, depth: number): MatrixRow[] => [{
    id: node.id, label: node.label, scope: node.children ? "node" : "slot", target: node.id,
    leaves: leavesOf(node), depth, emphasized: true, basket: "node", candidates: [],
  }, ...(node.children?.flatMap(child => rowsOf(child, depth + 1)) ?? [])];
  const rows = tree.flatMap(node => rowsOf(node, 0));
  const library: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, fills: [] };
  const boards = matrixBoards({ catalog, library, working: library }, rows);
  expect(boards.map(board => board.id)).toEqual(tree.flatMap(group => group.children?.map(family => family.id) ?? []));
  expect(boards.flatMap(board => board.leaves)).toHaveLength(count);
  expect(new Set(boards.flatMap(board => board.leaves))).toEqual(expectedLeaves);
  expect(boards.flatMap(board => board.rows.filter(row => row.scope === "slot").map(row => row.id))).toEqual(treeLeaves);
  expect(canvasDomains(catalog, boards).flatMap(domain => domain.boards)).toEqual(boards);
});

it.each(["themes", "assets", "components", "sections", "frames"] as const)("groups a three-level %s placement generically and keeps board filters independent of candidate evaluation", layer => {
  const leaves = [`${layer}.first`, `${layer}.second`];
  const loaded = loadCatalog();
  const catalog = { ...loaded, placements: [{ layer, nodes: [{ id: "group", label: "Group", children: [{ id: "family", label: "Family", leaves }] }] }] };
  const tree = purePlacementTree(catalog.placements);
  expect(tree.map(node => node.id)).toEqual([`${layer}/group`]);
  expect(tree[0]?.children?.[0]?.id).toBe(`${layer}/family`);
  expect(tree[0]?.children?.[0]?.children?.map(node => node.id)).toEqual(leaves);
  const rows: MatrixRow[] = [
    { id: `${layer}/group`, label: "Group", scope: "node", target: `${layer}/group`, leaves, depth: 0, basket: "node", emphasized: true, candidates: [] },
    { id: `${layer}/family`, label: "Family", scope: "node", target: `${layer}/family`, leaves, depth: 1, basket: "node", emphasized: true, candidates: [] },
    ...leaves.map(id => ({ id, label: id, scope: "slot" as const, target: id, leaves: [id], depth: 2, basket: "node" as const, emphasized: false, candidates: [] })),
  ];
  const working: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, fills: [] };
  const boards = matrixBoards({ catalog, library: working, working }, rows);
  expect(boards.map(board => board.id)).toEqual([`${layer}/family`]);
  expect(boards[0]?.leaves).toEqual(leaves);
  expect(canvasDomains(catalog, boards)[0]?.boards).toEqual(boards);
  const input = { board: boards[0]!, domain: "Group", query: "Family", working, changes: { baseHash: "unused", changes: [{ op: "adopt" as const, slot: leaves[0]!, source: "foundry" }] }, groupChoices: {}, warnings: 1 };
  expect(boardMatches({ ...input, filter: "pending" })).toBe(true);
  expect(boardMatches({ ...input, filter: "warnings" })).toBe(true);
  expect(boardMatches({ ...input, filter: "warnings", warnings: 0 })).toBe(false);
});
