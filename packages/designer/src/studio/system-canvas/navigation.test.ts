import { describe, expect, it } from "vitest";
import { systemLayout } from "./layout.js";
import { planNavigation } from "./navigation.js";
import { trailAt } from "./breadcrumb.js";
import { centreOn, clampZoom, stopZoom, stopViewport, systemZoomRange } from "./stops.js";
import { CANVAS_LEGIBLE_TEXT_PX } from "../../blocks/canvas/CanvasLod.js";
import { TOKENS } from "../../tokens/tokens.js";
import { legibleZoomFloor } from "../useCanvasWorld.js";
import { testMetrics, testPlacements } from "./__fixtures__/system.js";

// World (test metrics): bounds 360 x 755; tokens row y 660 h 95; tokens/color board 180 x 95;
// its palettes line at (5, 720) 170 x 30; tokens.status-color at (85, 720) 40 x 30.
const layout = systemLayout(testPlacements, testMetrics);
const view = { width: 120, height: 100 }, padding = 15;
// Navigation geometry remains covered with the original synthetic unconstrained
// range. Production now clamps the shared fit to readable captions (A4-DE-PREVIEW),
// pinned independently below instead of changing these camera-math expectations.
const range = { min: 70 / 755, max: 1 };
const system = stopViewport("system", layout.bounds, view, padding, range);

describe("system canvas zoom stops", () => {
  it("uses one caption-derived legibility floor for every layer at a 1440px viewport", () => {
    const realLayout = systemLayout(testPlacements);
    const screen = { width: 1440, height: 900 };
    const range = systemZoomRange(realLayout, screen, padding);
    const caption = Number.parseFloat(TOKENS["--text-caption"]!.value);
    expect(legibleZoomFloor()).toBeCloseTo(0.75);
    expect(range.min).toBeGreaterThanOrEqual(legibleZoomFloor());
    for (const row of realLayout.rows) {
      expect(stopZoom("layer", row.rect, screen, padding, range) * caption, row.layer).toBeGreaterThanOrEqual(CANVAS_LEGIBLE_TEXT_PX);
    }
  });
  it("fits the four stops inside an explicit synthetic navigation range", () => {
    expect(range.min).toBeCloseTo(70 / 755, 6);
    expect(range.max).toBe(1);
    expect(system.zoom).toBeCloseTo(70 / 755, 6);
    expect(stopZoom("layer", layout.rows.find(row => row.layer === "tokens")!.rect, view, padding, range)).toBe(0.25);
    expect(stopZoom("board", layout.boards.get("tokens/color")!.rect, view, padding, range)).toBe(0.5);
    expect(stopZoom("cell", layout.cells.get("tokens.status-color")!.rect, view, padding, range)).toBe(1);
  });

  it("clamps free zoom to the System minimum and the Cell maximum", () => {
    expect(clampZoom(range, 5)).toBe(1);
    expect(clampZoom(range, 0.001)).toBeCloseTo(70 / 755, 6);
    // A board that would fit above 100% stops at 100%.
    expect(stopZoom("board", layout.boards.get("tokens/color")!.rect, { width: 2000, height: 2000 }, padding, { min: 0.01, max: 1 })).toBe(1);
    // A system that fits above 100% pins both ends at 100%.
    expect(systemZoomRange(layout, { width: 10_000, height: 10_000 }, padding)).toEqual({ min: 1, max: 1 });
  });
});

