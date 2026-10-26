import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Board } from "./Board.js";
import { matrixBoards, matrixRows } from "./matrix-model.js";
import { buildCandidates, emptyChanges } from "./model.js";
import { labels, smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
import { CandidateChoice } from "./CandidateChoice.js";
import { RadioGroup } from "../components/RadioGroup.js";
import { applyLibraryChange, libraryHash } from "../catalog-core/index.js";
import { APP_FRAME_RIGHT_PANEL_CONFIG } from "../frames/right-panel-config.js";

afterEach(cleanup);
it("defaults to active-only View and edits just one content-sized board with actual library columns", async () => {
  const library = emptyLibrary();
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes: emptyChanges(library), expanded: new Set() });
  const board = matrixBoards({ catalog: smallCatalog, library, working: library }, rows).find(board => board.leaves.includes("tokens.surface-color"))!;
  const props = { boardRef: null, sources: ["empty-library", "foundry"], labels, working: library, changes: emptyChanges(library), expanded: new Set<string>(), groupChoices: {}, onExpand: () => {}, onUse: () => {}, onFocusCell: () => {} };
  const view = render(<><Board {...props} board={board} /><Board {...props} board={{ ...board, id: "second", label: "Second board" }} /></>);
  const boards = view.container.querySelectorAll<HTMLElement>("[data-studio-board]");
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(screen.queryByRole("columnheader", { name: "foundry" })).toBeNull();
  expect(within(boards[0]!).getAllByText(labels.board.notChosen).length).toBeGreaterThan(0);
  await userEvent.setup().click(within(boards[0]!).getByRole("button", { name: labels.board.changeSelection }));
  expect(boards[0]).toHaveAttribute("data-board-mode", "edit");
  expect(boards[1]).toHaveAttribute("data-board-mode", "view");
  expect(within(boards[1]!).queryAllByRole("radio")).toHaveLength(0);
  expect(screen.queryByRole("columnheader", { name: "empty-library" })).toBeNull();
  expect(screen.getByRole("columnheader", { name: "foundry" })).toBeInTheDocument();
  expect(boards[0]!.querySelectorAll("[data-studio-row]")).toHaveLength(board.leaves.length);
  expect(view.container.querySelector("[data-studio-board]")).toHaveClass("h-max");
  for (const column of boards[0]!.querySelectorAll<HTMLElement>("[data-studio-card]")) expect(column.querySelector<HTMLElement>("[data-candidate-cell], [data-studio-edit-actions]")?.style.maxWidth).toBe(`${APP_FRAME_RIGHT_PANEL_CONFIG.max}px`);
  expect([...view.container.querySelectorAll<HTMLElement>("[class]")].some(element => /(?:overflow-(?:auto|scroll)|max-h-)/.test(element.className))).toBe(false);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText(labels.previewUnavailable)).toBeNull();
  expect(screen.queryByText(labels.useSource("foundry", "tokens.surface-color"))).toBeNull();
  await userEvent.setup().click(within(boards[0]!).getByRole("button", { name: labels.board.done }));
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
});
it("selects the complete preview cell with click and native row arrow keys", async () => {
  const library = emptyLibrary();
  const base = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: "tokens.surface-color", scope: "slot", target: "tokens.surface-color" }).find(candidate => candidate.source === "foundry")!;
  function Row() { const [value, setValue] = useState("first"); return <RadioGroup label="Choices" orientation="horizontal" value={value} onChange={setValue}>{["first", "second"].map(source => <CandidateChoice key={source} candidate={{ ...base, source, usable: true }} target="leaf" labels={labels} />)}</RadioGroup>; }
  const view = render(<Row />); const user = userEvent.setup();
  const first = screen.getByRole("radio", { name: labels.useSource("first", "leaf") });
  const second = screen.getByRole("radio", { name: labels.useSource("second", "leaf") });
  const preview = second.closest("label")!.querySelector("span[data-studio-color-swatch]");
  expect(preview).not.toBeNull();
  const indicator = second.closest("label")!.querySelector(":scope > span[aria-hidden=true]");
  expect(indicator).not.toBeNull();
  expect(indicator?.querySelector("input")).toBeNull();
  expect(indicator).not.toBe(second.parentElement);
  await user.click(preview!);
  expect(second).toBeChecked();
  second.focus(); await user.keyboard("{ArrowLeft}"); expect(first).toBeChecked(); expect(first).toHaveFocus();
  expect(view.container.querySelector("label")).toHaveClass("w-full");
  expect(screen.queryByText(labels.checkSummary(0, base.notices))).toBeNull();
});
it("chooses one whole L3 candidate and renders every actual L4 variant horizontally", async () => {
  const library = emptyLibrary();
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes: emptyChanges(library), expanded: new Set() });
  const board = matrixBoards({ catalog: smallCatalog, library, working: library }, rows).find(board => board.leaves.includes("tokens.surface-color"))!;
  const use = vi.fn();
  const view = render(<Board board={board} boardRef={null} sources={["foundry"]} labels={labels} working={library} changes={emptyChanges(library)} expanded={new Set()} groupChoices={{}} onExpand={() => {}} onUse={use} onFocusCell={() => {}} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: labels.board.changeSelection }));
  const radio = screen.getByRole("radio", { name: labels.useSource("foundry", "tokens.surface-color") });
  const candidate = board.rows.find(row => row.id === "tokens.surface-color")!.candidates.find(candidate => candidate.source === "foundry")!;
  const variants = radio.closest("label")!.querySelectorAll<HTMLElement>("[data-candidate-variant]");
  expect([...variants].map(variant => variant.dataset.candidateVariant)).toEqual(candidate.members.map(member => member.id));
  expect(radio.closest("label")!.querySelector("[data-candidate-cell]")).toHaveClass("flex", "items-start");
  expect(view.container.querySelectorAll('[data-scope="member"]')).toHaveLength(0);
  await user.click(variants[0]!.querySelector("[data-studio-color-swatch]")!);
  expect(use).toHaveBeenCalledOnce();
  expect(use.mock.calls[0]![0]).toMatchObject({ id: "tokens.surface-color", scope: "slot", target: "tokens.surface-color" });
  expect(use.mock.calls[0]![1]).toBe("foundry");
});
it("shows an error badge only for positive errors and keeps notices in its tooltip", async () => {
  const library = emptyLibrary(); const base = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: "tokens.surface-color", scope: "slot", target: "tokens.surface-color" })[0]!;
  render(<RadioGroup label="Choices"><CandidateChoice candidate={{ ...base, errors: 1, notices: 2 }} target="leaf" labels={labels} /></RadioGroup>);
  const trigger = screen.getByRole("button", { name: labels.checkSummary(1, 2) });
  expect(screen.queryByText(labels.checkSummary(1, 2))).toBeNull();
  const user = userEvent.setup(); fireEvent.mouseMove(document.body); await user.hover(trigger);
  expect(await screen.findByRole("tooltip", {}, { timeout: 2500 })).toHaveTextContent(labels.checkSummary(1, 2));
});
it("gives an error card a one-line reason from its first error, not its notices", () => {
  const library = emptyLibrary(); const base = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: "tokens.surface-color", scope: "slot", target: "tokens.surface-color" })[0]!;
  const findings = [
    { code: "C2" as const, rule: "r", severity: "notice" as const, subject: "s", message: "A notice first" },
    { code: "C3" as const, rule: "r", severity: "error" as const, subject: "s", message: "Surface colour has no dark value" },
    { code: "C4" as const, rule: "r", severity: "error" as const, subject: "s", message: "Second error" },
  ];
  const view = render(<RadioGroup label="Choices"><CandidateChoice candidate={{ ...base, findings, errors: 2, notices: 1 }} target="leaf" labels={labels} /></RadioGroup>);
  const reason = view.container.querySelector<HTMLElement>("[data-error-reason]")!;
  expect(reason).toHaveTextContent(/^Surface colour has no dark value$/);
  expect(reason).toHaveClass("truncate", "max-w-full");
  expect(reason).toHaveAttribute("title", "Surface colour has no dark value");
  view.rerender(<RadioGroup label="Choices"><CandidateChoice candidate={{ ...base, findings: findings.slice(0, 1), errors: 0, notices: 1 }} target="leaf" labels={labels} /></RadioGroup>);
  expect(view.container.querySelector("[data-error-reason]")).toBeNull();
});
it("keeps an authored active choice unchanged when refresh returns a new pending candidate", async () => {
  const base = emptyLibrary();
  const library = applyLibraryChange(smallCatalog, base, { baseHash: libraryHash(base), changes: [{ op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: "#abcdef", $extensions: { "com.clossys.css": { raw: "#abcdef" } } } } }] });
  const changes = emptyChanges(library);
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes, expanded: new Set() });
  const board = matrixBoards({ catalog: smallCatalog, library, working: library }, rows).find(board => board.leaves.includes("tokens.surface-color"))!;
  const use = vi.fn(); const check = vi.fn(async () => ({ status: "checked" as const, candidates: [{ id: "new-custom", slot: "tokens.surface-color", label: "New custom", source: library.source.id, variants: ["tokens.surface-color.base"] }] }));
  render(<Board board={board} boardRef={null} sources={[library.source.id, "foundry"]} labels={labels} working={library} changes={changes} expanded={new Set()} groupChoices={{}} onExpand={() => {}} onUse={use} onFocusCell={() => {}} workflow={{ returnStep: "Return to this board", checkCandidates: check }} />);
  const user = userEvent.setup();
  expect(screen.getByRole("img", { name: `${labels.inspector.light} #abcdef` })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: labels.board.changeSelection }));
  expect(screen.getByRole("radio", { name: labels.useSource(library.source.id, "tokens.surface-color") })).toBeChecked();
  await user.click(screen.getByRole("button", { name: labels.board.refresh }));
  await user.click(screen.getByRole("button", { name: labels.board.checkCandidates }));
  expect(await screen.findByText(/New custom/)).toBeVisible();
  expect(check).toHaveBeenCalledWith("tokens.surface-color"); expect(use).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: labels.board.close }));
  await user.click(screen.getByRole("button", { name: labels.board.done }));
  expect(screen.getByRole("img", { name: `${labels.inspector.light} #abcdef` })).toBeInTheDocument();
  expect(changes.changes).toEqual([]); expect(use).not.toHaveBeenCalled();
});

