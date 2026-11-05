import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScatterChart, type ScatterChartProps } from "./ScatterChart.js";
import { ScatterChart as ServerScatterChart } from "./server.js";
import { ChartFrame } from "./ChartFrame.js";
import { assignCategoricalColor } from "./internal/chart-vars.js";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const labels = { table: "Afficher les données", category: "Observation" };
const series = [
  { id: "alpha", name: "Ensemble A" },
  { id: "beta", name: "Ensemble B" },
  { id: "gamma", name: "Ensemble C" },
  { id: "delta", name: "Ensemble D" },
];
const base: ScatterChartProps = {
  title: "Relation des mesures",
  description: "Les observations et leurs coordonnées",
  labels,
  x: { label: "Mesure horizontale", min: 0, max: 100 },
  y: { label: "Mesure verticale", min: 0, max: 100 },
  points: [
    { id: "p1", label: "Premier", x: 20, y: 30 },
    { id: "p2", label: "Deuxième", x: 40, y: 50 },
    { id: "p3", label: "Troisième", x: 60, y: 70 },
  ],
  valueFormat: value => `n=${value}`,
};

function props(overrides: Partial<ScatterChartProps> = {}): ScatterChartProps {
  return { ...base, ...overrides };
}
function pointGroup(container: HTMLElement, id: string): SVGGElement {
  const group = container.querySelector<SVGGElement>(`g[data-chart-point="${id}"]`);
  expect(group, `missing point ${id}`).not.toBeNull();
  return group!;
}
function mark(container: HTMLElement, id: string): SVGElement {
  const element = pointGroup(container, id).querySelector<SVGElement>("[data-chart-marker]");
  expect(element, `missing native marker ${id}`).not.toBeNull();
  return element!;
}
function numberAttr(element: Element, name: string): number {
  const raw = element.getAttribute(name);
  expect(raw, `${element.tagName}.${name}`).not.toBeNull();
  const value = Number(raw);
  expect(Number.isFinite(value)).toBe(true);
  return value;
}
function vertices(element: SVGElement): readonly [number, number][] {
  let coordinates: number[];
  if (element.tagName.toLowerCase() === "path") {
    const source = element.getAttribute("d") ?? "";
    const tokenPattern = /[MLZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
    const tokens = source.match(tokenPattern) ?? [];
    expect(source.replace(tokenPattern, "").replace(/[\s,]/g, "")).toBe("");
    expect(tokens[0]).toBe("M"); expect(tokens[tokens.length - 1]).toBe("Z");
    expect(tokens.filter(token => token === "M")).toHaveLength(1);
    expect(tokens.filter(token => token === "Z")).toHaveLength(1);
    coordinates = [];
    for (let index = 1; index < tokens.length - 1;) {
      if (tokens[index] === "L") { expect(coordinates.length).toBeGreaterThanOrEqual(2); index++; }
      const x = Number(tokens[index++]), y = Number(tokens[index++]);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      coordinates.push(x, y);
    }
  } else {
    expect(element.tagName.toLowerCase()).toBe("polygon");
    coordinates = (element.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
  }
  expect(coordinates.length).toBeGreaterThanOrEqual(6);
  expect(coordinates.length % 2).toBe(0);
  expect(coordinates.every(Number.isFinite)).toBe(true);
  return Array.from({ length: coordinates.length / 2 }, (_, index) =>
    [coordinates[index * 2]!, coordinates[index * 2 + 1]!] as const);
}
/** Independent geometric measurement, not an implementation data-area attribute. */
function area(element: SVGElement): number {
  if (element.tagName.toLowerCase() === "circle") {
    const radius = numberAttr(element, "r");
    expect(radius).toBeGreaterThanOrEqual(0);
    return Math.PI * radius ** 2;
  }
  if (element.tagName.toLowerCase() === "rect") {
    const width = numberAttr(element, "width"), height = numberAttr(element, "height");
    expect(width).toBeGreaterThanOrEqual(0); expect(height).toBeGreaterThanOrEqual(0);
    // A rounded rectangle's actual filled area is not width*height.
    expect(Number(element.getAttribute("rx") ?? 0)).toBe(0);
    expect(Number(element.getAttribute("ry") ?? 0)).toBe(0);
    expect(["", "0", "0px"]).toContain(element.style.getPropertyValue("rx"));
    expect(["", "0", "0px"]).toContain(element.style.getPropertyValue("ry"));
    return width * height;
  }
  expect(["path", "polygon"]).toContain(element.tagName.toLowerCase());
  const points = vertices(element);
  return Math.abs(points.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length]!;
    return sum + x * nextY - nextX * y;
  }, 0)) / 2;
}
function bounds(element: SVGElement) {
  if (element.tagName.toLowerCase() === "circle") {
    const cx = numberAttr(element, "cx"), cy = numberAttr(element, "cy"), r = numberAttr(element, "r");
    return { left: cx - r, right: cx + r, top: cy - r, bottom: cy + r };
  }
  if (element.tagName.toLowerCase() === "rect") {
    const x = numberAttr(element, "x"), y = numberAttr(element, "y");
    return { left: x, right: x + numberAttr(element, "width"), top: y, bottom: y + numberAttr(element, "height") };
  }
  const points = vertices(element);
  return {
    left: Math.min(...points.map(([x]) => x)), right: Math.max(...points.map(([x]) => x)),
    top: Math.min(...points.map(([, y]) => y)), bottom: Math.max(...points.map(([, y]) => y)),
  };
}
function tableRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll("tbody tr"), row =>
    Array.from(row.querySelectorAll("th,td"), cell => cell.textContent));
}
/** Vertex mean is the centroid of these regular glyphs, including collapsed ones.
 * Avoid shoelace division by zero for a positive size below coordinate precision. */
function markerCenter(element: SVGElement): readonly [number, number] {
  if (element.tagName.toLowerCase() === "circle") return [numberAttr(element, "cx"), numberAttr(element, "cy")];
  const points = vertices(element);
  const [originX, originY] = points[0]!;
  return [originX + points.reduce((sum, [x]) => sum + (x - originX), 0) / points.length,
    originY + points.reduce((sum, [, y]) => sum + (y - originY), 0) / points.length];
}
function expectFiniteFrameMarks(container: HTMLElement, points: ScatterChartProps["points"]) {
  expect(container.querySelector('svg[data-chart-part="frame"]')!.outerHTML).not.toMatch(/NaN|Infinity/);
  for (const point of points) {
    const element = mark(container, point.id), box = bounds(element), center = markerCenter(element);
    for (const value of [...Object.values(box), ...center]) expect(Number.isFinite(value)).toBe(true);
    expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(360);
    expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(300);
    expect(center[0]).toBeGreaterThanOrEqual(box.left); expect(center[0]).toBeLessThanOrEqual(box.right);
    expect(center[1]).toBeGreaterThanOrEqual(box.top); expect(center[1]).toBeLessThanOrEqual(box.bottom);
  }
}
function expectFiniteDistinctTicks(container: HTMLElement, formatted?: ReadonlyMap<number, string>) {
  for (const axis of ["x", "y"] as const) {
    const ticks = Array.from(container.querySelectorAll(`[data-chart-part="${axis}-ticks"] text`));
    // Resolve the compact fixture's exact value map when present; exponential
    // rounding must not silently collapse adjacent huge or subnormal ticks.
    const values = ticks.map(tick => {
      if (formatted) {
        const entry = [...formatted].find(([, label]) => label === tick.textContent);
        expect(entry, `unknown compact tick ${tick.textContent}`).toBeDefined();
        expect(Number.isFinite(entry![0])).toBe(true);
        return entry![0];
      }
      expect(tick.textContent).toMatch(/^n=/);
      const value = Number(tick.textContent!.slice(2));
      expect(Number.isFinite(value)).toBe(true);
      expect(tick.textContent).toBe(`n=${value}`);
      return value;
    });
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(new Set(values).size).toBe(values.length);
    const positions = ticks.map(tick => {
      // Draft rendering seam: native tick text coordinates are absolute.
      numberAttr(tick, "x"); numberAttr(tick, "y");
      return numberAttr(tick, axis);
    });
    expect(new Set(positions).size).toBe(positions.length);
  }
}
/** Independent affine oracle from the frame baseline and numeric native y ticks.
 * Never import the scale helper or assume a fixed left/title margin. */
