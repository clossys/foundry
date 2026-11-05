import { TOKENS } from "../../tokens/tokens.js";
import { describe, expect, it } from "vitest";
import { SYSTEM_LAYER_ORDER, defaultSystemMetrics, systemLayout } from "./layout.js";
import { testMetrics, testPlacements } from "./__fixtures__/system.js";

describe("system layout model", () => {
  const layout = systemLayout(testPlacements, testMetrics);

  it("stacks five layer rows top to bottom: Frames, Sections, Components, Assets, Themes", () => {
    expect(SYSTEM_LAYER_ORDER).toEqual(["frames", "sections", "components", "assets", "themes"]);
    expect(layout.rows.map(row => row.layer)).toEqual(["frames", "sections", "components", "assets", "themes"]);
    for (let index = 1; index < layout.rows.length; index++) {
      const above = layout.rows[index - 1]!.rect, below = layout.rows[index]!.rect;
      expect(below.y).toBe(above.y + above.height + testMetrics.rowGap);
    }
  });

  it("holds one board per L1 in each row, left to right in placement order", () => {
    const tokens = layout.rows.find(row => row.layer === "themes")!;
    expect(tokens.boards.map(board => board.id)).toEqual(["themes/color", "themes/space"]);
    const [color, space] = tokens.boards as [typeof tokens.boards[number], typeof tokens.boards[number]];
    expect(space.rect.x).toBe(color.rect.x + color.rect.width + testMetrics.boardGap);
    expect(color.rect.y).toBe(tokens.rect.y);
  });

  it("lays each board out as a ragged grid: one line per L2, its L3 cells along it", () => {
    const color = layout.boards.get("themes/color")!;
    expect(color.lines.map(line => [line.l2, line.cells.map(cell => cell.leaf)])).toEqual([
      ["color-engine", ["themes.chart-1"]],
      ["color-palettes", ["themes.primary", "themes.destructive", "themes.background"]],
    ]);
    const [engine, palettes] = color.lines as [typeof color.lines[number], typeof color.lines[number]];
    // Ragged: lines differ in length; the board is as wide as its longest line.
    expect(engine.rect.width).toBeLessThan(palettes.rect.width);
    expect(color.rect.width).toBe(palettes.rect.width + testMetrics.boardPadding * 2);
    // Lines stack downward; cells run along the line after its label.
    expect(palettes.rect.y).toBe(engine.rect.y + testMetrics.cellHeight + testMetrics.lineGap);
    const [first, second] = palettes.cells as [typeof palettes.cells[number], typeof palettes.cells[number]];
    expect(first.rect.x).toBe(palettes.rect.x + testMetrics.lineLabelWidth + testMetrics.cellGap);
    expect(second.rect.x).toBe(first.rect.x + testMetrics.cellWidth + testMetrics.cellGap);
    expect(first.rect.y).toBe(palettes.rect.y);
    expect(first.rect.width).toBe(testMetrics.cellWidth);
    expect(first.rect.height).toBe(testMetrics.cellHeight);
  });

  it("indexes every leaf to its layer, L1, L2, board and line", () => {
    expect(layout.cells.get("components.menu")).toMatchObject({ layer: "components", l1: "actions", l2: "actions-menus", board: "components/actions", line: "components/actions/actions-menus" });
    expect(layout.cells.size).toBe(14);
  });

  it("bounds every row and is deterministic", () => {
    const widest = Math.max(...layout.rows.map(row => row.rect.width));
    const last = layout.rows.at(-1)!.rect;
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: widest, height: last.y + last.height });
    expect(systemLayout(testPlacements, testMetrics)).toEqual(layout);
  });

  it("refuses a leaf placed twice", () => {
    const twice = [{ layer: "themes" as const, nodes: [{ id: "a", label: "A", children: [{ id: "b", label: "B", leaves: ["themes.x", "themes.x"] }] }] }];
    expect(() => systemLayout(twice, testMetrics)).toThrow(TypeError);
  });

  it("gives composed frame specimens a desktop viewport instead of collapsing their sidebar into a 320px card", () => {
    const real = systemLayout(testPlacements);
    const frame = [...real.cells.values()].find(cell => cell.layer === "frames")!;
    const component = [...real.cells.values()].find(cell => cell.layer === "components")!;
    expect(frame.rect.width).toBe(Number.parseFloat(TOKENS["--breakpoint-desktop"]!.value));
    expect(frame.rect.height).toBe(Number.parseFloat(TOKENS["--ui-layout-dock-max-block"]!.value));
    expect(component.rect.width).toBe(Number.parseFloat(TOKENS["--ui-layout-aside-w"]!.value));
  });

  it("reads its default geometry from tokens", () => {
    const metrics = defaultSystemMetrics();
    for (const value of Object.values(metrics)) expect(value).toBeGreaterThan(0);
  });
});
