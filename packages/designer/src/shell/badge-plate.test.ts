import { describe, expect, it } from "vitest";
import { BADGE_INSET_SHARE, BADGE_RADIUS_SHARE, badgePlatePath } from "./badge-plate.js";

describe("badgePlatePath: goldens", () => {
  it("size 32 is the pinned path", () => {
    expect(badgePlatePath(32)).toBe("M7 0H25A7 7 0 0 1 32 7V25A7 7 0 0 1 25 32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z");
  });

  it("size 100 uses a radius of 21.875", () => {
    expect(badgePlatePath(100)).toBe(
      "M21.875 0H78.125A21.875 21.875 0 0 1 100 21.875V78.125A21.875 21.875 0 0 1 78.125 100H21.875A21.875 21.875 0 0 1 0 78.125V21.875A21.875 21.875 0 0 1 21.875 0Z",
    );
  });

  it("rounds every number to 3 decimals", () => {
    expect(badgePlatePath(10)).toBe("M2.188 0H7.813A2.188 2.188 0 0 1 10 2.188V7.813A2.188 2.188 0 0 1 7.813 10H2.188A2.188 2.188 0 0 1 0 7.813V2.188A2.188 2.188 0 0 1 2.188 0Z");
  });

  it("never writes negative zero", () => {
    for (const size of [1, 32, 1e-9, 0.0001, 100]) {
      expect(badgePlatePath(size)).not.toMatch(/-0(?![.\d])/);
    }
  });
});

describe("badgePlatePath: refusals", () => {
  it("throws a RangeError for NaN, Infinity, zero and a negative, without echoing the value", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0, -7654.321]) {
      let error: unknown;
      try {
        badgePlatePath(bad);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(RangeError);
      const message = (error as Error).message;
      expect(message).toContain("size");
      expect(message).not.toContain("7654");
      expect(message).not.toMatch(/NaN|Infinity/);
    }
  });

  it("throws a TypeError for a string, without echoing it", () => {
    let error: unknown;
    try {
      badgePlatePath("zq-size-value" as unknown as number);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain("size");
    expect((error as Error).message).not.toContain("zq-size-value");
  });

  it.each([undefined, null, {}, [], 32n])("throws a TypeError for a non-number (%s)", (bad) => {
    expect(() => badgePlatePath(bad as unknown as number)).toThrow(TypeError);
  });
});

describe("the shares", () => {
  it("are the specified 7/32 and 0.18", () => {
    expect(BADGE_RADIUS_SHARE).toBe(7 / 32);
    expect(BADGE_INSET_SHARE).toBe(0.18);
  });
});