function expectAuthoredPointMapping(container: HTMLElement, input: ScatterChartProps) {
  expect(input.x.min).toBeDefined(); expect(input.x.max).toBeDefined();
  expect(input.y.min).toBeDefined(); expect(input.y.max).toBeDefined();
  const baseline = container.querySelector('[data-chart-part="axis"] line')!;
  expect(baseline).not.toBeNull();
  const left = numberAttr(baseline, "x1"), right = numberAttr(baseline, "x2");
  const bottom = numberAttr(baseline, "y1");
  expect(right).toBeGreaterThan(left);
  expect(numberAttr(baseline, "y2")).toBe(bottom);
  const ticks = [...container.querySelectorAll('[data-chart-part="y-ticks"] text')].map(tick => {
    expect(tick.textContent).toMatch(/^n=/);
    const value = Number(tick.textContent!.slice(2));
    expect(Number.isFinite(value)).toBe(true);
    return { value, y: numberAttr(tick, "y") };
  });
  expect(ticks.length).toBeGreaterThanOrEqual(2);
  const first = ticks[0]!, last = ticks.at(-1)!;
  expect(last.value).toBeGreaterThan(first.value);
  expect(last.y).toBeLessThan(first.y);
  const expectedY = (value: number) => first.y +
    (value - first.value) / (last.value - first.value) * (last.y - first.y);
  // Bounds need not themselves be nice ticks. Extrapolate to the authored
  // minimum, then anchor it against ChartFrame's independent baseline.
  expect(expectedY(input.y.min!)).toBeCloseTo(bottom, 8);
  const grid = [...container.querySelectorAll('[data-chart-part="grid"] line')];
  expect(grid).toHaveLength(ticks.length);
  for (const [index, tick] of ticks.entries()) {
    expect(tick.y).toBeCloseTo(expectedY(tick.value), 8);
    expect(numberAttr(grid[index]!, "x1")).toBe(left);
    expect(numberAttr(grid[index]!, "x2")).toBe(right);
    expect(numberAttr(grid[index]!, "y1")).toBe(tick.y);
    expect(numberAttr(grid[index]!, "y2")).toBe(tick.y);
  }
  for (const point of input.points) {
    const [centerX, centerY] = markerCenter(mark(container, point.id));
    const expectedX = left + (point.x - input.x.min!) /
      (input.x.max! - input.x.min!) * (right - left);
    expect(centerX).toBeCloseTo(expectedX, 8);
    expect(centerY).toBeCloseTo(expectedY(point.y), 8);
  }
}
function nativeProps(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nativeProps);
  if (!isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) return [];
  const descendants = nativeProps(node.props.children);
  return typeof node.type === "string" ? [node.props, ...descendants] : descendants;
}

describe("MC5 ScatterChart geometry and identity", () => {
  it("encodes 1:4:9 size by 1:2:3 lengths and 1:4:9 actual filled areas", () => {
    const { container } = render(<ScatterChart {...props({
      size: { label: "Mesure de surface" },
      points: base.points.map((point, index) => ({ ...point, size: [1, 4, 9][index]! })),
    })} />);
    const areas = base.points.map(point => area(mark(container, point.id)));
    expect(areas[0]).toBeGreaterThan(0);
    expect(areas[1]! / areas[0]!).toBeCloseTo(4, 6);
    expect(areas[2]! / areas[0]!).toBeCloseTo(9, 6);
    expect(Math.sqrt(areas[1]! / areas[0]!)).toBeCloseTo(2, 6);
    expect(Math.sqrt(areas[2]! / areas[0]!)).toBeCloseTo(3, 6);
    // MUTATION: change the size length exponent from 1/2 to 1.
    // The assertions measure emitted area ratios and require no particular helper expression.
  });

  it("uses four distinct native shapes with equal actual filled area for equal sizes", () => {
    const points = series.map((entry, index) => ({
      id: `s${index}`, label: `Point ${index + 1}`, x: 20 + index * 15, y: 30 + index * 10,
      size: 4, series: entry.id,
    }));
    const { container } = render(<ScatterChart {...props({ points, series, size: { label: "Mesure de surface" } })} />);
    const marks = points.map(point => mark(container, point.id));
    expect(marks.map(element => element.getAttribute("data-chart-marker"))).toEqual(["circle", "square", "diamond", "triangle"]);
    // Candidate representation only; the plan fixes shape/area, not native tag names.
    expect(marks.map(element => element.tagName.toLowerCase())).toEqual(["circle", "path", "path", "path"]);
    const square = vertices(marks[1]!), squareBox = bounds(marks[1]!);
    expect(square).toHaveLength(4);
    expect(new Set(square.map(([x, y]) => `${x},${y}`)).size).toBe(4);
    expect(squareBox.right - squareBox.left).toBeCloseTo(squareBox.bottom - squareBox.top, 6);
    for (const [x, y] of square) {
      expect([squareBox.left, squareBox.right].some(edge => Math.abs(edge - x) < 1e-6)).toBe(true);
      expect([squareBox.top, squareBox.bottom].some(edge => Math.abs(edge - y) < 1e-6)).toBe(true);
    }
    const diamond = vertices(marks[2]!);
    expect(diamond).toHaveLength(4);
    const diamondBox = bounds(marks[2]!), midX = (diamondBox.left + diamondBox.right) / 2;
    const midY = (diamondBox.top + diamondBox.bottom) / 2;
    expect(diamondBox.right - diamondBox.left).toBeCloseTo(diamondBox.bottom - diamondBox.top, 6);
    const actualDiamond = [...diamond].map(([x, y]) => `${x},${y}`).sort();
    const expectedDiamond = [[midX, diamondBox.top], [diamondBox.right, midY], [midX, diamondBox.bottom], [diamondBox.left, midY]];
    // Numeric comparison accepts either winding direction and any vertex start.
    for (const [x, y] of expectedDiamond) expect(diamond.some(([actualX, actualY]) =>
      Math.abs(actualX - x) < 1e-6 && Math.abs(actualY - y) < 1e-6)).toBe(true);
    expect(new Set(actualDiamond).size).toBe(4);
    const triangle = vertices(marks[3]!);
    expect(triangle).toHaveLength(3);
    const edges = triangle.map(([x, y], index) => {
      const [nextX, nextY] = triangle[(index + 1) % triangle.length]!;
      return Math.hypot(nextX - x, nextY - y);
    });
    expect(edges[0]).toBeGreaterThan(0);
    expect(edges[1]).toBeCloseTo(edges[0]!, 6); expect(edges[2]).toBeCloseTo(edges[0]!, 6);
    const areas = marks.map(area);
    expect(areas[0]).toBeGreaterThan(0);
    for (const measured of areas.slice(1)) expect(measured / areas[0]!).toBeCloseTo(1, 6);
    // MUTATION: use the same bounding radius for every shape without equal-area normalization.
  });

  it("keeps declared-series colors and shapes when point order and present series change", () => {
    const initialPoints = series.map((entry, index) => ({
      id: `s${index}`, label: entry.name, x: 20 + index * 15, y: 30 + index * 10, series: entry.id,
    }));
    const initial = render(<ScatterChart {...props({ points: initialPoints, series })} />);
    const before = mark(initial.container, "s3");
    const identity = { shape: before.getAttribute("data-chart-marker"), fill: before.getAttribute("fill") };
    initial.unmount();
    const points = [initialPoints[3]!, { ...initialPoints[3]!, id: "s3b" }, initialPoints[1]!];
    const { container } = render(<ScatterChart {...props({ points, series })} />);
    const after = mark(container, "s3");
    expect(after.getAttribute("data-chart-marker")).toBe(identity.shape);
    expect(after.getAttribute("fill")).toBe(identity.fill);
    expect(after.getAttribute("fill")).toContain("--color-chart-categorical-4");
    expect(mark(container, "s1").getAttribute("fill")).toContain("--color-chart-categorical-2");
    // MUTATION: assign shape/color by point index or by series present in points.
  });

  it.each(["start", "end", "above", "below"] as const)("puts the direct label outside the %s marker edge", labelSide => {
    const { container } = render(<ScatterChart {...props({
      size: { label: "Mesure de surface" },
      points: base.points.map(point => ({ ...point, size: 1, x: point.id === "p2" ? 50 : point.x,
        ...(point.id === "p2" ? { labelSide } : {}) })),
    })} />);
    const markerBounds = bounds(mark(container, "p2"));
    const label = pointGroup(container, "p2").querySelector('text[data-chart-part="point-label"]')!;
    expect(label.textContent).toBe("Deuxième");
    const x = numberAttr(label, "x"), y = numberAttr(label, "y");
    if (labelSide === "start") {
      expect(x).toBeLessThan(markerBounds.left);
      expect(label.getAttribute("text-anchor")).toBe("end");
    } else if (labelSide === "end") {
      expect(x).toBeGreaterThan(markerBounds.right);
      expect(label.getAttribute("text-anchor")).toBe("start");
    } else {
      expect(label.getAttribute("text-anchor")).toBe("middle");
      expect(y)[labelSide === "above" ? "toBeLessThan" : "toBeGreaterThan"](
        labelSide === "above" ? markerBounds.top : markerBounds.bottom);
    }
    // Visual review must also confirm glyph extents (text baseline alone cannot prove clearance).
  });

  it.each([{ sizes: [0, 1, 4] }, { sizes: [0, 0, 0] }])("allows zero sizes without division by zero: $sizes", ({ sizes }) => {
    const { container } = render(<ScatterChart {...props({
      size: { label: "Mesure de surface" },
      points: base.points.map((point, index) => ({ ...point, size: sizes[index]! })),
    })} />);
    for (const [index, point] of base.points.entries()) {
      const measured = area(mark(container, point.id));
      expect(Number.isFinite(measured)).toBe(true);
      if (sizes[index] === 0) expect(measured).toBe(0);
      expect(pointGroup(container, point.id).textContent).toContain(point.label);
    }
    expect(container.querySelector("svg")!.outerHTML).not.toMatch(/NaN|Infinity/);
  });
});

