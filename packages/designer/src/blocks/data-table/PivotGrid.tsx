import { defaultPivotAxisMessage, defaultPivotColumnMessage, defaultPivotValueMessage, type DataTableMessages } from "./messages.js";
import { Table } from "../../components/Table.js";
import { SectionHeader } from "../SectionHeader.js";
import { pivotRows, type TablePivotAxis } from "../table-model/index.js";
import type { DataTableViewModel } from "./view-model.js";
import { TableSurface } from "./TableSurface.js";

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
  if (!pivot || !measures.length) return <div className="p-2xl"><SectionHeader title={pivotEmptyLabel} level={2} /></div>;
  const result = pivotRows(rows as readonly (Row & object)[], model.table);
  const columns = result.columnAxis.flatMap(axis => measures.map(measure => ({ id: JSON.stringify([axis.key, measure.id]), axis, measure })));
  const cells = new Map(result.cells.map(cell => [JSON.stringify([cell.rowKey, cell.columnKey]), cell]));
  const density = model.density === "compact" ? "py-xs" : undefined;
  return <TableSurface label={label}><Table aria-label={label}>
    <Table.Header>
      <Table.Column id="axis" isRowHeader className={density}>{pivotRowsHeaderLabel}</Table.Column>
      {columns.map(column => <Table.Column key={column.id} id={column.id} className={density}>{pivotColumnMessage(column.axis, column.measure.id)}</Table.Column>)}
    </Table.Header>
    <Table.Body>{result.rowAxis.map(axis => <Table.Row key={axis.key} id={axis.key}>
      <Table.Cell data-column-label={pivotRowsHeaderLabel} className={density}>{pivotAxisMessage(axis)}</Table.Cell>
      {columns.map(column => {
        const cell = cells.get(JSON.stringify([axis.key, column.axis.key]));
        return <Table.Cell key={column.id} data-column-label={pivotColumnMessage(column.axis, column.measure.id)} className={density}>{pivotValueMessage(cell?.aggregates[column.measure.id] ?? null, !cell || cell.empty)}</Table.Cell>;
      })}
    </Table.Row>)}</Table.Body>
  </Table></TableSurface>;
}
