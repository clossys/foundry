import { describe, expect, it } from "vitest";
import { EXPLORER_LAYER_ORDER, explorerIndex, explorerNodes } from "./explorer-tree.js";
import { buildSlotTree } from "../model.js";
import { labels, smallCatalog } from "../__fixtures__/studio.js";
import { loadBuildCatalog } from "../../catalog-core/index.js";

describe("explorer tree", () => {
  it("orders the five layers as D5g rows: Frames top, Tokens bottom", () => {
    expect(EXPLORER_LAYER_ORDER).toEqual(["frames", "sections", "components", "assets", "tokens"]);
    const contracts = loadBuildCatalog();
    const nodes = explorerNodes(contracts.placements, labels.layers);
    expect(nodes.map(node => node.id)).toEqual(["frames", "sections", "components", "assets", "tokens"]);
    expect(nodes.map(node => node.label)).toEqual(["Frames", "Sections", "Components", "Assets", "Tokens"]);
  });
  it("shows only the layers a catalog places, still in D5g order", () => {
    expect(explorerNodes(smallCatalog.placements, labels.layers).map(node => node.id)).toEqual(["assets", "tokens"]);
  });
  it("nests L1, L2 and L3 under each layer with the slot-tree ids", () => {
    const nodes = explorerNodes(smallCatalog.placements, labels.layers);
    const tokens = nodes.find(node => node.id === "tokens")!;
    expect(tokens.children).toEqual(buildSlotTree(smallCatalog.placements).find(layer => layer.id === "tokens")!.children);
  });
  it("indexes every node with its navigation target", () => {
    const nodes = explorerNodes(smallCatalog.placements, labels.layers);
    const index = explorerIndex(nodes);
    expect(index.get("tokens")).toEqual({ target: { layer: "tokens" }, branch: true });
    expect(index.get("tokens.surface-color")?.target).toMatchObject({ layer: "tokens", leaf: "tokens.surface-color" });
    const l1 = nodes.find(node => node.id === "tokens")!.children![0]!;
    expect(index.get(l1.id)).toEqual({ target: { layer: "tokens", l1: l1.id }, branch: true });
    const l2 = l1.children?.find(child => child.children?.length);
    if (l2) expect(index.get(l2.id)).toEqual({ target: { layer: "tokens", l1: l1.id, l2: l2.id }, branch: true });
  });
  it("filters leaves by a query and drops empty branches", () => {
    const nodes = explorerNodes(smallCatalog.placements, labels.layers, "icon-search");
    expect(nodes.map(node => node.id)).toEqual(["assets"]);
  });
});
