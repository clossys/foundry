import type { TableFilterNode, TableModel } from "./types.js";

const columns = [
  { id: "name", kind: "text" }, { id: "seats", kind: "number" },
  { id: "renewal", kind: "date" }, { id: "plan", kind: "enum" },
  { id: "labels", kind: "tags" }, { id: "active", kind: "boolean" },
] as const;
const text = { column: "name", kind: "text", op: "equals", value: "Alpha" } as const;
const semanticRows = [
  { id: "a", name: "Alpha", seats: 10, renewal: "2026-01-01", plan: "pro", labels: ["urgent", "other", "urgent"], active: true },
  { id: "b", name: "Beta", seats: 20, renewal: "2026-02-01", plan: "free", labels: ["other"], active: false },
  { id: "c", name: "", seats: 0, renewal: 0, plan: "", labels: [], active: false },
  { id: "d", name: null, seats: null, renewal: null, plan: null, labels: null, active: null },
  { id: "e", name: "alpha", seats: 30, renewal: "2026-03-01", plan: "pro", labels: ["urgent"], active: true },
];
const semanticModel = (filters: readonly TableFilterNode[], version: 1 | 2 = 2): TableModel => ({ version, columns, collation: { locale: "en", sensitivity: "base" }, filters });
const semanticCase = (name: string, filters: readonly TableFilterNode[], expectedIds: readonly string[], version: 1 | 2 = 2) => ({ name, model: semanticModel(filters, version), rows: semanticRows, expectedIds });
export const TABLE_FILTER_CONFORMANCE: readonly { name: string; model: TableModel; rows: readonly Record<string, unknown>[]; expectedIds: readonly string[] }[] = [
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
