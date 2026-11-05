import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { MatrixChoices } from "./choices.js";
import { Matrix as Comparison } from "../Matrix.js";
import { valueLibraryBoardRecords, valueLibraryBoardPreviews, type PreparedLibraryBoardInput } from "../../studio/library-board-adapter.js";
import { resolve as resolveLibrary } from "../../catalog-core/api.js";
import { runtimeHash } from "../../catalog-core/runtime-ports.js";
import { CandidateCell, LIBRARY_COLUMN_BOUND } from "../../studio/CandidateCell.js";
import { orderTokenMembers } from "../../tokens/preview/member-order.js";
import { buildCandidates } from "../../studio/model.js";
import { labels, smallCatalog, emptyLibrary, adopt } from "../../studio/__fixtures__/studio.js";
import { loadCatalog } from "../../catalog-core/index.js";
import { completedTokenLibrary } from "../../importers/__fixtures__/completed-token-library.js";
import { APP_FRAME_RIGHT_PANEL_CONFIG } from "../../frames/right-panel-config.js";

afterEach(cleanup);
const UNBOUNDED = /(?:^|\s)w-max(?:\s|$)/;
const HIDING = /(?:^|\s)(?:overflow-(?:hidden|clip|x-hidden)|truncate|line-clamp-\S+|text-ellipsis|sr-only)(?:\s|$)/;
const SIZING_SOURCES = ["../../studio/CandidateCell.tsx", "./choices.tsx"];

