import { Matrix } from "@clossys/designer/blocks/server";

export default function Example() { return <>
<Matrix
  arrangement="grid"
  aria-label="Record comparison"
  columns={[
    { id: "record", label: "Record" },
    { id: "count", label: "Count" },
    { id: "state", label: "State" },
    { id: "coverage", label: "Coverage" },
  ]}
  rows={[
    {
      id: "current", label: "Current record", description: "The latest authored view.",
      cells: {
        record: { type: "text", text: "Reviewed record" },
        count: { type: "figure", value: "2,481", delta: "+12%", trend: "up" },
        state: { type: "status", tone: "success", label: "Reviewed" },
        coverage: { type: "mark", value: 3 },
      },
    },
    {
      id: "previous", label: "Previous record",
      cells: {
        record: { type: "empty" },
        count: { type: "figure", value: "2,200", delta: "-3%", trend: "down" },
        state: { type: "status", tone: "warning", label: "Needs review" },
        coverage: { type: "mark", value: 1 },
      },
    },
  ]}
  featured={{ column: "count" }}
  featuredLabel="Selected measure"
  emptyLabel="No authored value"
  markLabels={["None", "One quarter", "Half", "Three quarters", "Full"]}
  keyLabel="Coverage key"
/>
</>; }
