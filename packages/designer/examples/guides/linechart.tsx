import { LineChart } from "@clossys/designer/charts";

export default function Example() { return <>
<LineChart
  title="Daily active users"
  x={[new Date("2026-01-01"), new Date("2026-01-02"), new Date("2026-01-03")]}
  series={[{ name: "DAU", values: [1200, 1350, 1290] }]}
/>
</>; }
