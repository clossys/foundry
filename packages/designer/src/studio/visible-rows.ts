/** Candidate controls are hidden at overview zoom. At other zooms both the canvas and each scrolling matrix clip rows. */
export function visibleStudioRows(viewport: HTMLElement, rows: Iterable<readonly [string, HTMLElement]>, zoom: number): Set<string> {
  const visible = new Set<string>();
  if (zoom < .5) return visible;
  const host = viewport.getBoundingClientRect();
  for (const [id, element] of rows) {
    const rect = element.getBoundingClientRect();
    const matrix = element.closest<HTMLElement>("[data-studio-matrix]")?.getBoundingClientRect() ?? host;
    if (rect.width > 0 && rect.height > 0 && rect.right > Math.max(host.left, matrix.left) && rect.left < Math.min(host.right, matrix.right)
      && rect.bottom > Math.max(host.top, matrix.top) && rect.top < Math.min(host.bottom, matrix.bottom)) visible.add(id);
  }
  return visible;
}
