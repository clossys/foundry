import { WaterfallChart } from "@clossys/designer/charts/server";

export default function Example() { return <>
<WaterfallChart
  title="Balance changes"
  description="Opening balance, additions, and removals"
  start={{ label: "Opening", value: 100 }}
  steps={[
    { id: "added", label: "Added", value: 30 },
    { id: "removed", label: "Removed", value: -20 },
    { id: "recovered", label: "Recovered", value: 10 },
  ]}
  end={{ label: "Closing", value: 120 }}
  labels={{ table: "View values", category: "Stage", value: "Amount" }}
/>
</>; }
