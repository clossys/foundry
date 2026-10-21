import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import { DataTableViewModelError, editView, parseDataTableViewModel, serializeDataTableViewModel } from "../data-table/view-model.js";

const columns = [
  { id: "name", kind: "text" }, { id: "seats", kind: "number" },
  { id: "renewal", kind: "date" }, { id: "plan", kind: "enum" },
  { id: "labels", kind: "tags" }, { id: "active", kind: "boolean" },
] as const;
const base = { version: 2, columns, collation: { locale: "en" } } as const;
const viewBase = { version: 2, table: base, mode: "flat", density: "comfortable", sort: [], visibleColumns: columns.map(column => column.id) } as const;
const text = { column: "name", kind: "text", op: "equals", value: "Alpha" } as const;
const group = { kind: "group", op: "and", items: [text] } as const;
const withFilter = (filter: unknown, version = 2) => ({ ...base, version, filters: [filter] });
type Entry = { id: string; target: "table" | "view"; input: unknown };
const corpus: Entry[] = [];
const tableCase = (id: string, input: unknown) => corpus.push({ id, target: "table", input });
const viewCase = (id: string, input: unknown) => corpus.push({ id, target: "view", input });

// The accepted names are a hand-written oracle, independent of parser output.
const tableAccepted = new Set([
  "v1-contains", "v1-text-equals", "v1-number-range", "v1-date-range", "v1-in", "v1-any", "v1-all", "v1-none", "v1-boolean-equals",
  "v2-contains", "v2-text-equals", "v2-number-range", "v2-date-range", "v2-in", "v2-any", "v2-all", "v2-none", "v2-boolean-equals",
  "v2-notEquals", "v2-notIn", "v2-text-empty", "v2-text-notEmpty", "v2-number-empty", "v2-number-notEmpty",
  "v2-date-empty", "v2-date-notEmpty", "v2-enum-empty", "v2-enum-notEmpty", "v2-tags-empty", "v2-tags-notEmpty", "v2-boolean-empty", "v2-boolean-notEmpty",
  "v2-and", "v2-or", "v2-depth2", "v2-empty-depth1", "v2-empty-depth2",
]);
const viewAccepted = new Set([...tableAccepted, "view-v1", "view-v2", "view-width-48", "view-width-120", "view-width-2000", "view-pins-1", "view-pins-2", "view-pins-3"]);
const legacy = [
  ["contains", { ...text, op: "contains" }], ["text-equals", text],
  ["number-range", { column: "seats", kind: "number", op: "range", min: 0, max: 100 }],
  ["date-range", { column: "renewal", kind: "date", op: "range", min: "2026-01-01" }],
  ["in", { column: "plan", kind: "enum", op: "in", values: ["pro"] }],
  ...["any", "all", "none"].map(op => [op, { column: "labels", kind: "tags", op, values: ["red"] }]),
  ["boolean-equals", { column: "active", kind: "boolean", op: "equals", value: true }],
] as const;
for (const version of [1, 2]) for (const [name, filter] of legacy) tableCase(`v${version}-${name}`, withFilter(filter, version));
tableCase("v2-notEquals", withFilter({ ...text, op: "notEquals" }));
tableCase("v2-notIn", withFilter({ column: "plan", kind: "enum", op: "notIn", values: ["pro"] }));
for (const column of columns) for (const op of ["empty", "notEmpty"]) tableCase(`v2-${column.kind}-${op}`, withFilter({ column: column.id, kind: column.kind, op }));
tableCase("v2-and", withFilter(group));
tableCase("v2-or", withFilter({ ...group, op: "or" }));
tableCase("v2-depth2", withFilter({ ...group, items: [{ ...group, op: "or" }] }));
tableCase("v2-empty-depth1", withFilter({ ...group, items: [] }));
tableCase("v2-empty-depth2", withFilter({ ...group, items: [{ ...group, items: [] }] }));
viewCase("view-v1", { ...viewBase, version: 1, table: { ...base, version: 1 } });
viewCase("view-v2", viewBase);
for (const width of [48, 120, 2000]) viewCase(`view-width-${width}`, { ...viewBase, columnWidths: { name: width } });
for (const count of [1, 2, 3]) viewCase(`view-pins-${count}`, { ...viewBase, pinnedColumns: viewBase.visibleColumns.slice(0, count) });

