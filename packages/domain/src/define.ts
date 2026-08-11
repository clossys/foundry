import type { DomainModel, DomainModelDefinition, DomainTypeDefinition, FieldDefinition, RelationDefinition, ValueTypeDefinition, VocabularyDefinition } from "./types.js";

function copyField(field: FieldDefinition): FieldDefinition {
  return { ...field, required: field.required === true };
}

function copyType(type: DomainTypeDefinition): DomainTypeDefinition {
  return { ...type, fields: (type.fields ?? []).map(copyField) };
}

function copyRelation(relation: RelationDefinition): RelationDefinition {
  return { ...relation, properties: (relation.properties ?? []).map(copyField) };
}

/**
 * Creates a detached model value for authoring and later validation. This
 * function deliberately does not claim the definition is valid; call
 * `validateDomainModel` against the returned value before consuming it.
 */
export function defineDomainModel(definition: DomainModelDefinition): DomainModel {
  const valueTypes: ValueTypeDefinition[] = (definition.valueTypes ?? []).map((valueType) => ({ ...valueType }));
  const vocabularies: VocabularyDefinition[] = (definition.vocabularies ?? []).map((vocabulary) => ({
    ...vocabulary,
    values: [...vocabulary.values],
  }));

  return {
    id: definition.id,
    schemaVersion: definition.schemaVersion,
    valueTypes,
    vocabularies,
    types: (definition.types ?? []).map(copyType),
    relations: (definition.relations ?? []).map(copyRelation),
  };
}
