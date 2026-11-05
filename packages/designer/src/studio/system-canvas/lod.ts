import { CELL_NEAR_BUDGET, cellLodTier, cellScreenPx, type CellLodTier } from "../../blocks/canvas/cell-lod.js";
import type { CanvasRect } from "../../blocks/canvas/models.js";
import type { LayerId } from "../../catalog-core/index.js";
import type { SystemCell } from "./layout.js";

/** Sections and Frames are whole compositions: they never mount live on the system canvas. */
export function mountsLive(layer: LayerId): boolean {
  return layer !== "sections" && layer !== "frames";
}

/** Each cell's tier at `zoom`, held against its previous tier by the hysteresis band. */
export function cellTiers(cells: Iterable<SystemCell>, zoom: number, previous?: ReadonlyMap<string, CellLodTier>): Map<string, CellLodTier> {
  const tiers = new Map<string, CellLodTier>();
  for (const cell of cells) tiers.set(cell.leaf, cellLodTier(cellScreenPx(cell.rect, zoom), previous?.get(cell.leaf)));
  return tiers;
}

const overlap = (a: CanvasRect, b: CanvasRect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * The near cells that mount a live specimen: only cells of a live layer that
 * are on screen, most visible first (visible area, then distance to the view
 * centre, then leaf id), at most `limit` of them.
 */
export function liveCells(cells: Iterable<SystemCell>, tiers: ReadonlyMap<string, CellLodTier>, view: CanvasRect, limit = CELL_NEAR_BUDGET): Set<string> {
  const centre = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const ranked: { leaf: string; area: number; distance: number }[] = [];
  for (const cell of cells) {
    if (tiers.get(cell.leaf) !== "near" || !mountsLive(cell.layer)) continue;
    const area = overlap(cell.rect, view);
    if (area <= 0) continue;
    ranked.push({ leaf: cell.leaf, area, distance: Math.hypot(cell.rect.x + cell.rect.width / 2 - centre.x, cell.rect.y + cell.rect.height / 2 - centre.y) });
  }
  ranked.sort((a, b) => b.area - a.area || a.distance - b.distance || (a.leaf < b.leaf ? -1 : a.leaf > b.leaf ? 1 : 0));
  return new Set(ranked.slice(0, limit).map(entry => entry.leaf));
}

/** What a cell renders: near only when it holds a live slot; an over-budget near cell renders mid. */
export function renderedTier(leaf: string, tiers: ReadonlyMap<string, CellLodTier>, live: ReadonlySet<string>): CellLodTier {
  const tier = tiers.get(leaf) ?? "far";
  return tier === "near" && !live.has(leaf) ? "mid" : tier;
}