describe("MC5 exact authored alternatives and static frame", () => {
  it("preserves the published unshaped legend and keeps an absent optional mark byte-identical", () => {
    const ordinary = { title: "Relation", table: { headers: ["Observation"], rows: [["Premier"]] },
      legend: series.slice(0, 2).map((entry, index) => ({ label: entry.name, color: assignCategoricalColor(index) })) };
    const implicit = renderToStaticMarkup(<ChartFrame {...ordinary}>{() => null}</ChartFrame>);
    const explicit = renderToStaticMarkup(<ChartFrame {...ordinary} legend={ordinary.legend.map(item => ({ ...item, mark: undefined }))}>{() => null}</ChartFrame>);
    expect(explicit).toBe(implicit);
    const { container } = render(<ChartFrame {...ordinary}>{() => null}</ChartFrame>);
    const legend = container.querySelector('[data-chart-part="legend"]')!;
    expect(legend.querySelectorAll("svg")).toHaveLength(0);
    const keys = Array.from(legend.querySelectorAll("li > span"));
    expect(keys).toHaveLength(2);
    for (const [index, key] of keys.entries()) {
      expect(key.getAttribute("aria-hidden")).toBe("true");
      expect(key.getAttribute("class")).toBe("inline-block h-3 w-3 rounded-subtle");
      expect((key as HTMLElement).style.backgroundColor).toBe(ordinary.legend[index]!.color);
    }
  });

  it("renders an unsized circle with a positive uniform native radius without approving a literal size", () => {
    const { container } = render(<ScatterChart {...base} />);
    const circles = base.points.map(point => mark(container, point.id));
    for (const circle of circles) {
      expect(circle.tagName.toLowerCase()).toBe("circle");
      expect(numberAttr(circle, "r")).toBeGreaterThan(0);
    }
    expect(new Set(circles.map(circle => numberAttr(circle, "r"))).size).toBe(1);
    // A specific radius needs root's visual decision; --radius-subtle is a corner token.
  });
  it("uses exact table/category/x/y/size headings and formatted values in authored order", () => {
    const { container } = render(<ScatterChart {...props({
      size: { label: "Mesure de surface" },
      points: base.points.map((point, index) => ({ ...point, size: index })),
    })} />);
    expect(container.querySelector("summary")!.textContent).toBe(labels.table);
    expect(Array.from(container.querySelectorAll("thead th"), cell => cell.textContent)).toEqual([
      labels.category, base.x.label, base.y.label, "Mesure de surface",
    ]);
    expect(tableRows(container)).toEqual(base.points.map((point, index) =>
      [point.label, `n=${point.x}`, `n=${point.y}`, `n=${index}`]));
    // MUTATION: always omit the size column, or always render one for unsized plots.
  });

  it("omits the size column when unsized and requires its authored title when enabled", () => {
    const { container } = render(<ScatterChart {...base} />);
    expect(Array.from(container.querySelectorAll("thead th"), cell => cell.textContent)).toEqual([
      labels.category, base.x.label, base.y.label,
    ]);
    expect(tableRows(container)).toEqual(base.points.map(point => [point.label, `n=${point.x}`, `n=${point.y}`]));
    const invalid = props({ size: { label: "" }, points: base.points.map(point => ({ ...point, size: 1 })) });
    expect(() => ScatterChart(invalid)).toThrow();
  });

  it("shows exact authored axis titles and an exact sizing title when enabled", () => {
    const { container } = render(<ScatterChart {...props({
      size: { label: "Mesure de surface" },
      points: base.points.map(point => ({ ...point, size: 1 })),
    })} />);
    const visibleSvgText = Array.from(container.querySelectorAll('svg[data-chart-part="frame"] text'), node => node.textContent);
    expect(visibleSvgText).toContain(base.x.label);
    expect(visibleSvgText).toContain(base.y.label);
    // Size title may be a visible HTML key/caption; the table header alone is insufficient.
    const visibleSizingTitles = Array.from(container.querySelectorAll("text,p,figcaption,li,span"), node => node.textContent)
      .filter(text => text === "Mesure de surface");
    expect(visibleSizingTitles.length).toBeGreaterThan(0);
  });

  it("shows no legend for an implicit ungrouped plot", () => {
    const { container } = render(<ScatterChart {...base} />);
    expect(container.querySelector('[data-chart-part="legend"]')).toBeNull();
    for (const point of base.points) {
      expect(mark(container, point.id).getAttribute("data-chart-marker")).toBe("circle");
      expect(mark(container, point.id).getAttribute("fill")).toContain("--color-chart-categorical-1");
    }
  });

  it("explains series using matching marker keys at two or more declared series", () => {
    const points = base.points.map((point, index) => ({ ...point, series: series[index % 2]!.id }));
    const { container } = render(<ScatterChart {...props({ series: series.slice(0, 2), points })} />);
    const legend = container.querySelector('[data-chart-part="legend"]')!;
    expect(legend).not.toBeNull();
    const keys = Array.from(legend.querySelectorAll("li"));
    expect(keys).toHaveLength(2);
    keys.forEach((key, index) => {
      expect(key.textContent).toContain(series[index]!.name);
      const marker = key.querySelector("[data-chart-marker]")!;
      expect(marker.getAttribute("data-chart-marker")).toBe(index === 0 ? "circle" : "square");
      expect(marker.getAttribute("fill")).toContain(`--color-chart-categorical-${index + 1}`);
    });
    const rows = tableRows(container);
    rows.forEach((row, index) => {
      expect(row[0]).toContain(base.points[index]!.label);
      expect(row[0]).toContain(series[index % 2]!.name);
    });
  });

  it("has one graphic with linked authored title/description and static hidden native marks", () => {
    const { container } = render(<ServerScatterChart {...base} />);
    const svg = container.querySelector('svg[data-chart-part="frame"]')!;
    expect(svg.getAttribute("role")).toBe("group");
    const title = container.querySelector(`[id="${svg.getAttribute("aria-labelledby")}"]`)!;
    const description = container.querySelector(`[id="${svg.getAttribute("aria-describedby")}"]`)!;
    expect(title.textContent).toBe(base.title);
    expect(description.textContent).toBe(base.description);
    for (const point of base.points) {
      const marker = mark(container, point.id);
      expect(marker.getAttribute("aria-hidden") ?? pointGroup(container, point.id).getAttribute("aria-hidden")).toBe("true");
      expect(marker.hasAttribute("tabindex")).toBe(false);
    }
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(base.points.length);
    for (const target of container.querySelectorAll("[tabindex]")) expect(target).toHaveAttribute("data-chart-tooltip-trigger");
    expect(container.querySelector("details table")).not.toBeNull();
    expect(renderToStaticMarkup(<ServerScatterChart {...base} />)).not.toMatch(/onpointer|onkeydown|onfocus/i);
  });

  it("inspects native React props to catch event handlers that SSR serialization would strip", () => {
    // Assumes ScatterChart returns ChartFrame directly, with its marks render prop.
    const chart = ScatterChart(base);
    const native = nativeProps(chart.props.children({ x: 48, y: 16, width: 296, height: 252 }));
    expect(native.length).toBeGreaterThanOrEqual(base.points.length);
    for (const element of native) {
      expect(Object.entries(element).filter(([name, value]) => /^on[A-Z]/.test(name) && value !== undefined)).toEqual([]);
      expect(element.tabIndex).toBeUndefined();
    }
  });

  it("defaults to fluid 360×300 capped at 1.5 and preserves an authored fixed override", () => {
    const fluid = render(<ScatterChart {...base} />);
    const svg = fluid.container.querySelector('svg[data-chart-part="frame"]')! as SVGSVGElement;
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.getAttribute("viewBox")).toBe("0 0 360 300");
    expect(svg.style.maxWidth).toBe("540px");
    expect(svg.style.height).toBe("auto");
    fluid.unmount();
    const { container } = render(<ScatterChart {...base} fit="fixed" width={400} height={320} style={{ maxWidth: 450 }} />);
    expect(container.querySelector('svg[data-chart-part="frame"]')!.getAttribute("width")).toBe("400");
    expect(container.querySelector('svg[data-chart-part="frame"]')!.getAttribute("viewBox")).toBe("0 0 400 320");
    expect(container.querySelector("figure")!.style.maxWidth).toBe("450px");
  });

  it("introduces no English fallback UI when labels are authored", () => {
    const { container } = render(<ScatterChart {...base} />);
    expect(container.textContent).not.toMatch(/View as table|Category|Series|Size/);
    expect(container.querySelector("summary")!.textContent).toBe(labels.table);
    expect(container.querySelectorAll("thead th[scope=col]")).toHaveLength(3);
  });
});

