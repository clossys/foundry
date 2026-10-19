import { useId, type Key, type ReactNode } from "react";
import { Card } from "../atoms/Card.js";
import { cx } from "../atoms/internal/cx.js";

export interface GroupedTableColumn<Row> {
  /** Unique within its group; the row-header ID has its own namespace. */
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
}

export interface GroupedTableGroup<Row> {
  id: string;
  header: ReactNode;
  columns: readonly GroupedTableColumn<Row>[];
}

export interface GroupedTableProps<Row> {
  caption: string;
  rowHeader: GroupedTableColumn<Row>;
  groups: readonly GroupedTableGroup<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => Key;
  emptyMessage: string;
  className?: string;
}

function assertIds(ids: readonly string[], label: string) {
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error("GroupedTable requires nonempty, unique " + label + " IDs.");
  }
}

/** A captioned table with row labels and two levels of column headers. */
export function GroupedTable<Row>({ caption, rowHeader, groups, rows, rowKey, emptyMessage, className }: GroupedTableProps<Row>) {
  const prefix = useId();
  if (!caption.trim() || !emptyMessage.trim()) throw new Error("GroupedTable requires a caption and emptyMessage.");
  assertIds([rowHeader.id], "row header");
  assertIds(groups.map(group => group.id), "group");
  if (!groups.length || groups.some(group => !group.columns.length)) throw new Error("GroupedTable requires groups with columns.");
  groups.forEach(group => assertIds(group.columns.map(column => column.id), "column"));
  const keys = rows.map(rowKey);
  if (new Set(keys.map(String)).size !== keys.length) throw new Error("GroupedTable requires unique row keys.");
  const captionId = prefix + "-caption";
  const groupId = (group: number) => prefix + "-group-" + group;
  const columnId = (group: number, column: number) => prefix + "-column-" + group + "-" + column;
  const columnCount = 1 + groups.reduce((count, group) => count + group.columns.length, 0);
  return (
    <Card variant="outline" className={cx("p-0 overflow-hidden", className)}>
      <div role="region" aria-labelledby={captionId} tabIndex={0} className="overflow-x-auto focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2">
        <table className="w-full border-collapse text-body-s text-ink-primary">
          <caption id={captionId} className="p-md text-start font-medium">{caption}</caption>
          <colgroup span={1} />
          {groups.map(group => <colgroup key={group.id} span={group.columns.length} />)}
          <thead className="bg-surface-sunken">
            <tr>
              <th rowSpan={2} scope="col" className="border-b border-line-base p-md text-start font-medium">{rowHeader.header}</th>
              {groups.map((group, groupIndex) => (
                <th key={group.id} id={groupId(groupIndex)} colSpan={group.columns.length} scope="colgroup" className="border-b border-line-base p-md text-start font-medium">{group.header}</th>
              ))}
            </tr>
            <tr>
              {groups.map((group, groupIndex) => group.columns.map((column, columnIndex) => (
                <th key={groupIndex + "-" + column.id} id={columnId(groupIndex, columnIndex)} headers={groupId(groupIndex)} scope="col" className="border-b border-line-base p-md text-start font-medium">{column.header}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const rowId = prefix + "-row-" + rowIndex;
              return <tr key={keys[rowIndex]}>
                <th id={rowId} scope="row" className="border-b border-line-base p-md text-start font-medium">{rowHeader.cell(row)}</th>
                {groups.map((group, groupIndex) => group.columns.map((column, columnIndex) => (
                  <td key={groupIndex + "-" + column.id} headers={rowId + " " + groupId(groupIndex) + " " + columnId(groupIndex, columnIndex)} className="border-b border-line-base p-md text-start">{column.cell(row)}</td>
                )))}
              </tr>;
            })}
            {!rows.length && <tr><td colSpan={columnCount} className="p-md text-ink-secondary">{emptyMessage}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
