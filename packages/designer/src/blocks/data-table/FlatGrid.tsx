import { type DataTableMessages } from "./messages.js";
import type { CSSProperties } from "react";
import type { Key } from "react-aria-components";
import { Table } from "../../components/Table.js";
import { cx } from "../../components/internal/cx.js";
import { SectionHeader } from "../SectionHeader.js";
import type { DataTableProps } from "../DataTable.js";
import type { DataTableDensity } from "./view-model.js";
import { visibleColumns } from "./empty-columns.js";
import { dsPassThrough } from "../../catalog-core/provenance-attrs.js";
import { TableSurface } from "./TableSurface.js";

function columnStyle(width: string | number | undefined): CSSProperties | undefined {
  if (width === undefined) return undefined;
  return { width: typeof width === "number" ? `${width}px` : width };
}

function SkeletonCell() {
  return <div className="h-4 w-full animate-pulse motion-reduce:animate-none rounded-subtle bg-surface-sunken" />;
}

/** Shared grid assembly, preserving the legacy controlled props. */
export function FlatGrid<Row>({
  /** @default "Select all rows" */
  selectAllLabel = "Select all rows",
  /** @default "Select row" */
  selectRowLabel = "Select row",
  "aria-label": ariaLabel,
  columns: allColumns,
  rows,
  rowKey,
  sortDescriptor,
  onSortChange,
  selectionMode = "none",
  selectedKeys,
  onSelectionChange,
  isLoading = false,
  loadingRowCount = 5,
  /** @default "No results" */
  emptyStateTitle = "No results",
  emptyStateDescription,
  emptyStateAction,
  toolbar,
  footer,
  className,
  style,
  density,
  disabledKeys,
  hideEmptyColumns = false,
  ...passthrough
}: DataTableProps<Row> & DataTableMessages & { density?: DataTableDensity; disabledKeys?: Iterable<Key> }) {
  const columns = hideEmptyColumns && !isLoading ? visibleColumns(allColumns, rows) : allColumns;
  const showSelectionColumn = selectionMode === "multiple";
  const disabled = new Set(disabledKeys);

  return (
    <div {...dsPassThrough(passthrough)} className={cx("flex min-w-0 max-w-full flex-col gap-md", className)} style={style}>
      {toolbar ? <div data-table-toolbar="" className="flex flex-wrap items-end justify-between gap-md">{toolbar}</div> : null}
      <TableSurface label={ariaLabel}>
        <Table
          aria-label={ariaLabel}
          disabledKeys={disabledKeys}
          disabledBehavior="selection"
          sortDescriptor={sortDescriptor}
          onSortChange={onSortChange}
          selectionMode={selectionMode}
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange as ((keys: unknown) => void) | undefined}
        >
          <Table.Header>
            {showSelectionColumn ? (
              <Table.Column>
                <Table.SelectAllCheckbox aria-label={selectAllLabel} />
              </Table.Column>
            ) : null}
            {columns.map((column) => (
              <Table.Column
                key={column.id}
                id={column.id}
                isRowHeader={column.isRowHeader}
                className={density === "compact" ? "py-xs" : undefined}
                allowsSorting={column.allowsSorting}
                style={columnStyle(column.width)}
              >
                {column.header}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body
            className=""
            renderEmptyState={() => (
              <div className="p-2xl">
                <SectionHeader title={emptyStateTitle} description={emptyStateDescription} actions={emptyStateAction} level={2} />
              </div>
            )}
          >
            {isLoading
              ? Array.from({ length: loadingRowCount }, (_, index) => (
                  <Table.Row key={`loading-${index}`} id={`loading-${index}`}>
                    {showSelectionColumn ? (
                      <Table.Cell>
                        <SkeletonCell />
                      </Table.Cell>
                    ) : null}
                    {columns.map((column) => (
                      <Table.Cell key={column.id} className={density === "compact" ? "py-xs" : undefined}>
                        <SkeletonCell />
                      </Table.Cell>
                    ))}
                  </Table.Row>
                ))
              : rows.map((row) => {
                  const key = rowKey(row);
                  return (
                    <Table.Row key={key} id={key} data-table-group={disabled.has(key) ? "" : undefined} className={disabled.has(key) ? "text-ink-muted" : undefined}>
                      {showSelectionColumn ? (
                        <Table.Cell data-column-label={selectRowLabel}>
                          {disabled.has(key) ? null : <Table.SelectionCheckbox aria-label={selectRowLabel} />}
                        </Table.Cell>
                      ) : null}
                      {columns.map((column) => {
                        const value = column.cell(row);
                        return <Table.Cell key={column.id}
                          data-column-label={typeof column.header === "string" || typeof column.header === "number" ? String(column.header) : undefined}
                          textValue={typeof value === "string" ? value : undefined}
                          className={cx(density === "compact" && "py-xs", column.format === "id" && "type-id") || undefined}>
                          <span data-table-cell-value="">{value}</span>
                        </Table.Cell>;
                      })}
                    </Table.Row>
                  );
                })}
          </Table.Body>
        </Table>
      </TableSurface>
      {footer ? <div className="flex flex-wrap items-center justify-between gap-md">{footer}</div> : null}
    </div>
  );
}
