import { canvasLodTier } from "../blocks/canvas/CanvasLod.js";

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
