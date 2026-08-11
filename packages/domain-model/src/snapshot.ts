import { defineDomainModel } from "./define.js";
import { validateDomainModel } from "./validate.js";
import type {
  DomainModelDefinition,
  DomainRecord,
  DomainRecordDefinition,
  DomainRelation,
  DomainRelationDefinition,
  DomainSnapshot,
  DomainSnapshotDefinition,
  DomainSnapshotFinding,
  FieldDefinition,
  PrimitiveValueType,
  RelationCardinality,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

interface RelationCandidate {
  index: number;
  type: string;
  from: string;
  to: string;
  identity: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function copyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyValue(entry)]));
}

function copyValues(values: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, copyValue(value)]));
}

/** Creates a detached snapshot without asserting that its values satisfy a model. */
export function defineDomainSnapshot(definition: DomainSnapshotDefinition): DomainSnapshot {
  const records: DomainRecord[] = (definition.records ?? []).map((record) => ({
    id: record.id,
    type: record.type,
    values: copyValues(record.values),
  }));
  const relations: DomainRelation[] = (definition.relations ?? []).map((relation) => ({
    type: relation.type,
    from: relation.from,
    to: relation.to,
    values: copyValues(relation.values),
  }));
  return { records, relations };
}

function finding(rule: string, message: string, path: string): DomainSnapshotFinding {
  return { rule, severity: "error", message, path };
}

function arrayAt(record: UnknownRecord, key: string, findings: DomainSnapshotFinding[], path: string): unknown[] {
  const value = record[key];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  findings.push(finding("collection-shape", `${key} must be an array when provided.`, path));
  return [];
}

function nonEmptyStringAt(record: UnknownRecord, key: string, findings: DomainSnapshotFinding[], path: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) return value;
  findings.push(finding("required-string", `${key} must be a non-empty string.`, path));
  return undefined;
}

