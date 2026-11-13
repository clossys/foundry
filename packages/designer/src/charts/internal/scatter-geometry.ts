/** Unit-area marker geometry for the categorical silhouettes ChartFrame draws. */
export type ScatterMark = "circle" | "square" | "diamond" | "triangle";
const canonical = (value: number) => value === 0 ? 0 : value;

/** All four contours have area one and their geometric centroid at the origin. */
export function scatterGlyph(mark: ScatterMark, x: number, y: number, scale: number) {
  if (mark === "circle") {
    const radius = scale / Math.sqrt(Math.PI);
    return { radius, path: undefined, left: radius, right: radius, top: radius, bottom: radius };
  }
  let vertices: readonly (readonly [number, number])[];
  if (mark === "square") vertices = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]];
  else if (mark === "diamond") {
    const diagonal = 1 / Math.sqrt(2);
    vertices = [[0, -diagonal], [diagonal, 0], [0, diagonal], [-diagonal, 0]];
  } else {
    const edge = Math.sqrt(4 / Math.sqrt(3)), height = Math.sqrt(3) * edge / 2;
    vertices = [[0, -2 * height / 3], [edge / 2, height / 3], [-edge / 2, height / 3]];
  }
  const scaled = vertices.map(([dx, dy]) => [dx * scale, dy * scale] as const);
  const path = scaled.map(([dx, dy], index) => `${index ? "L" : "M"} ${canonical(x + dx)} ${canonical(y + dy)}`).join(" ") + " Z";
  return { radius: undefined, path,
    left: -Math.min(...scaled.map(([dx]) => dx)), right: Math.max(...scaled.map(([dx]) => dx)),
    top: -Math.min(...scaled.map(([, dy]) => dy)), bottom: Math.max(...scaled.map(([, dy]) => dy)) };
}
