/**
 * @vespeneventures/ui/charts — dependency-free SVG chart primitives. This
 * is a SIBLING layer to `atoms → blocks → views`, not another rung of that
 * composition ladder (the same way `shell` sits beside `views` rather than
 * above it — see this package's README, "Placement rules"): charts are a
 * distinct domain with their own primitives (marks, scales, a plot
 * coordinate space), not UI built by composing buttons and fields. `charts`
 * may import from `atoms` (its color-var and `cx` helpers); nothing in
 * `atoms`, `blocks`, `views`, or `shell` imports from `charts` — see
 * `src/ladder.test.ts`.
 *
 * No charting library is a dependency here — every mark is a hand-drawn
 * SVG primitive, positioned by this package's own small scale helpers
 * (`internal/scale.ts`), reading color exclusively through
 * `@vespeneventures/tokens`' chart-color family (`internal/chart-vars.ts`)
 * so every chart follows the active theme.
 *
 * `ChartFrame` is the shared container (plot area, axes, grid, legend
 * slot, accessible title/description, table-view fallback) that
 * `BarChart` and `LineChart` both compose; `Sparkline` is the one
 * exception (see its own doc comment for why it doesn't use `ChartFrame`).
 *
 * The scale helpers and color-slot assignment (`internal/scale.ts`,
 * `internal/chart-vars.ts`) are deliberately NOT exported here, the same
 * way `atoms/internal/cx.ts` and `atoms/internal/ui-vars.ts` never appear
 * in `atoms/index.ts` — this layer ships four components, not a general
 * numerical/color library.
 */

export { ChartFrame } from "./ChartFrame.js";
export type { ChartFrameProps, ChartMargin, ChartAxisTick, ChartLegendItem, ChartTableSpec, PlotArea } from "./ChartFrame.js";

export { BarChart } from "./BarChart.js";
export type { BarChartProps, BarChartSeries } from "./BarChart.js";

export { LineChart } from "./LineChart.js";
export type { LineChartProps, LineChartSeries } from "./LineChart.js";

export { Sparkline } from "./Sparkline.js";
export type { SparklineProps } from "./Sparkline.js";
