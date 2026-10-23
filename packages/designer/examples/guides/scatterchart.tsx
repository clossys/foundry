import { ScatterChart } from "@clossys/designer/charts/server";

export default function Example() { return <>
<ScatterChart
  title="Sample observations"
  description="Two measures and sample counts across two cohorts"
  x={{ label: "First measure", min: 0, max: 10 }}
  y={{ label: "Second measure", min: 0, max: 10 }}
  size={{ label: "Sample count" }}
  series={[
    { id: "a", name: "Cohort A" },
    { id: "b", name: "Cohort B" },
  ]}
  points={[
    { id: "first", label: "Observation A", x: 2, y: 2, size: 1, series: "a", labelSide: "end" },
    { id: "second", label: "Observation B", x: 5, y: 7, size: 4, series: "a", labelSide: "above" },
    { id: "third", label: "Observation C", x: 8, y: 4, size: 9, series: "b", labelSide: "start" },
  ]}
  labels={{ table: "Observation data", category: "Observation" }}
/>
</>; }
