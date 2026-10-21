import type { FilterBuilderProps } from "../FilterBuilder.js";
import type { TableColumn, TableColumnKind, TableFilter, TableFilterNode, TableModel } from "../table-model/index.js";

export function operatorsFor(kind: TableColumnKind): readonly TableFilter["op"][] {
  switch (kind) {
    case "text": return ["contains", "equals", "notEquals", "empty", "notEmpty"];
    case "number": case "date": return ["range", "empty", "notEmpty"];
    case "enum": return ["in", "notIn", "empty", "notEmpty"];
    case "tags": return ["any", "all", "none", "empty", "notEmpty"];
    case "boolean": return ["equals", "empty", "notEmpty"];
  }
}
export function newCondition(column: TableColumn): TableFilter {
  const head = { column: column.id };
  switch (column.kind) {
    case "text": return { ...head, kind: "text", op: "contains", value: "" };
    case "number": return { ...head, kind: "number", op: "range" };
    case "date": return { ...head, kind: "date", op: "range" };
    case "enum": return { ...head, kind: "enum", op: "in", values: [] };
    case "tags": return { ...head, kind: "tags", op: "any", values: [] };
    case "boolean": return { ...head, kind: "boolean", op: "equals", value: true };
  }
}
/** UI completeness, deliberately separate from the engine's saved-data validation. */
export function complete(node: TableFilterNode): boolean {
  if (node.kind === "group") return node.items.every(complete);
  if (node.op === "empty" || node.op === "notEmpty") return true;
  if ("value" in node) return typeof node.value !== "string" || node.value.trim().length > 0;
  if ("values" in node) return node.values.length > 0;
  return node.op === "range" && (node.min !== undefined || node.max !== undefined);
}
export function needsVersionTwo(nodes: readonly TableFilterNode[]): boolean {
  return nodes.some(node => node.kind === "group" || ["notEquals", "notIn", "empty", "notEmpty"].includes(node.op));
}
export function groupLevels(nodes: readonly TableFilterNode[]): number {
  return Math.max(0, ...nodes.map(node => node.kind === "group" ? 1 + groupLevels(node.items) : 0));
}
export function sentence(node: TableFilterNode, props: Pick<FilterBuilderProps, "labels" | "columnLabels" | "formatValue">): string {
  if (node.kind === "group") return props.labels.describeGroup(node.op, node.items.length);
  const format = (value: Parameters<NonNullable<FilterBuilderProps["formatValue"]>>[1]) => props.formatValue?.(node.column, value) ?? String(value);
  let value = "";
  if ("value" in node) value = typeof node.value === "boolean" ? (node.value ? props.labels.yes : props.labels.no) : format(node.value);
  else if ("values" in node) value = node.values.map(format).join(", ");
  else if ("min" in node || "max" in node) value = [node.min === undefined ? "" : `${props.labels.min} ${format(node.min)}`, node.max === undefined ? "" : `${props.labels.max} ${format(node.max)}`].filter(Boolean).join(" – ");
  return props.labels.describe(props.columnLabels[node.column] ?? node.column, node, value);
}
export function nextFilters(model: TableModel, filters: readonly TableFilterNode[]): TableModel { return { ...model, filters }; }
