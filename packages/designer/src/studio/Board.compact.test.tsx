import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Board } from "./Board.js";
import { matrixBoards, matrixRows } from "./matrix-model.js";
import { emptyChanges } from "./model.js";
import { adopt, labels, smallCatalog } from "./__fixtures__/studio.js";
import { CanvasLod, canvasLodTier } from "../blocks/canvas/CanvasLod.js";

afterEach(cleanup);
const COMPACT_ZOOM = .5;

function compactBoard() {
  const library = adopt(undefined, "tokens.surface-color", "foundry");
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes: emptyChanges(library), expanded: new Set() });
  const board = matrixBoards({ catalog: smallCatalog, library, working: library }, rows).find(board => board.leaves.includes("tokens.surface-color"))!;
  const props = { boardRef: null, sources: ["foundry"], labels, working: library, changes: emptyChanges(library), expanded: new Set<string>(), groupChoices: {}, onExpand: () => {}, onUse: () => {}, onFocusCell: () => {} };
  const view = render(<CanvasLod zoom={COMPACT_ZOOM}><Board {...props} board={board} summary={{ errors: 0, warnings: 0, sources: ["foundry"] }} /></CanvasLod>);
  const slots = board.rows.filter(row => row.scope === "slot");
  return { view, slots, compact: view.container.querySelector<HTMLElement>('[data-canvas-lod-layer="compact"]')! };
}

it("renders a miniature specimen for every L3 row in the compact tier", () => {
  expect(canvasLodTier(COMPACT_ZOOM)).toBe("compact");
  const { slots, compact } = compactBoard();
  expect(compact).not.toHaveAttribute("inert");
  const specimens = [...compact.querySelectorAll<HTMLElement>("[data-studio-compact-specimen]")];
  expect(specimens.map(specimen => specimen.dataset.studioCompactSpecimen)).toEqual(slots.map(row => row.id));
  for (const specimen of specimens) expect(specimen.querySelector("[data-compact-plate]")).not.toBeNull();
  // A chosen row paints its active library's specimen; an unchosen row keeps an empty plate of the same shape.
  const chosen = specimens.find(specimen => specimen.dataset.studioCompactSpecimen === "tokens.surface-color")!;
  expect(chosen.querySelector("[data-compact-plate]")!.childElementCount).toBeGreaterThan(0);
  expect(chosen.textContent).toContain("foundry");
});

it("keeps compact text at the tier's legible size: no member keys, values or notes inside a miniature", () => {
  const { compact } = compactBoard();
  const plate = compact.querySelector<HTMLElement>('[data-studio-compact-specimen="tokens.surface-color"] [data-compact-plate]')!;
  expect(plate.className).toMatch(/\[&_\[data-member-value\]\]:hidden/);
  expect(plate.className).toMatch(/\[&_\[data-preview-note\]\]:hidden/);
  expect(compact.querySelector("[data-studio-zoom-compact]")).toHaveClass("text-h0");
});
