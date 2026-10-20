import type { TableCollation, TableColumn, TableDimension, TableFilter, TableMeasure, TableModel, TableModelErrorCode, TableValue } from "./types.js";

/** A typed refusal of invalid saved-view data, cells or an oversized pivot. */
export class TableModelError extends TypeError {
  constructor(readonly code: TableModelErrorCode, message: string) {
    super("Table model: " + message);
    this.name = "TableModelError";
  }
}

function invalid(message: string): never {
  throw new TableModelError("invalid-model", message);
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("expected a plain object.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid("expected a plain object.");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key)) invalid("unsupported model field.");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid("model fields must be plain data.");
    result[key] = descriptor.value;
  }
  return result;
}

function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalid("expected an array.");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid("arrays must contain dense plain data.");
    result.push(descriptor.value);
  }
  for (const key of Reflect.ownKeys(value)) if (key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) invalid("unsupported array field.");
  return result;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) invalid("identifiers must be nonblank strings.");
  return value;
}

function strings(value: unknown): string[] {
  return list(value).map(item => {
    if (typeof item !== "string") invalid("expected string values.");
    return item;
  });
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid("expected a finite number.");
  return value;
}

/** Accepts epoch milliseconds, YYYY-MM-DD or the canonical UTC ISO representation. */
export function dateValue(value: unknown, code: "invalid-model" | "invalid-cell"): string {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "number" && !Number.isFinite(value))) throw new TableModelError(code, "expected a UTC date or finite epoch milliseconds.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TableModelError(code, "invalid date.");
  const canonical = date.toISOString();
  if (typeof value === "string" && canonical !== value && !(/^\d{4}-\d{2}-\d{2}$/.test(value) && canonical === value + "T00:00:00.000Z")) throw new TableModelError(code, "dates must use YYYY-MM-DD or canonical UTC ISO form.");
  return canonical;
}

function collation(value: unknown): TableCollation {
  const input = record(value, ["locale", "sensitivity", "numeric", "caseFirst", "ignorePunctuation"]);
  const locale = id(input.locale);
  if (input.sensitivity !== undefined && !["base", "accent", "case", "variant"].includes(input.sensitivity as string)) invalid("unknown collation sensitivity.");
  if (input.caseFirst !== undefined && !["upper", "lower", "false"].includes(input.caseFirst as string)) invalid("unknown case ordering.");
  for (const key of ["numeric", "ignorePunctuation"]) if (input[key] !== undefined && typeof input[key] !== "boolean") invalid("collation flags must be boolean.");
  const result: TableCollation = {
    locale,
    ...(input.sensitivity === undefined ? {} : { sensitivity: input.sensitivity as TableCollation["sensitivity"] }),
    ...(input.numeric === undefined ? {} : { numeric: input.numeric as boolean }),
    ...(input.caseFirst === undefined ? {} : { caseFirst: input.caseFirst as TableCollation["caseFirst"] }),
    ...(input.ignorePunctuation === undefined ? {} : { ignorePunctuation: input.ignorePunctuation as boolean }),
  };
  try {
    if (!Intl.Collator.supportedLocalesOf(locale).length) invalid("locale is not supported by this runtime.");
    new Intl.Collator(locale, result);
  } catch (error) {
    if (error instanceof TableModelError) throw error;
    invalid("invalid collation locale.");
  }
  return result;
}

