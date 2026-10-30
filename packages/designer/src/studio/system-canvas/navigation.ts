import { toScreen, type CanvasRect, type CanvasSize, type Viewport } from "../../blocks/canvas/models.js";
import type { LayerId } from "../../catalog-core/index.js";
import { revealDelta } from "../useCanvasWorld.js";
import type { SystemLayout } from "./layout.js";
import { centreOn, stopZoom, type SystemStop, type ZoomRange } from "./stops.js";

/** A rail target (Designer D5g): a layer, optionally narrowed to an L1, an L2 line, or one leaf. */
export interface SystemTarget {
  readonly layer: LayerId;
  readonly l1?: string;
  readonly l2?: string;
  readonly leaf?: string;
}

export interface NavigationPlan {
  readonly stop: SystemStop;
  /** The world rectangle the move frames and the arrival ring marks. */
  readonly focus: CanvasRect;
  readonly viewport: Viewport;
  /** False when the target is already on screen at the right stop: the camera stays put. */
  readonly move: boolean;
  /** The leaf an L3 target selects. */
  readonly select?: string;
}

/** A zoom within this fraction of a stop's zoom counts as already at that stop. */
export const STOP_TOLERANCE = 0.05;

const screenRect = (viewport: Viewport, rect: CanvasRect) => {
  const start = toScreen(viewport, rect), end = toScreen(viewport, { x: rect.x + rect.width, y: rect.y + rect.height });
  return { left: start.x, top: start.y, right: end.x, bottom: end.y };
};

/** The D5g table: what each target frames, at which stop, and around what. */
function resolve(layout: SystemLayout, target: SystemTarget): { stop: SystemStop; frame: CanvasRect; centre: CanvasRect; focus: CanvasRect; select?: string } | undefined {
  if (target.leaf !== undefined) {
    const cell = layout.cells.get(target.leaf);
    if (!cell || cell.layer !== target.layer) return undefined;
    // L3: the Board stop with the cell centred, and the cell selected.
    return { stop: "board", frame: layout.boards.get(cell.board)!.rect, centre: cell.rect, focus: cell.rect, select: cell.leaf };
  }
  if (target.l2 !== undefined) {
    const line = [...layout.lines.values()].find(candidate => candidate.l2 === target.l2 && candidate.id.startsWith(`${target.layer}/${target.l1 === undefined ? "" : `${target.l1}/`}`));
    if (!line) return undefined;
    const board = layout.boards.get(line.id.slice(0, line.id.lastIndexOf("/")))!;
    // L2: the Board stop with the line centred.
    return { stop: "board", frame: board.rect, centre: line.rect, focus: line.rect };
  }
  if (target.l1 !== undefined) {
    const board = layout.boards.get(`${target.layer}/${target.l1}`);
    return board ? { stop: "board", frame: board.rect, centre: board.rect, focus: board.rect } : undefined;
  }
  const row = layout.rows.find(candidate => candidate.layer === target.layer);
  return row ? { stop: "layer", frame: row.rect, centre: row.rect, focus: row.rect } : undefined;
}

/**
 * Plan one camera move to a target. An unknown target plans nothing. A target
 * already on screen (inside the inset stage, `revealDelta` zero) at its stop's
 * zoom keeps the current viewport and reports no move.
 */
export function planNavigation(layout: SystemLayout, target: SystemTarget, current: Viewport, viewSize: CanvasSize, padding: number, range: ZoomRange): NavigationPlan | undefined {
  const resolved = resolve(layout, target);
  if (!resolved) return undefined;
  const zoom = stopZoom(resolved.stop, resolved.frame, viewSize, padding, range);
  const select = resolved.select === undefined ? {} : { select: resolved.select };
  const delta = revealDelta({ left: 0, top: 0, right: viewSize.width, bottom: viewSize.height }, screenRect(current, resolved.focus));
  if (Math.abs(current.zoom - zoom) <= zoom * STOP_TOLERANCE && delta.x === 0 && delta.y === 0) {
    return { stop: resolved.stop, focus: resolved.focus, viewport: current, move: false, ...select };
  }
  return { stop: resolved.stop, focus: resolved.focus, viewport: centreOn(resolved.centre, viewSize, zoom), move: true, ...select };
}
