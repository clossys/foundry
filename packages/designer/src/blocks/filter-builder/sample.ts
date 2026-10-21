import type { TableFilter, TableModel, TableValue } from "../table-model/index.js";

/** Fictional studio projects; host-owned copy for the draft examples. */
export const sampleRows = [
  { id: "harbour", name: "Harbour library signage", status: "active", owner: "Mira Okafor", budget: 4200, due: "2026-11-14", labels: ["Design", "Print"], archived: false },
  { id: "spring", name: "Spring catalogue", status: "planned", owner: "Jonas Berg", budget: 12800, due: "2026-12-01", labels: ["Launch", "Print"], archived: false },
  { id: "guide", name: "Onboarding guide", status: "paused", owner: "Lena Park", budget: 950, due: "2027-01-20", labels: ["Design"], archived: false },
  { id: "survey", name: "Field survey app", status: "active", owner: null, budget: 30000, due: "2027-03-05", labels: ["Research", "Launch"], archived: false },
  { id: "report", name: "Annual report", status: "done", owner: "Mira Okafor", budget: null, due: null, labels: [], archived: true },
];
export const sampleColumnLabels = { name: "Project", status: "Status", owner: "Owner", budget: "Budget", due: "Due", labels: "Labels", archived: "Archived" };
export const sampleModel: TableModel = {
  version: 2, collation: { locale: "en", sensitivity: "base", numeric: true },
  columns: [{ id: "name", kind: "text" }, { id: "status", kind: "enum" }, { id: "owner", kind: "text" }, { id: "budget", kind: "number" }, { id: "due", kind: "date" }, { id: "labels", kind: "tags" }, { id: "archived", kind: "boolean" }],
  filters: [{ column: "status", kind: "enum", op: "in", values: ["active", "planned"] }, { column: "due", kind: "date", op: "range", max: "2026-12-31" }, { kind: "group", op: "or", items: [{ column: "owner", kind: "text", op: "empty" }, { column: "labels", kind: "tags", op: "any", values: ["Launch"] }] }],
};
const operators = { contains: "contains", equals: "is", notEquals: "is not", range: "between", in: "is any of", notIn: "is none of", any: "has any of", all: "has all of", none: "has none of", empty: "is empty", notEmpty: "is not empty" };
export const sampleLabels = {
  region: "Filters", addFilter: "Add filter", clearAll: "Clear all", advanced: "Advanced", apply: "Apply", cancel: "Cancel",
  describe: (column: string, filter: TableFilter, valueText: string) => `${column} ${operators[filter.op]} ${valueText}`.trim(),
  describeGroup: (op: "and" | "or", count: number) => `${op === "and" ? "All" : "Any"} of ${count} conditions`,
  remove: (sentence: string) => `Remove ${sentence}`, operators, connective: { and: "All of", or: "Any of" },
  matchLabel: "Match", columnLabel: "Column", operatorLabel: "Condition", valueLabel: "Value", addCondition: "Add condition", addGroup: "Add group",
  removeCondition: (sentence: string) => `Remove ${sentence}`, min: "From", max: "To", invalidRange: "Enter a start that is not after the end.", dateHint: "Use YYYY-MM-DD.", valueRequired: "Enter a value.", noValues: "No values to choose from.", yes: "Yes", no: "No",
  resultCount: (count: number) => `${count} projects`, depthLimit: "The maximum nesting depth is reached.", simplifyGroups: "Simplify nested groups first.",
};
export function sampleFormatValue(column: string, value: TableValue): string {
  if (column === "status" && typeof value === "string") return ({ planned: "Planned", active: "Active", paused: "Paused", done: "Done" } as Record<string, string>)[value] ?? value;
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}
