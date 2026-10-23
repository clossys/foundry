import { BarChart } from "@clossys/designer/charts";

export default function Example() { return <>
<BarChart
  title="Revenue vs. cost"
  categories={["Jan", "Feb", "Mar"]}
  series={[
    { name: "Revenue", values: [120, 150, 170] },
    { name: "Cost", values: [80, 90, 95] },
  ]}
/>
</>; }
