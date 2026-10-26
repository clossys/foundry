import { expect, it } from "vitest";
import { visibleStudioRows } from "./visible-rows.js";

it("requests only rows inside both the viewport and matrix clip, and none at overview zoom", () => {
  const viewport = document.createElement("div"), matrix = document.createElement("div"); matrix.dataset.studioMatrix = "";
  const row = document.createElement("tr"), clipped = document.createElement("tr"), offscreen = document.createElement("tr"); matrix.append(row, clipped, offscreen);
  const bounds = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top } as DOMRect);
  viewport.getBoundingClientRect = () => bounds(0, 200); matrix.getBoundingClientRect = () => bounds(20, 100);
  row.getBoundingClientRect = () => bounds(30, 60); clipped.getBoundingClientRect = () => bounds(110, 140); offscreen.getBoundingClientRect = () => bounds(220, 250);
  const rows = new Map([["visible", row], ["clipped", clipped], ["offscreen", offscreen]]);
  expect([...visibleStudioRows(viewport, rows, 1)]).toEqual(["visible"]);
  expect(visibleStudioRows(viewport, rows, .4).size).toBe(0);
});
