import { RangeChart } from "@clossys/designer/charts/server";

export default function Example() { return <>
<RangeChart
  title="Sample schedule"
  description="Activities across four phases"
  ticks={["Phase A", "Phase B", "Phase C", "Phase D"]}
  rows={[
    { id: "whole", label: "Whole schedule", from: 0, to: 4 },
    {
      id: "review",
      label: "Review",
      from: 0.5,
      to: 2.75,
      status: { tone: "warning", label: "Awaiting review" },
    },
  ]}
  labels={{
    table: "Schedule data",
    category: "Activity",
    from: "Start boundary",
    to: "End boundary",
    status: "State",
  }}
/>
</>; }
