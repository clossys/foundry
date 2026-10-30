import { canvasLodTier } from "../blocks/canvas/CanvasLod.js";
import type { CanvasRect, CanvasSize, Viewport } from "../blocks/canvas/models.js";

/** Rows live in the full detail tier; below it none are visible. In the full tier the canvas and each matrix clip rows. */
export function visibleStudioRows(viewport: HTMLElement, rows: Iterable<readonly [string, HTMLElement]>, zoom: number): Set<string> {
  const visible = new Set<string>();
  if (canvasLodTier(zoom) !== "full") return visible;
  const host = viewport.getBoundingClientRect();
  for (const [id, element] of rows) {
    const rect = element.getBoundingClientRect();
    const matrix = element.closest<HTMLElement>("[data-studio-matrix]")?.getBoundingClientRect() ?? host;
    if (rect.width > 0 && rect.height > 0 && rect.right > Math.max(host.left, matrix.left) && rect.left < Math.min(host.right, matrix.right)
      && rect.bottom > Math.max(host.top, matrix.top) && rect.top < Math.min(host.bottom, matrix.bottom)) visible.add(id);
  }
  return visible;
}

/** The world rectangle a viewport shows in a view of `viewSize` screen pixels. */
export function viewRect(viewport: Viewport, viewSize: CanvasSize): CanvasRect {
  return { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, width: viewSize.width / viewport.zoom, height: viewSize.height / viewport.zoom };
}

/** Whether two world rectangles share any area (edges that only touch do not). */
export function rectsOverlap(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Positioned-world virtualization: the ids of the boards a viewport shows, from
 * world geometry rather than DOM rects, so an off-screen board need not be
 * mounted at all to be measured.
 */
export function visibleBoards(boards: Iterable<{ readonly id: string; readonly rect: CanvasRect }>, viewport: Viewport, viewSize: CanvasSize): Set<string> {
  const view = viewRect(viewport, viewSize), visible = new Set<string>();
  for (const board of boards) if (rectsOverlap(board.rect, view)) visible.add(board.id);
  return visible;
}