/** Validate and copy a saved view from a plain object; unknown fields and versions are refused. */
export function parseTableModel(value: unknown): TableModel {
  const input = record(value, ["version", "columns", "collation", "filters", "search", "groupBy", "measures", "pivot"]);
  if (input.version === undefined) invalid("version is required.");
  if (input.version !== 1) throw new TableModelError("unsupported-version", "unsupported saved-view version.");
  const byId = new Map<string, TableColumn>();
  const columns = list(input.columns).map(value => {
    const column = record(value, ["id", "kind", "searchable"]);
    const name = id(column.id);
    if (byId.has(name)) invalid("column identifiers must be distinct.");
    if (!["text", "number", "date", "enum", "tags", "boolean"].includes(column.kind as string)) invalid("unknown column kind.");
    if (column.searchable !== undefined && typeof column.searchable !== "boolean") invalid("searchable must be boolean.");
    const result: TableColumn = { id: name, kind: column.kind as TableColumn["kind"], ...(column.searchable === undefined ? {} : { searchable: column.searchable as boolean }) };
    byId.set(name, result);
    return result;
  });
  const find = (value: unknown): TableColumn => {
    const name = id(value);
    const column = byId.get(name);
    if (!column) throw new TableModelError("unknown-column", "referenced column is not declared.");
    return column;
  };
  const dimensions = (value: unknown): TableDimension[] => {
    const seen = new Set<string>();
    return list(value).map(value => {
      const dimension = record(value, ["column", "order"]);
      const column = find(dimension.column).id;
      if (seen.has(column)) invalid("an axis cannot repeat a dimension.");
      seen.add(column);
      if (dimension.order !== undefined && dimension.order !== "asc" && dimension.order !== "desc") invalid("unknown dimension ordering.");
      return { column, ...(dimension.order === undefined ? {} : { order: dimension.order as "asc" | "desc" }) };
    });
  };
  const filters = input.filters === undefined ? undefined : list(input.filters).map((value): TableFilter => {
    const filter = record(value, ["column", "kind", "op", "value", "values", "min", "max"]);
    const column = find(filter.column);
    const kind = column.kind;
    if (filter.kind !== kind) invalid("filter kind must match its column.");
    const head = { column: column.id, kind };
    const only = (keys: string[]) => record(value, ["column", "kind", "op", ...keys]);
    if (kind === "text") {
      only(["value"]);
      if ((filter.op !== "contains" && filter.op !== "equals") || typeof filter.value !== "string") invalid("invalid text filter.");
      return { ...head, kind, op: filter.op, value: filter.value };
    }
    if (kind === "number" || kind === "date") {
      only(["min", "max"]);
      if (filter.op !== "range") invalid("invalid range operator.");
      const bound = (value: unknown): number => kind === "number" ? finite(value) : Date.parse(dateValue(value, "invalid-model"));
      const min = filter.min === undefined ? undefined : bound(filter.min);
      const max = filter.max === undefined ? undefined : bound(filter.max);
      if (min !== undefined && max !== undefined && min > max) invalid("range minimum exceeds maximum.");
      if (kind === "number") return { ...head, kind, op: "range", ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
      return { ...head, kind, op: "range", ...(min === undefined ? {} : { min: filter.min as number | string }), ...(max === undefined ? {} : { max: filter.max as number | string }) };
    }
    if (kind === "boolean") {
      only(["value"]);
      if (filter.op !== "equals" || typeof filter.value !== "boolean") invalid("invalid boolean filter.");
      return { ...head, kind, op: "equals", value: filter.value };
    }
    only(["values"]);
    const values = strings(filter.values);
    if (kind === "enum") {
      if (filter.op !== "in") invalid("invalid enum operator.");
      return { ...head, kind, op: "in", values };
    }
    if (filter.op !== "any" && filter.op !== "all" && filter.op !== "none") invalid("invalid tags operator.");
    return { ...head, kind, op: filter.op, values };
  });
  const measureIds = new Set<string>();
  const measures = input.measures === undefined ? undefined : list(input.measures).map((value): TableMeasure => {
    const measure = record(value, ["id", "op", "column"]);
    const name = id(measure.id);
    if (measureIds.has(name)) invalid("measure identifiers must be distinct.");
    measureIds.add(name);
    if (!["count", "sum", "min", "max", "avg", "distinct"].includes(measure.op as string)) invalid("unknown measure operation.");
    const column = measure.column === undefined ? undefined : find(measure.column);
    if (measure.op === "count") return { id: name, op: "count", ...(column ? { column: column.id } : {}) };
    if (!column) invalid("measure requires a column.");
    if ((measure.op === "sum" || measure.op === "avg") && column.kind !== "number") invalid("sum and average require a number column.");
    if ((measure.op === "min" || measure.op === "max") && column.kind === "tags") invalid("tag sets have no scalar extrema.");
    return { id: name, op: measure.op as "sum" | "min" | "max" | "avg" | "distinct", column: column.id };
  });
  let pivot: TableModel["pivot"];
  if (input.pivot !== undefined) {
    const value = record(input.pivot, ["rows", "columns"]);
    pivot = { rows: dimensions(value.rows), columns: dimensions(value.columns) };
    if (!measures?.length) invalid("pivot requires at least one measure.");
  }
  if (input.search !== undefined && typeof input.search !== "string") invalid("search must be a string.");
  return {
    version: 1, columns, collation: collation(input.collation),
    ...(filters === undefined ? {} : { filters }),
    ...(input.search === undefined ? {} : { search: input.search as string }),
    ...(input.groupBy === undefined ? {} : { groupBy: dimensions(input.groupBy) }),
    ...(measures === undefined ? {} : { measures }),
    ...(pivot === undefined ? {} : { pivot }),
  };
}

/** Returns an independent, validated plain object suitable for JSON saved views. */
export function serializeTableModel(model: TableModel): TableModel {
  return parseTableModel(model);
}

export function normalizeCell(value: unknown, column: TableColumn): TableValue {
  if (value == null) return null;
  if (column.kind === "date") return dateValue(value, "invalid-cell");
  if ((column.kind === "text" || column.kind === "enum") && typeof value === "string") return value;
  if (column.kind === "number" && typeof value === "number" && Number.isFinite(value)) return value === 0 ? 0 : value;
  if (column.kind === "boolean" && typeof value === "boolean") return value;
  if (column.kind === "tags" && Array.isArray(value)) {
    const tags: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") throw new TableModelError("invalid-cell", "tags must be strings in a dense plain-data array.");
      tags.push(descriptor.value);
    }
    return [...new Set(tags)].sort();
  }
  throw new TableModelError("invalid-cell", "cell does not match its declared column kind.");
}