describe("MC5 domain integrity", () => {
  it.each([
    { name: "positive maximum constant", values: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE] },
    { name: "negative maximum constant", values: [-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE] },
    { name: "positive minimum subnormal constant", values: [Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE] },
    { name: "negative minimum subnormal constant", values: [-Number.MIN_VALUE, -Number.MIN_VALUE, -Number.MIN_VALUE] },
    { name: "opposite maximum endpoints", values: [-Number.MAX_VALUE, 0, Number.MAX_VALUE] },
    { name: "tiny subnormal span", values: [Number.MIN_VALUE, 2 * Number.MIN_VALUE, 4 * Number.MIN_VALUE] },
    // At the top finite binade the representable spacing is exactly 2^971.
    // These are three adjacent values, independently authored without a scale helper.
    { name: "adjacent huge values", values: [Number.MAX_VALUE - 2 * 2 ** 971, Number.MAX_VALUE - 2 ** 971, Number.MAX_VALUE] },
  ])("auto-fits $name with finite distinct ticks and contained native geometry", ({ values }) => {
    const points = base.points.map((point, index) => ({ ...point, x: values[index]!, y: values[index]! }));
    const formatted = new Map<number, string>();
    const compactFormat = (value: number): string => {
      const existing = formatted.get(value);
      if (existing !== undefined) return existing;
      const label = `t${formatted.size}`;
      formatted.set(value, label);
      return label;
    };
    const { container } = render(<ScatterChart {...props({
      x: { label: base.x.label }, y: { label: base.y.label }, points, valueFormat: compactFormat,
    })} />);
    expectFiniteDistinctTicks(container, formatted);
    expectFiniteFrameMarks(container, points);
    expect(tableRows(container)).toEqual(points.map(point => [point.label, compactFormat(point.x), compactFormat(point.y)]));
    const centers = points.map(point => markerCenter(mark(container, point.id)));
    if (values[0] === values[2]) {
      expect(centers[1]).toEqual(centers[0]); expect(centers[2]).toEqual(centers[0]);
    } else {
      expect(centers[0]![0]).toBeLessThan(centers[1]![0]); expect(centers[1]![0]).toBeLessThan(centers[2]![0]);
      expect(centers[0]![1]).toBeGreaterThan(centers[1]![1]); expect(centers[1]![1]).toBeGreaterThan(centers[2]![1]);
      if (values[0] === -Number.MAX_VALUE && values[2] === Number.MAX_VALUE) {
        // No finite domain can extend beyond these endpoints. Zero must be the
        // midpoint, independently of whatever private nice-domain helper is used.
        expect(centers[1]![0]).toBeCloseTo((centers[0]![0] + centers[2]![0]) / 2, 6);
        expect(centers[1]![1]).toBeCloseTo((centers[0]![1] + centers[2]![1]) / 2, 6);
      }
    }
    // No inferred endpoint, tick count, strict interior at MAX, or zero exclusion
    // is pinned. MUTATION: raw overflowing span or fixed 1e10 tick rounding.
  });

  it("keeps an extreme positive polygon size in the table even if its offsets collapse", () => {
    const points = series.map((entry, index) => ({ id: `extreme-size-${index}`, label: `Point ${index + 1}`,
      x: 20 + index * 15, y: 30 + index * 10, series: entry.id,
      size: index === 3 ? Number.MIN_VALUE : Number.MAX_VALUE }));
    const { container } = render(<ScatterChart {...props({ points, series, size: { label: "Mesure de surface" } })} />);
    expectFiniteFrameMarks(container, points);
    const tiny = mark(container, "extreme-size-3");
    expect(tiny.getAttribute("data-chart-marker")).toBe("triangle");
    expect(Number.isFinite(area(tiny))).toBe(true); expect(area(tiny)).toBeGreaterThanOrEqual(0);
    // Intentionally no positive-area assertion: finite center coordinates cannot
    // distinguish every positive length ratio. The exact authored size survives.
    tableRows(container).forEach((row, index) => {
      expect(row[1]).toBe(`n=${points[index]!.x}`); expect(row[2]).toBe(`n=${points[index]!.y}`);
      expect(row[3]).toBe(`n=${points[index]!.size}`);
    });
  });

  it("keeps finite endpoint glyphs inside the frame and tick labels within explicit bounds", () => {
    const input = props({
      x: { label: base.x.label, min: 3, max: 17 }, y: { label: base.y.label, min: -7, max: -1 },
      points: [
        { id: "p1", label: "Premier", x: 3, y: -7, labelSide: "end" },
        { id: "p2", label: "Deuxième", x: 10, y: -4 },
        { id: "p3", label: "Troisième", x: 17, y: -1, labelSide: "start" },
      ],
    });
    const { container } = render(<ScatterChart {...input} />);
    expectAuthoredPointMapping(container, input);
    expect(numberAttr(mark(container, "p1"), "cx")).toBeLessThan(numberAttr(mark(container, "p3"), "cx"));
    expect(numberAttr(mark(container, "p1"), "cy")).toBeGreaterThan(numberAttr(mark(container, "p3"), "cy"));
    for (const point of input.points) {
      const box = bounds(mark(container, point.id));
      expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(360);
      expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(300);
    }
    for (const [axis, min, max] of [["x", 3, 17], ["y", -7, -1]] as const) {
      const ticks = container.querySelectorAll(`[data-chart-part="${axis}-ticks"] text`);
      expect(ticks.length).toBeGreaterThan(0);
      for (const tick of ticks) {
        const value = Number(tick.textContent!.replace(/^n=/, ""));
        expect(value).toBeGreaterThanOrEqual(min); expect(value).toBeLessThanOrEqual(max);
      }
    }
  });

  it.each([
    { name: "one-line", xLabel: "X", yLabel: "Y", titleLines: 1 },
    { name: "multiline", xLabel: "W".repeat(32), yLabel: "W".repeat(32), titleLines: 2 },
  ])("maps exact authored boundary and quarter-domain centers with $name titles", ({ xLabel, yLabel, titleLines }) => {
    const input = props({
      width: 240, height: 300,
      x: { label: xLabel, min: 3, max: 17 },
      y: { label: yLabel, min: -7, max: -1 },
      points: [
        { id: "minimum", label: "A", x: 3, y: -7 },
        { id: "quarter", label: "B", x: 6.5, y: -5.5 },
        { id: "maximum", label: "C", x: 17, y: -1 },
      ],
    });
    const { container } = render(<ScatterChart {...input} />);
    const titles = [...container.querySelectorAll('svg[data-chart-part="frame"] text')].filter(text =>
      text.querySelector("tspan") && (text.textContent === xLabel || text.textContent === yLabel));
    expect(titles).toHaveLength(2);
    for (const title of titles) expect(title.querySelectorAll("tspan")).toHaveLength(titleLines);
    expectAuthoredPointMapping(container, input);
    // MUTATION: use the old fixed left coordinate for point centers, reverse
    // the y range, round fractional inputs, or use a nonlinear point scale.
    // Numeric nice y ticks here are interior to -7..-1; the oracle deliberately
    // extrapolates from their native grid coordinates rather than claiming
    // those first/last tick labels coincide with authored domain endpoints.
  });

  it.each([100, -100])("auto-fits a constant domain around %i without forcing zero or nonfinite geometry", value => {
    const { container } = render(<ScatterChart {...props({
      x: { label: base.x.label }, y: { label: base.y.label },
      points: base.points.map(point => ({ ...point, x: value, y: value })),
    })} />);
    for (const axis of ["x", "y"]) {
      const values = Array.from(container.querySelectorAll(`[data-chart-part="${axis}-ticks"] text`),
        tick => Number(tick.textContent!.replace(/^n=/, "")));
      expect(values.length).toBeGreaterThan(1);
      expect(Math.min(...values)).toBeLessThan(value); expect(Math.max(...values)).toBeGreaterThan(value);
      expect(values).not.toContain(0);
      expect(values.every(Number.isInteger)).toBe(true);
    }
    expect(container.querySelector("svg")!.outerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("uses auto nice bounds for clustered values instead of a zero baseline", () => {
    const { container } = render(<ScatterChart {...props({
      x: { label: base.x.label }, y: { label: base.y.label },
      points: base.points.map((point, index) => ({ ...point, x: 103 + index * 7, y: 203 + index * 7 })),
    })} />);
    for (const [axis, minimum, maximum] of [["x", 103, 117], ["y", 203, 217]] as const) {
      const values = Array.from(container.querySelectorAll(`[data-chart-part="${axis}-ticks"] text`),
        tick => Number(tick.textContent!.replace(/^n=/, "")));
      expect(values.length).toBeGreaterThan(1);
      expect(Math.min(...values)).toBeLessThanOrEqual(minimum);
      expect(Math.max(...values)).toBeGreaterThanOrEqual(maximum);
      expect(values).not.toContain(0);
      expect(values.every(Number.isInteger)).toBe(true);
    }
  });

  it("preserves authored adjacent-ULP bounds and maps their midpoint without rounding", () => {
    const low = 1, middle = 1 + Number.EPSILON, high = 1 + 2 * Number.EPSILON;
    const formatted = new Map<number, string>();
    const valueFormat = (value: number) => {
      if (!formatted.has(value)) formatted.set(value, `t${formatted.size}`);
      return formatted.get(value)!;
    };
    const values = [low, middle, high];
    const points = base.points.map((point, index) => ({ ...point, x: values[index]!, y: values[index]! }));
    const { container } = render(<ScatterChart {...props({ points, valueFormat,
      x: { label: "X", min: low, max: high }, y: { label: "Y", min: low, max: high } })} />);
    expectFiniteDistinctTicks(container, formatted);
    for (const [index, point] of points.entries()) {
      const circle = mark(container, point.id);
      expect(numberAttr(circle, "cx")).toBeCloseTo([60, 202, 344][index]!, 6);
      expect(numberAttr(circle, "cy")).toBeCloseTo([236, 134, 32][index]!, 6);
    }
    expect(tableRows(container)).toEqual(points.map(point => [point.label, valueFormat(point.x), valueFormat(point.y)]));
    // MUTATION: round observations/authored bounds along with generated nice ticks.
  });
});

describe("MC5 bounded input", () => {
  it.each([
    { min: Number.MAX_VALUE, max: undefined, value: Number.MAX_VALUE },
    { min: undefined, max: -Number.MAX_VALUE, value: -Number.MAX_VALUE },
  ])("rejects an impossible explicit half-bound without shifting it: %j", ({ min, max, value }) => {
    for (const axis of ["x", "y"] as const) {
      expect(() => ScatterChart(props({
        [axis]: { label: base[axis].label, ...(min === undefined ? { max: max! } : { min }) },
        points: base.points.map(point => ({ ...point, [axis]: value })),
      }))).toThrow();
    }
  });
  it.each([2, 13])("rejects %i points", count => {
    expect(() => ScatterChart(props({ points: Array.from({ length: count }, (_, index) =>
      ({ id: `p${index}`, label: `Point ${index}`, x: 20, y: 30 })) }))).toThrow();
  });
  it("accepts exactly twelve points", () => {
    expect(() => ScatterChart(props({ points: Array.from({ length: 12 }, (_, index) =>
      ({ id: `p${index}`, label: `Point ${index}`, x: 20, y: 30 })) }))).not.toThrow();
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite coordinates/sizes/bounds: %s", bad => {
    for (const field of ["x", "y"]) {
      expect(() => ScatterChart(props({ points: base.points.map((point, index) => index ? point : { ...point, [field]: bad }) }))).toThrow();
    }
    expect(() => ScatterChart(props({ size: { label: "Mesure de surface" }, points: base.points.map(point => ({ ...point, size: bad })) }))).toThrow();
    expect(() => ScatterChart(props({ x: { ...base.x, min: bad } }))).toThrow();
    expect(() => ScatterChart(props({ y: { ...base.y, max: bad } }))).toThrow();
  });
  it("rejects duplicate point/series ids and more than four series", () => {
    expect(() => ScatterChart(props({ points: base.points.map(point => ({ ...point, id: "same" })) }))).toThrow();
    expect(() => ScatterChart(props({ series: [series[0]!, series[0]!], points: base.points.map(point => ({ ...point, series: "alpha" })) }))).toThrow();
    expect(() => ScatterChart(props({ series: [...series, { id: "epsilon", name: "Ensemble E" }], points: base.points.map(point => ({ ...point, series: "alpha" })) }))).toThrow();
  });
  it("rejects unknown or incomplete series assignments", () => {
    expect(() => ScatterChart(props({ series, points: base.points.map(point => ({ ...point, series: "unknown" })) }))).toThrow();
    expect(() => ScatterChart(props({ series, points: base.points.map((point, index) => index ? { ...point, series: "alpha" } : point) }))).toThrow();
    expect(() => ScatterChart(props({ points: base.points.map(point => ({ ...point, series: "alpha" })) }))).toThrow();
  });
  it("rejects negative, missing, and unconfigured sizes", () => {
    expect(() => ScatterChart(props({ size: { label: "Mesure de surface" }, points: base.points.map(point => ({ ...point, size: -1 })) }))).toThrow();
    expect(() => ScatterChart(props({ size: { label: "Mesure de surface" }, points: base.points.map((point, index) => index ? { ...point, size: 1 } : point) }))).toThrow();
    expect(() => ScatterChart(props({ points: base.points.map(point => ({ ...point, size: 1 })) }))).toThrow();
  });
  it.each([{ min: 10, max: 10 }, { min: 10, max: 5 }, { min: 25, max: 100 }, { min: 0, max: 55 }])("rejects invalid/excluding explicit domains: %j", domain => {
    expect(() => ScatterChart(props({ x: { label: base.x.label, ...domain } }))).toThrow();
  });
});

describe("MC5 server export and source assumptions", () => {
  it("exports the same component from the server barrel", () => {
    expect(ServerScatterChart).toBe(ScatterChart);
  });
  it("resolves the real compiled component and server barrel under react-server", () => {
    // Relative paths assume this draft is admitted/copied under src/charts first.
    // Requires an admitted build; NEVER run this from the scratch draft location.
    const component = resolve(sourceDir, "../../dist/charts/ScatterChart.js");
    const barrel = resolve(sourceDir, "../../dist/charts/server.js");
    const script = `const a=await import(${JSON.stringify(component)}); const b=await import(${JSON.stringify(barrel)}); if(a.ScatterChart !== b.ScatterChart) throw new Error("missing exact server export"); const element=a.ScatterChart(${JSON.stringify(base)}); if(!element) throw new Error("missing static frame"); process.stdout.write("OK");`;
    expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 10_000 }).trim()).toBe("OK");
    // Root adds EXACTLY ScatterChart to render-environment.test.ts's current server pin;
    // preserve landed MC2–MC4 names and the charts/index.js negative control.
  });
  it("keeps palette/chrome token driven and introduces no new token declarations", () => {
    const source = readFileSync(resolve(sourceDir, "ScatterChart.tsx"), "utf8");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
    expect(source).not.toMatch(/--[a-z][\w-]*\s*:/i);
    expect(source).not.toMatch(/useState|useEffect|useLayoutEffect|useReducer/);
    // Repository source gates and mutation-backed compiled probe remain authoritative.
    // Root decides glyph-area reference constant; this draft pins ratios only.
  });
});


