import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as renderPlain, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render, studioReady, chooseLayer } from "./__fixtures__/frame.js";
import { applyLibraryChange, loadCatalog, loadComponentRegistry, type LayerId } from "../catalog-core/index.js";
import { componentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { resolve } from "../catalog-core/api.js";
import { runtimeHash } from "../catalog-core/runtime-ports.js";
import { Studio, StudioRightPanel } from "./index.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import { CandidateCell } from "./CandidateCell.js";
import { buildCandidates } from "./model.js";
import { LibraryBoardSection } from "../blocks/library-board/LibraryBoardSection.js";
import { valueLibraryBoardPreviews, valueLibraryBoardRecords, type PreparedLibraryBoardInput } from "./library-board-adapter.js";
import { adopt, emptyLibrary, labels, smallCatalog } from "./__fixtures__/studio.js";
import type { CompositeStudioAdapter, CompositeStudioLabels } from "./types.js";

afterEach(cleanup);

const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } };
const LAYERS: readonly LayerId[] = ["tokens", "assets", "components", "sections", "frames"];

/** Every way a board header or a leaf cell departs from the one anatomy; empty means it conforms. */
function headerFaults(board: HTMLElement, title: string): string[] {
  const faults: string[] = [];
  const header = board.querySelector<HTMLElement>(":scope > [data-board-header]");
  if (!header) faults.push("no board header");
  const heading = header?.querySelector("h3");
  if (heading?.textContent !== title) faults.push("heading is not the board title");
  const named = board.getAttribute("aria-labelledby");
  const target = named ? document.getElementById(named) : null;
  if (!target || !heading?.contains(target) || target.textContent !== title) faults.push("board is not named by its heading");
  const gear = header ? [...header.querySelectorAll<HTMLElement>("button")].filter(button => button.getAttribute("aria-label") === labels.board.changeSelection) : [];
  // DESIGNER-RO (converted, rows 8-9): the header's selection gear is removed; a header that still carries one is nonconforming.
  if (gear.length !== 0) faults.push("a selection gear remains");
  return faults;
}
function cellFaults(cell: HTMLElement): string[] {
  const faults: string[] = [];
  const plates = cell.querySelectorAll<HTMLElement>("[data-candidate-cell]");
  if (plates.length !== 1) return [`${plates.length} plate cells`];
  const plate = plates[0]!;
  if (plate.getAttribute("data-variant") !== "plate") faults.push("cell is not a plate");
  const status = plate.querySelectorAll<HTMLElement>(":scope > [data-cell-status]");
  const actions = plate.querySelectorAll<HTMLElement>(":scope > [data-cell-actions]");
  if (status.length !== 1) faults.push(`${status.length} status slots`);
  if (actions.length !== 1) faults.push(`${actions.length} action slots`);
  const buttons = [...plate.querySelectorAll<HTMLElement>("button")];
  if (buttons.some(button => !button.hasAttribute("data-rac") || !actions[0]?.contains(button))) faults.push("action outside the action slot or not a Foundry Button");
  if (new Set(buttons.map(button => button.className)).size > 1) faults.push("actions differ in size");
  for (const text of [labels.board.notChosen, labels.previewUnavailable]) {
    const holders = [...cell.querySelectorAll<HTMLElement>("*")].filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.includes(text)));
    if (holders.some(holder => !status[0]?.contains(holder))) faults.push(`"${text}" outside the status slot`);
  }
  return faults;
}
function boardFaults(board: HTMLElement, title: string): { header: string[]; cells: string[] } {
  const rows = [...board.querySelectorAll<HTMLElement>("tbody tr, [role=row][data-studio-row]")].filter(row => row.querySelectorAll("td, [role=gridcell]").length > 0);
  const cells: string[] = rows.length === 0 ? ["no rows"] : [];
  for (const row of rows) {
    const columns = row.querySelectorAll<HTMLElement>("td, [role=gridcell]");
    for (const fault of cellFaults(columns[columns.length - 1]!)) cells.push(`${row.getAttribute("data-studio-row") ?? row.textContent}: ${fault}`);
  }
  return { header: headerFaults(board, title), cells };
}
function fullStudio() {
  const input = componentIntegration();
  const catalog = { values: loadCatalog(), components: { ...loadComponentRegistry(), fills: [] } };
  // One adopted token and one adopted icon, so filled cells sit beside unchosen ones.
  const values = adopt(adopt(emptyLibrary(), "tokens.surface-color", "foundry"), "assets.icon-search", "lucide");
  let library = { ...input.library, values: { fills: values.fills } };
  const adapter: CompositeStudioAdapter = { kind: "composite", catalog, load: vi.fn(async () => ({ library, componentOptions: input.componentOptions })),
    save: vi.fn(async (changes: Parameters<CompositeStudioAdapter["save"]>[0]) => { library = applyLibraryChange(catalog, library, changes); return { ok: true as const, library: structuredClone(library) }; }) };
  return adapter;
}

