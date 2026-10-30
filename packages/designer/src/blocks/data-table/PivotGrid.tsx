import { defaultPivotAxisMessage, defaultPivotColumnMessage, defaultPivotValueMessage, type DataTableMessages } from "./messages.js";

import type { ReactElement } from "react";
import type { TableProps, TableHeaderProps, TableBodyProps, RowProps, ColumnProps, CellProps } from "react-aria-components";

import { SectionHeader } from "../SectionHeader.js";
import { pivotRows, type TablePivotAxis } from "../table-model/index.js";
import type { DataTableViewModel } from "./view-model.js";
import { TableSurface } from "./TableSurface.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const Table = componentLeaf<(props: TableProps) => ReactElement>("components.table");
const TableHeader = componentLeaf<<T extends object>(props: TableHeaderProps<T>) => ReactElement>("components.table", "TableHeader");
const TableBody = componentLeaf<<T extends object>(props: TableBodyProps<T>) => ReactElement>("components.table", "TableBody");
const TableRow = componentLeaf<<T extends object>(props: RowProps<T>) => ReactElement>("components.table", "TableRow");
const TableHead = componentLeaf<(props: ColumnProps) => ReactElement>("components.table", "TableHead");
const TableCell = componentLeaf<(props: CellProps) => ReactElement>("components.table", "TableCell");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

export function PivotGrid<Row>({
  /** @default "Configure pivot dimensions and measures" */
  pivotEmptyLabel = "Configure pivot dimensions and measures",
  /** @default "Rows" */
  pivotRowsHeaderLabel = "Rows",
  /** @default axis => axis.kind === "total" ? "Total" : (axis.kind === "subtotal" ? "Subtotal " : "") + pathLabel(axis.path) */
  pivotAxisMessage = defaultPivotAxisMessage,
  /** @default (axis, measure) => `${defaultPivotAxisMessage(axis)} · ${measure}` */
  pivotColumnMessage = defaultPivotColumnMessage,
  /** @default (value, empty) => empty ? "—" : valueLabel(value) */
  pivotValueMessage = defaultPivotValueMessage,
  rows, model, label,
}: DataTableMessages & { rows: readonly Row[]; model: DataTableViewModel; label: string }) {
  const pivot = model.table.pivot;
  const measures = model.table.measures ?? [];
  if (!pivot || !measures.length) return <SemanticContent as="div" className="p-2xl"><SectionHeader title={pivotEmptyLabel} level={2} /></SemanticContent>;
  const result = pivotRows(rows as readonly (Row & object)[], model.table);
  const columns = result.columnAxis.flatMap(axis => measures.map(measure => ({ id: JSON.stringify([axis.key, measure.id]), axis, measure })));
  const cells = new Map(result.cells.map(cell => [JSON.stringify([cell.rowKey, cell.columnKey]), cell]));
  const density = model.density === "compact" ? "py-xs" : undefined;
  return <TableSurface label={label}><Table aria-label={label}>
    <TableHeader>
      <TableHead id="axis" isRowHeader className={density}>{pivotRowsHeaderLabel}</TableHead>
      {columns.map(column => <TableHead key={column.id} id={column.id} className={density}>{pivotColumnMessage(column.axis, column.measure.id)}</TableHead>)}
    </TableHeader>
    <TableBody>{result.rowAxis.map(axis => <TableRow key={axis.key} id={axis.key}>
      <TableCell data-column-label={pivotRowsHeaderLabel} className={density}>{pivotAxisMessage(axis)}</TableCell>
      {columns.map(column => {
        const cell = cells.get(JSON.stringify([axis.key, column.axis.key]));
        return <TableCell key={column.id} data-column-label={pivotColumnMessage(column.axis, column.measure.id)} className={density}>{pivotValueMessage(cell?.aggregates[column.measure.id] ?? null, !cell || cell.empty)}</TableCell>;
      })}
    </TableRow>)}</TableBody>
  </Table></TableSurface>;
}
