import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Board } from "./Board.js";
import { BoardChosenSummary, CompactLeafLine, LeafLabel } from "./board-summary.js";
import { matrixBoards, matrixRows } from "./matrix-model.js";
import { emptyChanges } from "./model.js";
import { adopt, emptyLibrary, labels, smallCatalog } from "./__fixtures__/studio.js";
import { CanvasLod } from "../blocks/canvas/CanvasLod.js";
import { BOARD_SURFACE_CLASS } from "../blocks/library-board/LeafCell.js";
import type { StudioLabels } from "./types.js";

afterEach(cleanup);
const OVERVIEW_ZOOM = .05, COMPACT_ZOOM = .5, FULL_ZOOM = 1;
const NAMES: Record<string, string> = { "tokens.surface-color": "Surface colour" };
const named: StudioLabels = { ...labels, chosenSummary: (chosen, total) => `${chosen} of ${total} chosen`, leafName: id => NAMES[id] };

function board(zoom: number, boardLabels: StudioLabels = named, summary: { chosen?: number; total?: number } = {}, onOpen?: () => void) {
  const library = adopt(undefined, "tokens.surface-color", "foundry");
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes: emptyChanges(library), expanded: new Set() });
  const matrixBoard = matrixBoards({ catalog: smallCatalog, library, working: library }, rows).find(board => board.leaves.includes("tokens.surface-color"))!;
  const props = { boardRef: null, sources: ["foundry"], labels: boardLabels, working: library, changes: emptyChanges(library), expanded: new Set<string>(), groupChoices: {}, onExpand: () => {}, onUse: () => {}, onFocusCell: () => {} };
  const view = render(<CanvasLod zoom={zoom}><Board {...props} board={matrixBoard} onOpen={onOpen} summary={{ errors: 0, warnings: 0, sources: ["foundry"], ...summary }} /></CanvasLod>);
  const slots = matrixBoard.rows.filter(row => row.scope === "slot");
  return { view, slots, chosen: slots.filter(row => row.candidates.some(candidate => candidate.selected)).length };
}
const layer = (tier: string) => document.querySelector<HTMLElement>(`[data-canvas-lod-layer="${tier}"]`)!;

it("renders the board's own n of m chosen line in tabular figures at overview and compact zoom", () => {
  const { slots, chosen } = board(OVERVIEW_ZOOM);
  expect(chosen).toBe(1);
  const line = layer("overview").querySelector<HTMLElement>("[data-studio-chosen-summary]")!;
  expect(line).toHaveTextContent(`1 of ${slots.length} chosen`);
  expect(line).toHaveClass("tabular-nums");
  cleanup();
  board(COMPACT_ZOOM);
  expect(layer("compact").querySelector("[data-studio-chosen-summary]")).toHaveTextContent(`1 of ${slots.length} chosen`);
});

it("prefers host-supplied chosen and total counts over the board's own rows", () => {
  board(OVERVIEW_ZOOM, named, { chosen: 40, total: 59 });
  expect(layer("overview").querySelector("[data-studio-chosen-summary]")).toHaveTextContent("40 of 59 chosen");
});

it("renders no chosen line without a host label, and drops an empty check summary", () => {
  board(OVERVIEW_ZOOM, { ...labels, checkSummary: () => "" });
  const overview = layer("overview");
  expect(overview.querySelector("[data-studio-chosen-summary]")).toBeNull();
  expect([...overview.querySelectorAll("p")].some(p => p.textContent === "")).toBe(false);
});

it("labels each leaf row with its human name and its id in the mono face, under a Leaf column header", () => {
  board(FULL_ZOOM);
  const table = within(layer("full")).getByRole("grid", { name: labels.matrix.label });
  expect(within(table).getByRole("columnheader", { name: labels.matrix.leaf })).toBeVisible();
  const header = within(table).getByRole("rowheader", { name: /Surface colour/ });
  const label = header.querySelector<HTMLElement>("[data-studio-leaf-label]")!;
  expect(label).toHaveTextContent("Surface colour");
  const id = label.querySelector<HTMLElement>("[data-studio-leaf-id]")!;
  expect(id).toHaveTextContent("tokens.surface-color");
  expect(id).toHaveClass("font-mono", "tabular-nums");
});

it("shows the id alone, still in the mono face, when the host has no name for a leaf", () => {
  render(<LeafLabel id="tokens.spacing" />);
  const label = document.querySelector<HTMLElement>("[data-studio-leaf-label]")!;
  expect(label.textContent).toBe("tokens.spacing");
  expect(label.querySelector("[data-studio-leaf-id]")).toHaveClass("font-mono", "tabular-nums");
});