// All eight cutter-written near-miss categories are retained verbatim.
const emptyNearMisses = new Set(["emty", "notEmptyy", "Empty", "NotEmpty", "еmpty", "isEmpty", "isNotEmpty", "exists"]);
const textNearMisses = new Set(["notEqual", "notEqualss", "contain", "notequals", "notContains", "neq"]);
for (const [category, ops] of [
  ["single", ["notEqual", "notEqualss", "notIm", "emty", "notEmptyy", "contain"]],
  ["case", ["NotIn", "NOTIN", "notequals", "Empty", "NotEmpty"]],
  ["separators", ["not_in", "not-in", "not in", "notIn ", " notIn"]],
  ["unicode", ["nоtIn", "еmpty"]],
  ["vocabulary", ["isEmpty", "isNotEmpty", "notContains", "neq", "nin", "exists", "between"]],
] as const) for (const op of ops) {
  const filter = emptyNearMisses.has(op) ? { column: "plan", kind: "enum", op }
    : textNearMisses.has(op) ? { ...text, op }
    : op === "between" ? { column: "seats", kind: "number", op, min: 0, max: 100 }
    : { column: "plan", kind: "enum", op, values: ["pro"] };
  tableCase(`${category}-leaf-${op}`, withFilter(filter));
}
for (const [category, ops] of [
  ["single", ["an", "orr"]], ["case", ["AND", "Or"]], ["separators", [" or", "and\u200b"]],
  ["unicode", ["оr"]], ["vocabulary", ["xor", "not", "nand", "all", "any"]],
] as const) for (const op of ops) tableCase(`${category}-group-${op}`, withFilter({ ...group, op }));
for (const [category, kind] of [["single", "grup"], ["case", "Group"], ["unicode", "grоup"]]) tableCase(`${category}-kind`, withFilter({ ...group, kind }));
for (const version of ["2", 3, 0]) tableCase(`value-version-${version}`, { ...base, version });
tableCase("value-notIn", withFilter({ column: "plan", kind: "enum", op: "notIn", values: "pro" }));
tableCase("value-notEquals", withFilter({ ...text, op: "notEquals", value: 5 }));
tableCase("value-empty-extra", withFilter({ column: "name", kind: "text", op: "empty", value: "" }));
tableCase("value-items-null", withFilter({ ...group, items: null }));
viewCase("value-view-version", { ...viewBase, version: "2" });
for (const [name, width] of [["string", "120"], ["low", 47], ["high", 2001], ["fraction", 47.5], ["nan", NaN], ["infinity", Infinity], ["negative", -48]]) viewCase(`value-width-${name}`, { ...viewBase, columnWidths: { name: width } });
viewCase("value-pins-string", { ...viewBase, pinnedColumns: "name" });
tableCase("container-filters", { ...base, filters: { 0: text } });
tableCase("container-items", withFilter({ ...group, items: { 0: text } }));
tableCase("container-bare-array", withFilter([text]));
tableCase("container-values-set", withFilter({ column: "plan", kind: "enum", op: "in", values: new Set(["pro"]) }));
viewCase("container-width-array", { ...viewBase, columnWidths: [["name", 120]] });
viewCase("container-width-map", { ...viewBase, columnWidths: new Map([["name", 120]]) });
viewCase("container-pins-set", { ...viewBase, pinnedColumns: new Set(["name"]) });
viewCase("container-pins-object", { ...viewBase, pinnedColumns: { 0: "name" } });
tableCase("structure-v1-group", withFilter(group, 1));
for (const filter of [{ ...text, op: "notEquals" }, { column: "plan", kind: "enum", op: "notIn", values: ["pro"] }, { column: "name", kind: "text", op: "empty" }, { column: "name", kind: "text", op: "notEmpty" }]) tableCase(`structure-v1-${filter.op}`, withFilter(filter, 1));
tableCase("structure-depth3", withFilter({ ...group, items: [{ ...group, items: [{ ...group, items: [] }] }] }));
viewCase("structure-pins-four", { ...viewBase, pinnedColumns: viewBase.visibleColumns.slice(0, 4) });
viewCase("structure-pins-hidden", { ...viewBase, visibleColumns: ["name"], pinnedColumns: ["seats"] });
viewCase("structure-pins-order", { ...viewBase, pinnedColumns: ["seats", "name"] });
viewCase("structure-pins-duplicate", { ...viewBase, pinnedColumns: ["name", "name"] });
viewCase("structure-width-unknown", { ...viewBase, columnWidths: { missing: 120 } });

