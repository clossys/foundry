import { expect, it } from "vitest";
import * as models from "./models.js";

it("vf13: one mouse-wheel notch (100px) zooms by about 8-10%, from one named rate", () => {
  const rate = (models as Record<string, unknown>).CANVAS_WHEEL_ZOOM_RATE;
  expect(typeof rate).toBe("number");
  const inward = models.wheelZoomFactor(-100, 0, 800), outward = models.wheelZoomFactor(100, 0, 800);
  expect(inward - 1).toBeGreaterThanOrEqual(0.08); expect(inward - 1).toBeLessThanOrEqual(0.10);
  expect(1 - outward).toBeGreaterThanOrEqual(0.08); expect(1 - outward).toBeLessThanOrEqual(0.10);
  expect(models.wheelZoomFactor(-100, 0, 800)).toBeCloseTo(Math.exp(100 * (rate as number)), 10);
});
