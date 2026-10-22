import { dateValue, normalizeCell, parseTableModel, TableModelError } from "./model.js";
import type { TableAggregates, TableAggregateValue, TableColumn, TableDimension, TableFacet, TableFilter, TableFilterNode, TableFilterResult, TableGroup, TableModel, TablePivotAxis, TablePivotCell, TablePivotResult, TableValue } from "./types.js";

export { parseTableModel, serializeTableModel, TableModelError } from "./model.js";
export { TABLE_FILTER_CONFORMANCE } from "./conformance.js";
export type { TableValue, TableColumnKind, TableColumn, TableCollation, TableFilter, TableFilterGroup, TableFilterNode, TableDimension, TableMeasure, TablePivot, TableModel, TableFacet, TableFilterResult, TableAggregateValue, TableAggregates, TableGroup, TablePivotAxis, TablePivotCell, TablePivotResult, TableModelErrorCode } from "./types.js";

interface Entry<Row> { readonly row: Row; readonly values: ReadonlyMap<string, TableValue> }
interface Context<Row> {
  readonly model: TableModel;
  readonly columns: ReadonlyMap<string, TableColumn>;
  readonly entries: readonly Entry<Row>[];
  readonly collator: Intl.Collator;
}

function normalizeRow<Row extends object>(row: Row, columns: readonly TableColumn[]): Entry<Row> {
  if (row === null || typeof row !== "object" || Array.isArray(row)) throw new TableModelError("invalid-cell", "each row must be an object.");
  const values = new Map(columns.map(column => {
    const descriptor = Object.getOwnPropertyDescriptor(row, column.id);
    if (descriptor && !Object.hasOwn(descriptor, "value")) throw new TableModelError("invalid-cell", "cells must be plain data rather than accessors.");
    return [column.id, normalizeCell(descriptor?.value, column)] as const;
  }));
  return { row, values };
}

function prepare<Row extends object>(rows: readonly Row[], input: TableModel): Context<Row> {
  const model = parseTableModel(input);
  if (!Array.isArray(rows)) throw new TableModelError("invalid-cell", "rows must be an array.");
  const entries: Entry<Row>[] = [];
  for (const row of rows) entries.push(normalizeRow(row, model.columns));
  return { model, entries, columns: new Map(model.columns.map(column => [column.id, column])), collator: new Intl.Collator(model.collation.locale, model.collation) };
}

function compareText(a: string, b: string, collator: Intl.Collator): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function compareValue(a: TableValue, b: TableValue, column: TableColumn, collator: Intl.Collator): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (column.kind === "date") return Date.parse(a as string) - Date.parse(b as string);
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  if (typeof a === "boolean" && typeof b === "boolean") return a ? 1 : -1;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const comparison = compareText(a[index]!, b[index]!, collator);
      if (comparison) return comparison;
    }
    return a.length - b.length;
  }
  return compareText(String(a), String(b), collator);
}

function contains(value: string, query: string, locale: string): boolean {
  return value.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale));
}

function isEmptyFilter(filter: TableFilter): filter is Extract<TableFilter, { op: "empty" | "notEmpty" }> {
  return filter.op === "empty" || filter.op === "notEmpty";
}

function matches(value: TableValue, filter: TableFilter, context: Context<unknown>): boolean {
  if (isEmptyFilter(filter)) {
    const empty = value === null || value === "" || (Array.isArray(value) && value.length === 0);
    return filter.op === "empty" ? empty : !empty;
  }
  if (filter.kind === "tags") {
    const tags = value === null ? [] : value as readonly string[];
    if (filter.op === "all") return filter.values.every(tag => tags.includes(tag));
    if (filter.op === "any") return filter.values.some(tag => tags.includes(tag));
    return filter.values.every(tag => !tags.includes(tag));
  }
  if (value === null) return filter.op === "notEquals" || filter.op === "notIn";
  if (filter.kind === "text") {
    if (filter.op === "contains") return contains(value as string, filter.value, context.model.collation.locale);
    const equal = context.collator.compare(value as string, filter.value) === 0;
    return filter.op === "notEquals" ? !equal : equal;
  }
  if (filter.kind === "boolean") return value === filter.value;
  if (filter.kind === "enum") {
    const included = filter.values.includes(value as string);
    return filter.op === "notIn" ? !included : included;
  }
  const number = filter.kind === "date" ? Date.parse(value as string) : value as number;
  const bound = (value: string | number): number => filter.kind === "date" ? Date.parse(dateValue(value, "invalid-model")) : value as number;
  if (filter.min !== undefined && number < bound(filter.min)) return false;
  if (filter.max !== undefined && number > bound(filter.max)) return false;
  return true;
}