it("keeps only the requested column for pending rows while editing, never one empty column per library (studio-16)", async () => {
  const base = emptyLibrary();
  const catalog = { ...smallCatalog, fills: [] };
  const rows = matrixRows({ catalog, library: base, working: base, changes: emptyChanges(base), expanded: new Set(), evaluateRows: new Set() });
  const board = { id: "pending-fixture", label: "Pending fixture", rows: rows.filter(row => row.id === "tokens.surface-color" || row.id === "tokens.spacing"), leaves: ["tokens.surface-color", "tokens.spacing"] };
  expect(board.rows.every(row => row.candidatesReady === false)).toBe(true);
  const request = vi.fn();
  render(<Board board={board} boardRef={null} sources={["foundry", "second", "third"]} labels={labels} working={base} changes={emptyChanges(base)} expanded={new Set()} groupChoices={{}} onExpand={() => {}} onUse={() => {}} onFocusCell={() => {}} onRequestRow={request} />);
  await userEvent.setup().click(screen.getByRole("button", { name: labels.board.changeSelection }));
  expect(request.mock.calls.map(([row, source]) => [row.id, source])).toEqual(board.rows.map(row => [row.id, "foundry"]));
  expect(screen.getByRole("columnheader", { name: "foundry" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "second" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "third" })).toBeNull();
});

