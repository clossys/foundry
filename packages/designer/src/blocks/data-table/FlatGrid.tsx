import { type DataTableMessages } from "./messages.js";
import type { CSSProperties, ReactElement } from "react";
import type { Key, TableProps, TableHeaderProps, TableBodyProps, RowProps, ColumnProps, CellProps } from "react-aria-components";

import { cx } from "../../components/internal/cx.js";
import { SectionHeader } from "../SectionHeader.js";
import type { DataTableProps } from "../DataTable.js";
import type { DataTableDensity } from "./view-model.js";
import { visibleColumns } from "./empty-columns.js";
import { dsPassThrough } from "../../catalog-core/provenance-attrs.js";
import { TableSurface } from "./TableSurface.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const Table = componentLeaf<(props: TableProps) => ReactElement>("components.table");
const TableHeader = componentLeaf<<T extends object>(props: TableHeaderProps<T>) => ReactElement>("components.table", "TableHeader");
const TableBody = componentLeaf<<T extends object>(props: TableBodyProps<T>) => ReactElement>("components.table", "TableBody");
const TableRow = componentLeaf<<T extends object>(props: RowProps<T>) => ReactElement>("components.table", "TableRow");
const TableHead = componentLeaf<(props: ColumnProps) => ReactElement>("components.table", "TableHead");
const TableCell = componentLeaf<(props: CellProps) => ReactElement>("components.table", "TableCell");
const Checkbox = componentLeaf<typeof import("../../components/Checkbox.js").Checkbox>("components.checkbox");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

function columnStyle(width: string | number | undefined): CSSProperties | undefined {
  if (width === undefined) return undefined;
  return { width: typeof width === "number" ? `${width}px` : width };
}

function SkeletonCell() {
  return <SemanticContent as="div" className="h-4 w-full animate-pulse motion-reduce:animate-none rounded-subtle bg-surface-sunken" />;
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
    <SemanticContent as="div" {...dsPassThrough(passthrough)} className={cx("flex min-w-0 max-w-full flex-col gap-md", className)} style={style}>
      {toolbar ? <SemanticContent as="div" data-table-toolbar="" className="flex flex-wrap items-end justify-between gap-md">{toolbar}</SemanticContent> : null}
      <TableSurface label={ariaLabel}>
        <Table
          aria-label={ariaLabel}
          disabledKeys={disabledKeys}
          disabledBehavior="selection"
          sortDescriptor={sortDescriptor}
          onSortChange={onSortChange}
          selectionMode={selectionMode}
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
        >
          <TableHeader>
            {showSelectionColumn ? (
              <TableHead>
                <Checkbox slot="selection" aria-label={selectAllLabel}>{null}</Checkbox>
              </TableHead>
            ) : null}
            {columns.map((column) => (
              <TableHead
                key={column.id}
                id={column.id}
                isRowHeader={column.isRowHeader || (!columns.some(item => item.isRowHeader) && column.id === columns[0]?.id)}
                className={density === "compact" ? "py-xs" : undefined}
                allowsSorting={column.allowsSorting}
                style={columnStyle(column.width)}
              >
                {column.header}
              </TableHead>
            ))}
          </TableHeader>
          <TableBody
            className=""
            renderEmptyState={() => (
              <SemanticContent as="div" className="p-2xl">
                <SectionHeader title={emptyStateTitle} description={emptyStateDescription} actions={emptyStateAction} level={2} />
              </SemanticContent>
            )}
          >
            {isLoading
              ? Array.from({ length: loadingRowCount }, (_, index) => (
                  <TableRow key={`loading-${index}`} id={`loading-${index}`}>
                    {showSelectionColumn ? (
                      <TableCell>
                        <SkeletonCell />
                      </TableCell>
                    ) : null}
                    {columns.map((column) => (
                      <TableCell key={column.id} className={density === "compact" ? "py-xs" : undefined}>
                        <SkeletonCell />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((row) => {
                  const key = rowKey(row);
                  return (
                    <TableRow key={key} id={key} data-table-group={disabled.has(key) ? "" : undefined} className={disabled.has(key) ? "text-ink-muted" : undefined}>
                      {showSelectionColumn ? (
                        <TableCell data-column-label={selectRowLabel}>
                          {disabled.has(key) ? null : <Checkbox slot="selection" aria-label={selectRowLabel}>{null}</Checkbox>}
                        </TableCell>
                      ) : null}
                      {columns.map((column) => {
                        const value = column.cell(row);
                        return <TableCell key={column.id}
                          data-column-label={typeof column.header === "string" || typeof column.header === "number" ? String(column.header) : undefined}
                          textValue={typeof value === "string" ? value : undefined}
                          className={cx(density === "compact" && "py-xs", column.format === "id" && "type-id") || undefined}>
                          <SemanticContent as="span" data-table-cell-value="">{value}</SemanticContent>
                        </TableCell>;
                      })}
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
      </TableSurface>
      {footer ? <SemanticContent as="div" className="flex flex-wrap items-center justify-between gap-md">{footer}</SemanticContent> : null}
    </SemanticContent>
  );
}
