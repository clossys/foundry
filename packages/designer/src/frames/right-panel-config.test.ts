import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { APP_FRAME_RIGHT_PANEL_CONFIG } from "./right-panel-config.js";
import * as frames from "./index.js";

it("pins the shipped right panel preset and exports that one object from the frames barrel", () => {
  expect(APP_FRAME_RIGHT_PANEL_CONFIG).toEqual({ min: 220, max: 420, defaultValue: 280 });
  expect(Object.isFrozen(APP_FRAME_RIGHT_PANEL_CONFIG)).toBe(true);
  expect(frames.APP_FRAME_RIGHT_PANEL_CONFIG).toBe(APP_FRAME_RIGHT_PANEL_CONFIG);
});

it("matches the bounds the frame specimen ships to its right panel", () => {
  const specimen = readFileSync(resolve(import.meta.dirname, "AppFrame.specimen.tsx"), "utf8");
  const { min, max, defaultValue } = APP_FRAME_RIGHT_PANEL_CONFIG;
  expect(specimen).toContain(`min: ${min}, max: ${max}, defaultValue: ${defaultValue}`);
});
