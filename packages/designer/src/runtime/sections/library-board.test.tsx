// @vitest-environment jsdom
/** sections.comparison library-board arrangement: the real LibraryBoardSection through the leaf's live Section host port. */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { buildCandidates } from "../../studio/model.js";
import { valueLibraryBoardPreviews, valueLibraryBoardRecords, type PreparedLibraryBoardInput } from "../../studio/library-board-adapter.js";
import { adopt, emptyLibrary, labels, smallCatalog } from "../../studio/__fixtures__/studio.js";
import { resolve } from "../../catalog-core/api.js";
import { runtimeHash, runtimeSnapshot, type RuntimeJson, type RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { sectionRenderers } from "./index.js";
import { assertLibraryBoardRecords, type LibraryBoardRecords } from "../../blocks/library-board/model.js";
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
  // DESIGNER-RO (converted from the gear's board-edit command): the board has no edit control; selecting a row
  // through the host port emits reveal, the only command.
  expect(screen.queryByRole("button", { name: labels.board.changeSelection })).toBeNull();
  await userEvent.click(screen.getByRole("row", { name: /Search/ }));
  expect(onCommand.mock.calls).toEqual([[{ version: 1, command: "reveal", boardId: "assets/icons", leafId: "assets.icon-search", source: "lucide" }]]);
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


it("reuses one validated board snapshot across runtime board renders", () => {
  const host = { previews: valueLibraryBoardPreviews(board(), labels), labels, onCommand: vi.fn() };
  const original = input(["arrangement.library-board"], boardContent(), host);
  const content = runtimeSnapshot(original.content);
  const renderRecords = (data: typeof content) => (entry.render({ ...original, content: data }) as ReactElement<{ records: LibraryBoardRecords }>).props.records;
  const first = renderRecords(content);
  assertLibraryBoardRecords(first);
  const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptors");
  const repeated: LibraryBoardRecords[] = [];
  let visits = 0;
  try {
    for (let render = 0; render < 4; render++) {
      const next = renderRecords(content);
      repeated.push(next);
      assertLibraryBoardRecords(next);
    }
    visits = descriptors.mock.calls.length;
  } finally { descriptors.mockRestore(); }
  expect(repeated.every(records => records === first)).toBe(true);
  expect(visits).toBe(0);
  const changed = renderRecords(runtimeSnapshot({ ...content, controls: { ...content.controls!, value: { version: 1, mode: "other", canSave: false, pending: false } } }));
  expect(changed).not.toBe(first);
  expect(() => assertLibraryBoardRecords(changed)).toThrow(/mode/);
  const mutable = structuredClone(content);
  const before = renderRecords(mutable);
  Object.assign(mutable.controls!.value as object, { mode: "other" });
  const after = renderRecords(mutable);
  expect(after).not.toBe(before);
  expect(() => assertLibraryBoardRecords(after)).toThrow(/mode/);
});