function passesSearch<Row>(entry: Entry<Row>, context: Context<Row>): boolean {
  const search = context.model.search;
  if (!search) return true;
  return context.model.columns.some(column => {
    if (column.searchable === false) return false;
    const value = entry.values.get(column.id)!;
    if (value === null) return false;
    return Array.isArray(value) ? value.some(tag => contains(tag, search, context.model.collation.locale)) : contains(String(value), search, context.model.collation.locale);
  });
}

function evaluateNode<Row>(entry: Entry<Row>, node: TableFilterNode, context: Context<Row>): boolean | undefined {
  if (node.kind !== "group") return matches(entry.values.get(node.column)!, node, context);
  const results = node.items.map(item => evaluateNode(entry, item, context)).filter((result): result is boolean => result !== undefined);
  if (!results.length) return undefined;
  return node.op === "and" ? results.every(Boolean) : results.some(Boolean);
}

function passesFilters<Row>(entry: Entry<Row>, nodes: readonly TableFilterNode[], context: Context<Row>): boolean {
  return nodes.every(node => evaluateNode(entry, node, context) !== false);
}

/** Compile filters once; global search remains the caller's separate operation. */
export function tableFilterPredicate<Row extends object>(model: TableModel): (row: Row) => boolean {
  const context = prepare<Row>([], model);
  return row => passesFilters(normalizeRow(row, context.model.columns), context.model.filters ?? [], context);
}

/** Remove a column's leaves at every depth, dropping groups left empty. */
export function pruneFilterColumn(nodes: readonly TableFilterNode[], column: string): readonly TableFilterNode[] {
  return nodes.flatMap((node): TableFilterNode[] => {
    if (node.kind !== "group") return node.column === column ? [] : [node];
    const items = pruneFilterColumn(node.items, column);
    return items.length ? [{ ...node, items }] : [];
  });
}

function selected<Row>(context: Context<Row>): readonly Entry<Row>[] {
  return context.entries.filter(entry => passesSearch(entry, context) && passesFilters(entry, context.model.filters ?? [], context));
}

/** Filter with global search and recursively disjunctive, row-counted facets. */
export function filterRows<Row extends object>(rows: readonly Row[], model: TableModel): TableFilterResult<Row> {
  const context = prepare(rows, model);
  const searchable = context.entries.filter(entry => passesSearch(entry, context));
  const filters = context.model.filters ?? [];
  const passing = searchable.filter(entry => passesFilters(entry, filters, context));
  const facets = context.model.columns.map(column => {
    const pruned = pruneFilterColumn(filters, column.id);
    const counts = new Map<string, { value: TableValue; count: number }>();
    for (const entry of searchable) {
      if (!passesFilters(entry, pruned, context)) continue;
      const value = entry.values.get(column.id)!;
      const values: readonly TableValue[] = column.kind === "tags" && value !== null ? value as readonly string[] : [value];
      for (const value of values) {
        const key = JSON.stringify(value);
        const prior = counts.get(key);
        if (prior) prior.count++;
        else counts.set(key, { value, count: 1 });
      }
    }
    // Tag facets contain individual strings, rather than set dimensions.
    const facetColumn: TableColumn = column.kind === "tags" ? { ...column, kind: "text" } : column;
    const values: TableFacet[] = [...counts.values()].sort((a, b) => compareValue(a.value, b.value, facetColumn, context.collator));
    return [column.id, values] as const;
  });
  return { rows: passing.map(entry => entry.row), facets: Object.fromEntries(facets) };
}

function summarize<Row>(entries: readonly Entry<Row>[], context: Context<Row>): TableAggregates {
  return Object.fromEntries((context.model.measures ?? []).map(measure => {
    if (measure.op === "count" && measure.column === undefined) return [measure.id, entries.length];
    const values = entries.map(entry => entry.values.get(measure.column!)!).filter((value): value is Exclude<TableValue, null> => value !== null);
    if (measure.op === "count") return [measure.id, values.length];
    if (measure.op === "distinct") return [measure.id, new Set(values.map(value => JSON.stringify(value))).size];
    if (measure.op === "sum" || measure.op === "avg") {
      const sum = (values as number[]).reduce((sum, value) => sum + value, 0);
      if (!Number.isFinite(sum)) throw new TableModelError("aggregate-overflow", "numeric aggregate exceeds the finite number range.");
      return [measure.id, measure.op === "sum" ? sum : values.length ? sum / values.length : null];
    }
    if (!values.length) return [measure.id, null];
    const column = context.columns.get(measure.column!)!;
    const value = values.reduce((best, value) => {
      const comparison = compareValue(value, best, column, context.collator);
      return (measure.op === "min" ? comparison < 0 : comparison > 0) ? value : best;
    });
    return [measure.id, value as TableAggregateValue];
  }));
}

/** Compute measures after the saved view's filters; nulls are excluded from column measures. */
export function aggregate<Row extends object>(rows: readonly Row[], model: TableModel): TableAggregates {
  const context = prepare(rows, model);
  return summarize(selected(context), context);
}

