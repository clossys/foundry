import { linearScale } from "./scale.js";
import { MAX_CATEGORICAL_SERIES } from "./chart-vars.js";
import type { AreaChartProps } from "./signature-types.js";
import type { PlotArea } from "../ChartFrame.js";

export function datumLabel(value: string | number | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function coordinate(value: number | Date): number {
  const result = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(result))
    throw new TypeError("Chart interval coordinates must be finite.");
  return result;
}

export function assertSize(width: number, height: number): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 64 ||
    height <= 48
  ) {
    throw new RangeError(
      "Chart width and height must leave a positive plot rectangle.",
    );
  }
}

export function areaGeometry(props: AreaChartProps, plot: PlotArea) {
  const {
    x,
    series,
    normalized = false,
    stacked = false,
    hiddenSeries = [],
  } = props;
  if (series.length > MAX_CATEGORICAL_SERIES)
    throw new RangeError(
      "AreaChart supports at most eight series; facet larger sets.",
    );
  if (
    new Set(series.map((item) => item.name)).size !== series.length ||
    series.some((item) => !item.name.trim())
  )
    throw new TypeError("AreaChart requires unique nonempty series names.");
  const category = typeof x[0] === "string";
  const dates = x[0] instanceof Date;
  if (
    x.some((value) =>
      category
        ? typeof value !== "string"
        : dates
          ? !(value instanceof Date)
          : typeof value !== "number",
    )
  )
    throw new TypeError(
      "AreaChart x values must share one category or time/numeric domain.",
    );
  const positions = category
    ? x.map((_, index) => index)
    : x.map((value) => coordinate(value as number | Date));
  if (
    !category &&
    positions.some(
      (value, index) => index > 0 && value <= positions[index - 1]!,
    )
  )
    throw new RangeError(
      "AreaChart continuous x values must increase strictly.",
    );
  for (const item of series) {
    if (item.values.length !== x.length)
      throw new RangeError("AreaChart series must have one value for every x.");
    if (
      item.values.some(
        (value) =>
          value !== null &&
          (!Number.isFinite(value) || ((stacked || normalized) && value < 0)),
      )
    )
      throw new RangeError(
        "AreaChart values must be finite; stacked values must be nonnegative.",
      );
  }
  const visible = series
    .map((item, index) => ({ ...item, index }))
    .filter((item) => !hiddenSeries.includes(item.name));
  const totals = x.map((_, index) =>
    visible.reduce((total, item) => total + (item.values[index] ?? 0), 0),
  );
  const bases = x.map(() => 0);
  const layers = visible.map((item) => ({
    ...item,
    points: item.values.map((value, index) => {
      if (value === null) return null;
      const amount = normalized
        ? totals[index] === 0
          ? 0
          : (value / totals[index]!) * 100
        : value;
      const bottom = stacked || normalized ? bases[index]! : 0;
      const top = bottom + amount;
      if (stacked || normalized) bases[index] = top;
      return { bottom, top, index };
    }),
  }));
  const values = layers.flatMap((layer) =>
    layer.points.flatMap((point) => (point ? [point.bottom, point.top] : [])),
  );
  const min = values.reduce((result, value) => Math.min(result, value), 0);
  const max = normalized
    ? 100
    : values.reduce((result, value) => Math.max(result, value), 0);
  const y = linearScale(
    [min, max === min ? min + 1 : max],
    [plot.y + plot.height, plot.y],
  );
  const scaleX = linearScale(
    [positions[0] ?? 0, positions.at(-1) ?? 1],
    [plot.x, plot.x + plot.width],
  );
  const px = positions.map((value) =>
    positions.length === 1 ? plot.x + plot.width / 2 : scaleX(value),
  );
  return { layers, px, y, min, max: max === min ? min + 1 : max };
}

type Point = { x: number; y: number };
function trace(points: readonly Point[], smooth: boolean): string {
  return points
    .map((point, index) => {
      if (index === 0) return `M${point.x},${point.y}`;
      const previous = points[index - 1]!;
      if (!smooth) return `L${point.x},${point.y}`;
      const distance = (point.x - previous.x) / 3;
      return `C${previous.x + distance},${previous.y} ${point.x - distance},${point.y} ${point.x},${point.y}`;
    })
    .join(" ");
}

export function areaPaths(
  points: ReturnType<typeof areaGeometry>["layers"][number]["points"],
  px: readonly number[],
  y: (value: number) => number,
  smooth: boolean,
): string[] {
  const runs: Array<Array<NonNullable<(typeof points)[number]>>> = [];
  let run: Array<NonNullable<(typeof points)[number]>> = [];
  for (const point of points) {
    if (point) run.push(point);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.map((items) => {
    const top = items.map((point) => ({
      x: px[point.index]!,
      y: y(point.top),
    }));
    const bottom = [...items]
      .reverse()
      .map((point) => ({ x: px[point.index]!, y: y(point.bottom) }));
    return `${trace(top, smooth)} ${trace(bottom, smooth).replace(/^M/, "L")} Z`;
  });
}
