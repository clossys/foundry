import { parseTableModel, TableModelError, type TableModel } from "../table-model/index.js";

export type DataTableMode = "flat" | "grouped" | "pivot";
export type DataTableDensity = "comfortable" | "compact";
export interface DataTableSortRule {
  readonly column: string;
  readonly direction: "ascending" | "descending";
}
/** Persist this complete, plain-data envelope; the nested engine model stays unchanged. */
export interface DataTableViewModelV1 {
  readonly version: 1;
  readonly table: TableModel;
  readonly mode: DataTableMode;
  readonly density: DataTableDensity;
  readonly sort: readonly DataTableSortRule[];
  readonly visibleColumns: readonly string[];
}
/** Version 2 preserves the nested engine version and adds optional grid metadata. */
export interface DataTableViewModel extends Omit<DataTableViewModelV1, "version"> {
  readonly version: 2;
  readonly columnWidths?: Readonly<Record<string, number>>;
  readonly pinnedColumns?: readonly string[];
}
export class DataTableViewModelError extends TypeError {
  constructor(message: string) {
    super("DataTable view: " + message);
    this.name = "DataTableViewModelError";
  }
}
function invalid(message: string): never { throw new DataTableViewModelError(message); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("expected a plain object.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid("expected a plain object.");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key)) invalid("unsupported field.");
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    if (!field.enumerable || !Object.hasOwn(field, "value")) invalid("fields must be plain data.");
    result[key] = field.value;
  }
  return result;
}
function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalid("expected an array.");
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    if (!field?.enumerable || !Object.hasOwn(field, "value")) invalid("arrays must contain dense plain data.");
    result.push(field.value);
  }
  if (Reflect.ownKeys(value).some(key => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) invalid("unsupported array field.");
  return result;
}
/** Validate and copy an object or JSON string; unknown versions, fields and columns are refused. */
export function parseDataTableViewModel(value: unknown): DataTableViewModel {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { invalid("invalid JSON."); }
  }
  const fields = ["version", "table", "mode", "density", "sort", "visibleColumns"];
  const input = record(value, [...fields, "columnWidths", "pinnedColumns"]);
  if (input.version !== 1 && input.version !== 2) invalid("unsupported or missing version.");
  if (input.version === 1) record(value, fields);
  let table: TableModel;
  try { table = parseTableModel(input.table); }
  catch (error) {
    if (error instanceof TableModelError) invalid("invalid nested table model.");
    throw error;
  }
  if (!["flat", "grouped", "pivot"].includes(input.mode as string)) invalid("unknown mode.");
  if (!["comfortable", "compact"].includes(input.density as string)) invalid("unknown density.");
  const columns = new Set(table.columns.map(column => column.id));
  const columnId = (value: unknown): string => {
    if (typeof value !== "string" || !columns.has(value)) invalid("unknown column.");
    return value;
  };
  const seen = new Set<string>();
  const sort = list(input.sort).map(value => {
    const item = record(value, ["column", "direction"]);
    const column = columnId(item.column);
    if (seen.has(column)) invalid("sort columns must be distinct.");
    seen.add(column);
    if (item.direction !== "ascending" && item.direction !== "descending") invalid("unknown sort direction.");
    return { column, direction: item.direction } as DataTableSortRule;
  });
  const visibleColumns = list(input.visibleColumns).map(columnId);
  if (!visibleColumns.length || new Set(visibleColumns).size !== visibleColumns.length) invalid("visible columns must be nonempty and distinct.");
  const columnWidths = input.columnWidths === undefined ? undefined : Object.fromEntries(Object.entries(record(input.columnWidths, [...columns])).map(([column, width]) => {
    if (typeof width !== "number" || !Number.isInteger(width) || width < 48 || width > 2000) invalid("column widths must be integer pixels from 48 to 2000.");
    return [column, width];
  }));
  const pinnedColumns = input.pinnedColumns === undefined ? undefined : list(input.pinnedColumns).map(columnId);
  if (pinnedColumns !== undefined && (pinnedColumns.length > 3 || new Set(pinnedColumns).size !== pinnedColumns.length || pinnedColumns.some((column, index) => column !== visibleColumns[index]))) invalid("pinned columns must be a distinct leading prefix of at most three visible columns.");
  return {
    version: 2, table, mode: input.mode as DataTableMode, density: input.density as DataTableDensity, sort, visibleColumns,
    ...(columnWidths === undefined ? {} : { columnWidths }),
    ...(pinnedColumns === undefined ? {} : { pinnedColumns }),
  };
}
export function serializeDataTableViewModel(model: DataTableViewModel | DataTableViewModelV1): string {
  return JSON.stringify(parseDataTableViewModel(model));
}

/** An edit copies the envelope and preserves untouched nested data. */
export function editView(model: DataTableViewModel, patch: Partial<Omit<DataTableViewModel, "version">>): DataTableViewModel {
  return { ...model, ...patch };
}
