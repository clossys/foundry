import type { ColumnMapperIssue, ColumnMapperProps, ColumnMapping } from "../ColumnMapper.js";
import { copy, record } from "../access-matrix/validate.js";

const KINDS = ["text", "number", "date", "enum", "tags", "boolean"];

export function mappedSource(mapping: ColumnMapping, targetId: string): string | null {
  return Object.hasOwn(mapping, targetId) ? mapping[targetId]! : null;
}

export function assertColumnMapper(props: ColumnMapperProps): void {
  if (!Array.isArray(props.targets) || !Array.isArray(props.sourceColumns) || !record(props.mapping)) throw new TypeError("ColumnMapper: targets and sourceColumns must be arrays and mapping a record.");
  const targets = new Set<string>(), sources = new Set<string>();
  for (const target of props.targets) {
    if (!record(target) || !copy(target.id) || !copy(target.label) || targets.has(target.id) || !KINDS.includes(target.kind as string) || typeof target.required !== "boolean" || (target.description !== undefined && !copy(target.description))) throw new TypeError("ColumnMapper: targets need distinct ids, labels, supported kinds and boolean required flags.");
    targets.add(target.id);
  }
  for (const source of props.sourceColumns) {
    if (!record(source) || !copy(source.id) || !copy(source.header) || sources.has(source.id) || !Array.isArray(source.samples) || source.samples.some(sample => typeof sample !== "string")) throw new TypeError("ColumnMapper: sources need distinct ids, headers and string sample arrays.");
    sources.add(source.id);
  }
  for (const [target, source] of Object.entries(props.mapping)) {
    if (!targets.has(target) || (source !== null && (typeof source !== "string" || !sources.has(source)))) throw new TypeError("ColumnMapper: mapping must name declared targets and source ids or null.");
  }
  if (!record(props.labels) || ![props.labels.legend, props.labels.notMapped, props.labels.required].every(copy) || ![props.labels.requiredMissing, props.labels.duplicate, props.labels.samples, props.labels.summary].every(value => typeof value === "function") || typeof props.onMappingChange !== "function") throw new TypeError("ColumnMapper: labels and onMappingChange are required.");
  if (props.issues !== undefined && (!Array.isArray(props.issues) || props.issues.some(issue => !record(issue) || !targets.has(issue.targetId as string)))) throw new TypeError("ColumnMapper: issues must name declared targets.");
}

export function columnMapperIssues(props: ColumnMapperProps): readonly ColumnMapperIssue[] {
  const counts = new Map<string, number>();
  for (const target of props.targets) {
    const source = mappedSource(props.mapping, target.id);
    if (source !== null) counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  const issues: ColumnMapperIssue[] = [];
  for (const target of props.targets) {
    const sourceId = mappedSource(props.mapping, target.id);
    if (target.required && sourceId === null) issues.push({ targetId: target.id, message: props.labels.requiredMissing(target.label) });
    if (sourceId !== null && (counts.get(sourceId) ?? 0) > 1) {
      const source = props.sourceColumns.find(column => column.id === sourceId)!;
      issues.push({ targetId: target.id, message: props.labels.duplicate(source.header) });
    }
  }
  return [...issues, ...(props.issues ?? [])];
}
