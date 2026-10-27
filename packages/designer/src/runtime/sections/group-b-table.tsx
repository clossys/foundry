import { useState, type ReactNode } from "react";
import { DataTable, type DataTableColumn, type DataTableProps } from "../../blocks/DataTable.js";
import type { DataTableViewModel } from "../../blocks/data-table/view-model.js";
import type { TableColumnKind } from "../../blocks/table-model/index.js";
import type { DsAttrs } from "../../catalog-core/provenance-attrs.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

/**
 * The DataTable glue shared by sections.data-table and sections.data-grid. Rows and column records are
 * JSON; this module turns them into DataTable columns and, when grouping or pinning is filled, into the
 * block's typed view model. It never draws a cell itself: DataTable and its FlatGrid/ModelTable render.
 */
export interface ColumnRecord { readonly id: string; readonly label: string; readonly kind?: TableColumnKind; readonly allowsSorting?: boolean; readonly isRowHeader?: boolean }
export type RowRecord = Readonly<Record<string, string | number | boolean | null>> & { readonly id: string };
export interface SortRecord { readonly column: string; readonly direction: "ascending" | "descending" }
export interface DimensionRecord { readonly column: string; readonly order?: "asc" | "desc" }

export interface TableFillProps {
  readonly label: string;
  readonly columns: readonly ColumnRecord[];
  readonly rows: readonly RowRecord[];
  readonly sort?: readonly SortRecord[];
  /** Absent: no selection. Present (even empty): multiple selection with these row ids selected. */
  readonly selected?: readonly string[];
  readonly grouping?: readonly DimensionRecord[];
  readonly pinned?: readonly string[];
  readonly toolbar?: ReactNode;
  readonly footer?: ReactNode;
  readonly isLoading: boolean;
  /** A leaf that renders through DataTable but is not sections.data-table restamps its own provenance. */
  readonly stamp?: DsAttrs;
}

type Sort = NonNullable<DataTableProps<RowRecord>["sortDescriptor"]>;
const cellText = (value: RowRecord[string] | undefined): string => value === null || value === undefined ? "" : String(value);

function initialModel(props: TableFillProps): DataTableViewModel | undefined {
  const grouping = props.grouping ?? [], pinned = props.pinned ?? [];
  if (!grouping.length && !pinned.length) return undefined;
  // Pinned columns are a leading prefix of the visible columns (at most three), so they move to the front.
  const ids = props.columns.map(column => column.id);
  const pins = ids.filter(id => pinned.includes(id)).slice(0, 3);
  const visible = [...pins, ...ids.filter(id => !pins.includes(id))];
  return {
    version: 2,
    table: { version: 1, collation: { locale: "en", sensitivity: "base", numeric: true }, columns: props.columns.map(column => ({ id: column.id, kind: column.kind ?? "text" })), ...(grouping.length ? { groupBy: grouping.map(({ column, order }) => order ? { column, order } : { column }) } : {}) },
    mode: grouping.length ? "grouped" : "flat",
    density: "comfortable",
    sort: (props.sort ?? []).map(({ column, direction }) => ({ column, direction })),
    visibleColumns: visible,
    ...(pins.length ? { pinnedColumns: pins } : {}),
  };
}

export function TableFill(props: TableFillProps) {
  const [model, setModel] = useState(() => initialModel(props));
  const [sortDescriptor, setSort] = useState<Sort | undefined>(() => props.sort?.[0]);
  const [selectedKeys, setSelected] = useState<"all" | Iterable<string | number>>(() => props.selected ?? []);
  const columns: DataTableColumn<RowRecord>[] = props.columns.map((column, index) => ({
    id: column.id, header: column.label, cell: row => cellText(row[column.id]),
    allowsSorting: column.allowsSorting ?? true, isRowHeader: column.isRowHeader ?? index === 0,
  }));
  return <DataTable<RowRecord>
    {...props.stamp}
    aria-label={props.label}
    columns={columns}
    rows={props.rows}
    rowKey={row => row.id}
    isLoading={props.isLoading}
    emptyStateTitle={specimenDataset.sections.states.tableEmpty.title}
    emptyStateDescription={specimenDataset.sections.states.tableEmpty.description}
    toolbar={props.toolbar}
    footer={props.footer}
    {...(props.selected ? { selectionMode: "multiple" as const, selectedKeys, onSelectionChange: keys => setSelected(keys === "all" ? "all" : [...keys] as (string | number)[]) } : {})}
    {...(model ? { model, onModelChange: setModel } : { sortDescriptor, onSortChange: setSort })}
  />;
}
