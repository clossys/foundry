import { HeatmapView } from "./internal/signature-views.js";
import type { HeatmapProps } from "./internal/signature-types.js";

/** Static server rendering of the same grid and native table. */
export function Heatmap(props: HeatmapProps) {
  return <HeatmapView props={props} />;
}