describe("one generated filter/view near-miss corpus", () => {
  it("has exactly the hand-written accepted set and unique names", () => {
    expect(new Set(corpus.map(entry => entry.id)).size).toBe(corpus.length);
    expect(corpus.filter(entry => tableAccepted.has(entry.id))).toHaveLength(37);
    expect(corpus.filter(entry => viewAccepted.has(entry.id))).toHaveLength(45);
  });
  it.each(corpus)("table parser: $id", entry => {
    if (tableAccepted.has(entry.id)) expect(api.parseTableModel(entry.input)).toMatchObject({ version: (entry.input as { version: number }).version });
    else expect(() => api.parseTableModel(entry.input)).toThrow(api.TableModelError);
  });
  it.each(corpus)("view parser: $id", entry => {
    const input = entry.target === "table" ? { ...viewBase, table: entry.input } : entry.input;
    if (viewAccepted.has(entry.id)) expect(parseDataTableViewModel(input)).toMatchObject({ version: 2 });
    else expect(() => parseDataTableViewModel(input)).toThrow(DataTableViewModelError);
  });
});

// Hand-written row identities and outcomes also pin the exported host-parity fixture.
const semanticRows = [
  { id: "a", name: "Alpha", seats: 10, renewal: "2026-01-01", plan: "pro", labels: ["urgent", "other", "urgent"], active: true },
  { id: "b", name: "Beta", seats: 20, renewal: "2026-02-01", plan: "free", labels: ["other"], active: false },
  { id: "c", name: "", seats: 0, renewal: 0, plan: "", labels: [], active: false },
  { id: "d", name: null, seats: null, renewal: null, plan: null, labels: null, active: null },
  { id: "e", name: "alpha", seats: 30, renewal: "2026-03-01", plan: "pro", labels: ["urgent"], active: true },
];
const semanticModel = (filters: readonly api.TableFilterNode[], version: 1 | 2 = 2): api.TableModel => ({ version, columns, collation: { locale: "en", sensitivity: "base" }, filters });
const semanticCase = (name: string, filters: readonly api.TableFilterNode[], expectedIds: readonly string[], version: 1 | 2 = 2) => ({ name, model: semanticModel(filters, version), rows: semanticRows, expectedIds });
const semanticCases = [
  semanticCase("text contains", [{ ...text, op: "contains", value: "alp" }], ["a", "e"]),
  semanticCase("text equals collation", [{ ...text, value: "ALPHA" }], ["a", "e"]),
  semanticCase("number inclusive range", [{ column: "seats", kind: "number", op: "range", min: 10, max: 20 }], ["a", "b"]),
  semanticCase("date inclusive range", [{ column: "renewal", kind: "date", op: "range", min: "2026-01-15", max: "2026-02-01" }], ["b"]),
  semanticCase("enum in", [{ column: "plan", kind: "enum", op: "in", values: ["pro"] }], ["a", "e"]),
  semanticCase("tags any", [{ column: "labels", kind: "tags", op: "any", values: ["other"] }], ["a", "b"]),
  semanticCase("tags all", [{ column: "labels", kind: "tags", op: "all", values: ["urgent", "other"] }], ["a"]),
  semanticCase("tags none includes null", [{ column: "labels", kind: "tags", op: "none", values: ["urgent"] }], ["b", "c", "d"]),
  semanticCase("boolean equals", [{ column: "active", kind: "boolean", op: "equals", value: true }], ["a", "e"]),
  semanticCase("text notEquals includes null", [{ ...text, op: "notEquals" }], ["b", "c", "d"]),
  semanticCase("enum notIn includes null", [{ column: "plan", kind: "enum", op: "notIn", values: ["pro"] }], ["b", "c", "d"]),
  ...columns.flatMap(column => {
    const empty = column.kind === "text" || column.kind === "enum" || column.kind === "tags" ? ["c", "d"] : ["d"];
    const present = column.kind === "text" || column.kind === "enum" || column.kind === "tags" ? ["a", "b", "e"] : ["a", "b", "c", "e"];
    return [semanticCase(`${column.kind} empty`, [{ column: column.id, kind: column.kind, op: "empty" }], empty), semanticCase(`${column.kind} notEmpty`, [{ column: column.id, kind: column.kind, op: "notEmpty" }], present)];
  }),
  semanticCase("OR inside AND", [{ kind: "group", op: "and", items: [{ kind: "group", op: "or", items: [text, { column: "plan", kind: "enum", op: "in", values: ["free"] }] }, { column: "seats", kind: "number", op: "range", max: 20 }] }], ["a", "b"]),
  semanticCase("empty AND ignored", [{ kind: "group", op: "and", items: [] }], ["a", "b", "c", "d", "e"]),
  semanticCase("empty OR ignored", [{ kind: "group", op: "or", items: [] }], ["a", "b", "c", "d", "e"]),
  semanticCase("empty OR child ignored", [{ kind: "group", op: "or", items: [{ kind: "group", op: "or", items: [] }, text] }], ["a", "e"]),
  semanticCase("empty AND child ignored", [{ kind: "group", op: "or", items: [{ kind: "group", op: "and", items: [] }, text] }], ["a", "e"]),
  semanticCase("only nested empty groups ignored", [{ kind: "group", op: "or", items: [{ kind: "group", op: "and", items: [] }] }], ["a", "b", "c", "d", "e"]),
  semanticCase("v1 flat parity", [text, { column: "seats", kind: "number", op: "range", min: 20 }], ["e"], 1),
  semanticCase("v2 flat parity", [text, { column: "seats", kind: "number", op: "range", min: 20 }], ["e"]),
  semanticCase("empty tags any", [{ column: "labels", kind: "tags", op: "any", values: [] }], []),
  semanticCase("empty tags all", [{ column: "labels", kind: "tags", op: "all", values: [] }], ["a", "b", "c", "d", "e"]),
  semanticCase("empty tags none", [{ column: "labels", kind: "tags", op: "none", values: [] }], ["a", "b", "c", "d", "e"]),
  semanticCase("empty enum notIn", [{ column: "plan", kind: "enum", op: "notIn", values: [] }], ["a", "b", "c", "d", "e"]),
  semanticCase("OR facet model", [{ kind: "group", op: "or", items: [text, { column: "plan", kind: "enum", op: "in", values: ["free"] }] }], ["a", "b", "e"]),
];

