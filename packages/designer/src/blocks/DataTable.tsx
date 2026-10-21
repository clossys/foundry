import type { CSSProperties, ReactNode } from "react";
import type { Key, SortDescriptor } from "react-aria-components";

import { FlatGrid } from "./data-table/FlatGrid.js";
import { ModelTable } from "./data-table/ModelTable.js";
import type { DataTableMessages } from "./data-table/messages.js";
import type { DataTableViewModel, DataTableViewModelV1 } from "./data-table/view-model.js";

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
  /** Optional saved-view mode. With a model, filtering/sorting/grouping/pivoting are computed locally. */
  model?: DataTableViewModel | DataTableViewModelV1;
  /** Host labels/formatters with documented English defaults. Kept outside the saved view. */
  messages?: DataTableMessages;
  /** Required with model; persist the complete replacement envelope. Never called just for opening options. */
  onModelChange?: (model: DataTableViewModel) => void;
  /** Controlled group expansion; omitted means all groups expanded. Keys come from groupRows. */
  expandedGroupKeys?: ReadonlySet<string> | "all";
  onExpandedGroupKeysChange?: (keys: ReadonlySet<string>) => void;
  className?: string;
  style?: CSSProperties;
}

/** Legacy controlled grid, or a saved local view over the same rows and column renderers. */
export function DataTable<Row>(props: DataTableProps<Row>) {
  return props.model ? <ModelTable {...props} {...props.messages} model={props.model} /> : <FlatGrid {...props} {...props.messages} />;
}