describe("one board and cell anatomy on every layer", () => {
  it("renders every board of the five layers with one header and one plate cell per leaf", async () => {
    const user = userEvent.setup();
    render(<WholeStudioProvider adapter={fullStudio()} labels={wholeLabels}><Studio header="external" /><StudioRightPanel /></WholeStudioProvider>);
    await studioReady();
    const report: Record<string, { boards: number; nonconforming: number; header: number; cells: number; faults: string[] }> = {};
    let filled = 0, unchosen = 0;
    for (const layer of LAYERS) {
      await chooseLayer(labels, labels.layers[layer], user);
      await waitFor(() => expect(document.querySelector(`[data-studio-canvas-board^="${layer}/"] > section[data-library-board]`)).not.toBeNull(), { timeout: 20000 });
      // Every canvas board is the registered library-board Section.
      const boards = [...document.querySelectorAll<HTMLElement>("[data-studio-canvas-board] > section[data-library-board]")];
      const entry = report[layer] = { boards: boards.length, nonconforming: 0, header: 0, cells: 0, faults: [] as string[] };
      for (const board of boards) {
        const title = board.querySelector("h3")?.textContent ?? "";
        const { header, cells } = boardFaults(board, title);
        if (header.length) entry.header += 1;
        if (cells.length) entry.cells += 1;
        if (header.length || cells.length) { entry.nonconforming += 1; entry.faults.push(`${board.parentElement!.dataset.studioCanvasBoard}: ${[...header, ...cells].slice(0, 3).join("; ")}`); }
        filled += board.querySelectorAll("[data-candidate-cell] [data-cell-status][hidden]").length;
        unchosen += [...board.querySelectorAll("[data-cell-status]")].filter(status => status.textContent === labels.board.notChosen).length;
      }
    }
    // Per layer: nonconforming boards / boards (header faults, cell faults).
    const summary = Object.fromEntries(LAYERS.map(layer => { const entry = report[layer]!; return [layer, `${entry.nonconforming}/${entry.boards} (header ${entry.header}, cell ${entry.cells})`]; }));
    expect(Object.values(report).every(entry => entry.boards > 0)).toBe(true);
    expect({ summary, faults: LAYERS.flatMap(layer => report[layer]!.faults).slice(0, 12) }).toEqual({ summary: Object.fromEntries(LAYERS.map(layer => [layer, `0/${report[layer]!.boards} (header 0, cell 0)`])), faults: [] });
    expect(filled).toBeGreaterThan(0);
    expect(unchosen).toBeGreaterThan(0);
  }, 240000);

  it("keeps the same plate skeleton for a filled, an unchosen and an unavailable leaf", () => {
    const library = adopt(emptyLibrary(), "assets.icon-search", "lucide");
    const candidate = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: "assets.icon-search", scope: "slot", target: "assets.icon-search" }).find(entry => entry.selected)!;
    const views = [
      renderPlain(<CandidateCell candidate={candidate} labels={labels} />).container,
      renderPlain(<CandidateCell candidate={{ ...candidate, previewable: false }} labels={labels} />).container,
      renderPlain(<CandidateCell labels={labels} />).container,
    ];
    for (const view of views) expect(cellFaults(view)).toEqual([]);
    expect(views[0]!.querySelector("[data-cell-status]")).toHaveAttribute("hidden");
    expect(views[1]!.querySelector("[data-cell-status]")).toHaveTextContent(labels.previewUnavailable);
    expect(views[2]!.querySelector("[data-cell-status]")).toHaveTextContent(labels.previewUnavailable);
  });

  it.each(["filled", "unchosen", "stale"] as const)("renders the public library board %s leaf with the same header and cell", state => {
    const library = state === "unchosen" ? emptyLibrary() : adopt(emptyLibrary(), "assets.icon-search", "lucide");
    const candidates = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: "assets.icon-search", scope: "slot", target: "assets.icon-search" });
    const input: PreparedLibraryBoardInput = { layer: "assets", board: { id: "assets/icons", label: "Icons", leaves: ["assets.icon-search"], rows: [{ id: "assets.icon-search", label: "Search", scope: "slot", target: "assets.icon-search", leaves: ["assets.icon-search"], depth: 0, emphasized: false, basket: "leaf", candidates }] },
      sources: smallCatalog.sources, consumerSource: library.source.id, selectionHash: resolve({ catalog: smallCatalog, library }).selectionHash,
      sourceHashes: Object.fromEntries(candidates.map(candidate => [candidate.source, runtimeHash(candidate.fill)])), mode: "view", canSave: true, pending: false,
      prompt: row => ({ consumer: library.source.id, board: { id: "assets/icons", label: "Icons" }, slot: { id: row.id, label: row.label }, variants: [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
    const previews = valueLibraryBoardPreviews(input, labels);
    const view = renderPlain(<LibraryBoardSection records={valueLibraryBoardRecords(input)} previews={state === "stale" ? { ...previews, selectionHash: `${previews.selectionHash}-stale` } : previews} labels={labels} onCommand={vi.fn()} />);
    const board = view.container.querySelector<HTMLElement>("[data-library-board]")!;
    expect(boardFaults(board, "Icons")).toEqual({ header: [], cells: [] });
    const status = board.querySelector("[data-cell-status]")!;
    if (state === "filled") expect(status).toHaveAttribute("hidden");
    else expect(status).toHaveTextContent(state === "unchosen" ? labels.board.notChosen : labels.previewUnavailable);
  });
});

