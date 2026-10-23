// Supply a paint fallback when the chart token is unset.
import { ChartFrame } from "@clossys/designer/charts";

export default function Example() { return <>
<ChartFrame
  title="Monthly signups"
  table={{ headers: ["Month", "Signups"], rows: [["Jan", 12], ["Feb", 18]] }}
>
  {(plot) => (
    // marks, positioned against `plot.x` / `plot.y` / `plot.width` / `plot.height`
    <rect x={plot.x} y={plot.y} width={20} height={plot.height} fill="var(--color-chart-categorical-1, currentColor)" />
  )}
</ChartFrame>
</>; }
