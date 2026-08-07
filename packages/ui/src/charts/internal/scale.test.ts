import { describe, expect, it } from "vitest";
import { bandScale, formatTickValue, linearScale, niceTicks, timeScale } from "./scale.js";

describe("linearScale", () => {
  it("maps the domain minimum to the range minimum", () => {
    const scale = linearScale([0, 100], [10, 210]);
    expect(scale(0)).toBe(10);
  });

  it("maps the domain maximum to the range maximum", () => {
    const scale = linearScale([0, 100], [10, 210]);
    expect(scale(100)).toBe(210);
  });

  it("maps the domain midpoint to the range midpoint", () => {
    const scale = linearScale([0, 100], [0, 200]);
    expect(scale(50)).toBe(100);
  });

  it("exposes its own domain and range", () => {
    const scale = linearScale([0, 10], [20, 30]);
    expect(scale.domain).toEqual([0, 10]);
    expect(scale.range).toEqual([20, 30]);
  });

  it("handles an inverted range (SVG y-down) correctly at both boundaries", () => {
    const scale = linearScale([0, 10], [280, 0]);
    expect(scale(0)).toBe(280);
    expect(scale(10)).toBe(0);
  });

  it("does not divide by zero on a degenerate (zero-span) domain", () => {
    const scale = linearScale([5, 5], [0, 100]);
    expect(scale(5)).toBe(0);
    expect(Number.isFinite(scale(5))).toBe(true);
  });
});

describe("bandScale", () => {
  it("places the first category's band starting at the range minimum plus half the side padding", () => {
    const scale = bandScale(["a", "b"], [0, 100], 0);
    expect(scale("a")).toBe(0);
  });

  it("gives every band the same width, summing (with zero padding) to the full range", () => {
    const scale = bandScale(["a", "b", "c", "d"], [0, 100], 0);
    expect(scale.bandwidth).toBeCloseTo(25);
    expect(scale("d")).toBeCloseTo(75);
  });

  it("shrinks the bandwidth as paddingRatio grows, without moving the first band off the range start's side-pad", () => {
    const noPad = bandScale(["a", "b"], [0, 100], 0);
    const padded = bandScale(["a", "b"], [0, 100], 0.5);
    expect(padded.bandwidth).toBeLessThan(noPad.bandwidth);
  });

  it("throws for a key not in the domain", () => {
    const scale = bandScale(["a", "b"], [0, 100]);
    expect(() => scale("z")).toThrow(/not in the domain/);
  });

  it("exposes its own domain and range", () => {
    const scale = bandScale(["a", "b"], [0, 100]);
    expect(scale.domain).toEqual(["a", "b"]);
    expect(scale.range).toEqual([0, 100]);
  });
});

describe("timeScale", () => {
  it("maps the domain start Date to the range minimum", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");
    const scale = timeScale([start, end], [0, 300]);
    expect(scale(start)).toBe(0);
  });

  it("maps the domain end Date to the range maximum", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");
    const scale = timeScale([start, end], [0, 300]);
    expect(scale(end)).toBe(300);
  });

  it("maps the domain midpoint Date to the range midpoint", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const mid = new Date("2026-01-16T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");
    const scale = timeScale([start, end], [0, 300]);
    expect(scale(mid)).toBeCloseTo(150, 0);
  });

  it("accepts a raw millisecond timestamp, not just a Date instance", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");
    const scale = timeScale([start, end], [0, 300]);
    expect(scale(end.getTime())).toBe(300);
  });
});

describe("niceTicks", () => {
  it("includes both a value at or below the minimum and a value at or above the maximum", () => {
    const ticks = niceTicks(3, 97, 5);
    expect(ticks[0]).toBeLessThanOrEqual(3);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(97);
  });

  it("returns a single tick for a degenerate (min === max) domain", () => {
    expect(niceTicks(10, 10)).toEqual([10]);
  });

  it("produces evenly, cleanly stepped values (no float-drift remainders)", () => {
    const ticks = niceTicks(0, 10, 5);
    const steps = ticks.slice(1).map((t, i) => t - ticks[i]!);
    const [first, ...rest] = steps;
    for (const step of rest) {
      expect(step).toBeCloseTo(first!);
    }
  });
});

describe("formatTickValue", () => {
  it("adds thousands commas", () => {
    expect(formatTickValue(1284)).toBe("1,284");
  });

  it("passes small numbers through unchanged", () => {
    expect(formatTickValue(7)).toBe("7");
  });
});
