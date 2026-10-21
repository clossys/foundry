import { describe, expect, it } from "vitest";
import {
  aggregate,
  filterRows,
  groupRows,
  parseTableModel,
  pivotRows,
  serializeTableModel,
  TableModelError,
  type TableFilter,
  type TableModel,
} from "./index.js";

describe.each([1, 2] as const)("table engine v%s compatibility", version => {
const columns: TableModel["columns"] = [
  { id: "name", kind: "text" },
  { id: "amount", kind: "number" },
  { id: "date", kind: "date" },
  { id: "region", kind: "enum" },
  { id: "team", kind: "enum" },
  { id: "year", kind: "number" },
  { id: "quarter", kind: "enum" },
  { id: "channel", kind: "enum" },
  { id: "tags", kind: "tags" },
  { id: "active", kind: "boolean" },
];

const rows = [
  { name: "Aster", amount: 10, date: "2026-01-01", region: "East", team: "Blue", year: 2026, quarter: "Q1", channel: "Web", tags: ["red", "urgent"], active: true },
  { name: "Birch", amount: 20, date: "2026-01-02", region: "East", team: "Blue", year: 2026, quarter: "Q1", channel: "Store", tags: ["red"], active: false },
  { name: "Cedar", amount: 30, date: "2026-01-03", region: "East", team: "Gold", year: 2026, quarter: "Q2", channel: "Web", tags: ["urgent", "blue"], active: true },
  { name: "Aster", amount: 40, date: "2026-01-04", region: "West", team: "Blue", year: 2027, quarter: "Q1", channel: "Web", tags: [], active: false },
  { name: "Elm", amount: null, date: null, region: "West", team: "Gold", year: 2027, quarter: "Q2", channel: "Store", tags: null, active: null },
];

function model(delta: Partial<TableModel> = {}): TableModel {
  return {
    version,
    columns,
    collation: { locale: "en", sensitivity: "base" },
    measures: [
      { id: "count", op: "count" },
      { id: "present", op: "count", column: "amount" },
      { id: "sum", op: "sum", column: "amount" },
      { id: "min", op: "min", column: "amount" },
      { id: "max", op: "max", column: "amount" },
      { id: "avg", op: "avg", column: "amount" },
      { id: "distinct", op: "distinct", column: "name" },
    ],
    ...delta,
  };
}

function names(filters: readonly TableFilter[], search?: string) {
  return filterRows(rows, model({ filters, search })).rows.map(row => row.name);
}

describe("table-model filters", () => {
  it("implements contains and equals separately, with explicit locale case handling", () => {
    expect(names([{ column: "name", kind: "text", op: "contains", value: "ste" }])).toEqual(["Aster", "Aster"]);
    expect(names([{ column: "name", kind: "text", op: "equals", value: "aster" }])).toEqual(["Aster", "Aster"]);
    expect(names([{ column: "name", kind: "text", op: "equals", value: "ste" }])).toEqual([]);
    expect(filterRows([{ name: "İSTANBUL" }, { name: "Izmir" }], model({ columns: [{ id: "name", kind: "text" }], measures: [], collation: { locale: "tr" }, filters: [{ column: "name", kind: "text", op: "contains", value: "istan" }] })).rows).toEqual([{ name: "İSTANBUL" }]);
  });

  it("uses inclusive number bounds and excludes null values", () => {
    expect(names([{ column: "amount", kind: "number", op: "range", min: 10, max: 20 }])).toEqual(["Aster", "Birch"]);
    expect(names([{ column: "amount", kind: "number", op: "range", min: 30 }])).toEqual(["Cedar", "Aster"]);
    expect(names([{ column: "amount", kind: "number", op: "range", max: 10 }])).toEqual(["Aster"]);
    expect(names([{ column: "amount", kind: "number", op: "range", min: 10, max: 10 }])).toEqual(["Aster"]);
    expect(names([{ column: "amount", kind: "number", op: "range", min: 100 }])).toEqual([]);
  });

  it("uses inclusive UTC date bounds, accepting epoch milliseconds and canonical dates", () => {
    expect(names([{ column: "date", kind: "date", op: "range", min: "2026-01-01", max: "2026-01-02" }])).toEqual(["Aster", "Birch"]);
    expect(names([{ column: "date", kind: "date", op: "range", min: Date.UTC(2026, 0, 3) }])).toEqual(["Cedar", "Aster"]);
    expect(names([{ column: "date", kind: "date", op: "range", max: "2026-01-01T00:00:00.000Z" }])).toEqual(["Aster"]);
  });

  it("implements enum membership and both boolean values", () => {
    expect(names([{ column: "region", kind: "enum", op: "in", values: ["West"] }])).toEqual(["Aster", "Elm"]);
    expect(names([{ column: "region", kind: "enum", op: "in", values: [] }])).toEqual([]);
    expect(names([{ column: "active", kind: "boolean", op: "equals", value: true }])).toEqual(["Aster", "Cedar"]);
    expect(names([{ column: "active", kind: "boolean", op: "equals", value: false }])).toEqual(["Birch", "Aster"]);
  });

  it("distinguishes tags any, all and none, including empty queries and missing tags", () => {
    expect(names([{ column: "tags", kind: "tags", op: "any", values: ["red", "urgent"] }])).toEqual(["Aster", "Birch", "Cedar"]);
    expect(names([{ column: "tags", kind: "tags", op: "all", values: ["red", "urgent"] }])).toEqual(["Aster"]);
    expect(names([{ column: "tags", kind: "tags", op: "none", values: ["red", "urgent"] }])).toEqual(["Aster", "Elm"]);
    expect(names([{ column: "tags", kind: "tags", op: "any", values: [] }])).toEqual([]);
    expect(names([{ column: "tags", kind: "tags", op: "all", values: [] }])).toHaveLength(rows.length);
    expect(names([{ column: "tags", kind: "tags", op: "none", values: [] }])).toHaveLength(rows.length);
  });

  it("ANDs filters and global search without changing row order", () => {
    expect(names([
      { column: "region", kind: "enum", op: "in", values: ["East"] },
      { column: "amount", kind: "number", op: "range", min: 15 },
      { column: "active", kind: "boolean", op: "equals", value: true },
    ], "URGENT")).toEqual(["Cedar"]);
    expect(names([], "2027")).toEqual(["Aster", "Elm"]);
    expect(names([], "no matching value")).toEqual([]);
    expect(names([], "")).toEqual(rows.map(row => row.name));
    const hidden = model({ columns: columns.map(column => ({ ...column, searchable: column.id !== "name" })), search: "Birch" });
    expect(filterRows(rows, hidden).rows).toEqual([]);
  });

  it("computes disjunctive facets after global search and other-column filters, counting each tag once per row", () => {
    const result = filterRows(rows, model({ filters: [
      { column: "region", kind: "enum", op: "in", values: ["East"] },
      { column: "active", kind: "boolean", op: "equals", value: true },
    ] }));
    expect(result.rows.map(row => row.name)).toEqual(["Aster", "Cedar"]);
    expect(result.facets.region).toEqual([{ value: "East", count: 2 }]);
    expect(result.facets.active).toEqual([{ value: false, count: 1 }, { value: true, count: 2 }]);
    expect(result.facets.tags).toEqual([{ value: "blue", count: 1 }, { value: "red", count: 1 }, { value: "urgent", count: 2 }]);
    const tags = filterRows([{ tags: ["red", "red"] }, { tags: ["red"] }, { tags: null }], model({ columns: [{ id: "tags", kind: "tags" }], measures: [] }));
    expect(tags.facets.tags).toEqual([{ value: null, count: 1 }, { value: "red", count: 2 }]);
    expect(filterRows(rows, model({ search: "Birch", filters: [{ column: "region", kind: "enum", op: "in", values: ["West"] }] })).facets.region).toEqual([{ value: "East", count: 1 }]);
  });

  it("returns fresh arrays and keeps frozen rows, tags, models and input order unchanged", () => {
    const input = Object.freeze(rows.map(row => Object.freeze({ ...row, tags: row.tags && Object.freeze([...row.tags].reverse()) })));
    const saved = JSON.stringify(input);
    const view = Object.freeze(model({ groupBy: Object.freeze([{ column: "region" }]), pivot: { rows: [{ column: "region" }], columns: [{ column: "year" }] } }));
    const freeze = (value: unknown): void => {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    };
    freeze(view);
    const savedModel = JSON.stringify(view);
    const output = filterRows(input, view);
    expect(output.rows).not.toBe(input);
    expect(output.rows[0]).toBe(input[0]);
    aggregate(input, view);
    groupRows(input, view);
    pivotRows(input, view);
    serializeTableModel(view);
    expect(JSON.stringify(input)).toBe(saved);
    expect(JSON.stringify(view)).toBe(savedModel);
  });
});

describe("table-model aggregates and groups", () => {
  it("defines count, present count, sum, min, max, average and distinct over source rows", () => {
    expect(aggregate(rows, model())).toEqual({ count: 5, present: 4, sum: 100, min: 10, max: 40, avg: 25, distinct: 4 });
    expect(aggregate([], model())).toEqual({ count: 0, present: 0, sum: 0, min: null, max: null, avg: null, distinct: 0 });
    expect(aggregate(rows, model({ filters: [{ column: "region", kind: "enum", op: "in", values: ["East"] }] }))).toEqual({ count: 3, present: 3, sum: 60, min: 10, max: 30, avg: 20, distinct: 3 });
  });

  it("aggregates date/text extrema and distinct tag sets without conflating missing values", () => {
    const view = model({ measures: [
      { id: "date", op: "min", column: "date" },
      { id: "name", op: "max", column: "name" },
      { id: "tags", op: "distinct", column: "tags" },
    ] });
    expect(aggregate(rows, view)).toEqual({ date: "2026-01-01T00:00:00.000Z", name: "Elm", tags: 4 });
    expect(aggregate([{ tags: ["a,b"] }, { tags: ["a", "b"] }, { tags: ["b", "a", "a"] }, { tags: null }], model({ columns: [{ id: "tags", kind: "tags" }], measures: [{ id: "sets", op: "distinct", column: "tags" }] }))).toEqual({ sets: 2 });
  });

  it.each([1, 2, 3])("groups %i levels with per-node row aggregates", levels => {
    const dimensions = ["region", "team", "year"].slice(0, levels).map(column => ({ column }));
    const groups = groupRows(rows, model({ groupBy: dimensions }));
    expect(groups.map(group => group.value)).toEqual(["East", "West"]);
    expect(groups[0]!.aggregates).toEqual({ count: 3, present: 3, sum: 60, min: 10, max: 30, avg: 20, distinct: 3 });
    const visit = (nodes: typeof groups, depth: number) => {
      for (const node of nodes) {
        expect(node.path).toHaveLength(depth);
        expect(node.key).toBe(JSON.stringify(node.path));
        expect(node.aggregates.count).toBe(node.rows.length);
        expect(node.aggregates.sum).toBe(node.rows.reduce((sum, row) => sum + (row.amount ?? 0), 0));
        if (depth === levels) expect(node.children).toEqual([]);
        else {
          expect(node.children.length).toBeGreaterThan(0);
          expect(node.children.reduce((count, child) => count + child.rows.length, 0)).toBe(node.rows.length);
          visit(node.children, depth + 1);
        }
      }
    };
    visit(groups, 1);
    expect(groupRows([], model({ groupBy: dimensions }))).toEqual([]);
  });

  it("normalizes null and undefined together, separately from the literal null string", () => {
    const input = [{ value: null }, {}, { value: "null" }, { value: "a" }];
    const view = model({ columns: [{ id: "value", kind: "text" }], groupBy: [{ column: "value" }], measures: [{ id: "count", op: "count" }] });
    const groups = groupRows(input, view);
    expect(groups.map(group => [group.value, group.rows.length, group.key])).toEqual([[null, 2, "[null]"], ["a", 1, '["a"]'], ["null", 1, '["null"]']]);
  });

  it("breaks collation ties deterministically and applies explicit locale and descending order", () => {
    const input = [{ value: "a" }, { value: "A" }, { value: "ä" }, { value: "z" }];
    const view = model({ columns: [{ id: "value", kind: "text" }], groupBy: [{ column: "value" }], measures: [] });
    const expected = groupRows(input, view).map(group => group.key);
    expect(expected).toEqual(['["A"]', '["a"]', '["ä"]', '["z"]']);
    for (let offset = 0; offset < input.length; offset++) {
      const permutation = [...input.slice(offset), ...input.slice(0, offset)].reverse();
      expect(groupRows(permutation, view).map(group => group.key)).toEqual(expected);
    }
    expect(groupRows(input, { ...view, collation: { locale: "sv" } }).map(group => group.value)).toEqual(["a", "A", "z", "ä"]);
    expect(groupRows(input, { ...view, groupBy: [{ column: "value", order: "desc" }] }).map(group => group.key)).toEqual([...expected].reverse());
  });

  it("treats tags as one canonical set dimension without multiplying rows", () => {
    const input = [{ tags: ["b", "a"] }, { tags: ["a", "b", "a"] }, { tags: [] }, { tags: null }];
    const groups = groupRows(input, model({ columns: [{ id: "tags", kind: "tags" }], groupBy: [{ column: "tags" }], measures: [{ id: "count", op: "count" }] }));
    expect(groups.map(group => [group.value, group.aggregates.count])).toEqual([[null, 1], [[], 1], [["a", "b"], 2]]);
  });
});

describe("table-model pivot", () => {
  it.each([2, 3])("pivots two row dimensions and %i column dimensions with explicit sparse cells and every subtotal", columnCount => {
    const rowDimensions = ["region", "team"];
    const columnDimensions = ["year", "quarter", "channel"].slice(0, columnCount);
    const view = model({ pivot: { rows: rowDimensions.map(column => ({ column })), columns: columnDimensions.map(column => ({ column })) } });
    const result = pivotRows(rows, view);
    expect(result.totals).toEqual({ count: 5, present: 4, sum: 100, min: 10, max: 40, avg: 25, distinct: 4 });
    expect(new Set(result.rowAxis.map(axis => axis.path.length))).toEqual(new Set([0, 1, 2]));
    expect(new Set(result.columnAxis.map(axis => axis.path.length))).toEqual(new Set(Array.from({ length: columnCount + 1 }, (_, index) => index)));
    expect(result.cells).toHaveLength(result.rowAxis.length * result.columnAxis.length);
    for (const rowAxis of result.rowAxis) for (const columnAxis of result.columnAxis) {
      const cell = result.cells.find(item => item.rowKey === rowAxis.key && item.columnKey === columnAxis.key)!;
      expect(cell).toBeDefined();
      const matching = rows.filter(row => rowAxis.path.every((value, index) => row[rowDimensions[index]! as keyof typeof row] === value) && columnAxis.path.every((value, index) => row[columnDimensions[index]! as keyof typeof row] === value));
      const values = matching.map(row => row.amount).filter((value): value is number => value !== null);
      expect(cell.empty).toBe(matching.length === 0);
      expect(cell.aggregates.count).toBe(matching.length);
      expect(cell.aggregates.sum).toBe(values.reduce((sum, value) => sum + value, 0));
      expect(cell.aggregates.avg).toBe(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
      expect(cell.aggregates.distinct).toBe(new Set(matching.map(row => row.name)).size);
    }
    expect(result.cells.some(cell => cell.empty && cell.aggregates.count === 0 && cell.aggregates.sum === 0 && cell.aggregates.avg === null)).toBe(true);
    expect(result.rowAxis.filter(axis => axis.kind === "subtotal").map(axis => axis.path)).toEqual([["East"], ["West"]]);
    expect(result.rowAxis[0]).toMatchObject({ key: "[]", path: [], kind: "total" });
    expect(result.cells.find(cell => cell.rowKey === "[]" && cell.columnKey === "[]")!.aggregates).toEqual(aggregate(rows, view));
    expect(pivotRows([...rows].reverse(), view)).toEqual(result);
  });

  it("keeps source-row average and distinct totals, rather than adding child results", () => {
    const result = pivotRows(rows, model({ pivot: { rows: [{ column: "region" }], columns: [{ column: "year" }] } }));
    expect(result.totals.avg).toBe(25);
    expect(result.totals.distinct).toBe(4);
    expect(result.totals.count).toBe(5);
  });

  it("returns an explicit empty grand-total cell, including a zero-dimensional pivot", () => {
    for (const pivot of [{ rows: [{ column: "region" }], columns: [{ column: "year" }] }, { rows: [], columns: [] }]) {
      const result = pivotRows([], model({ pivot }));
      expect(result.rowAxis).toEqual([{ key: "[]", path: [], kind: "total" }]);
      expect(result.columnAxis).toEqual([{ key: "[]", path: [], kind: "total" }]);
      expect(result.cells).toEqual([{ rowKey: "[]", columnKey: "[]", empty: true, aggregates: { count: 0, present: 0, sum: 0, min: null, max: null, avg: null, distinct: 0 } }]);
    }
  });

  it("refuses an oversized Cartesian result with a typed error before allocating cells", () => {
    const input = Array.from({ length: 1000 }, (_, index) => ({ a: index, b: index }));
    const view = model({ columns: [{ id: "a", kind: "number" }, { id: "b", kind: "number" }], measures: [{ id: "count", op: "count" }], pivot: { rows: [{ column: "a" }], columns: [{ column: "b" }] } });
    expect(() => pivotRows(input, view)).toThrowError(TableModelError);
    try { pivotRows(input, view); } catch (error) { expect(error).toMatchObject({ code: "pivot-budget" }); }
  });
});

describe("table-model saved views and errors", () => {
  it("round trips a complete plain-object saved view without retaining input references", () => {
    const view = model({ filters: [{ column: "amount", kind: "number", op: "range", min: 10, max: 30 }, { column: "tags", kind: "tags", op: "any", values: ["red"] }], search: "a", groupBy: [{ column: "region", order: "desc" }], pivot: { rows: [{ column: "team" }], columns: [{ column: "year" }] } });
    const saved = serializeTableModel(view);
    expect(saved).toEqual(view);
    expect(saved).not.toBe(view);
    expect(saved.columns).not.toBe(view.columns);
    expect(saved.filters).not.toBe(view.filters);
    const restored = parseTableModel(JSON.parse(JSON.stringify(saved)));
    expect(restored).toEqual(view);
    expect(filterRows(rows, restored)).toEqual(filterRows(rows, view));
    expect(groupRows(rows, restored)).toEqual(groupRows(rows, view));
    expect(pivotRows(rows, restored)).toEqual(pivotRows(rows, view));
  });

  it("rejects an unknown model version with a typed code", () => {
    expect(() => parseTableModel({ ...model(), version: 3 })).toThrowError(TableModelError);
    try { parseTableModel({ ...model(), version: 3 }); } catch (error) { expect(error).toMatchObject({ name: "TableModelError", code: "unsupported-version" }); }
  });

  it("refuses model accessors and sparse arrays without invoking accessor code", () => {
    let reads = 0;
    const view = { ...model() };
    Object.defineProperty(view, "search", { enumerable: true, get() { reads++; return "x"; } });
    expect(() => parseTableModel(view)).toThrowError(TableModelError);
    const values: unknown[] = [];
    Object.defineProperty(values, "0", { enumerable: true, get() { reads++; return { id: "x", kind: "text" }; } });
    expect(() => parseTableModel({ ...model(), columns: values })).toThrowError(TableModelError);
    expect(() => parseTableModel({ ...model(), columns: new Array(2) })).toThrowError(TableModelError);
    const row = Object.defineProperty({}, "name", { get() { reads++; return "Aster"; } });
    expect(() => filterRows([row], model())).toThrowError(TableModelError);
    expect(reads).toBe(0);
  });

  it("reports finite-number aggregate overflow with a typed code", () => {
    const view = model({ columns: [{ id: "amount", kind: "number" }], measures: [{ id: "sum", op: "sum", column: "amount" }] });
    expect(() => aggregate([{ amount: Number.MAX_VALUE }, { amount: Number.MAX_VALUE }], view)).toThrowError(TableModelError);
    try { aggregate([{ amount: Number.MAX_VALUE }, { amount: Number.MAX_VALUE }], view); } catch (error) { expect(error).toMatchObject({ code: "aggregate-overflow" }); }
  });

  it.each([
    null,
    { ...model(), surprise: true },
    { ...model(), columns: [{ id: "name", kind: "unknown" }] },
    { ...model(), collation: undefined },
    { ...model(), collation: { locale: "not_a_locale" } },
    { ...model(), columns: [{ id: "name", kind: "text" }, { id: "name", kind: "text" }] },
    { ...model(), filters: [{ column: "amount", kind: "number", op: "range", min: 30, max: 10 }] },
    { ...model(), filters: [{ column: "date", kind: "date", op: "range", min: "2026-02-30" }] },
    { ...model(), filters: [{ column: "name", kind: "number", op: "range", min: 0 }] },
    { ...model(), filters: [{ column: "name", kind: "text", op: "unknown", value: "x" }] },
    { ...model(), groupBy: [{ column: "missing" }] },
    { ...model(), groupBy: [{ column: "name" }, { column: "name" }] },
    { ...model(), measures: [{ id: "sum", op: "sum", column: "name" }] },
    { ...model(), measures: [{ id: "min", op: "min", column: "tags" }] },
    { ...model(), measures: [{ id: "x", op: "count" }, { id: "x", op: "count" }] },
  ])("rejects malformed saved-view data %#", value => {
    expect(() => parseTableModel(value)).toThrowError(TableModelError);
  });

  it.each([
    { amount: Number.NaN }, { amount: Number.POSITIVE_INFINITY }, { amount: "10" },
    { date: "2026-02-30" }, { date: "01/02/2026" }, { active: "true" }, { tags: ["red", 1] },
  ])("rejects invalid cells with a typed error %#", row => {
    expect(() => filterRows([row], model())).toThrowError(TableModelError);
    try { filterRows([row], model()); } catch (error) { expect(error).toMatchObject({ code: "invalid-cell" }); }
  });

  it("keeps special record keys as own data keys and ignores inherited row values", () => {
    const row = JSON.parse('{"__proto__":7}');
    const view = model({ columns: [{ id: "__proto__", kind: "number" }], measures: [{ id: "__proto__", op: "sum", column: "__proto__" }] });
    expect(Object.hasOwn(aggregate([row], view), "__proto__")).toBe(true);
    expect(aggregate([row], view)["__proto__"]).toBe(7);
    expect(aggregate([Object.create(JSON.parse('{"__proto__":8}'))], view)["__proto__"]).toBe(0);
  });
});

describe("table-model performance budget", () => {
  it("filters, groups and pivots 10,000 rows within a stated 2,000 ms computation budget", () => {
    const input = Array.from({ length: 10_000 }, (_, index) => ({
      name: "Row " + index, amount: index % 100, date: "2026-01-01", region: "R" + (index % 4), team: "T" + (Math.floor(index / 4) % 3), year: 2026 + (index % 2), quarter: "Q" + (Math.floor(index / 8) % 4), channel: "Web", tags: ["tag" + (index % 3)], active: index % 2 === 0,
    }));
    const view = model({ filters: [{ column: "amount", kind: "number", op: "range", min: 10, max: 90 }], groupBy: [{ column: "region" }, { column: "team" }, { column: "year" }], pivot: { rows: [{ column: "region" }, { column: "team" }], columns: [{ column: "year" }, { column: "quarter" }] }, measures: [{ id: "count", op: "count" }, { id: "sum", op: "sum", column: "amount" }, { id: "avg", op: "avg", column: "amount" }] });
    const start = performance.now();
    const filtered = filterRows(input, view);
    const groups = groupRows(input, view);
    const pivot = pivotRows(input, view);
    const elapsed = performance.now() - start;
    expect(filtered.rows).toHaveLength(8_100);
    expect(groups.reduce((count, group) => count + group.rows.length, 0)).toBe(8_100);
    expect(pivot.totals.count).toBe(8_100);
    expect(elapsed).toBeLessThan(2_000);
  });
});

});
