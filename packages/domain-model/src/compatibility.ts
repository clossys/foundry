import { normalizeDomainModel } from "./normalize.js";
import { validateDomainModel } from "./validate.js";
import type { DomainModel, DomainModelChange, DomainModelCompatibilityReport, DomainModelDefinition, DomainTypeDefinition, FieldDefinition, RelationDefinition, ValueTypeDefinition, VocabularyDefinition } from "./types.js";

function mapById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function compareFields(
  previous: readonly FieldDefinition[],
  next: readonly FieldDefinition[],
  subject: "field" | "relation-property",
  ownerId: string,
  changes: DomainModelChange[],
): void {
  const before = mapById(previous);
  const after = mapById(next);
  for (const [id, field] of before) {
    const replacement = after.get(id);
    if (replacement === undefined) {
      changes.push({ kind: "breaking", subject, id, message: `${subject} "${id}" was removed from "${ownerId}".` });
      continue;
    }
    if (field.valueType !== replacement.valueType) {
      changes.push({ kind: "breaking", subject, id, message: `${subject} "${id}" changed valueType.` });
    }
    if (field.required !== true && replacement.required === true) {
      changes.push({ kind: "breaking", subject, id, message: `${subject} "${id}" became required.` });
    }
    if (field.required === true && replacement.required !== true) {
      changes.push({ kind: "additive", subject, id, message: `${subject} "${id}" became optional.` });
    }
  }
  for (const [id, field] of after) {
    if (!before.has(id)) {
      changes.push({
        kind: field.required === true ? "breaking" : "additive",
        subject,
        id,
        message: `${subject} "${id}" was added to "${ownerId}"${field.required === true ? " as required" : ""}.`,
      });
    }
  }
}

function compareValueTypes(previous: readonly ValueTypeDefinition[], next: readonly ValueTypeDefinition[], changes: DomainModelChange[]): void {
  const before = mapById(previous);
  const after = mapById(next);
  for (const [id, valueType] of before) {
    const replacement = after.get(id);
    if (replacement === undefined) changes.push({ kind: "breaking", subject: "value-type", id, message: `Value type "${id}" was removed.` });
    else if (valueType.primitive !== replacement.primitive) changes.push({ kind: "breaking", subject: "value-type", id, message: `Value type "${id}" changed primitive.` });
  }
  for (const [id] of after) if (!before.has(id)) changes.push({ kind: "additive", subject: "value-type", id, message: `Value type "${id}" was added.` });
}

function compareVocabularies(previous: readonly VocabularyDefinition[], next: readonly VocabularyDefinition[], changes: DomainModelChange[]): void {
  const before = mapById(previous);
  const after = mapById(next);
  for (const [id, vocabulary] of before) {
    const replacement = after.get(id);
    if (replacement === undefined) {
      changes.push({ kind: "breaking", subject: "vocabulary", id, message: `Vocabulary "${id}" was removed.` });
      continue;
    }
    const previousValues = new Set(vocabulary.values);
    const nextValues = new Set(replacement.values);
    for (const value of previousValues) if (!nextValues.has(value)) changes.push({ kind: "breaking", subject: "vocabulary-value", id: `${id}.${value}`, message: `Vocabulary value "${value}" was removed from "${id}".` });
    for (const value of nextValues) if (!previousValues.has(value)) changes.push({ kind: "additive", subject: "vocabulary-value", id: `${id}.${value}`, message: `Vocabulary value "${value}" was added to "${id}".` });
  }
  for (const [id] of after) if (!before.has(id)) changes.push({ kind: "additive", subject: "vocabulary", id, message: `Vocabulary "${id}" was added.` });
}

function compareTypes(previous: readonly DomainTypeDefinition[], next: readonly DomainTypeDefinition[], changes: DomainModelChange[]): void {
  const before = mapById(previous);
  const after = mapById(next);
  for (const [id, type] of before) {
    const replacement = after.get(id);
    if (replacement === undefined) changes.push({ kind: "breaking", subject: "type", id, message: `Type "${id}" was removed.` });
    else compareFields(type.fields ?? [], replacement.fields ?? [], "field", id, changes);
  }
  for (const [id] of after) if (!before.has(id)) changes.push({ kind: "additive", subject: "type", id, message: `Type "${id}" was added.` });
}

function compareRelations(previous: readonly RelationDefinition[], next: readonly RelationDefinition[], changes: DomainModelChange[]): void {
  const before = mapById(previous);
  const after = mapById(next);
  for (const [id, relation] of before) {
    const replacement = after.get(id);
    if (replacement === undefined) {
      changes.push({ kind: "breaking", subject: "relation", id, message: `Relation "${id}" was removed.` });
      continue;
    }
    if (relation.from !== replacement.from || relation.to !== replacement.to) changes.push({ kind: "breaking", subject: "relation", id, message: `Relation "${id}" changed an endpoint.` });
    if (relation.cardinality !== replacement.cardinality) changes.push({ kind: "breaking", subject: "relation", id, message: `Relation "${id}" changed cardinality.` });
    compareFields(relation.properties ?? [], replacement.properties ?? [], "relation-property", id, changes);
  }
  for (const [id] of after) if (!before.has(id)) changes.push({ kind: "additive", subject: "relation", id, message: `Relation "${id}" was added.` });
}

/**
 * Compares actual model content. Labels and `schemaVersion` are intentionally
 * not compatibility surface; stable identifiers and structural contracts are.
 */
export function compareDomainModels(previous: DomainModelDefinition, next: DomainModelDefinition): DomainModelCompatibilityReport {
  const previousFindings = validateDomainModel(previous);
  const nextFindings = validateDomainModel(next);
  if (previousFindings.some((entry) => entry.severity === "error") || nextFindings.some((entry) => entry.severity === "error")) {
    return { compatible: false, changes: [], previousFindings, nextFindings };
  }
  const before: DomainModel = normalizeDomainModel(previous);
  const after: DomainModel = normalizeDomainModel(next);
  const changes: DomainModelChange[] = [];

  if (before.id !== after.id) changes.push({ kind: "breaking", subject: "model", id: after.id, message: `Model id changed from "${before.id}" to "${after.id}".` });
  compareValueTypes(before.valueTypes, after.valueTypes, changes);
  compareVocabularies(before.vocabularies, after.vocabularies, changes);
  compareTypes(before.types, after.types, changes);
  compareRelations(before.relations, after.relations, changes);

  changes.sort((left, right) => stable(left).localeCompare(stable(right)));
  return {
    compatible: changes.every((entry) => entry.kind !== "breaking"),
    changes,
    previousFindings,
    nextFindings,
  };
}
