import { GroupedTable } from "@clossys/designer/blocks";

export default function Example() { return <>
<GroupedTable
  caption="Quarterly results"
  rowHeader={{ id: "team", header: "Team", cell: row => row.name }}
  groups={[{ id: "quarter", header: "This quarter", columns: [
    { id: "total", header: "Total", cell: row => row.total },
  ] }]}
  rows={[{ id: "alpha", name: "Alpha", total: 0 }]}
  rowKey={row => row.id}
  emptyMessage="No results yet"
/>
</>; }
