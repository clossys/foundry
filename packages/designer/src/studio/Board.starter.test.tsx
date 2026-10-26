import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board.js";
import { matrixBoards, matrixRows } from "./matrix-model.js";
import { emptyChanges } from "./model.js";
import { catalog, emptyLibrary, labels } from "./__fixtures__/studio.js";
import type { CatalogData, PlacementNode } from "../catalog-core/types.js";

afterEach(cleanup);
const ids = new Set(["assets.lockup", "assets.icon-search"]);
const prune = (node: PlacementNode): PlacementNode[] => {
  if ("children" in node) { const children = node.children.flatMap(prune); return children.length ? [{ ...node, children }] : []; }
  const leaves = node.leaves.filter(id => ids.has(id)); return leaves.length ? [{ ...node, leaves }] : [];
};
const slice: CatalogData = { ...catalog, slots: catalog.slots.filter(slot => ids.has(slot.id)), fills: catalog.fills.filter(fill => ids.has(fill.$extensions["com.clossys.fill"].slot)), placements: catalog.placements.map(placement => ({ ...placement, nodes: placement.nodes.flatMap(prune) })).filter(placement => placement.nodes.length > 0) };

function setup(starter?: { label: string; onGenerate: ReturnType<typeof vi.fn> }) {
  const library = emptyLibrary();
  const rows = matrixRows({ catalog: slice, library, working: library, changes: emptyChanges(library), expanded: new Set() });
  const boards = matrixBoards({ catalog: slice, library, working: library }, rows).filter(board => board.leaves.some(leaf => ids.has(leaf)));
  const props = { boardRef: null, sources: ["example", "lucide", "phosphor"], labels, working: library, changes: emptyChanges(library), expanded: new Set<string>(), groupChoices: {}, onExpand: () => {}, onUse: () => {}, onFocusCell: () => {} };
  return render(<>{boards.map(board => <Board key={board.id} {...props} board={board} starter={starter} />)}</>);
}

it("offers Generate starter in the Custom cell of brand rows only, and hands the row and starter id to the host", async () => {
  const onGenerate = vi.fn(), user = userEvent.setup();
  const view = setup({ label: "Generate starter", onGenerate });
  for (const button of screen.getAllByRole("button", { name: labels.board.changeSelection })) await user.click(button);
  const starters = view.container.querySelectorAll("[data-studio-generate-starter]");
  expect(starters).toHaveLength(1);
  expect(starters[0]).toHaveAttribute("data-studio-generate-starter", "identity-kit");
  expect(starters[0]!.closest("[data-studio-edit-actions]")).not.toBeNull();
  await user.click(within(starters[0]!.closest("[data-studio-edit-actions]") as HTMLElement).getByRole("button", { name: "Generate starter" }));
  expect(onGenerate).toHaveBeenCalledTimes(1);
  expect(onGenerate.mock.calls[0]![0].id).toBe("assets.lockup");
  expect(onGenerate.mock.calls[0]![1]).toBe("identity-kit");
});

it("renders no starter action when the host supplies none, and none in view mode", async () => {
  const view = setup({ label: "Generate starter", onGenerate: vi.fn() });
  expect(view.container.querySelector("[data-studio-generate-starter]")).toBeNull();
  cleanup();
  const bare = setup();
  for (const button of screen.getAllByRole("button", { name: labels.board.changeSelection })) await userEvent.setup().click(button);
  expect(bare.container.querySelector("[data-studio-generate-starter]")).toBeNull();
});
