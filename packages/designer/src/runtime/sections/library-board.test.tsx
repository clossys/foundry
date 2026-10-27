// @vitest-environment jsdom
/** sections.comparison library-board arrangement: the real LibraryBoardSection through the leaf's live Section host port. */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { buildCandidates } from "../../studio/model.js";
import { valueLibraryBoardPreviews, valueLibraryBoardRecords, type PreparedLibraryBoardInput } from "../../studio/library-board-adapter.js";
import { adopt, emptyLibrary, labels, smallCatalog } from "../../studio/__fixtures__/studio.js";
import { resolve } from "../../catalog-core/api.js";
import { runtimeHash, type RuntimeJson, type RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { sectionRenderers } from "./index.js";
import type { LibraryBoardSectionHost } from "./library-board.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function board(): PreparedLibraryBoardInput {
  const library = adopt(emptyLibrary(), "assets.icon-search", "lucide");
  const candidates = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: "assets.icon-search", scope: "slot", target: "assets.icon-search" });
  return { layer: "assets", board: { id: "assets/icons", label: "Icons", leaves: ["assets.icon-search"], rows: [{ id: "assets.icon-search", label: "Search", scope: "slot", target: "assets.icon-search", leaves: ["assets.icon-search"], depth: 0, emphasized: false, basket: "leaf", candidates }] },
    sources: smallCatalog.sources, consumerSource: library.source.id, selectionHash: resolve({ catalog: smallCatalog, library }).selectionHash,
    sourceHashes: Object.fromEntries(candidates.map(candidate => [candidate.source, runtimeHash(candidate.fill)])), mode: "view", canSave: true, pending: false,
    prompt: row => ({ consumer: library.source.id, board: { id: "assets/icons", label: "Icons" }, slot: { id: row.id, label: row.label }, variants: candidates[0]?.members.map(member => member.id) ?? [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
}
const entry = sectionRenderers["sections.comparison"]!;
function input(members: string[], content: Readonly<Record<string, RuntimeJson>>, sectionHost?: object): RuntimeRenderInput<ReactNode> {
  return {
    path: "sections.body.0", fill: { leaf: "sections.comparison", slots: ["columns", "controls", "highlight", "rows"], members: ["arrangement.library-board"] }, cell: { theme: "light", state: "default", width: 1280 }, profile: {}, slots: {},
    selection: { leaf: "sections.comparison", fill: "foundry/sections.comparison", config: null, members, content: {} },
    content: Object.fromEntries(Object.entries(content).map(([slot, value]) => [slot, { reference: { kind: "record", ref: `content:${slot}` }, value, hash: runtimeHash(value) }])),
    ...(sectionHost ? { sectionHost } : {}),
  } as unknown as RuntimeRenderInput<ReactNode>;
}
function boardContent(): Record<string, RuntimeJson> {
  const records = valueLibraryBoardRecords(board());
  return JSON.parse(JSON.stringify({ columns: records.columns, rows: records.rows, controls: records.controls })) as Record<string, RuntimeJson>;
}

it("draws the live library board from board records and the comparison Section host", async () => {
  const onCommand = vi.fn(), host: LibraryBoardSectionHost = { previews: valueLibraryBoardPreviews(board(), labels), labels, onCommand };
  render(<>{entry.render(input(["arrangement.library-board"], boardContent(), host))}</>);
  expect(screen.getByRole("region", { name: "Icons" })).toHaveAttribute("data-library-board", "assets/icons");
  expect(screen.getByRole("row", { name: /Search/ })).toBeInTheDocument();
  expect(screen.queryByText(labels.previewUnavailable)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: labels.board.changeSelection }));
  expect(onCommand).toHaveBeenCalledWith({ version: 1, command: "board-edit", boardId: "assets/icons" });
});

it("refuses the board without its port, with stray content or malformed records; other arrangements keep the grid", () => {
  const host = { previews: valueLibraryBoardPreviews(board(), labels), labels, onCommand: vi.fn() };
  expect(() => entry.render(input(["arrangement.library-board"], boardContent()))).toThrow(/needs its live port/);
  expect(() => entry.render({ ...input(["arrangement.library-board"], boardContent(), host), fill: { leaf: "sections.comparison", slots: ["columns", "controls", "rows"], members: [] } } as never)).toThrow(/is not mapped by this fill/);
  expect(() => entry.render(input(["arrangement.library-board"], boardContent(), { labels }))).toThrow(/needs its live port/);
  expect(() => entry.render(input(["arrangement.library-board"], { ...boardContent(), highlight: { row: "x" } }, host))).toThrow(/highlight has no board prop/);
  expect(() => render(<>{entry.render(input(["arrangement.library-board"], { ...boardContent(), controls: { version: 1 } }, host))}</>)).toThrow();
  render(<>{entry.render(input([], entry.sample(specimenDataset), host))}</>);
  expect(document.querySelector("[data-library-board]")).toBeNull();
});
