import { isPrefixOf, type CatalogData, type ChangeSet, type Selection } from "../catalog-core/index.js";
import type { MatrixBoard } from "./matrix-model.js";
import { nodeKey, pickAt } from "./model.js";

export type CanvasFilter = "all" | "pending" | "warnings" | "undecided" | "differs";
export interface CanvasDomain { id: string; label: string; boards: readonly MatrixBoard[] }

/** Layout follows the signed placement domains; the canvas never creates a second catalog. */
export function canvasDomains(catalog: CatalogData, boards: readonly MatrixBoard[]): CanvasDomain[] {
  return catalog.placements.filter(placement => placement.layer === "tokens").flatMap(placement => placement.nodes.map(node => {
    const ids = new Set(("children" in node ? node.children : [node]).map(child => nodeKey(placement.layer, child.id)));
    return { id: nodeKey(placement.layer, node.id), label: node.label, boards: boards.filter(board => ids.has(board.id)) };
  }));
}
export function boardSources(board: MatrixBoard, working: Selection): string[] {
  return [...new Set(working.picks.filter(pick => board.leaves.some(leaf => pick.scope === "slot" ? pick.target === leaf : isPrefixOf(leaf, pick.target))).map(pick => pick.source))];
}
export function boardMatches({ board, domain, query, filter, working, changes, groupChoices, warnings }: {
  board: MatrixBoard; domain: string; query: string; filter: CanvasFilter; working: Selection; changes: ChangeSet; groupChoices: Readonly<Record<string, string>>; warnings: number;
}): boolean {
  const search = query.trim().toLocaleLowerCase();
  if (search && ![domain, board.label, board.id, ...board.leaves].some(value => value.toLocaleLowerCase().includes(search))) return false;
  if (filter === "pending") return changes.changes.some(change => { const scope = change.op === "set" ? change.pick.scope : change.scope; const target = change.op === "set" ? change.pick.target : change.target; return board.leaves.some(leaf => scope === "slot" ? target === leaf : isPrefixOf(leaf, target)); });
  if (filter === "warnings") return warnings > 0;
  if (filter === "undecided") return board.decided < board.leaves.length;
  if (filter === "differs") return groupChoices[board.id] !== undefined && board.leaves.some(leaf => { const pick = pickAt(working, "slot", leaf); return pick !== undefined && pick.source !== groupChoices[board.id]; });
  return true;
}
