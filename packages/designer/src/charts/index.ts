/**
 * @vespeneventures/designer/charts — dependency-free SVG chart primitives. This
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
 * this package's token-layer chart-color family (`internal/chart-vars.ts`)
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

import { version as reactVersion } from "react";
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` is one of this package's optional peers — see `atoms/index.ts`'s
 * own, longer version of this comment for the full #182 rationale. Charts
 * do not use `react-aria-components` at all (no charting library
 * dependency, per this file's own header above), so this barrel only
 * needs the `react` guard, independent of `atoms/index.ts`'s: a consumer
 * who imports only `@vespeneventures/designer/charts` would otherwise get no
 * signal at all.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { ChartFrame } from "./ChartFrame.js";
export type { ChartFrameProps, ChartMargin, ChartAxisTick, ChartLegendItem, ChartTableSpec, PlotArea } from "./ChartFrame.js";

export { BarChart } from "./BarChart.js";
export type { BarChartProps, BarChartSeries } from "./BarChart.js";

export { LineChart } from "./LineChart.js";
export type { LineChartProps, LineChartSeries } from "./LineChart.js";

export { Sparkline } from "./Sparkline.js";
export type { SparklineProps } from "./Sparkline.js";
