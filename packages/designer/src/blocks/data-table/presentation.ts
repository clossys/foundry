import type { TableColumn, TableValue } from "../table-model/index.js";
import type { DataTableViewModel } from "./view-model.js";

/** Called only after the engine validates cells. Sort a copy, keeping source order for ties. */
export function sortViewRows<Row>(rows: readonly Row[], model: DataTableViewModel): Row[] {
  const collator = new Intl.Collator(model.table.collation.locale, model.table.collation);
  const columns = new Map(model.table.columns.map(column => [column.id, column]));
  const text = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
  const normalized = (row: Row, column: TableColumn): TableValue => {
    const value = Object.getOwnPropertyDescriptor(row, column.id)?.value ?? null;
    if (value === null) return null;
    if (column.kind === "date") return new Date(value).toISOString();
    if (column.kind === "tags") return [...new Set(value as string[])].sort(text);
    return value;
  };
  const compare = (a: TableValue, b: TableValue, column: TableColumn): number => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    if (column.kind === "date") return Date.parse(a as string) - Date.parse(b as string);
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
    if (typeof a === "boolean" && typeof b === "boolean") return a ? 1 : -1;
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) { const result = text(a[i]!, b[i]!); if (result) return result; }
      return a.length - b.length;
    }
    return text(String(a), String(b));
  };
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    for (const rule of model.sort) {
      const column = columns.get(rule.column)!;
      const result = compare(normalized(a.row, column), normalized(b.row, column), column);
      if (result) return result * (rule.direction === "descending" ? -1 : 1);
    }
    return a.index - b.index;
  }).map(entry => entry.row);
}
export function valueLabel(value: TableValue): string {
  if (value === null) return "(empty)";
  return Array.isArray(value) ? value.join(", ") || "(empty set)" : String(value);
}
export function pathLabel(path: readonly TableValue[]): string { return path.map(valueLabel).join(" / "); }
