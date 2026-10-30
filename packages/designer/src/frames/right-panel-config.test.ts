import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { APP_FRAME_RIGHT_PANEL_CONFIG } from "./right-panel-config.js";
import * as frames from "./index.js";
import { TOKENS } from "../tokens/index.js";

it("pins the shipped right panel preset and exports that one object from the frames barrel", () => {
  expect(APP_FRAME_RIGHT_PANEL_CONFIG).toEqual({ min: 220, max: 420, defaultValue: 280 });
  expect(Object.isFrozen(APP_FRAME_RIGHT_PANEL_CONFIG)).toBe(true);
  expect(frames.APP_FRAME_RIGHT_PANEL_CONFIG).toBe(APP_FRAME_RIGHT_PANEL_CONFIG);
});

it("reads the preset from the tokens.region-width inspector members rather than restating numbers", () => {
  expect(APP_FRAME_RIGHT_PANEL_CONFIG).toEqual({
    min: Number.parseFloat(TOKENS["--ui-layout-inspector-min-w"]!.value),
    max: Number.parseFloat(TOKENS["--ui-layout-inspector-max-w"]!.value),
    defaultValue: Number.parseFloat(TOKENS["--ui-layout-inspector-w"]!.value),
  });
  expect(readFileSync(resolve(import.meta.dirname, "right-panel-config.ts"), "utf8")).not.toMatch(/\b(?:220|280|420)\b/);
});

it("ships the same preset object to the frame specimen's right panel", () => {
  const specimen = readFileSync(resolve(import.meta.dirname, "AppFrame.specimen.tsx"), "utf8");
  expect(specimen).toMatch(/rightPanel=\{\{[^}]*\.\.\.APP_FRAME_RIGHT_PANEL_CONFIG,/);
  expect(specimen).not.toMatch(/min: 220|max: 420|defaultValue: 280/);
});
