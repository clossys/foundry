import { defineDomainModel } from "./define.js";
import type { DomainModel, DomainModelDefinition, DomainTypeDefinition, FieldDefinition, RelationDefinition, ValueTypeDefinition, VocabularyDefinition } from "./types.js";

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function normalizeField(field: FieldDefinition): FieldDefinition {
  const normalized: FieldDefinition = { id: field.id, valueType: field.valueType, required: field.required === true };
  if (field.label !== undefined) normalized.label = field.label;
  return normalized;
}

function normalizeType(type: DomainTypeDefinition): DomainTypeDefinition {
  const normalized: DomainTypeDefinition = {
    id: type.id,
    fields: [...(type.fields ?? [])].map(normalizeField).sort(byId),
  };
  if (type.label !== undefined) normalized.label = type.label;
  return normalized;
}

function normalizeRelation(relation: RelationDefinition): RelationDefinition {
  const normalized: RelationDefinition = {
    id: relation.id,
    from: relation.from,
    to: relation.to,
    cardinality: relation.cardinality,
    properties: [...(relation.properties ?? [])].map(normalizeField).sort(byId),
  };
  if (relation.label !== undefined) normalized.label = relation.label;
  return normalized;
}

function normalizeValueType(valueType: ValueTypeDefinition): ValueTypeDefinition {
  const normalized: ValueTypeDefinition = { id: valueType.id, primitive: valueType.primitive };
  if (valueType.label !== undefined) normalized.label = valueType.label;
  return normalized;
}

function normalizeVocabulary(vocabulary: VocabularyDefinition): VocabularyDefinition {
  const normalized: VocabularyDefinition = { id: vocabulary.id, values: [...vocabulary.values].sort() };
  if (vocabulary.label !== undefined) normalized.label = vocabulary.label;
  return normalized;
}

/** Returns one canonical ordering and property layout for the same model value. */
export function normalizeDomainModel(model: DomainModelDefinition): DomainModel {
  const copied = defineDomainModel(model);
  return {
    id: copied.id,
    schemaVersion: copied.schemaVersion,
    valueTypes: copied.valueTypes.map(normalizeValueType).sort(byId),
    vocabularies: copied.vocabularies.map(normalizeVocabulary).sort(byId),
    types: copied.types.map(normalizeType).sort(byId),
    relations: copied.relations.map(normalizeRelation).sort(byId),
  };
}

/** Serializes a normalized model as stable, language-neutral JSON followed by one newline. */
export function serializeDomainModel(model: DomainModelDefinition): string {
  return `${JSON.stringify(normalizeDomainModel(model), null, 2)}\n`;
}
