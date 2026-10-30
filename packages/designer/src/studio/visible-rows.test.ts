import { expect, it } from "vitest";
import { viewRect, visibleBoards, visibleStudioRows } from "./visible-rows.js";

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

it("maps a viewport to the world rectangle it shows", () => {
  expect(viewRect({ x: -100, y: 50, zoom: 2 }, { width: 400, height: 300 })).toEqual({ x: 50, y: -25, width: 200, height: 150 });
});

it("finds the boards a positioned world shows; off-screen and edge-touching boards are not visible", () => {
  const boards = [
    { id: "inside", rect: { x: 10, y: 10, width: 20, height: 20 } },
    { id: "straddling", rect: { x: 90, y: 40, width: 40, height: 20 } },
    { id: "touching", rect: { x: 100, y: 0, width: 10, height: 10 } },
    { id: "offscreen", rect: { x: 500, y: 500, width: 10, height: 10 } },
  ];
  expect([...visibleBoards(boards, { x: 0, y: 0, zoom: 1 }, { width: 100, height: 100 })]).toEqual(["inside", "straddling"]);
  expect([...visibleBoards(boards, { x: -1000, y: -1000, zoom: 2 }, { width: 100, height: 100 })]).toEqual(["offscreen"]);
});