describe("Scatter boundary ticks and default label direction", () => {
  it("keeps complete formatter endpoints and deterministically thins overlapping interior x labels", () => {
    const { container } = render(<ScatterChart {...base} valueFormat={value => `${value} units`} />);
    const ticks = [...container.querySelectorAll('[data-chart-part="x-ticks"] text')];
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]?.textContent).toBe("0 units");
    expect(ticks[0]?.getAttribute("text-anchor")).toBe("start");
    expect(ticks.at(-1)?.textContent).toBe("100 units");
    expect(ticks.at(-1)?.getAttribute("text-anchor")).toBe("end");
    const yTicks = container.querySelectorAll('[data-chart-part="y-ticks"] text');
    expect(ticks.length).toBeLessThan(yTicks.length);
    const intervals = ticks.map(tick => {
      expect(tick.textContent).toMatch(/^\d+ units$/);
      expect(tick.textContent).toBe(`${Number(tick.textContent!.slice(0, -6))} units`);
      const width = [...tick.textContent!].length * 11, x = numberAttr(tick, "x");
      const anchor = tick.getAttribute("text-anchor");
      return anchor === "start" ? [x, x + width] : anchor === "end" ? [x - width, x] : [x - width / 2, x + width / 2];
    });
    for (let index = 1; index < intervals.length; index++) {
      expect(intervals[index]![0]).toBeGreaterThanOrEqual(intervals[index - 1]![1]!);
    }
    const repeat = render(<ScatterChart {...base} valueFormat={value => `${value} units`} />);
    expect(repeat.container.querySelector('[data-chart-part="x-ticks"]')!.outerHTML).toBe(
      container.querySelector('[data-chart-part="x-ticks"]')!.outerHTML,
    );
  });
  it("defaults labels inward on either plot half and retains an authored override", () => {
    const { container } = render(<ScatterChart {...base} points={[
      { id: "left", label: "Left", x: 10, y: 20 },
      { id: "right", label: "Right", x: 90, y: 50 },
      { id: "override", label: "Override", x: 50, y: 80, labelSide: "end" },
    ]} />);
    expect(pointGroup(container, "left").querySelector("text")?.getAttribute("text-anchor")).toBe("start");
    expect(pointGroup(container, "right").querySelector("text")?.getAttribute("text-anchor")).toBe("end");
    expect(pointGroup(container, "override").querySelector("text")?.getAttribute("text-anchor")).toBe("start");
  });
  it("retains distinct declared identity shapes when series names repeat", () => {
    const { container } = render(<ScatterChart {...base} series={[{ id: "a", name: "Repeated" }, { id: "b", name: "Repeated" }]}
      points={base.points.map((point, index) => ({ ...point, series: index === 1 ? "b" : "a" }))} />);
    const keys = [...container.querySelectorAll('[data-chart-part="legend"] li')];
    expect(keys).toHaveLength(2);
    expect(keys.map(key => key.textContent)).toEqual(["Repeated", "Repeated"]);
    expect(keys.map(key => key.querySelector("[data-chart-marker]")?.getAttribute("data-chart-marker"))).toEqual(["circle", "square"]);
  });
  it("checks native handlers and focus targets inside the sized caption wrapper", () => {
    const chart = ScatterChart({ ...base, size: { label: "Magnitude" }, points: base.points.map(point => ({ ...point, size: 1 })) });
    function findFrame(node: ReactNode): ReturnType<typeof ChartFrame> | null {
      if (Array.isArray(node)) return node.map(findFrame).find(Boolean) ?? null;
      if (!isValidElement<{ children?: ReactNode }>(node)) return null;
      return node.type === ChartFrame ? node as unknown as ReturnType<typeof ChartFrame> : findFrame(node.props.children);
    }
    const frame = findFrame(chart);
    expect(frame).not.toBeNull();
    const renderer = (frame!.props as unknown as { children: (plot: { x: number; y: number; width: number; height: number }) => ReactNode }).children;
    for (const native of nativeProps(renderer({ x: 48, y: 16, width: 296, height: 252 }))) {
      expect(native).not.toHaveProperty("tabIndex");
      expect(Object.entries(native).filter(([key, value]) => /^on[A-Z]/.test(key) && value !== undefined)).toEqual([]);
    }
  });
});


