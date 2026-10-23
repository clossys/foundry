import { describe, expect, it } from "vitest";
import {
  panBy, zoomAt, fitTo, clamp, toWorld, toScreen, selectSingle, toggleSelection,
  selectRange, selectMarquee, clearSelection, navigate, minimapModel,
  type CanvasItem, type Viewport,
} from "./models.js";

const viewport: Viewport = Object.freeze({ x: 35, y: -20, zoom: 2 });
const items: readonly CanvasItem[] = Object.freeze([
  { id: "a", label: "Alpha", rect: { x: 0, y: 0, width: 20, height: 20 } },
  { id: "b", label: "Beta", rect: { x: 100, y: 0, width: 20, height: 20 } },
  { id: "c", label: "Gamma", rect: { x: 0, y: 100, width: 20, height: 20 } },
]);

describe("canvas viewport", () => {
  it("pans by screen pixels without mutating input", () => {
    expect(panBy(viewport, { x: 10, y: -5 })).toEqual({ x: 45, y: -25, zoom: 2 });
    expect(viewport).toEqual({ x: 35, y: -20, zoom: 2 });
  });
  it("keeps a non-origin anchor fixed when zooming in and out", () => {
    const anchor = { x: 143, y: 87 };
    const world = toWorld(viewport, anchor);
    for (const factor of [0.5, 1.7, 4]) {
      const changed = zoomAt(viewport, anchor, factor);
      expect(changed.zoom).toBeCloseTo(viewport.zoom * factor);
      expect(toScreen(changed, world).x).toBeCloseTo(anchor.x);
      expect(toScreen(changed, world).y).toBeCloseTo(anchor.y);
    }
  });
  it("round trips negative fractional coordinates", () => {
    const point = { x: -17.25, y: 318.125 };
    expect(toWorld(viewport, toScreen(viewport, point))).toEqual(point);
  });
  it("fits translated world bounds with screen padding", () => {
    expect(fitTo({ x: -100, y: 40, width: 200, height: 100 }, { width: 500, height: 300 }, 50))
      .toEqual({ x: 250, y: -30, zoom: 2 });
  });
  it("fits a point at zoom one, and a line along its nonzero axis", () => {
    expect(fitTo({ x: 8, y: 9, width: 0, height: 0 }, { width: 100, height: 80 }))
      .toEqual({ x: 42, y: 31, zoom: 1 });
    expect(fitTo({ x: 0, y: 0, width: 0, height: 20 }, { width: 100, height: 80 }).zoom).toBe(4);
  });
  it("clamps zoom and translation to contain the visible area in the world", () => {
    expect(clamp({ x: 90, y: -999, zoom: 8 }, 0.5, 2,
      { x: -10, y: 20, width: 300, height: 200 }, { width: 100, height: 80 }))
      .toEqual({ x: 20, y: -360, zoom: 2 });
  });
  it("centers a world smaller than the view and clamps zoom independently", () => {
    expect(clamp({ x: 90, y: -999, zoom: 0.1 }, 1, 2,
      { x: 10, y: 20, width: 20, height: 10 }, { width: 100, height: 80 }))
      .toEqual({ x: 30, y: 15, zoom: 1 });
    expect(clamp(viewport, 0.5, 1)).toEqual({ ...viewport, zoom: 1 });
  });
  it("rejects invalid arithmetic instead of emitting nonserializable geometry", () => {
    expect(() => zoomAt(viewport, { x: 0, y: 0 }, 0)).toThrow();
    expect(() => panBy(viewport, { x: Infinity, y: 0 })).toThrow();
    expect(() => fitTo({ x: 0, y: 0, width: -1, height: 1 }, { width: 10, height: 10 })).toThrow();
    expect(() => fitTo(items[0]!.rect, { width: 10, height: 10 }, 5)).toThrow();
    expect(() => clamp(viewport, 4, 2)).toThrow();
    expect(() => clamp(viewport, 1, 2, items[0]!.rect)).toThrow();
  });
});

describe("canvas selection", () => {
  it("selects one, toggles immutably in stable insertion order, and clears", () => {
    const selected = Object.freeze(["c", "a"]);
    expect(selectSingle("b")).toEqual(["b"]);
    expect(toggleSelection(selected, "b")).toEqual(["c", "a", "b"]);
    expect(toggleSelection(selected, "c")).toEqual(["a"]);
    expect(selected).toEqual(["c", "a"]);
    expect(clearSelection()).toEqual([]);
  });
  it("ranges in canonical order in both directions, including endpoints", () => {
    const order = Object.freeze(["c", "a", "b", "d"]);
    expect(selectRange(order, "b", "c")).toEqual(["c", "a", "b"]);
    expect(selectRange(order, "a", "d")).toEqual(["a", "b", "d"]);
    expect(selectRange(order, "missing", "d")).toEqual([]);
    expect(order).toEqual(["c", "a", "b", "d"]);
  });
  it("marquees edge and corner touching rectangles inclusively in item order", () => {
    const before = JSON.stringify(items);
    expect(selectMarquee(items, { x: 20, y: 20, width: 80, height: 80 })).toEqual(["a", "b", "c"]);
    expect(selectMarquee(items, { x: 21, y: 21, width: 78, height: 78 })).toEqual([]);
    expect(JSON.stringify(items)).toBe(before);
  });
});

describe("canvas spatial navigation", () => {
  const compass: readonly CanvasItem[] = [
    { id: "center", label: "Center", rect: { x: 50, y: 50, width: 10, height: 10 } },
    ...[["left", 0, 50], ["right", 100, 50], ["up", 50, 0], ["down", 50, 100], ["far", 200, 50]]
      .map(([id, x, y]) => ({ id: String(id), label: String(id), rect: { x: Number(x), y: Number(y), width: 10, height: 10 } })),
  ];
  it.each(["left", "right", "up", "down"] as const)("finds nearest %s by center geometry", direction => {
    expect(navigate(compass, "center", direction)).toBe(direction);
  });
  it("uses input order for ties and returns null at an edge", () => {
    const tied = [compass[0]!, compass[2]!, { ...compass[2]!, id: "other" }];
    expect(navigate(tied, "center", "right")).toBe("right");
    expect(navigate(compass, "far", "right")).toBeNull();
    expect(navigate(compass, null, "right")).toBe("center");
    expect(navigate([], null, "right")).toBeNull();
  });
});

describe("canvas minimap", () => {
  it("describes normalized viewport bounds and their clipped visible intersection", () => {
    expect(minimapModel({ x: -100, y: -50, width: 400, height: 200 },
      { x: 0, y: 0, zoom: 2 }, { width: 200, height: 100 })).toEqual({
      worldBounds: { x: -100, y: -50, width: 400, height: 200 },
      viewport: { x: 0, y: 0, width: 100, height: 50 },
      visible: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 },
    });
  });
  it("clips outside the world and supports degenerate world dimensions", () => {
    const result = minimapModel({ x: 0, y: 0, width: 0, height: 0 }, viewport, { width: 20, height: 10 });
    expect(result.visible).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(JSON.stringify(result)).not.toMatch(/null/);
  });
});
