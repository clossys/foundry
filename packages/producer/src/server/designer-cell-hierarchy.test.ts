import { describe, expect, it, vi } from "vitest";
import { loadBuildCatalog } from "../../../designer/src/catalog-core/index.js";
import { cellHierarchy, parseCellsResponse } from "../../studio/lib/cells-client.js";
import { projectStudioAgentIA } from "../../studio/lib/studio-agent-ia.js";
import { designerCellHierarchy, projectDesignerCellHierarchy } from "./designer-cell-hierarchy.js";

vi.mock("./cells.js", () => ({ agentModule: vi.fn(async (agent: string, file: string) => {
  if (agent !== "designer" || file !== "catalog-core/index.js") throw new Error("Unexpected native module");
  return { loadBuildCatalog };
}) }));

const catalog = loadBuildCatalog();
const cells = ["assets.icon-check", "tokens.spacing", "tokens.radius", "tokens.accent-color"].map((id, index) => ({ id, title: id, version: index + 1, status: "active" as const }));

describe("native Designer cell hierarchy", () => {
  it("joins authentic native cells to canonical groups, families and order without catalog-only rows", async () => {
    const projected = await designerCellHierarchy(cells);
    expect(projected.tree).toEqual([
      { id: "tokens/color", name: "Color", children: [{ id: "tokens/color-palettes", name: "Palettes", cells: ["tokens.accent-color"] }] },
      { id: "tokens/space", name: "Space", children: [{ id: "tokens/space-rhythm", name: "Rhythm", cells: ["tokens.spacing"] }] },
      { id: "tokens/shape", name: "Shape", children: [{ id: "tokens/shape-corners", name: "Corners", cells: ["tokens.radius"] }] },
      { id: "assets/icons", name: "Icons", children: [{ id: "assets/icons-actions", name: "Actions", cells: ["assets.icon-check"] }] },
    ]);
    const ia = projectStudioAgentIA({ agent: "designer", state: "ready", cells, tree: { active: {}, ...projected } });
    expect(ia.state).toBe("ready");
    expect(ia.groups.flatMap(group => group.collections.flatMap(collection => collection.cells.map(cell => ({ id: cell.id, version: cell.version, status: cell.status }))))).toEqual([cells[3], cells[1], cells[2], cells[0]].map(cell => ({ id: cell!.id, version: cell!.version, status: cell!.status })));
    expect(projected.designerSlots).toContainEqual({ id: "tokens.radius", layer: "tokens", kind: "token", valueKind: "dimension" });
    expect(projected.designerSlots).toContainEqual({ id: "assets.icon-check", layer: "assets", kind: "asset", valueKind: "glyph" });
  });

  it("preserves all five canonical layers and separates empty consumer layers from populated groups", () => {
    const projected = projectDesignerCellHierarchy(cells, catalog);
    expect(projected.designerLayers.map(layer => layer.id)).toEqual(catalog.placements.map(placement => placement.layer));
    expect(projected.designerLayers).toEqual([
      { id: "tokens", label: "tokens", groups: ["tokens/color", "tokens/space", "tokens/shape"] },
      { id: "assets", label: "assets", groups: ["assets/icons"] },
      { id: "components", label: "components", groups: [] },
      { id: "sections", label: "sections", groups: [] },
      { id: "frames", label: "frames", groups: [] },
    ]);
    const everyLayer = catalog.placements.map(placement => {
      const group = placement.nodes[0]!;
      if (!("children" in group) || !("leaves" in group.children[0]!)) throw new Error("Invalid fixture catalog");
      return { id: group.children[0]!.leaves[0]! };
    });
    const all = projectDesignerCellHierarchy(everyLayer, catalog);
    expect(all.designerLayers.every(layer => layer.groups.length > 0)).toBe(true);
    expect(new Set(all.designerSlots.map(slot => slot.kind))).toEqual(new Set(["token", "asset", "component", "section", "frame"]));
    expect(cellHierarchy(everyLayer.map(cell => ({ ...cell, title: cell.id })), all).flatMap(group => group.children.flatMap(family => family.children))).toHaveLength(5);
  });

  it("keeps canonical leaf order when source versions arrive in a different order", () => {
    const input = ["tokens.status-color", "tokens.accent-color"].map((id, i) => ({ id, title: id, version: i + 4 }));
    const projected = projectDesignerCellHierarchy(input, catalog);
    const nested = cellHierarchy(input, projected);
    expect(nested[0]!.children[0]!.children.map(cell => [cell.id, cell.version])).toEqual([["tokens.accent-color", 5], ["tokens.status-color", 4]]);
  });

  it("carries the native joins through the actual HTTP parser and refuses missing slot coverage", () => {
    const hierarchy = projectDesignerCellHierarchy(cells, catalog);
    const response = { agents: [{ agent: "designer", packageName: "@clossys/designer", state: "ready", tree: { tree: hierarchy.tree }, designerLayers: hierarchy.designerLayers, designerSlots: hierarchy.designerSlots, cells: cells.map(cell => ({ ...cell, path: `cells/${cell.id}/v${cell.version}.md`, fields: {} })) }] };
    const parsed = parseCellsResponse(response)[0]!;
    expect(parsed.designerLayers).toEqual(hierarchy.designerLayers);
    expect(parsed.designerSlots).toEqual(hierarchy.designerSlots);
    const ia = projectStudioAgentIA(parsed);
    expect(ia.state).toBe("ready");
    const joined = ia.groups.flatMap(group => group.collections.flatMap(collection => collection.cells));
    expect(joined.map(cell => [cell.id, cell.version, cell.status])).toEqual([cells[3], cells[1], cells[2], cells[0]].map(cell => [cell!.id, cell!.version, cell!.status]));
    expect(new Set(joined.map(cell => cell.id)).size).toBe(cells.length);
    expect(() => parseCellsResponse({ agents: [{ ...response.agents[0]!, designerSlots: hierarchy.designerSlots.slice(1) }] })).toThrow("do not cover every cell");
  });

  it("rejects empty, repeated, unknown or unplaced consumer identities", () => {
    expect(() => projectDesignerCellHierarchy([], catalog)).toThrow("no Designer cells");
    expect(() => projectDesignerCellHierarchy([cells[0]!, cells[0]!], catalog)).toThrow("duplicate identities");
    expect(() => projectDesignerCellHierarchy([{ id: "tokens.unregistered" }], catalog)).toThrow("no registered native slot");
    expect(() => projectDesignerCellHierarchy(cells, { ...catalog, placements: [] })).toThrow("does not place every consumer cell");
  });

  it("refuses malformed group levels and duplicated placement instead of hiding cells", () => {
    const first = catalog.placements[0]!;
    expect(() => projectDesignerCellHierarchy(cells, { ...catalog, placements: [first, first] })).toThrow("repeats a layer");
    expect(() => projectDesignerCellHierarchy(cells, { ...catalog, placements: [{ ...first, nodes: [{ id: "color", label: "Color", leaves: ["tokens.accent-color"] }] }] })).toThrow("no L1 grouping");
    expect(() => projectDesignerCellHierarchy(cells, { ...catalog, placements: [{ ...first, nodes: [{ id: "color", label: "Color", children: [{ id: "a", label: "A", leaves: ["tokens.accent-color"] }, { id: "b", label: "B", leaves: ["tokens.accent-color"] }] }] }] })).toThrow("more than once");
  });
});
