import { expect, it } from "vitest";
import { FRAME_DOCK_DEFAULTS, frameDockGeometry } from "./frame-dock-layout.js";
it("uses the approved semantic minimum, initial and maximum heights", () => {
  expect(FRAME_DOCK_DEFAULTS).toEqual({ min: 160, defaultValue: 240, max: 480 });
  expect(frameDockGeometry(undefined)).toEqual({ min: 160, max: 480, defaultValue: 240, value: 240 });
  expect(frameDockGeometry(600, {}, 900).value).toBe(480);
});
it("bounds the panel within actual frame capacity, including below its normal minimum", () => {
  expect(frameDockGeometry(96)).toEqual({ min: 96, max: 96, defaultValue: 96, value: 96 });
  expect(frameDockGeometry(0)).toEqual({ min: 0, max: 0, defaultValue: 0, value: 0 });
  expect(frameDockGeometry(320, {}, 480)).toEqual({ min: 160, max: 320, defaultValue: 240, value: 320 });
});
it("retains host control while clamping its values to current capacity", () => {
  expect(frameDockGeometry(300, { min: 100, max: 400, defaultValue: 200 }, 380)).toEqual({ min: 100, max: 300, defaultValue: 200, value: 300 });
  expect(frameDockGeometry(500, { min: 100, max: 400, defaultValue: 200 }, 380).value).toBe(380);
  expect(() => frameDockGeometry(300, { min: 400, max: 100 })).toThrow();
});
