import { describe, expect, it } from "vitest";
import { CELL_LOD_FAR_PX, CELL_LOD_HYSTERESIS, CELL_LOD_NEAR_PX, cellLodTier, cellScreenPx } from "./cell-lod.js";

describe("per-cell level of detail by on-screen size", () => {
  it("measures a cell by its smaller on-screen side", () => {
    expect(cellScreenPx({ width: 320, height: 240 }, 0.5)).toBe(120);
  });

  it("uses the plain thresholds with no previous tier: far < 28, mid 28-140, near > 140", () => {
    expect(CELL_LOD_FAR_PX).toBe(28);
    expect(CELL_LOD_NEAR_PX).toBe(140);
    expect(cellLodTier(27.9)).toBe("far");
    expect(cellLodTier(28)).toBe("mid");
    expect(cellLodTier(140)).toBe("mid");
    expect(cellLodTier(140.1)).toBe("near");
  });

  it("holds the previous tier inside the +-15% band at the far/mid boundary [mutant: no hysteresis]", () => {
    expect(CELL_LOD_HYSTERESIS).toBe(0.15);
    // Growing from far: stays far until 28 * 1.15.
    expect(cellLodTier(30, "far")).toBe("far");
    expect(cellLodTier(32.1, "far")).toBe("far");
    expect(cellLodTier(32.3, "far")).toBe("mid");
    // Shrinking from mid: stays mid until 28 * 0.85.
    expect(cellLodTier(25, "mid")).toBe("mid");
    expect(cellLodTier(23.9, "mid")).toBe("mid");
    expect(cellLodTier(23.7, "mid")).toBe("far");
  });

  it("holds the previous tier inside the +-15% band at the mid/near boundary [mutant: no hysteresis]", () => {
    // Growing from mid: stays mid until 140 * 1.15.
    expect(cellLodTier(150, "mid")).toBe("mid");
    expect(cellLodTier(161, "mid")).toBe("mid");
    expect(cellLodTier(161.1, "mid")).toBe("near");
    // Shrinking from near: stays near until 140 * 0.85.
    expect(cellLodTier(130, "near")).toBe("near");
    expect(cellLodTier(119.1, "near")).toBe("near");
    expect(cellLodTier(118.9, "near")).toBe("mid");
  });

  it("jumps tiers when the size leaves both bands", () => {
    expect(cellLodTier(400, "far")).toBe("near");
    expect(cellLodTier(4, "near")).toBe("far");
  });
});
