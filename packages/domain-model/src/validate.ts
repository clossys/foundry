import { PRIMITIVE_VALUE_TYPES, RELATION_CARDINALITIES } from "./types.js";
import type { DomainModelFinding, FieldDefinition } from "./types.js";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finding(rule: string, message: string, path: string): DomainModelFinding {
  return { rule, severity: "error", message, path };
}

function arrayAt(record: RecordValue, key: string, findings: DomainModelFinding[], path: string): unknown[] {
  const value = record[key];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  findings.push(finding("collection-shape", `${key} must be an array when provided.`, path));
  return [];
}

function stringAt(record: RecordValue, key: string, findings: DomainModelFinding[], path: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) return value;
  findings.push(finding("required-string", `${key} must be a non-empty string.`, path));
  return undefined;
}

function optionalLabel(record: RecordValue, findings: DomainModelFinding[], path: string): void {
  if (record.label !== undefined && typeof record.label !== "string") {
    findings.push(finding("label-shape", "label must be a string when provided.", path));
  }
}

function isPrimitive(value: unknown): boolean {
  return typeof value === "string" && (PRIMITIVE_VALUE_TYPES as readonly string[]).includes(value);
}

function isCardinality(value: unknown): boolean {
  return typeof value === "string" && (RELATION_CARDINALITIES as readonly string[]).includes(value);
}

function hasNamespace(id: string, modelId: string): boolean {
  return id.startsWith(`${modelId}.`) && id.length > modelId.length + 1;
}

