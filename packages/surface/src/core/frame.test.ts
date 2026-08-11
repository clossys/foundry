import { describe, expect, it } from "vitest";
import { frameToInches, frameToPercent } from "./frame.js";
import type { Frame } from "./types.js";

describe("frameToPercent", () => {
  it("converts 0..1 fractions to 0..100 percentages", () => {
    const frame: Frame = { x: 0.1, y: 0.25, w: 0.5, h: 0.75 };
    expect(frameToPercent(frame)).toEqual({ x: 10, y: 25, w: 50, h: 75 });
  });

  it("maps the full-canvas frame to 0/0/100/100", () => {
    expect(frameToPercent({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe("frameToInches", () => {
  it("scales a fraction by the canvas's real size in inches — Letter portrait, 8.5x11", () => {
    const frame: Frame = { x: 0.1, y: 0.1, w: 0.8, h: 0.15 };
    const result = frameToInches(frame, { width: 8.5, height: 11 });
    expect(result.x).toBeCloseTo(0.85);
    expect(result.y).toBeCloseTo(1.1);
    expect(result.w).toBeCloseTo(6.8);
    expect(result.h).toBeCloseTo(1.65);
  });

  it("maps the full-canvas frame to the canvas's own dimensions", () => {
    const result = frameToInches({ x: 0, y: 0, w: 1, h: 1 }, { width: 13.333, height: 7.5 });
    expect(result).toEqual({ x: 0, y: 0, w: 13.333, h: 7.5 });
  });
});
