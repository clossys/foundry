import { DataTable, Pagination, type DataTableColumn } from "@clossys/designer/blocks";
import { useState } from "react";
import type { Key, SortDescriptor } from "react-aria-components";

interface PromptRun {
  id: string;
  name: string;
  runs: number;
}

const COLUMNS: DataTableColumn<PromptRun>[] = [
  { id: "name", header: "Name", cell: (row) => row.name, isRowHeader: true, allowsSorting: true },
  { id: "runs", header: "Runs", cell: (row) => row.runs, allowsSorting: true },
];

function PromptRunsTable({ rows }: { rows: PromptRun[] }) {
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>();
  const [selectedKeys, setSelectedKeys] = useState<"all" | Set<Key>>(new Set());
  const [page, setPage] = useState(1);

  return (
    <DataTable
      aria-label="Prompt runs"
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      sortDescriptor={sortDescriptor}
      onSortChange={setSortDescriptor}
      selectionMode="multiple"
      selectedKeys={selectedKeys}
      onSelectionChange={setSelectedKeys}
      emptyStateTitle="No prompt runs yet"
      footer={<Pagination page={page} pageCount={10} onPageChange={setPage} />}
    />
  );
}

export default PromptRunsTable;
export const smokeProps = { rows: [{ id: "one", name: "Example prompt", runs: 3 }] } satisfies React.ComponentProps<typeof PromptRunsTable>;
