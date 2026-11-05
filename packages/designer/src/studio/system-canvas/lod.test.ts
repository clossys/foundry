import { describe, expect, it } from "vitest";
import { CELL_NEAR_BUDGET, type CellLodTier } from "../../blocks/canvas/cell-lod.js";
import type { LayerId } from "../../catalog-core/index.js";
import type { SystemCell } from "./layout.js";
import { cellTiers, liveCells, mountsLive, renderedTier } from "./lod.js";

const cell = (index: number, layer: LayerId = "components", x = index * 10): SystemCell => {
  const leaf = `${layer}.c${String(index).padStart(2, "0")}`;
  return { leaf, layer, l1: "l1", l2: "l2", board: `${layer}/l1`, line: `${layer}/l1/l2`, rect: { x, y: 0, width: 10, height: 10 } };
};
const allNear = (cells: readonly SystemCell[]) => new Map<string, CellLodTier>(cells.map(entry => [entry.leaf, "near"]));

describe("system canvas per-cell LOD", () => {
  it("tiers each cell by its own on-screen size and holds the previous tier", () => {
    const cells = [cell(0)]; // 10px world: 5x is 50px (mid), 15x is 150px.
    expect(cellTiers(cells, 2).get(cells[0]!.leaf)).toBe("far");
    expect(cellTiers(cells, 5).get(cells[0]!.leaf)).toBe("mid");
    expect(cellTiers(cells, 15).get(cells[0]!.leaf)).toBe("near");
    expect(cellTiers(cells, 15, new Map([[cells[0]!.leaf, "mid"]])).get(cells[0]!.leaf)).toBe("mid");
    expect(cellTiers(cells, 13, new Map([[cells[0]!.leaf, "near"]])).get(cells[0]!.leaf)).toBe("near");
  });

  it("mounts at most 24 live specimens, the most visible first; over-budget cells render mid [mutant: no budget]", () => {
    expect(CELL_NEAR_BUDGET).toBe(24);
    const cells = Array.from({ length: 31 }, (_, index) => cell(index));
    const tiers = allNear(cells);
    // c00 and c30 are half visible; c01..c29 are whole. The centre is c15.
    const live = liveCells(cells, tiers, { x: 5, y: 0, width: 300, height: 10 });
    expect(live.size).toBe(24);
    expect([...live].sort()).toEqual(Array.from({ length: 24 }, (_, index) => `components.c${String(index + 3).padStart(2, "0")}`));
    expect(renderedTier("components.c15", tiers, live)).toBe("near");
    expect(renderedTier("components.c27", tiers, live)).toBe("mid");
    expect(renderedTier("components.c00", tiers, live)).toBe("mid");
  });

  it("chooses live cells by visibility: off-screen near cells never mount", () => {
    const cells = [cell(0), cell(1, "components", 1000)];
    const live = liveCells(cells, allNear(cells), { x: 0, y: 0, width: 100, height: 100 });
    expect([...live]).toEqual(["components.c00"]);
  });

  it("never mounts Sections or Frames live, even near and on screen", () => {
    expect(mountsLive("sections")).toBe(false);
    expect(mountsLive("frames")).toBe(false);
    expect(mountsLive("components")).toBe(true);
    const cells = [cell(0, "sections"), cell(1, "frames"), cell(2, "themes")];
    const tiers = allNear(cells);
    const live = liveCells(cells, tiers, { x: 0, y: 0, width: 100, height: 100 });
    expect([...live]).toEqual(["themes.c02"]);
    expect(renderedTier("sections.c00", tiers, live)).toBe("mid");
  });

  it("keeps far and mid cells out of the live set", () => {
    const cells = [cell(0), cell(1)];
    const tiers = new Map<string, CellLodTier>([["components.c00", "far"], ["components.c01", "mid"]]);
    expect(liveCells(cells, tiers, { x: 0, y: 0, width: 100, height: 100 }).size).toBe(0);
  });
});