/** One canvas board as the Studio mounts it: the registered library-board comparison Section, in view or edit mode. */
function boardFixture(mode: "view" | "edit") {
  const library = adopt(emptyLibrary(), "assets.icon-search", "lucide");
  const candidates = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: "assets.icon-search", scope: "slot", target: "assets.icon-search" });
  const input: PreparedLibraryBoardInput = { layer: "assets", board: { id: "assets/icons", label: "Icons", leaves: ["assets.icon-search"], rows: [{ id: "assets.icon-search", label: "Search", scope: "slot", target: "assets.icon-search", leaves: ["assets.icon-search"], depth: 0, emphasized: false, basket: "leaf", candidates }] },
    sources: smallCatalog.sources, consumerSource: library.source.id, selectionHash: resolveLibrary({ catalog: smallCatalog, library }).selectionHash,
    sourceHashes: Object.fromEntries(candidates.map(candidate => [candidate.source, runtimeHash(candidate.fill)])), mode, canSave: true, pending: false,
    prompt: row => ({ consumer: library.source.id, board: { id: "assets/icons", label: "Icons" }, slot: { id: row.id, label: row.label }, variants: [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
  const view = render(<Comparison arrangement="library-board" records={valueLibraryBoardRecords(input)} previews={valueLibraryBoardPreviews(input, labels)} labels={labels} onCommand={() => {}} />);
  return { element: view.container.querySelector<HTMLElement>("section[data-library-board]")! };
}

it("lays out the choices matrix in normal flow from its bounded columns, never at max-content width", () => {
  const view = render(<MatrixChoices arrangement="choices" aria-label="Choices" columns={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}
    rows={[{ id: "row", label: "Row", name: "Row", selected: "a", cells: { a: <span>first</span>, b: <span>second</span> } }]} onChange={() => {}} />);
  const matrix = view.container.querySelector<HTMLElement>("[data-studio-matrix]")!;
  for (const element of [matrix, ...matrix.querySelectorAll<HTMLElement>("[class]")]) expect(element.className, element.tagName).not.toMatch(UNBOUNDED);
  expect(within(matrix).getByText("first")).toBeInTheDocument(); expect(within(matrix).getByText("second")).toBeInTheDocument();
});

it("caps every rendered library candidate cell at the one shared panel preset maximum, in view and edit", () => {
  // View: the chosen column's candidate cell carries the cap class, never a style attribute. The view table
  // itself still sizes to max-content (w-max on the library-board Section: a NEED on sections.comparison).
  const view = boardFixture("view").element;
  const viewCells = [...view.querySelectorAll<HTMLElement>("[data-candidate-cell]")];
  expect(viewCells.length).toBeGreaterThan(0);
  for (const cell of viewCells) { expect(cell).toHaveClass(LIBRARY_COLUMN_BOUND); expect(cell.getAttribute("style")).toBeNull(); }
  cleanup();
  // Edit: every library column's candidate cell carries the same cap. The not-chosen and custom-action cells
  // of the library-board Section carry no bound yet (a NEED on sections.comparison@library-board).
  const edit = boardFixture("edit").element;
  const editCells = [...edit.querySelectorAll<HTMLElement>("[data-candidate-cell]")];
  expect(editCells.length).toBeGreaterThan(0);
  for (const cell of editCells) { expect(cell).toHaveClass(LIBRARY_COLUMN_BOUND); expect(cell.getAttribute("style")).toBeNull(); }
  const matrix = edit.querySelector<HTMLElement>("[data-studio-matrix]")!;
  // A cell's specimen (here an icon at its intrinsic size) sits inside the capped cell; the layout around it never sizes to max-content.
  for (const node of [matrix, ...matrix.querySelectorAll<HTMLElement>("[class]")].filter(node => !node.closest("[data-asset-specimen]"))) expect(node.className, node.tagName).not.toMatch(UNBOUNDED);
});

it("gives a 1-member and a 7-member candidate the identical cap and wraps every member into view", () => {
  // The actual selected shadow scale: every step the signed default library ships (the largest themes leaf).
  const catalog = loadCatalog();
  const library = completedTokenLibrary(catalog, { id: "bounds-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");
  const scale = buildCandidates({ catalog, library, working: library, slotId: "themes.shadow", scope: "slot", target: "themes.shadow" }).find(candidate => candidate.selected)!;
  expect(scale.members).toHaveLength(7);
  const single = { ...scale, members: scale.members.slice(0, 1) };
  const cells = [single, scale].map(candidate => {
    const view = render(<CandidateCell candidate={candidate} labels={labels} />);
    const cell = view.container.querySelector<HTMLElement>("[data-candidate-cell]")!;
    // Every member renders, in the ordinal display order CandidateCell applies since 1a4aeab8e (2xs before xs).
    expect([...cell.querySelectorAll<HTMLElement>("[data-candidate-variant]")].map(variant => variant.dataset.candidateVariant)).toEqual(orderTokenMembers(candidate.members).map(entry => entry.id));
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
  for (const cell of cells) { expect(cell).toHaveClass(LIBRARY_COLUMN_BOUND); expect(cell.getAttribute("style")).toBeNull(); }
  expect(cells[1]!.querySelectorAll("[data-member-key]")).toHaveLength(7);
}, 20_000);

it("reads the bound from one named utility pinned to the shared preset, with no copied pixel numbers or style attributes", () => {
  for (const path of SIZING_SOURCES) {
    const source = readFileSync(resolve(import.meta.dirname, path), "utf8");
    expect(source, path).not.toMatch(/\b(?:220|280|420|256|320|576)(?:px)?\b/);
  }
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
  const cell = read("../../studio/CandidateCell.tsx");
  expect(cell).toMatch(/LIBRARY_COLUMN_BOUND\s*=\s*"library-column-bound"/);
  expect(cell).not.toMatch(/\bstyle=/);
  // The live bound reads the region-width role; its fallback remains the shared preset's maximum.
  const bound = `var(--ui-layout-inspector-max-w, ${APP_FRAME_RIGHT_PANEL_CONFIG.max}px)`;
  expect(read("../../../styles/theme-keys.css")).toContain(`@utility library-column-bound { max-inline-size: ${bound}; }`);
  expect(read("../../../styles/compiled.css")).toContain(`max-inline-size: ${bound};`);
});
