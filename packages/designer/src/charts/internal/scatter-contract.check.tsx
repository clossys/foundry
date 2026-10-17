import { ScatterChart, type ScatterChartProps } from "../ScatterChart.js";
import { ChartFrame, type ChartFrameProps, type ChartLegendItem } from "../ChartFrame.js";
import type { ScatterChart as ChartEntry, ScatterChartProps as ChartProps } from "../index.js";
import type { ScatterChart as ServerEntry, ScatterChartProps as ServerProps } from "../server.js";
import type { ScatterChart as RootEntry, ScatterChartProps as RootProps } from "../../index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type RequiredShape<T, K extends keyof T> = Equal<Pick<T, K>, Required<Pick<T, K>>>;
export type PreservedScatterExports = [
  Assert<Equal<ScatterChartProps, ChartProps>>,
  Assert<Equal<ScatterChartProps, ServerProps>>,
  Assert<Equal<ScatterChartProps, RootProps>>,
  Assert<Equal<typeof ScatterChart, typeof ChartEntry>>,
  Assert<Equal<typeof ScatterChart, typeof ServerEntry>>,
  Assert<Equal<typeof ScatterChart, typeof RootEntry>>,
];
export type RequiredScatterInput = [
  Assert<RequiredShape<ScatterChartProps, "title" | "points" | "x" | "y" | "labels">>,
  Assert<RequiredShape<ScatterChartProps["points"][number], "id" | "label" | "x" | "y">>,
  Assert<RequiredShape<ScatterChartProps["x"], "label">>,
  Assert<RequiredShape<ScatterChartProps["y"], "label">>,
  Assert<RequiredShape<ScatterChartProps["labels"], "table" | "category">>,
  Assert<Equal<ChartLegendItem["mark"], "circle" | "square" | "diamond" | "triangle" | undefined>>,
];

const points = [
  { id: "a", label: "Observation A", x: 0, y: -2, labelSide: "start" },
  { id: "b", label: "Observation B", x: 2, y: 0, labelSide: "above" },
  { id: "c", label: "Observation C", x: 4, y: 2, labelSide: "below" },
] as const;
const sample = {
  title: "Measured observations", points,
  x: { label: "Input" }, y: { label: "Outcome" },
  labels: { table: "Measurements", category: "Observation" },
} satisfies ScatterChartProps;
export const validReadonlyPoints = <ScatterChart {...sample} />;
const series = [{ id: "one", name: "Series one" }] as const;
const sizedPoints = [
  { ...points[0], series: "one", size: 0 },
  { ...points[1], series: "one", size: 1 },
  { ...points[2], series: "one", size: 4, labelSide: "end" },
] as const;
export const validReadonlySizedSeries = <ScatterChart {...sample} points={sizedPoints}
  series={series} size={{ label: "Magnitude" }} x={{ label: "Input", min: -1, max: 5 }} />;

const { labels: omittedLabels, x: omittedX, y: omittedY, ...withoutLabelsOrAxes } = sample;
void omittedLabels; void omittedX; void omittedY;
// @ts-expect-error table and category labels must be authored.
export const missingLabels = <ScatterChart {...withoutLabelsOrAxes} x={sample.x} y={sample.y} />;
// @ts-expect-error the native table disclosure needs an authored label.
export const missingTableLabel = <ScatterChart {...sample} labels={{ category: "Observation" }} />;
// @ts-expect-error the observation column needs an authored label.
export const missingCategoryLabel = <ScatterChart {...sample} labels={{ table: "Measurements" }} />;
// @ts-expect-error the horizontal axis definition is required.
export const missingXAxis = <ScatterChart {...withoutLabelsOrAxes} labels={sample.labels} y={sample.y} />;
// @ts-expect-error the vertical axis definition is required.
export const missingYAxis = <ScatterChart {...withoutLabelsOrAxes} labels={sample.labels} x={sample.x} />;
// @ts-expect-error horizontal axis identity cannot be omitted.
export const missingXAxisLabel = <ScatterChart {...sample} x={{ min: 0, max: 4 }} />;
// @ts-expect-error vertical axis identity cannot be omitted.
export const missingYAxisLabel = <ScatterChart {...sample} y={{ min: -2, max: 2 }} />;
// @ts-expect-error point coordinates are numeric observations, not formatted text.
export const formattedPoint = <ScatterChart {...sample} points={[{ ...points[0], x: "0" }]} />;
// @ts-expect-error point label placement uses the four supported logical sides.
export const unsupportedLabelSide = <ScatterChart {...sample} points={[{ ...points[0], labelSide: "left" }]} />;

const legacyLegend = { label: "Series one", color: "currentColor" } satisfies ChartLegendItem;
const legacyFrame = { title: "Legacy chart", table: { headers: ["Value"], rows: [[0]] }, children: () => null } satisfies ChartFrameProps;
export const validFrameWithoutLegend = <ChartFrame {...legacyFrame} />;
export const validLegendWithoutMark = <ChartFrame {...legacyFrame} legend={[legacyLegend]} />;
export const validLegendShapes = <ChartFrame {...legacyFrame} legend={[
  { ...legacyLegend, mark: "circle" }, { ...legacyLegend, mark: "square" },
  { ...legacyLegend, mark: "diamond" }, { ...legacyLegend, mark: "triangle" },
]} />;
// @ts-expect-error the additive legend mark vocabulary has exactly four shapes.
export const unsupportedLegendShape: ChartLegendItem = { ...legacyLegend, mark: "star" };