/** Group any number of dimensions with stable keys, sorted children and source-row aggregates. */
export function groupRows<Row extends object>(rows: readonly Row[], model: TableModel): readonly TableGroup<Row>[] {
  const context = prepare(rows, model);
  const dimensions = context.model.groupBy ?? [];
  const build = (entries: readonly Entry<Row>[], depth: number, parent: readonly TableValue[]): readonly TableGroup<Row>[] => {
    const dimension = dimensions[depth];
    if (!dimension) return [];
    const buckets = new Map<string, { value: TableValue; entries: Entry<Row>[] }>();
    for (const entry of entries) {
      const value = entry.values.get(dimension.column)!;
      const key = JSON.stringify(value);
      const prior = buckets.get(key);
      if (prior) prior.entries.push(entry);
      else buckets.set(key, { value, entries: [entry] });
    }
    const column = context.columns.get(dimension.column)!;
    return [...buckets.values()].sort((a, b) => compareValue(a.value, b.value, column, context.collator) * (dimension.order === "desc" ? -1 : 1)).map(bucket => {
      const path = [...parent, bucket.value];
      return { key: JSON.stringify(path), column: column.id, value: bucket.value, path, rows: bucket.entries.map(entry => entry.row), aggregates: summarize(bucket.entries, context), children: build(bucket.entries, depth + 1, path) };
    });
  };
  return build(selected(context), 0, []);
}

function axis<Row>(entries: readonly Entry<Row>[], dimensions: readonly TableDimension[], context: Context<Row>): readonly TablePivotAxis[] {
  const paths = new Map<string, readonly TableValue[]>([["[]", []]]);
  for (const entry of entries) {
    const path: TableValue[] = [];
    for (const dimension of dimensions) {
      path.push(entry.values.get(dimension.column)!);
      paths.set(JSON.stringify(path), [...path]);
    }
  }
  return [...paths].map(([key, path]): TablePivotAxis => ({ key, path, kind: path.length === 0 ? "total" : path.length === dimensions.length ? "leaf" : "subtotal" })).sort((a, b) => {
    for (let depth = 0; depth < Math.min(a.path.length, b.path.length); depth++) {
      const dimension = dimensions[depth]!;
      const comparison = compareValue(a.path[depth]!, b.path[depth]!, context.columns.get(dimension.column)!, context.collator) * (dimension.order === "desc" ? -1 : 1);
      if (comparison) return comparison;
    }
    return a.path.length - b.path.length;
  });
}

function prefixKeys<Row>(entry: Entry<Row>, dimensions: readonly TableDimension[]): readonly string[] {
  const result = ["[]"];
  const path: TableValue[] = [];
  for (const dimension of dimensions) {
    path.push(entry.values.get(dimension.column)!);
    result.push(JSON.stringify(path));
  }
  return result;
}

/**
 * Cross observed prefix axes, including totals and subtotals. Empty intersections are explicit.
 * Refuses more than 100,000 measure slots before constructing the Cartesian cell array.
 */
export function pivotRows<Row extends object>(rows: readonly Row[], model: TableModel): TablePivotResult {
  const context = prepare(rows, model);
  const pivot = context.model.pivot;
  if (!pivot) throw new TableModelError("invalid-model", "pivot dimensions are required.");
  const entries = selected(context);
  const rowAxis = axis(entries, pivot.rows, context);
  const columnAxis = axis(entries, pivot.columns, context);
  const slots = rowAxis.length * columnAxis.length * context.model.measures!.length;
  if (!Number.isSafeInteger(slots) || slots > 100_000) throw new TableModelError("pivot-budget", "pivot exceeds the 100,000 measure-slot budget.");
  const buckets = new Map<string, Map<string, Entry<Row>[]>>();
  for (const entry of entries) {
    const columns = prefixKeys(entry, pivot.columns);
    for (const row of prefixKeys(entry, pivot.rows)) {
      let rowBuckets = buckets.get(row);
      if (!rowBuckets) { rowBuckets = new Map(); buckets.set(row, rowBuckets); }
      for (const column of columns) {
        const bucket = rowBuckets.get(column);
        if (bucket) bucket.push(entry);
        else rowBuckets.set(column, [entry]);
      }
    }
  }
  const empty = summarize([], context);
  const cells: TablePivotCell[] = [];
  for (const row of rowAxis) for (const column of columnAxis) {
    const bucket = buckets.get(row.key)?.get(column.key);
    cells.push({ rowKey: row.key, columnKey: column.key, empty: !bucket?.length, aggregates: bucket ? summarize(bucket, context) : { ...empty } });
  }
  return { rowAxis, columnAxis, cells, totals: summarize(entries, context) };
}
