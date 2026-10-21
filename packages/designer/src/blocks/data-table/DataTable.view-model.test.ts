import { describe, expect, it } from "vitest";
import { DataTableViewModelError, parseDataTableViewModel, serializeDataTableViewModel, type DataTableViewModelV1 } from "./view-model.js";
import { filterRows } from "../table-model/index.js";
import { sortViewRows } from "./presentation.js";
const model: DataTableViewModelV1 = {
  version: 1, mode: "flat", density: "comfortable", sort: [{ column: "amount", direction: "descending" }], visibleColumns: ["name", "amount"],
  table: { version: 1, columns: [{ id: "name", kind: "text" }, { id: "amount", kind: "number" }], collation: { locale: "en", numeric: true } },
};
describe("DataTable saved view", () => {
  it("round trips the complete envelope independently of the original and nested engine model", () => {
    const decoded = parseDataTableViewModel(serializeDataTableViewModel(model));
    expect(decoded).toEqual({ ...model, version: 2 }); expect(decoded).not.toBe(model); expect(decoded.table).not.toBe(model.table);
    expect(parseDataTableViewModel(decoded)).toEqual(decoded);
  });
  it.each([
    null, "{", { ...model, version: 3 }, { ...model, mode: "chart" }, { ...model, density: "tiny" }, { ...model, visibleColumns: [] },
    { ...model, visibleColumns: ["missing"] }, { ...model, visibleColumns: ["name", "name"] }, { ...model, sort: [{ column: "missing", direction: "ascending" }] },
    { ...model, sort: [{ column: "amount", direction: "up" }] }, { ...model, sort: [model.sort[0], model.sort[0]] }, { ...model, extra: "unknown" },
    { ...model, sort: [{ column: "amount", direction: "ascending", extra: true }] }, { ...model, sort: new Array(1) },
  ])("refuses invalid envelope data %#", invalid => expect(() => parseDataTableViewModel(invalid)).toThrow(DataTableViewModelError));
  it("rejects accessors without invoking them and refuses prototypes", () => {
    let called = false;
    const getter = { ...model }; Object.defineProperty(getter, "mode", { enumerable: true, get: () => { called = true; return "flat"; } });
    expect(() => parseDataTableViewModel(getter)).toThrow(DataTableViewModelError); expect(called).toBe(false);
    expect(() => parseDataTableViewModel(Object.assign(Object.create({ inherited: true }), model))).toThrow(DataTableViewModelError);
  });
  it("uses the engine's strict nested validator", () => {
    expect(() => parseDataTableViewModel({ ...model, table: { ...model.table, sort: [] } })).toThrow(DataTableViewModelError);
    expect(() => parseDataTableViewModel({ ...model, table: { ...model.table, filters: [{ column: "missing", kind: "text", op: "equals", value: "x" }] } })).toThrow(DataTableViewModelError);
  });
  it("uses ordered sort rules with stable ties, nulls and explicit numeric text collation", () => {
    const rows = [{ name: "Item 10", amount: 2 }, { name: "Item 2", amount: 2 }, { name: "Item 2", amount: 2 }, { name: "None", amount: null }];
    Object.freeze(rows); rows.forEach(Object.freeze);
    const view = parseDataTableViewModel({ ...model, sort: [{ column: "amount", direction: "ascending" }, { column: "name", direction: "ascending" }] });
    const sorted = sortViewRows(filterRows(rows, view.table).rows, view);
    expect(sorted).toEqual([rows[3], rows[1], rows[2], rows[0]]); expect(sorted[1]).toBe(rows[1]);
    expect(rows[0]?.name).toBe("Item 10");
  });
  it("sorts dates, booleans and canonical tag sets without changing cells", () => {
    const table = { version: 1, columns: [{ id: "date", kind: "date" }, { id: "flag", kind: "boolean" }, { id: "tags", kind: "tags" }], collation: { locale: "en" } } as const;
    const rows = [{ date: "2026-02-01", flag: true, tags: ["z", "a", "a"] }, { date: 0, flag: false, tags: ["a", "z"] }];
    const filtered = filterRows(rows, table).rows;
    for (const column of ["date", "flag"]) expect(sortViewRows(filtered, parseDataTableViewModel({ ...model, table, visibleColumns: ["date", "flag", "tags"], sort: [{ column, direction: "ascending" }] }))).toEqual([rows[1], rows[0]]);
    expect(sortViewRows(filtered, parseDataTableViewModel({ ...model, table, visibleColumns: ["date", "flag", "tags"], sort: [{ column: "tags", direction: "ascending" }] }))).toEqual(rows);
    expect(rows[0]?.tags).toEqual(["z", "a", "a"]);
  });
});
