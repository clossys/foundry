/**
 * @clossys/designer/charts/server — the server-safe subset of
 * `@clossys/designer/charts`. See `atoms/server.ts`'s own header for the
 * full #375 rationale this file shares: `charts/index.ts` re-exports
 * every member eagerly from one module, so `BarChart` and `LineChart` —
 * which hold their own hover state via `useState`, touching no
 * third-party library at all — drag the whole barrel down under React's
 * `react-server` condition even though `ChartFrame` and `Sparkline`
 * resolve cleanly on their own.
 *
 * MEMBERSHIP IS EMPIRICAL — confirmed by resolving each member's own
 * compiled file (`dist/charts/<Name>.js`, never the barrel) under
 * `node --conditions=react-server`. See `src/render-environment.ts` for
 * the recorded verdict and `render-environment.test.ts` for the negative
 * control proving `charts/index.ts` still fails the identical probe.
 *
 * ADDITIVE ONLY: every name below already ships from `charts/index.ts`.
 * No wildcard subpath, no per-file deep export — see `atoms/server.ts`'s
 * header for why.
 */

import { version as reactVersion } from "react";
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/** `react` guard only — `charts` never depends on `react-aria-components` at all, guarded or not (see `charts/index.ts`'s own header). */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { ChartFrame } from "./ChartFrame.js";
export type { ChartFrameProps, ChartMargin, ChartAxisTick, ChartLegendItem, ChartTableSpec, PlotArea } from "./ChartFrame.js";

export { Sparkline } from "./Sparkline.js";
export type { SparklineProps } from "./Sparkline.js";