it("draws the studio board on the shared raised board plate, not the canvas ground", () => {
  board(FULL_ZOOM);
  const plate = document.querySelector<HTMLElement>("[data-studio-board]")!;
  expect(plate.className).toBe(BOARD_SURFACE_CLASS);
  expect(plate).toHaveClass("bg-surface-raised", "border-line-base");
  expect(plate).not.toHaveClass("bg-surface-base");
});

it("labels an unnamed leaf row once, with its id alone in the mono face", () => {
  board(FULL_ZOOM, { ...named, leafName: () => undefined });
  const header = within(layer("full")).getByRole("rowheader", { name: "tokens.surface-color" });
  const label = header.querySelector<HTMLElement>("[data-studio-leaf-label]")!;
  expect(label.textContent).toBe("tokens.surface-color");
  expect(header.textContent).toBe("tokens.surface-color");
  expect(label.querySelector("[data-studio-leaf-id]")).toHaveClass("font-mono", "tabular-nums", "text-ink-primary");
});

it("wraps the overview Open label inside the board plate instead of ellipsising it", () => {
  board(OVERVIEW_ZOOM, named, {}, () => {});
  const overview = layer("overview");
  const label = overview.querySelector<HTMLElement>("button [data-studio-wrapping-label]")!;
  expect(label).toHaveTextContent(labels.canvas.openBoard(document.querySelector("[data-studio-zoom-summary] p")!.textContent!));
  expect(label).toHaveClass("whitespace-normal", "break-words");
  expect(overview.querySelector(".truncate")).toBeNull();
});

it("formats the chosen line only through the host label", () => {
  render(<BoardChosenSummary chosen={3} total={7} label={(chosen, total) => `${chosen}/${total}`} />);
  expect(screen.getByText("3/7")).toHaveClass("tabular-nums");
});

it("renders compact rows as plain text: the human name, then the leaf and library ids in mono secondary", () => {
  board(COMPACT_ZOOM);
  const row = layer("compact").querySelector<HTMLElement>('[data-studio-compact-specimen="tokens.surface-color"]')!;
  const line = row.querySelector<HTMLElement>("[data-studio-compact-leaf]")!;
  expect(line).toHaveTextContent("Surface colour");
  const id = line.querySelector<HTMLElement>("[data-studio-leaf-id]")!, source = line.querySelector<HTMLElement>("[data-studio-compact-source]")!;
  expect(id).toHaveTextContent("tokens.surface-color");
  expect(source).toHaveTextContent("foundry");
  for (const element of [id, source]) expect(element).toHaveClass("font-mono", "text-ink-secondary");
});

it("keeps an unnamed compact row's id primary in mono and its not-chosen words plain", () => {
  render(<CompactLeafLine id="assets.lockup" notChosen="Not chosen" />);
  const line = document.querySelector<HTMLElement>("[data-studio-compact-leaf]")!;
  expect(line.querySelector("[data-studio-leaf-id]")).toHaveClass("font-mono", "text-ink-primary");
  expect(line.querySelector("[data-studio-compact-source]")).toHaveTextContent("Not chosen");
  expect(line.querySelector("[data-studio-compact-source]")).not.toHaveClass("font-mono");
});

it("vf35: marks each full-zoom leaf cell live when chosen and not-chosen otherwise", () => {
  board(FULL_ZOOM);
  const chosen = layer("full").querySelector<HTMLElement>("[data-candidate-cell]")!;
  expect(chosen).not.toHaveTextContent(labels.board.notChosen);
  expect(chosen).toHaveAttribute("data-preview-state", "live");
  cleanup();
  const library = emptyLibrary();
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes: emptyChanges(library), expanded: new Set() });
  const matrixBoard = matrixBoards({ catalog: smallCatalog, library, working: library }, rows).find(entry => entry.leaves.includes("tokens.surface-color"))!;
  render(<CanvasLod zoom={FULL_ZOOM}><Board boardRef={null} sources={["foundry"]} labels={named} working={library} changes={emptyChanges(library)} expanded={new Set<string>()} groupChoices={{}} onExpand={() => {}} onUse={() => {}} onFocusCell={() => {}} board={matrixBoard} summary={{ errors: 0, warnings: 0, sources: ["foundry"] }} /></CanvasLod>);
  const unchosen = layer("full").querySelector<HTMLElement>("[data-candidate-cell]")!;
  expect(unchosen).toHaveTextContent(labels.board.notChosen);
  expect(unchosen).toHaveAttribute("data-preview-state", "not-chosen");
});
