import type { LineChartProps } from "../LineChart.js";
import type { PlotArea } from "../ChartFrame.js";
import { MAX_CATEGORICAL_SERIES, resolveSeriesColor } from "./chart-vars.js";
import { linearScale, niceTicks, timeScale, type LinearScale, type TimeScale } from "./scale.js";

export const defaultLineXFormat = (value: Date | number): string =>
  value instanceof Date ? value.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(value);

export function createLineData({ x, series, colorDomain }: Pick<LineChartProps, "x" | "series" | "colorDomain">) {
  const visibleSeries = series.slice(0, MAX_CATEGORICAL_SERIES);
  const allValues = visibleSeries.flatMap(s => s.values);
  const domainMin = Math.min(0, ...allValues);
  const domainMax = Math.max(0, ...allValues, 1);
  const yTicks = niceTicks(domainMin, domainMax);
  const isTime = x.length > 0 && x[0] instanceof Date;
  const legend = visibleSeries.map((s, i) => ({ label: s.name, color: resolveSeriesColor(s.name, i, colorDomain, s.color) }));
  const showDirectLabels = visibleSeries.length >= 2 && visibleSeries.length <= 4;
  return { visibleSeries, domainMin, domainMax, yTicks, isTime, legend, showDirectLabels };
}

export function createLinePlot(x: LineChartProps["x"], data: ReturnType<typeof createLineData>, plot: PlotArea) {
  const y = linearScale([data.domainMin, data.domainMax], [plot.y + plot.height, plot.y]);
  const xScale = data.isTime
    ? timeScale([x[0] as Date, x[x.length - 1] as Date], [plot.x, plot.x + plot.width])
    : linearScale([x[0] as number, x[x.length - 1] as number], [plot.x, plot.x + plot.width]);
  const xTickValues = x.length <= 6 ? x : [x[0]!, x[Math.floor((x.length - 1) / 2)]!, x[x.length - 1]!];
  return { y, xScale, xTickValues };
}

export function createLineMark(x: LineChartProps["x"], values: readonly number[], xScale: LinearScale | TimeScale, y: LinearScale) {
  const points = x.map((xv, i) => [xScale(xv as never), y(values[i] ?? 0)] as const);
  const d = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join(" ");
  const last = points[points.length - 1];
  return { points, d, last };
}
