import {
  aggregate, filterRows, groupRows, pivotRows,
  parseTableModel, serializeTableModel, type TableModel,
} from "@clossys/designer/blocks";

const records = [
  { region: "East", team: "Blue", year: 2026, quarter: "Q1", amount: 20, tags: ["urgent"] },
  { region: "East", team: "Gold", year: 2026, quarter: "Q2", amount: 30, tags: ["urgent", "follow-up"] },
];
const view: TableModel = {
  version: 1,
  columns: [
    { id: "region", kind: "enum" }, { id: "team", kind: "enum" },
    { id: "year", kind: "number" }, { id: "quarter", kind: "enum" },
    { id: "amount", kind: "number" }, { id: "tags", kind: "tags" },
  ],
  collation: { locale: "en", sensitivity: "base", numeric: true },
  filters: [{ column: "tags", kind: "tags", op: "all", values: ["urgent"] }],
  groupBy: [{ column: "region" }, { column: "team" }],
  measures: [
    { id: "rows", op: "count" },
    { id: "total", op: "sum", column: "amount" },
    { id: "average", op: "avg", column: "amount" },
  ],
  pivot: {
    rows: [{ column: "region" }, { column: "team" }],
    columns: [{ column: "year" }, { column: "quarter" }],
  },
};
const filtered = filterRows(records, view); // { rows, facets }
const groups = groupRows(records, view);    // nested groups with rows and aggregates
const pivot = pivotRows(records, view);    // rowAxis, columnAxis, cells, totals
const totals = aggregate(records, view);   // { rows: 2, total: 50, average: 25 }
const saved = serializeTableModel(view);   // independent validated plain object
const restored = parseTableModel(JSON.parse(JSON.stringify(saved)));
export { filtered, restored };
export { groups, pivot, totals };