describe("filter version 2 semantics", () => {
  it.each(semanticCases)("$name", fixture => {
    expect(api.filterRows(fixture.rows, fixture.model).rows.map(row => row.id)).toEqual(fixture.expectedIds);
  });
  it("exports the complete input-ordered host conformance set", () => {
    expect(api.TABLE_FILTER_CONFORMANCE).toEqual(semanticCases);
    expect(api.TABLE_FILTER_CONFORMANCE.length).toBeGreaterThanOrEqual(30);
    for (const fixture of api.TABLE_FILTER_CONFORMANCE) {
      expect(fixture.rows.every(row => typeof row.id === "string")).toBe(true);
      expect(api.filterRows(fixture.rows, fixture.model).rows.map(row => row.id)).toEqual(fixture.expectedIds);
    }
  });
  it("keeps the predicate independent of search and parses once", () => {
    const model = { ...semanticModel([text]), search: "Beta" };
    const predicate = api.tableFilterPredicate<typeof semanticRows[number]>(model);
    model.filters = [{ ...text, value: "Beta" }];
    expect(semanticRows.filter(predicate).map(row => row.id)).toEqual(["a", "e"]);
    expect(api.filterRows(semanticRows, { ...semanticModel([text]), search: "Beta" }).rows).toEqual([]);
    expect(() => predicate({ ...semanticRows[0]!, seats: "bad" } as never)).toThrow(api.TableModelError);
  });
  it("prunes every target leaf recursively, retaining other-column leaves and ignoring emptied groups", () => {
    const other = { column: "plan", kind: "enum", op: "in", values: ["free"] } as const;
    const filters: api.TableFilterNode[] = [{ kind: "group", op: "or", items: [text, { kind: "group", op: "and", items: [text, other] }] }, text];
    const before = structuredClone(filters);
    expect(api.pruneFilterColumn(filters, "name")).toEqual([{ kind: "group", op: "or", items: [{ kind: "group", op: "and", items: [other] }] }]);
    expect(filters).toEqual(before);
    expect(api.pruneFilterColumn([group], "name")).toEqual([]);
    const model = semanticModel([{ kind: "group", op: "or", items: [text, other] }]);
    expect(api.filterRows(semanticRows, model).facets.name).toEqual([{ value: "Beta", count: 1 }]);
    expect(api.filterRows(semanticRows, { ...model, search: "Alpha" }).facets.name).toEqual([]);
  });
  it("preserves flat AND rows, every facet and version 1 serialization", () => {
    for (const fixture of semanticCases.filter(fixture => fixture.model.filters?.every(node => node.kind !== "group" && !["empty", "notEmpty", "notEquals", "notIn"].includes(node.op)))) {
      const v1 = { ...fixture.model, version: 1 } as const;
      expect(api.filterRows(fixture.rows, { ...v1, version: 2 })).toEqual(api.filterRows(fixture.rows, v1));
      expect(api.serializeTableModel(v1)).toEqual(v1);
    }
  });
  it("keeps unsupported versions distinct from invalid v1 filters and excessive depth", () => {
    for (const version of ["2", 3, 0]) expect(() => api.parseTableModel({ ...base, version })).toThrow(expect.objectContaining({ code: "unsupported-version" }));
    for (const id of ["structure-v1-group", "structure-v1-notEquals", "structure-v1-notIn", "structure-v1-empty", "structure-v1-notEmpty", "structure-depth3"]) expect(() => api.parseTableModel(corpus.find(entry => entry.id === id)!.input)).toThrow(expect.objectContaining({ code: "invalid-model" }));
  });
  it("retains descriptor safety for recursive groups and width/pin containers", () => {
    let reads = 0;
    const accessor = { ...group };
    Object.defineProperty(accessor, "items", { enumerable: true, get() { reads++; return []; } });
    expect(() => api.parseTableModel(withFilter(accessor))).toThrow(api.TableModelError);
    const widths = Object.defineProperty({}, "name", { enumerable: true, get() { reads++; return 120; } });
    expect(() => parseDataTableViewModel({ ...viewBase, columnWidths: widths })).toThrow(DataTableViewModelError);
    expect(() => parseDataTableViewModel({ ...viewBase, pinnedColumns: new Array(1) })).toThrow(DataTableViewModelError);
    expect(reads).toBe(0);
  });
  it("applies grouped filters consistently to aggregate, group and pivot operations", () => {
    const model: api.TableModel = { ...semanticModel([{ kind: "group", op: "or", items: [text, { column: "plan", kind: "enum", op: "in", values: ["free"] }] }]), groupBy: [{ column: "plan" }], measures: [{ id: "count", op: "count" }], pivot: { rows: [{ column: "plan" }], columns: [] } };
    expect(api.aggregate(semanticRows, model)).toEqual({ count: 3 });
    expect(api.groupRows(semanticRows, model).flatMap(group => group.rows).map(row => row.id).sort()).toEqual(["a", "b", "e"]);
    expect(api.pivotRows(semanticRows, model).totals).toEqual({ count: 3 });
  });
});

