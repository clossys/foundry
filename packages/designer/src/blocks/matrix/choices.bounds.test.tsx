import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MatrixChoices } from "./choices.js";
import { Board } from "../../studio/Board.js";
import { CandidateCell } from "../../studio/CandidateCell.js";
import { matrixBoards, matrixRows } from "../../studio/matrix-model.js";
import { buildCandidates, emptyChanges } from "../../studio/model.js";
import { labels, smallCatalog, emptyLibrary } from "../../studio/__fixtures__/studio.js";
import { loadCatalog } from "../../catalog-core/index.js";
import { completedTokenLibrary } from "../../importers/__fixtures__/completed-token-library.js";
import { APP_FRAME_RIGHT_PANEL_CONFIG } from "../../frames/right-panel-config.js";

// A preset no source file ships: a bound that follows it was read from the
// shared object, not copied from the frame specimen's numbers.
vi.mock("../../frames/right-panel-config.js", () => ({ APP_FRAME_RIGHT_PANEL_CONFIG: Object.freeze({ min: 203, max: 517, defaultValue: 311 }) }));

afterEach(cleanup);
const CAP = `${APP_FRAME_RIGHT_PANEL_CONFIG.max}px`;
const UNBOUNDED = /(?:^|\s)w-max(?:\s|$)/;
const HIDING = /(?:^|\s)(?:overflow-(?:hidden|clip|x-hidden)|truncate|line-clamp-\S+|text-ellipsis|sr-only)(?:\s|$)/;
const SIZING_SOURCES = ["../../studio/CandidateCell.tsx", "./choices.tsx", "../../studio/Board.tsx"];

function boardFixture() {
  const library = emptyLibrary();
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes: emptyChanges(library), expanded: new Set() });
  const board = matrixBoards({ catalog: smallCatalog, library, working: library }, rows).find(board => board.leaves.includes("tokens.surface-color"))!;
  const view = render(<Board board={board} boardRef={null} sources={["empty-library", "foundry"]} labels={labels} working={library} changes={emptyChanges(library)} expanded={new Set()} groupChoices={{}} onExpand={() => {}} onUse={() => {}} onFocusCell={() => {}} />);
  return { board, library, element: view.container.querySelector<HTMLElement>("[data-studio-board]")! };
}
/** The one element in a library or Edit column that carries that column's width bound. */
const bounded = (column: HTMLElement) => column.querySelector<HTMLElement>("[data-candidate-cell], [data-studio-edit-actions]");

it("lays out the choices matrix in normal flow from its bounded columns, never at max-content width", () => {
  const view = render(<MatrixChoices arrangement="choices" aria-label="Choices" columns={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}
    rows={[{ id: "row", label: "Row", name: "Row", selected: "a", cells: { a: <span>first</span>, b: <span>second</span> } }]} onChange={() => {}} />);
  const matrix = view.container.querySelector<HTMLElement>("[data-studio-matrix]")!;
  for (const element of [matrix, ...matrix.querySelectorAll<HTMLElement>("[class]")]) expect(element.className, element.tagName).not.toMatch(UNBOUNDED);
  expect(within(matrix).getByText("first")).toBeInTheDocument(); expect(within(matrix).getByText("second")).toBeInTheDocument();
});

it("caps every library column and the Edit column at the one shared panel preset maximum", async () => {
  const { element, library } = boardFixture();
  // View: the chosen-or-not column reads the same cap, and the table no longer sizes to max-content.
  const viewColumns = [...element.querySelectorAll<HTMLElement>("[data-studio-row] td:last-child")];
  expect(viewColumns.length).toBeGreaterThan(0);
  for (const column of viewColumns) expect(bounded(column)?.style.maxWidth).toBe(CAP);
  for (const node of element.querySelectorAll<HTMLElement>("table, [role=grid]")) expect(node.className).not.toMatch(UNBOUNDED);

  await userEvent.setup().click(within(element).getByRole("button", { name: labels.board.changeSelection }));
  const columns = [...element.querySelectorAll<HTMLElement>("[data-studio-card]")];
  const ids = new Set(columns.map(column => column.dataset.studioCard));
  // Every library column plus the Edit (custom) column, which belongs to the working library.
  expect(ids).toEqual(new Set(["foundry", library.source.id]));
  const caps = columns.map(column => bounded(column)?.style.maxWidth);
  expect(caps.every(cap => cap === CAP), JSON.stringify(caps)).toBe(true);
  const matrix = element.querySelector<HTMLElement>("[data-studio-matrix]")!;
  for (const node of [matrix, ...matrix.querySelectorAll<HTMLElement>("[class]")]) expect(node.className, node.tagName).not.toMatch(UNBOUNDED);
});

it("gives a 1-member and a 286-member candidate the identical cap and wraps every member into view", () => {
  // The actual selected color ramp: every family and step the signed default library ships.
  const catalog = loadCatalog();
  const library = completedTokenLibrary(catalog, { id: "bounds-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");
  const ramp = buildCandidates({ catalog, library, working: library, slotId: "tokens.color-ramp", scope: "slot", target: "tokens.color-ramp" }).find(candidate => candidate.selected)!;
  expect(ramp.members).toHaveLength(286);
  const single = { ...ramp, members: ramp.members.slice(0, 1) };
  const cells = [single, ramp].map(candidate => {
    const view = render(<CandidateCell candidate={candidate} labels={labels} />);
    const cell = view.container.querySelector<HTMLElement>("[data-candidate-cell]")!;
    expect([...cell.querySelectorAll<HTMLElement>("[data-candidate-variant]")].map(variant => variant.dataset.candidateVariant)).toEqual(candidate.members.map(entry => entry.id));
    expect(cell).toHaveClass("flex", "flex-wrap");
    expect(cell.className).not.toMatch(UNBOUNDED);
    // No member, member key or container between them and the cell is hidden, clipped or height-capped.
    for (const member of cell.querySelectorAll<HTMLElement>("[data-candidate-variant], [data-member-key]")) for (let node: HTMLElement | null = member; node && node !== cell.parentElement; node = node.parentElement) {
      expect(node.hidden, node.outerHTML.slice(0, 80)).toBe(false);
      expect(node.getAttribute("class") ?? "").not.toMatch(HIDING);
      expect(node.style.overflow + node.style.maxHeight + node.style.height).toBe("");
    }
    return cell;
  });
  expect(cells.map(cell => cell.style.maxWidth)).toEqual([CAP, CAP]);
  expect(cells[1]!.querySelectorAll("[data-member-key]")).toHaveLength(286);
});

it("reads the bound from the shared preset in every sizing source, with no copied pixel numbers", () => {
  for (const path of SIZING_SOURCES) {
    const source = readFileSync(resolve(import.meta.dirname, path), "utf8");
    expect(source, path).not.toMatch(/\b(?:220|280|420|256|320|576)(?:px)?\b/);
  }
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
  expect(read("../../studio/CandidateCell.tsx")).toMatch(/LIBRARY_COLUMN_BOUND[^=]*=\s*\{\s*maxWidth:\s*APP_FRAME_RIGHT_PANEL_CONFIG\.max\s*\}/);
  expect(read("../../studio/Board.tsx").match(/style=\{LIBRARY_COLUMN_BOUND\}/g)).toHaveLength(2);
});