it("shows actual selected values before alternative demand with no comparison columns", () => {
  const base = emptyLibrary();
  const library = applyLibraryChange(smallCatalog, base, { baseHash: libraryHash(base), changes: [{ op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: "#abcdef", $extensions: { "com.clossys.css": { raw: "#abcdef" } } } } }] });
  const catalog = { ...smallCatalog, fills: [] };
  const rows = matrixRows({ catalog, library, working: library, changes: emptyChanges(library), expanded: new Set(), evaluateRows: new Set() });
  const board = { id: "selected-fixture", label: "Selected fixture", rows: rows.filter(row => row.id === "tokens.surface-color" || row.id === "tokens.spacing"), leaves: ["tokens.surface-color", "tokens.spacing"] };
  expect(rows.find(row => row.id === "tokens.surface-color")?.candidatesReady).toBe(false);
  const view = render(<Board board={board} boardRef={null} sources={[]} labels={labels} working={library} changes={emptyChanges(library)} expanded={new Set()} groupChoices={{}} onExpand={() => {}} onUse={() => {}} onFocusCell={() => {}} />);
  const selected = view.container.querySelector('[data-studio-row="tokens.surface-color"]')!;
  expect(selected.querySelector('[data-candidate-cell] [data-candidate-variant="tokens.surface-color.base"]')).not.toBeNull();
  expect(within(selected as HTMLElement).getByRole("img", { name: `${labels.inspector.light} #abcdef` })).toBeInTheDocument();
  expect(within(selected as HTMLElement).queryByText(labels.board.notChosen)).toBeNull();
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(screen.queryByRole("columnheader", { name: "foundry" })).toBeNull();
  const missing = view.container.querySelector('[data-studio-row="tokens.spacing"]')!;
  expect(within(missing as HTMLElement).getByText(labels.board.notChosen)).toBeInTheDocument();
});
