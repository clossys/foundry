import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board.js";
import { matrixBoards, matrixRows } from "./matrix-model.js";
import { emptyChanges } from "./model.js";
import { labels, smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
import { useCanvasWorld } from "./useCanvasWorld.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const OUT_OF_FLOW = /(?:^|\s)(?:absolute|fixed|sticky|float-[a-z]+|inset-\S+|top-\S+)(?:\s|$)/;
const SCROLL_OR_CAP = /(?:^|\s)(?:overflow-(?:auto|scroll|hidden|clip|x-\S+|y-\S+)|max-[wh]-\S+|h-\[[^\]]+\]|w-\[(?!var\(--ui-layout-sidebar-w\))[^\]]+\])(?:\s|$)/;
const COLUMN_WIDTH = "w-[var(--ui-layout-sidebar-w)]";
const COLUMN_MIN = "min-w-[var(--ui-layout-sidebar-w)]";

function fixture() {
  const library = emptyLibrary();
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes: emptyChanges(library), expanded: new Set() });
  const board = matrixBoards({ catalog: smallCatalog, library, working: library }, rows).find(board => board.leaves.includes("tokens.surface-color"))!;
  const props = { boardRef: null, sources: ["empty-library", "foundry"], labels, working: library, changes: emptyChanges(library), expanded: new Set<string>(), groupChoices: {}, onExpand: () => {}, onUse: () => {}, onFocusCell: () => {}, summary: { errors: 0, warnings: 1, sources: [] }, onOpen: () => {} };
  const view = render(<section data-testid="domain" className="flex items-start gap-2xl"><Board {...props} board={board} /><Board {...props} board={{ ...board, id: "next", label: "Next board" }} /></section>);
  const [first, next] = view.container.querySelectorAll<HTMLElement>("[data-studio-board]");
  return { board: first!, next: next!, view };
}
// Generated accessibility ids change when the trigger remounts; geometry and content must not.
const stable = (element: Element) => element.outerHTML.replace(/_r_[0-9a-z]+_/g, "_r_");
const chain = (from: Element, to: Element) => { const nodes: HTMLElement[] = []; for (let node = from as HTMLElement | null; node && node !== to; node = node.parentElement) nodes.push(node); return nodes; };

it("edits in normal flow: the board grows with its matrix and pushes the next sibling, with no inner scroll wrapper", async () => {
  const { board, next } = fixture();
  await userEvent.setup().click(within(board).getByRole("button", { name: labels.board.changeSelection }));
  expect(board).toHaveAttribute("data-board-mode", "edit");
  // Siblings stay ordinary flex items in one row: a wider first board moves the next one.
  expect(board.parentElement).toBe(next.parentElement);
  for (const element of [board, next]) { expect(element.className).not.toMatch(OUT_OF_FLOW); expect(element).toHaveClass("w-max", "h-max", "shrink-0"); }
  const matrix = board.querySelector<HTMLElement>("[data-studio-matrix]")!;
  expect(matrix).not.toBeNull();
  // Nothing between the matrix and the board caps, clips, scrolls or lifts it out of flow.
  for (const node of chain(matrix, board.parentElement!)) {
    expect(node.className, node.outerHTML.slice(0, 80)).not.toMatch(OUT_OF_FLOW);
    expect(node.className, node.outerHTML.slice(0, 80)).not.toMatch(SCROLL_OR_CAP);
    expect(node.style.overflow + node.style.maxWidth + node.style.maxHeight + node.style.position).toBe("");
  }
  // Every tier layer, including the zoomed-out summary, is in normal flow too.
  for (const layer of board.querySelectorAll<HTMLElement>("[data-canvas-lod-layer], [data-studio-zoom-summary]")) for (const node of chain(layer, board)) expect(node.className).not.toMatch(OUT_OF_FLOW);
  expect(board.querySelector("[data-studio-zoom-summary]")).not.toBeNull();
  expect([...board.querySelectorAll<HTMLElement>("[class]")].some(element => /(?:^|\s)overflow-(?:auto|scroll)(?:\s|$)/.test(element.className))).toBe(false);
});

it("keeps each library column at its original width and restores both boards on Done", async () => {
  const { board, next } = fixture();
  const original = { board: stable(board), next: stable(next) };
  const user = userEvent.setup();
  await user.click(within(board).getByRole("button", { name: labels.board.changeSelection }));
  const headers = [...board.querySelectorAll<HTMLElement>("[data-studio-matrix] thead th")].slice(1);
  const cards = [...board.querySelectorAll<HTMLElement>("[data-studio-card]")];
  expect(headers.length).toBeGreaterThan(0); expect(cards.length).toBeGreaterThan(0);
  for (const column of [...headers, ...cards]) expect(column).toHaveClass(COLUMN_WIDTH, COLUMN_MIN);
  expect(stable(next)).toBe(original.next);
  await user.click(within(board).getByRole("button", { name: labels.board.done }));
  expect(board).toHaveAttribute("data-board-mode", "view");
  expect(stable(board)).toBe(original.board);
  expect(stable(next)).toBe(original.next);
});

it("withdraws the contained inner-overflow workaround from the edit board", () => {
  const source = readFileSync(resolve(import.meta.dirname, "Board.tsx"), "utf8");
  // The JSX prop, not prose such as "self-contained".
  expect(source).not.toMatch(/\scontained(?=[\s/>=])/);
});

it("re-measures a grown world without refitting, so neighbours keep their camera position", () => {
  let width = 600; const notify: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { notify.push(callback); } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.testid === "world" ? width : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.testid === "world" ? 400 : 0; });
  const fit = vi.fn();
  let latest!: ReturnType<typeof useCanvasWorld>;
  function Probe() { const canvas = useCanvasWorld("tokens"); latest = canvas; canvas.actions.current = { read: () => canvas.pose, pan: () => {}, zoom: () => {}, fit, flyTo: () => {} }; return <div ref={canvas.onSurfaceElement}><div data-testid="world" ref={canvas.onWorldElement} /></div>; }
  render(<Probe />);
  expect(latest.bounds.width).toBe(600); expect(fit).toHaveBeenCalledTimes(1);
  act(() => latest.setPose({ x: -40, y: -20, zoom: .8 }));
  width = 960; act(() => notify.forEach(callback => callback()));
  expect(latest.bounds).toEqual({ x: 0, y: 0, width: 960, height: 400 });
  expect(latest.pose).toEqual({ x: -40, y: -20, zoom: .8 }); expect(fit).toHaveBeenCalledTimes(1);
});
