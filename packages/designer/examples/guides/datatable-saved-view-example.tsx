import { useState } from "react";
import { DataTable, parseDataTableViewModel, serializeDataTableViewModel,
  type DataTableViewModelV1 } from "@clossys/designer/blocks";

const initialView: DataTableViewModelV1 = {
  version: 1,
  table: {
    version: 1, collation: { locale: "en", numeric: true },
    columns: [{ id: "name", kind: "text" }, { id: "team", kind: "enum" },
      { id: "amount", kind: "number" }],
    groupBy: [{ column: "team" }],
    measures: [{ id: "total", op: "sum", column: "amount" }],
  },
  mode: "grouped", density: "comfortable", sort: [],
  visibleColumns: ["name", "team", "amount"],
};
const records = [{ id: "one", name: "Example", team: "Blue", amount: 42 }];

function SavedTable() {
  const [model, setModel] = useState(() => parseDataTableViewModel(initialView));
  const [expanded, setExpanded] = useState<ReadonlySet<string> | "all">("all");
  return <DataTable aria-label="Records" rows={records} rowKey={row => row.id}
    columns={[
      { id: "name", header: "Name", cell: row => row.name, isRowHeader: true },
      { id: "team", header: "Team", cell: row => row.team },
      { id: "amount", header: "Amount", cell: row => row.amount },
    ]}
    model={model} onModelChange={setModel}
    expandedGroupKeys={expanded} onExpandedGroupKeysChange={setExpanded} />;
}
// Persistence belongs to the host. The codec validates and copies plain data.
const encoded = serializeDataTableViewModel(initialView);
const restored = parseDataTableViewModel(encoded);

export default SavedTable;
export { restored };
