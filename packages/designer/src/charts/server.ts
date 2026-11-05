/**
 * @clossys/designer/charts/server — the server-safe subset of
 * `@clossys/designer/charts`. See `components/server.ts`'s own header for the
 * full #375 rationale this file shares: `charts/index.ts` re-exports
 * every member eagerly from one module, so `LineChart` — which holds
 * its own hover state via `useState`, touching no third-party library —
 * drags the whole barrel down under React's
 * `react-server` condition even though `ChartFrame`, `BarChart`, `WaterfallChart`, `RangeChart`, `ScatterChart`, and `Sparkline`
 * resolve cleanly on their own.
 *
 * MEMBERSHIP IS EMPIRICAL — confirmed by resolving each member's own
 * compiled file (`dist/charts/<Name>.js`, or `LineChart.server.js` for
 * the static line implementation, never the barrel) under
 * `node --conditions=react-server`. See `src/render-environment.ts` for
 * the recorded verdict and `render-environment.test.ts` for the negative
 * control proving `charts/index.ts` still fails the identical probe.
 *
 * ADDITIVE ONLY: every name below already ships from `charts/index.ts`.
 * No wildcard subpath, no per-file deep export — see `components/server.ts`'s
 * header for why.
 */

import { version as reactVersion } from "react";
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/** `react` guard only — `charts` never depends on `react-aria-components` at all, guarded or not (see `charts/index.ts`'s own header). */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { ChartFrame } from "./ChartFrame.js";
export type { ChartFrameProps, ChartMargin, ChartAxisTick, ChartLegendItem, ChartTableSpec, PlotArea } from "./ChartFrame.js";

export { BarChart } from "./BarChart.js";
export type { BarChartProps, BarChartSeries } from "./BarChart.js";

export { LineChart } from "./LineChart.server.js";
export type { LineChartProps, LineChartSeries } from "./LineChart.js";

export { WaterfallChart } from "./WaterfallChart.js";
export type { WaterfallChartProps } from "./WaterfallChart.js";

export { Sparkline } from "./Sparkline.js";
export type { SparklineProps } from "./Sparkline.js";

export { RangeChart } from "./RangeChart.js";
export type { RangeChartProps } from "./RangeChart.js";

export { ScatterChart } from "./ScatterChart.js";
export type { ScatterChartProps } from "./ScatterChart.js";

export { AreaChart } from "./AreaChart.server.js";
export type { AreaChartProps, AreaChartSeries } from "./AreaChart.js";
export { Heatmap } from "./Heatmap.server.js";
export type { HeatmapProps } from "./Heatmap.js";
export { StatusStrip } from "./StatusStrip.server.js";
export type { StatusStripProps, StatusStripSegment } from "./StatusStrip.js";

export type { SignatureChartLabels } from "./internal/signature-types.js";
