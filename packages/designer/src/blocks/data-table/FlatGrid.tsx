import { type DataTableMessages } from "./messages.js";
import type { CSSProperties } from "react";
import type { Key } from "react-aria-components";
import { Table } from "../../atoms/Table.js";
import { cx } from "../../atoms/internal/cx.js";
import { EmptyState } from "../EmptyState.js";
import type { DataTableProps } from "../DataTable.js";
import type { DataTableDensity } from "./view-model.js";

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
  columns,
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
}: DataTableProps<Row> & DataTableMessages & { density?: DataTableDensity; disabledKeys?: Iterable<Key> }) {
  const showSelectionColumn = selectionMode === "multiple";
  const disabled = new Set(disabledKeys);

  return (
    <div className={cx("flex flex-col gap-md", className)} style={style}>
      {toolbar ? <div className="flex flex-wrap items-center justify-between gap-md">{toolbar}</div> : null}
      <div className="overflow-x-auto rounded-control border border-line-base">
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
              <EmptyState
                title={emptyStateTitle}
                description={emptyStateDescription}
                action={emptyStateAction}
              />
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
                    <Table.Row key={key} id={key}>
                      {showSelectionColumn ? (
                        <Table.Cell>
                          {disabled.has(key) ? null : <Table.SelectionCheckbox aria-label={selectRowLabel} />}
                        </Table.Cell>
                      ) : null}
                      {columns.map((column) => (
                        <Table.Cell key={column.id} className={density === "compact" ? "py-xs" : undefined}>{column.cell(row)}</Table.Cell>
                      ))}
                    </Table.Row>
                  );
                })}
          </Table.Body>
        </Table>
      </div>
      {footer ? <div className="flex flex-wrap items-center justify-between gap-md">{footer}</div> : null}
    </div>
  );
}