describe("view version 2 migration", () => {
  it("migrates without dropping nested fields or adding optional keys, and serializes v2", () => {
    const v1 = { ...viewBase, version: 1, table: { ...withFilter(text, 1), search: "Alpha" } };
    const parsed = parseDataTableViewModel(v1);
    expect(parsed).toEqual({ ...v1, version: 2 });
    expect(Object.keys(parsed).sort()).toEqual(["density", "mode", "sort", "table", "version", "visibleColumns"]);
    expect(parsed.table).not.toBe(v1.table);
    expect(JSON.parse(serializeDataTableViewModel(v1))).toEqual(parsed);
    expect(parsed.table.version).toBe(1);
  });
  it("preserves widths and pins through copying, serialization and edits", () => {
    const input = { ...viewBase, columnWidths: { name: 48, seats: 2000 }, pinnedColumns: ["name", "seats"] };
    const parsed = parseDataTableViewModel(input);
    expect(parsed).toEqual(input);
    expect(parsed.columnWidths).not.toBe(input.columnWidths);
    expect(parsed.pinnedColumns).not.toBe(input.pinnedColumns);
    const edited = editView(parsed, { density: "compact" });
    expect(edited.columnWidths).toBe(parsed.columnWidths);
    expect(edited.pinnedColumns).toBe(parsed.pinnedColumns);
    expect(parseDataTableViewModel(serializeDataTableViewModel(edited))).toEqual(edited);
  });
  it("requires integer widths inside the valid numeric bounds", () => {
    for (const width of [48.5, 120.5, 1999.5]) expect(() => parseDataTableViewModel({ ...viewBase, columnWidths: { name: width } })).toThrow(DataTableViewModelError);
  });
  it("uses DataTableViewModelError for nested table rejection under R8", () => {
    expect(() => parseDataTableViewModel({ ...viewBase, table: { ...base, version: 3 } })).toThrow(DataTableViewModelError);
    expect(() => api.parseTableModel({ ...base, version: 3 })).toThrow(api.TableModelError);
  });
});
