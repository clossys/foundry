/** Dependency-free machinery for product-owned domain models, never product values. */
export { defineDomainModel } from "./define.js";
export { normalizeDomainModel, serializeDomainModel } from "./normalize.js";
export { validateDomainModel } from "./validate.js";
export { compareDomainModels } from "./compatibility.js";
export { defineDomainSnapshot, normalizeDomainSnapshot, serializeDomainSnapshot, validateDomainSnapshot } from "./snapshot.js";
export { PRIMITIVE_VALUE_TYPES, RELATION_CARDINALITIES } from "./types.js";
export type {
  DomainModel,
  DomainModelChange,
  DomainModelCompatibilityReport,
  DomainModelDefinition,
  DomainModelFinding,
  DomainRecord,
  DomainRecordDefinition,
  DomainRelation,
  DomainRelationDefinition,
  DomainSnapshot,
  DomainSnapshotDefinition,
  DomainSnapshotFinding,
  DomainTypeDefinition,
  FieldDefinition,
  FieldValueType,
  PrimitiveValueType,
  RelationCardinality,
  RelationDefinition,
  ValueTypeDefinition,
  VocabularyDefinition,
} from "./types.js";