describe("Scatter complete authored label bounds", () => {
  it("rejects a wide y formatter that consumes the plot in a 240 by 240 frame", () => {
    expect(() => ScatterChart({ ...base, width: 240, height: 240,
      valueFormat: value => `${"W".repeat(17)}${value}` })).toThrow(/tick.*plot|dimensions/i);
    // Invoke only the hook-free chart: an x-layout rejection during rendering must
    // not mask a failed y-margin check when the seven-unit mutation is applied.
    // MUTATION: reduce the y tick width budget back to seven units per grapheme.
  });
  it("rejects an authored outward start label at the left plot boundary", () => {
    expect(() => renderToStaticMarkup(<ScatterChart {...base} points={[
      { id: "edge", label: "A", x: 0, y: 50, labelSide: "start" },
      { id: "middle", label: "B", x: 50, y: 50 },
      { id: "right", label: "C", x: 100, y: 50 },
    ]} />)).toThrow(/authored label side|complete text|space/i);
    // MUTATION: measure start-room against the whole frame instead of plot.x.
  });
  it.each([
    { labelSide: "start" as const, x: 8 },
    { labelSide: "end" as const, x: 92 },
  ])("includes the full six-unit gap for an authored $labelSide label near its plot edge", ({ labelSide, x }) => {
    // With base's n= formatter, the longest y tick is n=100 (five
    // graphemes), so the source draft's native plot is x91..344: width 253.
    // Either edge point is 0.08 * 253 = 20.24 units inward. The unsized circle
    // radius is 8 / sqrt(pi) ~= 4.513517; the one-grapheme label budget is 11.
    // Four-unit clearance falsely accepts 20.24 - 4.513517 - 4 ~= 11.726483.
    // Six-unit clearance has only 9.726483 units, and must reject rather
    // than render the full label 1.273517 units beyond the plot boundary.
    expect(() => renderToStaticMarkup(<ScatterChart {...base} points={[
      { id: "edge", label: "A", x, y: 50, labelSide },
      { id: "middle", label: "B", x: 50, y: 30 },
      { id: "other", label: "C", x: 60, y: 70 },
    ]} />)).toThrow(/authored label side|complete text|space/i);
    // Rendering evaluates ChartFrame's callback; ScatterChart(props) alone
    // would not exercise its per-point label-space guard.
    // MUTATION: reduce either horizontal room allowance from 6 back to 4.
  });
  it("rejects full String labels when the two displayed extreme x ticks cannot both fit", () => {
    expect(() => renderToStaticMarkup(<ScatterChart {...base} width={240} x={{ label: base.x.label }}
      valueFormat={String} points={[
        { id: "low", label: "A", x: -Number.MAX_VALUE, y: 30 },
        { id: "middle", label: "B", x: 0, y: 50 },
        { id: "high", label: "C", x: Number.MAX_VALUE, y: 70 },
      ]} />)).toThrow(/tick|overlap|layout/i);
    // Keep y ordinary so this case exercises x endpoint layout, not y margin refusal.
    // MUTATION: accept overlapping endpoint labels or truncate formatter output.
  });
  it("uses an above label when a twenty-grapheme name cannot fit either horizontal side", () => {
    const { container } = render(<ScatterChart {...base} points={base.points.map((point, index) => ({ ...point, label: index === 1 ? "W".repeat(20) : point.label, x: index === 1 ? 50 : point.x }))} />);
    const label = pointGroup(container, "p2").querySelector("text")!;
    expect(label.textContent).toBe("W".repeat(20));
    expect(label.getAttribute("text-anchor")).toBe("middle");
    expect(numberAttr(label, "y")).toBeLessThan(bounds(mark(container, "p2")).top);
  });
  it("retains all graphemes in a thirty-two-grapheme vertical title", () => {
    const title = "W".repeat(32);
    const { container } = render(<ScatterChart {...base} y={{ ...base.y, label: title }} />);
    const text = [...container.querySelectorAll('svg[data-chart-part="frame"] text')].find(node => node.textContent === title)!;
    expect([...text.querySelectorAll("tspan")].map(node => node.textContent)).toEqual(["W".repeat(16), "W".repeat(16)]);
  });
  it("rejects point and axis copy beyond the authored catalog limits", () => {
    expect(() => ScatterChart({ ...base, points: base.points.map((point, index) => index ? point : { ...point, label: "W".repeat(21) }) })).toThrow(/label|grapheme/i);
    expect(() => ScatterChart({ ...base, x: { ...base.x, label: "W".repeat(33) } })).toThrow(/title|grapheme/i);
    expect(() => ScatterChart({ ...base, y: { ...base.y, label: "W".repeat(33) } })).toThrow(/title|grapheme/i);
  });
});

