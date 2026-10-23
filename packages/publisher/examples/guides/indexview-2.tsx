"use client";
import { useState } from "react";
import { IndexView, type IndexViewTable } from "@clossys/publisher/web/client";

type TaskRow = { id: string; name: string; stage: string };
type TaskView = NonNullable<IndexViewTable<TaskRow>["model"]>;
const rows: TaskRow[] = [{ id: "one", name: "First task", stage: "Ready" }];
const initial: TaskView = {
  version: 2,
  table: {
    version: 1,
    collation: { locale: "en" },
    columns: [{ id: "name", kind: "text" }, { id: "stage", kind: "enum" }],
    groupBy: [{ column: "stage" }],
  },
  mode: "grouped",
  density: "comfortable",
  sort: [],
  visibleColumns: ["name", "stage"],
};

export function TasksArea() {
  const [model, setModel] = useState<TaskView>(initial);
  const [expanded, setExpanded] = useState<ReadonlySet<string> | "all">("all");
  return <IndexView
    collectionLabel="Tasks"
    rows={rows}
    rowKey={row => row.id}
    columns={[
      { id: "name", header: "Name", isRowHeader: true, cell: row => row.name },
      { id: "stage", header: "Stage", cell: row => row.stage },
    ]}
    table={{
      model,
      onModelChange: setModel,
      messages: { viewOptionsLabel: "Table settings" },
      expandedGroupKeys: expanded,
      onExpandedGroupKeysChange: setExpanded,
    }}
    empty={{ title: "No tasks" }}
  />;
}

export default TasksArea;