describe("system canvas navigateTo (D5g table)", () => {
  it("Layer goes to the Layer stop framing the row", () => {
    const plan = planNavigation(layout, { layer: "tokens" }, system, view, padding, range)!;
    expect(plan).toMatchObject({ stop: "layer", move: true, viewport: { x: 15, y: -126.875, zoom: 0.25 } });
    expect(plan.select).toBeUndefined();
  });

  it("L1 goes to the Board stop framing the board", () => {
    const plan = planNavigation(layout, { layer: "tokens", l1: "color" }, system, view, padding, range)!;
    expect(plan).toMatchObject({ stop: "board", move: true, viewport: { x: 15, y: -303.75, zoom: 0.5 }, focus: layout.boards.get("tokens/color")!.rect });
  });

  it("L2 goes to the Board stop with the line centred", () => {
    const plan = planNavigation(layout, { layer: "tokens", l1: "color", l2: "color-palettes" }, system, view, padding, range)!;
    expect(plan).toMatchObject({ stop: "board", move: true, viewport: { x: 15, y: -317.5, zoom: 0.5 }, focus: layout.lines.get("tokens/color/color-palettes")!.rect });
  });

  it("L3 goes to the Board stop with the cell centred, and selects the cell", () => {
    const plan = planNavigation(layout, { layer: "tokens", l1: "color", l2: "color-palettes", leaf: "tokens.status-color" }, system, view, padding, range)!;
    expect(plan).toMatchObject({ stop: "board", move: true, viewport: { x: 7.5, y: -317.5, zoom: 0.5 }, select: "tokens.status-color" });
    // The leaf alone is enough.
    expect(planNavigation(layout, { layer: "tokens", leaf: "tokens.status-color" }, system, view, padding, range)).toEqual(plan);
  });

  it("does not move when the target is already on screen at the right stop [mutant: always move]", () => {
    const board = centreOn(layout.boards.get("tokens/color")!.rect, view, 0.5);
    const atBoard = planNavigation(layout, { layer: "tokens", l1: "color" }, board, view, padding, range)!;
    expect(atBoard.move).toBe(false);
    expect(atBoard.viewport).toBe(board);
    // At the line-centred Board stop the cell is already inside the inset stage: no move, still selected.
    const atLine = { x: 15, y: -317.5, zoom: 0.5 };
    const leaf = planNavigation(layout, { layer: "tokens", leaf: "tokens.status-color" }, atLine, view, padding, range)!;
    expect(leaf).toMatchObject({ move: false, viewport: atLine, select: "tokens.status-color" });
  });

  it("moves when the target is off screen at the right zoom, or on screen at the wrong stop", () => {
    const board = centreOn(layout.boards.get("tokens/color")!.rect, view, 0.5);
    expect(planNavigation(layout, { layer: "tokens", l1: "color" }, { ...board, x: board.x - 200 }, view, padding, range)!.move).toBe(true);
    expect(planNavigation(layout, { layer: "tokens", l1: "color" }, { ...board, zoom: 1 }, view, padding, range)!.move).toBe(true);
  });

  it("plans nothing for a target that is not on the canvas", () => {
    expect(planNavigation(layout, { layer: "tokens", leaf: "tokens.missing" }, system, view, padding, range)).toBeUndefined();
    expect(planNavigation(layout, { layer: "assets", leaf: "tokens.status-color" }, system, view, padding, range)).toBeUndefined();
    expect(planNavigation(layout, { layer: "tokens", l1: "missing" }, system, view, padding, range)).toBeUndefined();
    expect(planNavigation(layout, { layer: "tokens", l1: "color", l2: "missing" }, system, view, padding, range)).toBeUndefined();
  });
});

describe("system canvas breadcrumb trail", () => {
  it("reads Layer > L1 > L2 at the view centre", () => {
    const trail = trailAt(layout, { x: 15, y: -317.5, zoom: 0.5 }, view);
    expect(trail.layer).toBe("tokens");
    expect(trail.board?.id).toBe("tokens/color");
    expect(trail.line?.l2).toBe("color-palettes");
  });

  it("names only the layer between boards, and the nearest layer between rows", () => {
    // The System stop centres (180, 377.5): the components row, right of its only board.
    expect(trailAt(layout, system, view)).toEqual({ layer: "components" });
    // World y 130 sits in the gap between frames (0-55) and sections (155-210).
    expect(trailAt(layout, centreOn({ x: 300, y: 130, width: 0, height: 0 }, view, 1), view)).toEqual({ layer: "sections" });
  });
});
