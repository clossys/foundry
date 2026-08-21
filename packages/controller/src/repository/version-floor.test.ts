import { describe, expect, it } from "vitest";
import { compareVersionFloors, meetsVersionFloor, parseVersionFloor } from "./version-floor.js";

describe("parseVersionFloor", () => {
  it("parses a bare major, a major.minor, and a full major.minor.patch", () => {
    expect(parseVersionFloor("20")).toEqual([20, 0, 0]);
    expect(parseVersionFloor("20.11")).toEqual([20, 11, 0]);
    expect(parseVersionFloor("10.33.0")).toEqual([10, 33, 0]);
  });

  it("accepts a leading v and surrounding whitespace", () => {
    expect(parseVersionFloor("v20.11.0")).toEqual([20, 11, 0]);
    expect(parseVersionFloor("  20.11.0  ")).toEqual([20, 11, 0]);
  });

  it("returns undefined rather than throwing for an unparseable value", () => {
    expect(parseVersionFloor("")).toBeUndefined();
    expect(parseVersionFloor("latest")).toBeUndefined();
    expect(parseVersionFloor(">=20")).toBeUndefined();
    expect(parseVersionFloor("20.11.0-beta.1")).toBeUndefined();
    expect(parseVersionFloor("20.11.0.1")).toBeUndefined();
    expect(parseVersionFloor("20.")).toBeUndefined();
  });
});

describe("compareVersionFloors", () => {
  it("compares major, then minor, then patch", () => {
    expect(compareVersionFloors([20, 0, 0], [19, 99, 99])).toBeGreaterThan(0);
    expect(compareVersionFloors([20, 1, 0], [20, 0, 99])).toBeGreaterThan(0);
    expect(compareVersionFloors([20, 0, 1], [20, 0, 0])).toBeGreaterThan(0);
    expect(compareVersionFloors([20, 0, 0], [20, 0, 0])).toBe(0);
    expect(compareVersionFloors([19, 0, 0], [20, 0, 0])).toBeLessThan(0);
  });
});

describe("meetsVersionFloor", () => {
  it("is true when the value is at or above the floor", () => {
    expect(meetsVersionFloor("20", "20")).toBe(true);
    expect(meetsVersionFloor("24.1.2", "20")).toBe(true);
    expect(meetsVersionFloor("10.33.0", "10.33.0")).toBe(true);
    expect(meetsVersionFloor("10.34.0", "10.33.0")).toBe(true);
  });

  it("is false when the value is below the floor", () => {
    expect(meetsVersionFloor("18", "20")).toBe(false);
    expect(meetsVersionFloor("10.32.9", "10.33.0")).toBe(false);
  });

  it("is false, never true, when either side fails to parse", () => {
    expect(meetsVersionFloor("not-a-version", "20")).toBe(false);
    expect(meetsVersionFloor("24.0.0", "also-not-a-version")).toBe(false);
    expect(meetsVersionFloor("not-a-version", "also-not-a-version")).toBe(false);
  });
});