describe("MC5 optional frame legend marks", () => {
  const shapes = ["circle", "square", "diamond", "triangle"] as const;
  const frame = { title: "Authored legend", table: { headers: ["Observation"], rows: [["A"]] } };
  const color = (slot: number) => assignCategoricalColor(slot - 1);

  it("keeps mixed legend identities distinct through reorder, removal, and restoration", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ordinary = { label: "1:Series B", color: color(1) };
    const shaped = { label: "Series B", color: color(2), mark: "diamond" as const };
    const last = { label: "Plain", color: color(3) };
    try {
      const chart = render(<ChartFrame {...frame} legend={[ordinary, shaped, last]}>{() => null}</ChartFrame>);
      const check = (names: string[], mark: string) => {
        const entries = [...chart.container.querySelectorAll('[data-chart-part="legend"] li')];
        expect(entries.map(entry => entry.textContent)).toEqual(names);
        expect(chart.container.querySelectorAll('[data-chart-part="legend"] svg')).toHaveLength(1);
        expect(chart.container.querySelector('[data-chart-part="legend"] [data-chart-marker]')!.getAttribute("data-chart-marker")).toBe(mark);
      };
      check([ordinary.label, shaped.label, last.label], "diamond");
      const revised = { ...shaped, mark: "triangle" as const };
      chart.rerender(<ChartFrame {...frame} legend={[revised, ordinary, last]}>{() => null}</ChartFrame>);
      check([shaped.label, ordinary.label, last.label], "triangle");
      chart.rerender(<ChartFrame {...frame} legend={[revised, last]}>{() => null}</ChartFrame>);
      check([shaped.label, last.label], "triangle");
      chart.rerender(<ChartFrame {...frame} legend={[ordinary, revised, last]}>{() => null}</ChartFrame>);
      check([ordinary.label, shaped.label, last.label], "triangle");
      expect(errors.mock.calls.filter(call => /same key|unique.*key/i.test(call.map(String).join(" ")))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it("uses all four distinct unclipped native shapes with equal positive filled area in legend keys", () => {
    const legend = shapes.map((mark, index) => ({ label: series[index]!.name, color: color(index + 1), mark }));
    const { container } = render(<ChartFrame {...frame} legend={legend}>{() => null}</ChartFrame>);
    const keys = [...container.querySelectorAll('[data-chart-part="legend"] li')];
    expect(keys).toHaveLength(4);
    const markers = keys.map((key, index) => {
      expect(key.textContent).toBe(legend[index]!.label);
      expect(key.getAttribute("class")).toBe("inline-flex items-center gap-xs");
      expect(key.querySelector("span")).toBeNull();
      const svg = key.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("viewBox")).toBe("0 0 12 12");
      expect(numberAttr(svg, "width")).toBe(12); expect(numberAttr(svg, "height")).toBe(12);
      expect(svg.hasAttribute("tabindex")).toBe(false);
      expect(svg.querySelectorAll("[tabindex],a,button,foreignObject")).toHaveLength(0);
      const marker = svg.querySelector<SVGElement>("[data-chart-marker]")!;
      expect(marker).not.toBeNull();
      expect(svg.querySelectorAll("[data-chart-marker]")).toHaveLength(1);
      expect(marker.getAttribute("data-chart-marker")).toBe(shapes[index]);
      expect(marker.getAttribute("fill")).toBe(legend[index]!.color);
      expect(marker.hasAttribute("stroke")).toBe(false);
      expect(marker.hasAttribute("stroke-width")).toBe(false);
      const box = bounds(marker);
      expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(12);
      expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(12);
      return marker;
    });
    expect(markers.map(marker => marker.tagName.toLowerCase())).toEqual(["circle", "path", "path", "path"]);

    const square = vertices(markers[1]!), squareBox = bounds(markers[1]!);
    expect(square).toHaveLength(4);
    expect(new Set(square.map(([x, y]) => `${x},${y}`)).size).toBe(4);
    expect(squareBox.right - squareBox.left).toBeCloseTo(squareBox.bottom - squareBox.top, 6);
    for (const [x, y] of square) {
      expect([squareBox.left, squareBox.right].some(edge => Math.abs(edge - x) < 1e-6)).toBe(true);
      expect([squareBox.top, squareBox.bottom].some(edge => Math.abs(edge - y) < 1e-6)).toBe(true);
    }
    const diamond = vertices(markers[2]!), diamondBox = bounds(markers[2]!);
    expect(diamond).toHaveLength(4);
    expect(new Set(diamond.map(([x, y]) => `${x},${y}`)).size).toBe(4);
    const midX = (diamondBox.left + diamondBox.right) / 2, midY = (diamondBox.top + diamondBox.bottom) / 2;
    expect(diamondBox.right - diamondBox.left).toBeCloseTo(diamondBox.bottom - diamondBox.top, 6);
    for (const [x, y] of [[midX, diamondBox.top], [diamondBox.right, midY], [midX, diamondBox.bottom], [diamondBox.left, midY]]) {
      expect(diamond.some(([actualX, actualY]) => Math.abs(actualX - x!) < 1e-6 && Math.abs(actualY - y!) < 1e-6)).toBe(true);
    }
    const triangle = vertices(markers[3]!);
    expect(triangle).toHaveLength(3);
    const edges = triangle.map(([x, y], index) => {
      const [nextX, nextY] = triangle[(index + 1) % triangle.length]!;
      return Math.hypot(nextX - x, nextY - y);
    });
    expect(edges[0]).toBeGreaterThan(0);
    expect(edges[1]).toBeCloseTo(edges[0]!, 6); expect(edges[2]).toBeCloseTo(edges[0]!, 6);
    const areas = markers.map(area);
    expect(areas.every(value => Number.isFinite(value) && value > 0)).toBe(true);
    for (const measured of areas.slice(1)) expect(measured / areas[0]!).toBeCloseTo(1, 6);
    // No absolute area pin: the root chooses the readable key scale.
    // MUTATION: reuse a bounding radius across shapes, substitute one contour,
    // add a perimeter, or scale the triangle until its native bounds clip.
  });

  it("keeps mixed unmarked and explicitly undefined keys identical to the ordinary branch", () => {
    const first = { label: "Ordinary", color: color(1) };
    const shaped = { label: "Shaped", color: color(2), mark: "diamond" as const };
    const last = { label: "Explicit omission", color: color(3), mark: undefined };
    const ordinary = render(<ChartFrame {...frame} legend={[first, last]}>{() => null}</ChartFrame>);
    const expected = [...ordinary.container.querySelectorAll('[data-chart-part="legend"] li')].map(key => key.outerHTML);
    ordinary.unmount();
    const { container } = render(<ChartFrame {...frame} legend={[first, shaped, last]}>{() => null}</ChartFrame>);
    const keys = [...container.querySelectorAll('[data-chart-part="legend"] li')];
    expect(keys.map(key => key.textContent)).toEqual([first.label, shaped.label, last.label]);
    expect(keys[0]!.outerHTML).toBe(expected[0]); expect(keys[2]!.outerHTML).toBe(expected[1]);
    for (const index of [0, 2]) {
      expect(keys[index]!.querySelector("svg")).toBeNull();
      const swatch = keys[index]!.querySelector("span")!;
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
      expect(swatch.getAttribute("class")).toBe("inline-block h-3 w-3 rounded-subtle");
      expect(swatch.style.backgroundColor).toBe(index === 0 ? first.color : last.color);
    }
    expect(keys[1]!.querySelector("span")).toBeNull();
    expect(keys[1]!.querySelector('[data-chart-marker="diamond"]')!.getAttribute("fill")).toBe(shaped.color);
    // This compares the current ordinary branch with mixed-entry rendering.
    // Exact parent byte identity is a separate standalone golden assertion;
    // no scratch artifact path enters the repository test.
  });

  it.each([false, true].flatMap(marked => [false, true].flatMap(optIn => [0, 1, 2].map(count => ({ marked, optIn, count })))))
    ("preserves legend visibility with marked=$marked optIn=$optIn count=$count", ({ marked, optIn, count }) => {
      const legend = series.slice(0, count).map((entry, index) => ({ label: entry.name, color: color(index + 1), ...(marked ? { mark: shapes[index]! } : {}) }));
      const { container } = render(<ChartFrame {...frame} legend={legend} showSingleSeriesLegend={optIn}>{() => null}</ChartFrame>);
      const visible = count >= (optIn ? 1 : 2), node = container.querySelector('[data-chart-part="legend"]');
      if (!visible) {
        expect(node).toBeNull();
      } else {
        expect(node).not.toBeNull();
        const keys = [...node!.querySelectorAll("li")];
        expect(keys.map(key => key.textContent)).toEqual(legend.map(item => item.label));
        expect(node!.querySelectorAll("svg")).toHaveLength(marked ? count : 0);
        expect(node!.querySelectorAll("span")).toHaveLength(marked ? 0 : count);
      }
    });
});
