import { AreaChart, Heatmap, StatusStrip } from "@clossys/designer/charts";

export default function Example() { return <>
<AreaChart
  title="Volume by month"
  x={["Jan", "Feb", "Mar"]}
  series={[
    { name: "New", values: [10, 20, null] },
    { name: "Returning", values: [30, 20, 10] },
  ]}
  stacked
/>
<Heatmap
  title="Capacity by team"
  rows={["East", "West"]}
  columns={["Mon", "Tue"]}
  values={[[0, 100], [null, 50]]}
/>
<StatusStrip
  title="Service history"
  domain={[0, 40]}
  segments={[
    { from: 0, to: 10, status: "ok" },
    { from: 20, to: 40, status: "error" },
  ]}
/>
</>; }