function isStableId(id: string): boolean {
  return /^[a-z][a-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/.test(id);
}

function validateStableId(
  id: string | undefined,
  modelId: string | undefined,
  findings: DomainModelFinding[],
  path: string,
  expectedPrefix?: string,
): void {
  if (id === undefined) return;
  if (!isStableId(id)) {
    findings.push(finding("stable-id-shape", "id must be a dotted, namespaced identifier.", path));
  }
  if (modelId !== undefined && !hasNamespace(id, modelId)) {
    findings.push(finding("stable-id-namespace", `id must begin with "${modelId}.".`, path));
  }
  if (expectedPrefix !== undefined && !id.startsWith(`${expectedPrefix}.`)) {
    findings.push(finding("field-parent", `id must begin with "${expectedPrefix}.".`, path));
  }
}

function validateFields(
  fields: unknown[],
  fieldName: "fields" | "properties",
  ownerId: string | undefined,
  modelId: string | undefined,
  knownValueIds: Set<string>,
  findings: DomainModelFinding[],
  path: string,
): void {
  const ids = new Set<string>();
  fields.forEach((candidate, index) => {
    const fieldPath = `${path}.${fieldName}[${index}]`;
    if (!isRecord(candidate)) {
      findings.push(finding("field-shape", "A field must be an object.", fieldPath));
      return;
    }
    const id = stringAt(candidate, "id", findings, `${fieldPath}.id`);
    validateStableId(id, modelId, findings, `${fieldPath}.id`, ownerId);
    if (id !== undefined) {
      if (ids.has(id)) findings.push(finding("duplicate-field-id", `Duplicate field id "${id}".`, `${fieldPath}.id`));
      ids.add(id);
    }
    const valueType = stringAt(candidate, "valueType", findings, `${fieldPath}.valueType`);
    if (valueType !== undefined && !isPrimitive(valueType) && !knownValueIds.has(valueType)) {
      findings.push(finding("unknown-value-type", `valueType "${valueType}" does not reference a primitive, value type, or vocabulary.`, `${fieldPath}.valueType`));
    }
    if (candidate.required !== undefined && typeof candidate.required !== "boolean") {
      findings.push(finding("required-shape", "required must be a boolean when provided.", `${fieldPath}.required`));
    }
    optionalLabel(candidate, findings, `${fieldPath}.label`);
  });
}

/**
 * Validates real definitions rather than a consumer-provided success flag.
 * It never throws for malformed input and reports every independently
 * checkable structural and referential finding.
 */
export function validateDomainModel(value: unknown): DomainModelFinding[] {
  const findings: DomainModelFinding[] = [];
  if (!isRecord(value)) return [finding("model-shape", "A domain model must be an object.", "$")];

  const modelId = stringAt(value, "id", findings, "id");
  if (modelId !== undefined && !/^[a-z][a-z0-9-]*$/.test(modelId)) {
    findings.push(finding("model-id-shape", "id must be a lowercase namespace token.", "id"));
  }
  stringAt(value, "schemaVersion", findings, "schemaVersion");

  const valueTypes = arrayAt(value, "valueTypes", findings, "valueTypes");
  const vocabularies = arrayAt(value, "vocabularies", findings, "vocabularies");
  const types = arrayAt(value, "types", findings, "types");
  const relations = arrayAt(value, "relations", findings, "relations");

  const knownValueIds = new Set<string>();
  const allNamedIds = new Set<string>();
  const recordNamed = (id: string | undefined, kind: string, path: string, isValueReference = false): void => {
    if (id === undefined) return;
    if (allNamedIds.has(id)) findings.push(finding("duplicate-id", `Duplicate ${kind} id "${id}".`, path));
    allNamedIds.add(id);
    if (isValueReference) knownValueIds.add(id);
  };

  valueTypes.forEach((candidate, index) => {
    const path = `valueTypes[${index}]`;
    if (!isRecord(candidate)) {
      findings.push(finding("value-type-shape", "A value type must be an object.", path));
      return;
    }
    const id = stringAt(candidate, "id", findings, `${path}.id`);
    validateStableId(id, modelId, findings, `${path}.id`);
    recordNamed(id, "value type", `${path}.id`, true);
    if (!isPrimitive(candidate.primitive)) findings.push(finding("primitive-known", "primitive must be a known primitive value type.", `${path}.primitive`));
    optionalLabel(candidate, findings, `${path}.label`);
  });

  vocabularies.forEach((candidate, index) => {
    const path = `vocabularies[${index}]`;
    if (!isRecord(candidate)) {
      findings.push(finding("vocabulary-shape", "A vocabulary must be an object.", path));
      return;
    }
    const id = stringAt(candidate, "id", findings, `${path}.id`);
    validateStableId(id, modelId, findings, `${path}.id`);
    recordNamed(id, "vocabulary", `${path}.id`, true);
    const values = arrayAt(candidate, "values", findings, `${path}.values`);
    const seen = new Set<string>();
    values.forEach((entry, valueIndex) => {
      if (typeof entry !== "string" || entry.length === 0) {
        findings.push(finding("vocabulary-value-shape", "Vocabulary values must be non-empty strings.", `${path}.values[${valueIndex}]`));
      } else if (seen.has(entry)) {
        findings.push(finding("duplicate-vocabulary-value", `Duplicate vocabulary value "${entry}".`, `${path}.values[${valueIndex}]`));
      } else seen.add(entry);
    });
    optionalLabel(candidate, findings, `${path}.label`);
  });

  const typeIds = new Set<string>();
  types.forEach((candidate, index) => {
    const path = `types[${index}]`;
    if (!isRecord(candidate)) {
      findings.push(finding("type-shape", "A domain type must be an object.", path));
      return;
    }
    const id = stringAt(candidate, "id", findings, `${path}.id`);
    validateStableId(id, modelId, findings, `${path}.id`);
    if (id !== undefined) {
      if (typeIds.has(id)) findings.push(finding("duplicate-type-id", `Duplicate type id "${id}".`, `${path}.id`));
      typeIds.add(id);
    }
    recordNamed(id, "type", `${path}.id`);
    validateFields(arrayAt(candidate, "fields", findings, `${path}.fields`), "fields", id, modelId, knownValueIds, findings, path);
    optionalLabel(candidate, findings, `${path}.label`);
  });

  const relationIds = new Set<string>();
  relations.forEach((candidate, index) => {
    const path = `relations[${index}]`;
    if (!isRecord(candidate)) {
      findings.push(finding("relation-shape", "A relation must be an object.", path));
      return;
    }
    const id = stringAt(candidate, "id", findings, `${path}.id`);
    validateStableId(id, modelId, findings, `${path}.id`);
    if (id !== undefined) {
      if (relationIds.has(id)) findings.push(finding("duplicate-relation-id", `Duplicate relation id "${id}".`, `${path}.id`));
      relationIds.add(id);
    }
    recordNamed(id, "relation", `${path}.id`);
    const from = stringAt(candidate, "from", findings, `${path}.from`);
    const to = stringAt(candidate, "to", findings, `${path}.to`);
    if (from !== undefined && !typeIds.has(from)) findings.push(finding("relation-from-known", `from endpoint "${from}" does not reference a type.`, `${path}.from`));
    if (to !== undefined && !typeIds.has(to)) findings.push(finding("relation-to-known", `to endpoint "${to}" does not reference a type.`, `${path}.to`));
    if (!isCardinality(candidate.cardinality)) findings.push(finding("relation-cardinality-known", "cardinality must be a supported relation cardinality.", `${path}.cardinality`));
    validateFields(arrayAt(candidate, "properties", findings, `${path}.properties`), "properties", id, modelId, knownValueIds, findings, path);
    optionalLabel(candidate, findings, `${path}.label`);
  });

  return findings;
}