function valuesAt(record: UnknownRecord, findings: DomainSnapshotFinding[], path: string): UnknownRecord {
  const value = record.values;
  if (value === undefined) return {};
  if (isRecord(value)) return value;
  findings.push(finding("values-shape", "values must be an object when provided.", path));
  return {};
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function isDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  if (!isCalendarDate(match[1] ?? "")) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  const offset = match[6] ?? "";
  if (offset !== "Z") {
    const [offsetHour, offsetMinute] = offset.slice(1).split(":").map(Number);
    if (offsetHour === undefined || offsetMinute === undefined || offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
}

function isJsonValue(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    try {
      return value.every((entry) => isJsonValue(entry, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (!isRecord(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    return Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

function matchesPrimitive(value: unknown, primitive: PrimitiveValueType): boolean {
  switch (primitive) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "date": return typeof value === "string" && isCalendarDate(value);
    case "datetime": return typeof value === "string" && isDateTime(value);
    case "json": return isJsonValue(value);
  }
}

function validateValues(
  values: UnknownRecord,
  fields: readonly FieldDefinition[],
  primitiveByValueType: ReadonlyMap<string, PrimitiveValueType>,
  vocabularyValues: ReadonlyMap<string, ReadonlySet<string>>,
  findings: DomainSnapshotFinding[],
  path: string,
): void {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  for (const key of Object.keys(values)) {
    if (!fieldsById.has(key)) findings.push(finding("unknown-value", `values.${key} is not declared by this type.`, `${path}.values.${key}`));
  }
  for (const field of fields) {
    const value = values[field.id];
    const valuePath = `${path}.values.${field.id}`;
    if (value === undefined) {
      if (field.required === true) findings.push(finding("required-value", `Required value "${field.id}" is missing.`, valuePath));
      continue;
    }
    const vocabulary = vocabularyValues.get(field.valueType);
    if (vocabulary !== undefined) {
      if (typeof value !== "string" || !vocabulary.has(value)) {
        findings.push(finding("vocabulary-value", `Value for "${field.id}" must be a declared vocabulary member.`, valuePath));
      }
      continue;
    }
    const primitive = primitiveByValueType.get(field.valueType) ?? field.valueType;
    if (!matchesPrimitive(value, primitive as PrimitiveValueType)) {
      findings.push(finding("value-type", `Value for "${field.id}" does not match "${field.valueType}".`, valuePath));
    }
  }
}

function cardinalityViolation(cardinality: RelationCardinality, fromCount: number, toCount: number): boolean {
  switch (cardinality) {
    case "one-to-one": return fromCount > 1 || toCount > 1;
    case "one-to-many": return toCount > 1;
    case "many-to-one": return fromCount > 1;
    case "many-to-many": return false;
  }
}

/**
 * Validates a snapshot against a domain model without throwing for malformed
 * input. Model validation runs first so instance findings never rely on an
 * ambiguous declaration.
 */
export function validateDomainSnapshot(model: DomainModelDefinition, value: unknown): DomainSnapshotFinding[] {
  const modelFindings = validateDomainModel(model);
  if (modelFindings.length > 0) {
    return modelFindings.map((entry) => ({ ...entry, rule: `model-${entry.rule}`, message: `Domain model: ${entry.message}` }));
  }
  if (!isRecord(value)) return [finding("snapshot-shape", "A domain snapshot must be an object.", "$")];

  const normalizedModel = defineDomainModel(model);
  const findings: DomainSnapshotFinding[] = [];
  const records = arrayAt(value, "records", findings, "records");
  const relations = arrayAt(value, "relations", findings, "relations");
  const typesById = new Map(normalizedModel.types.map((type) => [type.id, type]));
  const relationsById = new Map(normalizedModel.relations.map((relation) => [relation.id, relation]));
  const primitiveByValueType = new Map(normalizedModel.valueTypes.map((valueType) => [valueType.id, valueType.primitive]));
  const vocabularyValues = new Map(normalizedModel.vocabularies.map((vocabulary) => [vocabulary.id, new Set(vocabulary.values)]));
  const recordTypes = new Map<string, string>();

  records.forEach((candidate, index) => {
    const path = `records[${index}]`;
    if (!isRecord(candidate)) {
      findings.push(finding("record-shape", "A record must be an object.", path));
      return;
    }
    const id = nonEmptyStringAt(candidate, "id", findings, `${path}.id`);
    const type = nonEmptyStringAt(candidate, "type", findings, `${path}.type`);
    const values = valuesAt(candidate, findings, `${path}.values`);
    if (id !== undefined) {
      if (recordTypes.has(id)) findings.push(finding("duplicate-record-id", `Duplicate record id "${id}".`, `${path}.id`));
      else if (type !== undefined) recordTypes.set(id, type);
    }
    if (type === undefined) return;
    const typeDefinition = typesById.get(type);
    if (typeDefinition === undefined) {
      findings.push(finding("unknown-record-type", `Record type "${type}" is not declared by the model.`, `${path}.type`));
      return;
    }
    validateValues(values, typeDefinition.fields ?? [], primitiveByValueType, vocabularyValues, findings, path);
  });

  const relationCandidates: RelationCandidate[] = [];
  relations.forEach((candidate, index) => {
    const path = `relations[${index}]`;
    if (!isRecord(candidate)) {
      findings.push(finding("relation-shape", "A relation must be an object.", path));
      return;
    }
    const type = nonEmptyStringAt(candidate, "type", findings, `${path}.type`);
    const from = nonEmptyStringAt(candidate, "from", findings, `${path}.from`);
    const to = nonEmptyStringAt(candidate, "to", findings, `${path}.to`);
    const values = valuesAt(candidate, findings, `${path}.values`);
    if (type === undefined || from === undefined || to === undefined) return;
    const relationDefinition = relationsById.get(type);
    if (relationDefinition === undefined) {
      findings.push(finding("unknown-relation-type", `Relation type "${type}" is not declared by the model.`, `${path}.type`));
      return;
    }
    const fromType = recordTypes.get(from);
    const toType = recordTypes.get(to);
    if (fromType === undefined) findings.push(finding("relation-from-record", `from record "${from}" is not present in this snapshot.`, `${path}.from`));
    else if (fromType !== relationDefinition.from) findings.push(finding("relation-from-type", `from record "${from}" must have type "${relationDefinition.from}".`, `${path}.from`));
    if (toType === undefined) findings.push(finding("relation-to-record", `to record "${to}" is not present in this snapshot.`, `${path}.to`));
    else if (toType !== relationDefinition.to) findings.push(finding("relation-to-type", `to record "${to}" must have type "${relationDefinition.to}".`, `${path}.to`));
    validateValues(values, relationDefinition.properties ?? [], primitiveByValueType, vocabularyValues, findings, path);
    if (fromType === relationDefinition.from && toType === relationDefinition.to) {
      relationCandidates.push({
        index,
        type,
        from,
        to,
        // A snapshot is a graph of facts. Repeating the same fact in input
        // must not turn a valid one-to-one or many-to-one fact into a false
        // cardinality violation.
        identity: `${type}\u0000${from}\u0000${to}\u0000${comparable(values)}`,
      });
    }
  });

  for (const relationDefinition of normalizedModel.relations) {
    const seen = new Set<string>();
    const candidates = relationCandidates.filter((candidate) => {
      if (candidate.type !== relationDefinition.id || seen.has(candidate.identity)) return false;
      seen.add(candidate.identity);
      return true;
    });
    const byFrom = new Map<string, number>();
    const byTo = new Map<string, number>();
    for (const candidate of candidates) {
      byFrom.set(candidate.from, (byFrom.get(candidate.from) ?? 0) + 1);
      byTo.set(candidate.to, (byTo.get(candidate.to) ?? 0) + 1);
    }
    for (const candidate of candidates) {
      if (cardinalityViolation(relationDefinition.cardinality, byFrom.get(candidate.from) ?? 0, byTo.get(candidate.to) ?? 0)) {
        findings.push(finding("relation-cardinality", `Relation "${relationDefinition.id}" violates its ${relationDefinition.cardinality} cardinality.`, `relations[${candidate.index}]`));
      }
    }
  }

  return findings;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeValue(value[key])]));
}

function comparable(value: unknown): string {
  try {
    const serialized = JSON.stringify(normalizeValue(value));
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function normalizeRecord(record: DomainRecordDefinition): DomainRecord {
  return { id: record.id, type: record.type, values: normalizeValue(copyValues(record.values)) as Record<string, unknown> };
}

function normalizeRelation(relation: DomainRelationDefinition): DomainRelation {
  return { type: relation.type, from: relation.from, to: relation.to, values: normalizeValue(copyValues(relation.values)) as Record<string, unknown> };
}

/** Returns one canonical ordering and property layout for the same snapshot value. */
export function normalizeDomainSnapshot(snapshot: DomainSnapshotDefinition): DomainSnapshot {
  const copied = defineDomainSnapshot(snapshot);
  const records = copied.records.map(normalizeRecord).sort((left, right) =>
    left.id.localeCompare(right.id) || left.type.localeCompare(right.type) || comparable(left.values).localeCompare(comparable(right.values)),
  );
  const relations = copied.relations.map(normalizeRelation).sort((left, right) =>
    left.type.localeCompare(right.type) || left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || comparable(left.values).localeCompare(comparable(right.values)),
  );
  return { records, relations };
}

/** Serializes a normalized snapshot as stable, language-neutral JSON followed by one newline. */
export function serializeDomainSnapshot(snapshot: DomainSnapshotDefinition): string {
  return `${JSON.stringify(normalizeDomainSnapshot(snapshot), null, 2)}\n`;
}
