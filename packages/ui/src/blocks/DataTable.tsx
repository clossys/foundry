import type { CSSProperties, ReactNode } from "react";
import type { Key, SortDescriptor } from "react-aria-components";
import { Table } from "../atoms/Table.js";
import { cx } from "../atoms/internal/cx.js";
import { EmptyState } from "./EmptyState.js";

export type DataTableSelectionMode = "none" | "single" | "multiple";

export interface DataTableColumn<Row> {
  /** Stable identifier, passed through to `Table.Column`'s own `id`. */
  id: string;
  /** Column header content. */
  header: ReactNode;
  /** Renders one row's value for this column. */
  cell: (row: Row) => ReactNode;
  /**
   * Makes this column's header clickable to sort — reported through
   * `onSortChange`, the same as `Table.Column`'s own `allowsSorting`.
   */
  allowsSorting?: boolean;
  /**
   * Marks this column as the row's accessible name (`Table.Column`'s own
   * `isRowHeader`). Exactly one column should set this — it's what a
   * `Table.SelectionCheckbox` reads to announce "Select row Ada" instead of
   * just "Select row".
   */
  isRowHeader?: boolean;
  /** Fixed column width (`"120px"`, `"10rem"`, or a bare number of pixels). */
  width?: string | number;
}

export interface DataTableProps<Row> {
  /** Accessible name for the underlying grid — `Table`'s own `aria-label`. */
  "aria-label": string;
  /** Column definitions, as data. */
  columns: ReadonlyArray<DataTableColumn<Row>>;
  /** The rows to render. Empty (and not `isLoading`) renders the empty-state region instead of a grid body. */
  rows: ReadonlyArray<Row>;
  /** Derives each row's unique key from the row's own data. */
  rowKey: (row: Row) => Key;
  /**
   * Current sort, and the callback fired when a sortable column header is
   * activated. Controlled only: `DataTable` never re-sorts `rows` itself —
   * it reports the requested `SortDescriptor` and waits for the consumer to
   * pass back already-sorted `rows`, the same reason it never re-selects or
   * re-paginates them (see this package's README).
   */
  sortDescriptor?: SortDescriptor;
  onSortChange?: (descriptor: SortDescriptor) => void;
  /**
   * Row selection. `"none"` (the default) renders no selection column at
   * all. `"multiple"` renders `Table.SelectAllCheckbox`/
   * `Table.SelectionCheckbox` as a leading column, including the select-all
   * indeterminate state for a partial selection. `"single"` relies on
   * `Table`'s own row-press selection, with no checkbox column.
   * @default "none"
   */
  selectionMode?: DataTableSelectionMode;
  /** Required whenever `selectionMode` isn't `"none"` — the same controlled contract as `sortDescriptor`/`onSortChange`. */
  selectedKeys?: "all" | Iterable<Key>;
  onSelectionChange?: (keys: "all" | Set<Key>) => void;
  /**
   * Renders `loadingRowCount` skeleton rows in place of `rows`, for a
   * consumer's own fetch in flight. `DataTable` never fetches or tracks
   * loading state itself — it only reads this prop.
   */
  isLoading?: boolean;
  /** Skeleton row count while `isLoading`. @default 5 */
  loadingRowCount?: number;
  /** Heading for the empty-state region, shown when `rows` is empty and not loading. @default "No results" */
  emptyStateTitle?: ReactNode;
  /** Supporting copy for the empty-state region. */
  emptyStateDescription?: ReactNode;
  /** Recovery-action slot for the empty-state region — e.g. a "Clear filters" `Button`. */
  emptyStateAction?: ReactNode;
  /** Slot above the grid — a title, search, filters, bulk actions for the current selection. */
  toolbar?: ReactNode;
  /** Slot below the grid — typically a `Pagination` block. `DataTable` never paginates `rows` itself. */
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function columnStyle(width: string | number | undefined): CSSProperties | undefined {
  if (width === undefined) return undefined;
  return { width: typeof width === "number" ? `${width}px` : width };
}

function SkeletonCell() {
  return <div className="h-4 w-full animate-pulse rounded-subtle bg-surface-sunken" />;
}

/**
 * A working data grid: a toolbar region, the grid itself (built on the
 * `Table` atom's primitives), an empty-state region, a loading region, and
 * a footer/pagination slot — five regions that differ in kind, which is
 * what makes this a block rather than an atom (see this package's README,
 * "Placement rules", test 2). A page can hold two `DataTable`s side by
 * side (test 3), which is why it's a block and not a view even though it's
 * the largest, most intricate component this package ships.
 *
 * Controlled only, deliberately: sorting, selection, and pagination all
 * come from props with change callbacks, and `DataTable` never fetches
 * data or owns any async state of its own. Welding a data table to one
 * consumer's data-fetching layer (a specific pagination style, a specific
 * cache) would make it useless to every consumer whose data layer differs
 * — the same reasoning `Table`'s own doc comment gives for shipping
 * compositional primitives instead of a pre-wired grid in the first place.
 * `toolbar` and `footer` are plain slots for exactly this reason: a
 * `Pagination` block belongs in `footer`, wired to the consumer's own
 * paging state, not reimplemented in here.
 */
export function DataTable<Row>({
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
  emptyStateTitle = "No results",
  emptyStateDescription,
  emptyStateAction,
  toolbar,
  footer,
  className,
  style,
}: DataTableProps<Row>) {
  const showSelectionColumn = selectionMode === "multiple";

  return (
    <div className={cx("flex flex-col gap-md", className)} style={style}>
      {toolbar ? <div className="flex flex-wrap items-center justify-between gap-md">{toolbar}</div> : null}
      <div className="overflow-x-auto rounded-control border border-line-base">
        <Table
          aria-label={ariaLabel}
          sortDescriptor={sortDescriptor}
          onSortChange={onSortChange}
          selectionMode={selectionMode}
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange as ((keys: unknown) => void) | undefined}
        >
          <Table.Header>
            {showSelectionColumn ? (
              <Table.Column>
                <Table.SelectAllCheckbox />
              </Table.Column>
            ) : null}
            {columns.map((column) => (
              <Table.Column
                key={column.id}
                id={column.id}
                isRowHeader={column.isRowHeader}
                allowsSorting={column.allowsSorting}
                style={columnStyle(column.width)}
              >
                {column.header}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body
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
                      <Table.Cell key={column.id}>
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
                          <Table.SelectionCheckbox />
                        </Table.Cell>
                      ) : null}
                      {columns.map((column) => (
                        <Table.Cell key={column.id}>{column.cell(row)}</Table.Cell>
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
