import type { CanvasSize, Viewport } from "../../blocks/canvas/models.js";
import type { LayerId } from "../../catalog-core/index.js";
import { toWorld } from "../../blocks/canvas/models.js";
import type { SystemBoard, SystemLayout, SystemLine } from "./layout.js";

export interface SystemTrail {
  readonly layer?: LayerId;
  readonly board?: SystemBoard;
  readonly line?: SystemLine;
}

const inside = (value: number, start: number, extent: number) => value >= start && value <= start + extent;

/**
 * Where the viewport is (Layer > L1 > L2), read at the view centre: the layer
 * row nearest to it, the board under it, and the line under it. A centre in
 * the gap between boards names only the layer.
 */
export function trailAt(layout: SystemLayout, viewport: Viewport, viewSize: CanvasSize): SystemTrail {
  const centre = toWorld(viewport, { x: viewSize.width / 2, y: viewSize.height / 2 });
  let row = layout.rows[0], nearest = Infinity;
  for (const candidate of layout.rows) {
    const { y, height } = candidate.rect;
    const distance = centre.y < y ? y - centre.y : centre.y > y + height ? centre.y - y - height : 0;
    if (distance < nearest) { nearest = distance; row = candidate; }
  }
  if (!row) return {};
  const board = row.boards.find(candidate => inside(centre.x, candidate.rect.x, candidate.rect.width) && inside(centre.y, candidate.rect.y, candidate.rect.height));
  if (!board) return { layer: row.layer };
  const line = board.lines.find(candidate => inside(centre.y, candidate.rect.y, candidate.rect.height));
  return line ? { layer: row.layer, board, line } : { layer: row.layer, board };
}
