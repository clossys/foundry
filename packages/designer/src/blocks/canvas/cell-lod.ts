import type { CanvasSize } from "./models.js";

/**
 * Per-cell level of detail (Designer D5g), a sibling of the zoom-based `canvasLodTier`.
 * A cell's tier follows its own on-screen size, not the camera zoom, so cells of
 * different world sizes on one canvas each pick the detail they can show.
 */
export type CellLodTier = "far" | "mid" | "near";
/** Below this on-screen size (CSS px) a cell is a flat status chip. Spec value (D5g), not a design token. */
export const CELL_LOD_FAR_PX = 28;
/** Above this on-screen size (CSS px) a cell may mount its live specimen. Spec value (D5g). */
export const CELL_LOD_NEAR_PX = 140;
/** A tier boundary moves this fraction away from the previous tier, so a cell does not flicker at it. */
export const CELL_LOD_HYSTERESIS = 0.15;
/** At most this many near cells mount a live specimen at once; the rest keep their mid rendering. */
export const CELL_NEAR_BUDGET = 24;

const RANK: Readonly<Record<CellLodTier, number>> = { far: 0, mid: 1, near: 2 };

/** A cell's on-screen size: its smaller side at this zoom. */
export function cellScreenPx(size: CanvasSize, zoom: number): number {
  return Math.min(size.width, size.height) * zoom;
}

/**
 * The tier for a cell of `px` on-screen size. With a previous tier each boundary
 * is held by +-15%: a cell below a boundary crosses it only above `boundary * 1.15`,
 * and a cell above it drops only below `boundary * 0.85`.
 */
export function cellLodTier(px: number, previous?: CellLodTier): CellLodTier {
  const band = (boundary: number, rank: number) => previous === undefined ? boundary
    : RANK[previous] >= rank ? boundary * (1 - CELL_LOD_HYSTERESIS) : boundary * (1 + CELL_LOD_HYSTERESIS);
  if (px < band(CELL_LOD_FAR_PX, 1)) return "far";
  return px > band(CELL_LOD_NEAR_PX, 2) ? "near" : "mid";
}
