import { isPrefixOf, type CatalogData, type ChangeSet, type LibraryData } from "../catalog-core/index.js";
import type { MatrixBoard } from "./matrix-model.js";
import { nodeKey, sourcesAt } from "./model.js";

export type CanvasFilter = "all" | "pending" | "warnings" | "differs";
export interface CanvasDomain { id: string; label: string; boards: readonly MatrixBoard[] }

/** Layout follows the signed placement domains; the canvas never creates a second catalog. */
export function canvasDomains(catalog: CatalogData, boards: readonly MatrixBoard[]): CanvasDomain[] {
  return catalog.placements.flatMap(placement => placement.nodes.map(node => {
    const ids = new Set(("children" in node ? node.children : [node]).map(child => nodeKey(placement.layer, child.id)));
    return { id: nodeKey(placement.layer, node.id), label: node.label, boards: boards.filter(board => ids.has(board.id)) };
  }));
}
export function boardSources(board: MatrixBoard, working: LibraryData): string[] {
  return [...new Set(board.leaves.flatMap(leaf => sourcesAt(working, "slot", leaf)))];
}
export function boardMatches({ board, domain, query, filter, working, changes, groupChoices, warnings }: {
  board: MatrixBoard; domain: string; query: string; filter: CanvasFilter; working: LibraryData; changes: ChangeSet; groupChoices: Readonly<Record<string, string>>; warnings: number;
}): boolean {
  const search = query.trim().toLocaleLowerCase();
  if (search && ![domain, board.label, board.id, ...board.leaves].some(value => value.toLocaleLowerCase().includes(search))) return false;
  if (filter === "pending") return changes.changes.some(change => board.leaves.includes(change.slot));
  if (filter === "warnings") return warnings > 0;
  if (filter === "differs") return groupChoices[board.id] !== undefined && board.leaves.some(leaf => { const sources = sourcesAt(working, "slot", leaf); return sources.length > 0 && sources.some(source => source !== groupChoices[board.id]); });
  return true;
}
