import { WaterfallChart, type WaterfallChartProps } from "../WaterfallChart.js";
import type { WaterfallChart as ChartEntry, WaterfallChartProps as ChartProps } from "../index.js";
import type { WaterfallChart as ServerEntry, WaterfallChartProps as ServerProps } from "../server.js";
import type { WaterfallChart as RootEntry, WaterfallChartProps as RootProps } from "../../index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type PreservedWaterfallExports = [
  Assert<Equal<WaterfallChartProps, ChartProps>>,
  Assert<Equal<WaterfallChartProps, ServerProps>>,
  Assert<Equal<WaterfallChartProps, RootProps>>,
  Assert<Equal<typeof WaterfallChart, typeof ChartEntry>>,
  Assert<Equal<typeof WaterfallChart, typeof ServerEntry>>,
  Assert<Equal<typeof WaterfallChart, typeof RootEntry>>,
];
type RequiredShape<T, K extends keyof T> = Equal<Pick<T, K>, Required<Pick<T, K>>>;
export type RequiredWaterfallStages = [
  Assert<RequiredShape<WaterfallChartProps, "start" | "steps" | "end" | "labels">>,
  Assert<RequiredShape<WaterfallChartProps["start"], "label" | "value">>,
  Assert<RequiredShape<WaterfallChartProps["steps"][number], "id" | "label" | "value">>,
  Assert<RequiredShape<WaterfallChartProps["end"], "label">>,
];

const sample = {
  title: "Measured change",
  start: { label: "Opening", value: 0 },
  steps: [],
  end: { label: "Closing" },
  labels: { table: "Measurements", category: "Stage", value: "Change" },
} satisfies WaterfallChartProps;
export const validEmptySteps = <WaterfallChart {...sample} />;
export const validZeroStep = <WaterfallChart {...sample} steps={[{ id: "zero", label: "Unchanged", value: 0 }]} />;
export const validAssertedEnd = <WaterfallChart {...sample} end={{ label: "Closing", value: 0 }} />;

const { labels: omittedLabels, ...withoutLabels } = sample;
void omittedLabels;
// @ts-expect-error all authored table/category/value labels are required.
export const missingLabels = <WaterfallChart {...withoutLabels} />;
// @ts-expect-error the native table disclosure needs an authored label.
export const missingTableLabel = <WaterfallChart {...sample} labels={{ category: "Stage", value: "Change" }} />;
// @ts-expect-error the category column needs an authored label.
export const missingCategoryLabel = <WaterfallChart {...sample} labels={{ table: "Measurements", value: "Change" }} />;
// @ts-expect-error the value column needs an authored label.
export const missingValueLabel = <WaterfallChart {...sample} labels={{ table: "Measurements", category: "Stage" }} />;
// @ts-expect-error step changes are numbers, not formatted strings.
export const formattedStepValue = <WaterfallChart {...sample} steps={[{ id: "one", label: "Change", value: "1" }]} />;
// @ts-expect-error opening stage identity is visible authored text.
export const missingOpeningLabel = <WaterfallChart {...sample} start={{ value: 0 }} />;
// @ts-expect-error every intermediate stage needs a readable name.
export const missingStepLabel = <WaterfallChart {...sample} steps={[{ id: "one", value: 0 }]} />;
// @ts-expect-error the derived closing stage still needs an authored label.
export const missingClosingLabel = <WaterfallChart {...sample} end={{ value: 0 }} />;
