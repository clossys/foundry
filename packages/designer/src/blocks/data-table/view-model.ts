import { parseTableModel, type TableModel } from "../table-model/index.js";

export type DataTableMode = "flat" | "grouped" | "pivot";
export type DataTableDensity = "comfortable" | "compact";
export interface DataTableSortRule {
  readonly column: string;
  readonly direction: "ascending" | "descending";
}
/** Persist this complete, plain-data envelope; the nested engine model stays unchanged. */
export interface DataTableViewModel {
  readonly version: 1;
  readonly table: TableModel;
  readonly mode: DataTableMode;
  readonly density: DataTableDensity;
  readonly sort: readonly DataTableSortRule[];
  readonly visibleColumns: readonly string[];
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
  const input = record(value, ["version", "table", "mode", "density", "sort", "visibleColumns"]);
  if (input.version !== 1) invalid("unsupported or missing version.");
  const table = parseTableModel(input.table);
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
  return { version: 1, table, mode: input.mode as DataTableMode, density: input.density as DataTableDensity, sort, visibleColumns };
}
export function serializeDataTableViewModel(model: DataTableViewModel): string {
  return JSON.stringify(parseDataTableViewModel(model));
}

/** An edit copies the envelope and preserves untouched nested data. */
export function editView(model: DataTableViewModel, patch: Partial<Omit<DataTableViewModel, "version">>): DataTableViewModel {
  return { ...model, ...patch };
}
