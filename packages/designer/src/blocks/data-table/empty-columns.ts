import { Fragment, isValidElement, type ReactNode } from "react";

/** True when a rendered cell draws nothing: null, boolean, empty string, or a fragment/array of such. */
export function isEmptyCell(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean") return true;
  if (typeof node === "string") return node.trim() === "";
  if (Array.isArray(node)) return node.every(isEmptyCell);
  if (isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment) return isEmptyCell(node.props.children);
  return false;
}

/** Drops each column whose cell is empty for every row; with no rows every column stays (nothing to judge). */
export function visibleColumns<Row, Column extends { cell: (row: Row) => ReactNode }>(columns: ReadonlyArray<Column>, rows: ReadonlyArray<Row>): ReadonlyArray<Column> {
  if (rows.length === 0) return columns;
  return columns.filter(column => rows.some(row => !isEmptyCell(column.cell(row))));
}
