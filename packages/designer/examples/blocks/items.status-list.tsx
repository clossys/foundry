import { StatusList } from "@clossys/designer/blocks";

export default function Example() { return <>
<StatusList
  legendLabel="Status"
  labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }}
  groups={[
    { id: "coverage", heading: "Coverage", items: [{ id: "reports", label: "Reports", state: "available" }] },
  ]}
/>
</>; }
