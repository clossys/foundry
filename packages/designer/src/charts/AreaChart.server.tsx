import { AreaView } from "./internal/signature-views.js";
import type { AreaChartProps } from "./internal/signature-types.js";

/** Static server rendering; table and authored inspection remain available. */
export function AreaChart(props: AreaChartProps) {
  return <AreaView props={props} />;
}
