"use client";
import { IndexView } from "@clossys/publisher/web/client";

type RecordRow = { id: string; name: string };
const rows: RecordRow[] = [{ id: "one", name: "First record" }];

export function RecordsArea({ navigate }: { navigate: (href: string) => void }) {
  return <IndexView
    collectionLabel="Records"
    rows={rows}
    rowKey={row => row.id}
    columns={[{ id: "name", header: "Name", isRowHeader: true, cell: row => row.name }]}
    rowRoute={{ href: row => `/records/${row.id}`, onNavigate: href => navigate(href) }}
    empty={{ title: "No records", description: "Create a record to begin." }}
  />;
}

export const smokeProps = { navigate: (_href: string): void => {} } satisfies Parameters<typeof RecordsArea>[0];
export default RecordsArea;
