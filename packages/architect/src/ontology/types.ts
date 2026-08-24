/** A scalar representation supplied by this package. */
export type PrimitiveValueType = "string" | "number" | "integer" | "boolean" | "date" | "datetime" | "json";

/** A product-defined scalar type built on one primitive representation. */
export interface ValueTypeDefinition {
  id: string;
  primitive: PrimitiveValueType;
  label?: string;
}

/** A closed set of product-defined string values. */
export interface VocabularyDefinition {
  id: string;
  values: readonly string[];
  label?: string;
}

/** A field's representation: a primitive or the id of a value type or vocabulary. */
export type FieldValueType = PrimitiveValueType | string;

/** One stable field on a domain type or relation. */
export interface FieldDefinition {
  id: string;
  valueType: FieldValueType;
  required?: boolean;
  label?: string;
}

/** A product-owned domain type with stable fields. */
export interface DomainTypeDefinition {
  id: string;
  fields?: readonly FieldDefinition[];
  label?: string;
}

/** The allowed cardinality of a directed relation. */
export type RelationCardinality = "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";

/** A directed relation that may carry its own stable fields. */
export interface RelationDefinition {
  id: string;
  from: string;
  to: string;
  cardinality: RelationCardinality;
  properties?: readonly FieldDefinition[];
  label?: string;
}

/** A consumer-owned semantic model. `schemaVersion` belongs to that consumer, not this package. */
export interface DomainModelDefinition {
  id: string;
  schemaVersion: string;
  valueTypes?: readonly ValueTypeDefinition[];
  vocabularies?: readonly VocabularyDefinition[];
  types?: readonly DomainTypeDefinition[];
  relations?: readonly RelationDefinition[];
}

/** A normalized, immutable-looking model value returned by `defineDomainModel`. */
export interface DomainModel extends DomainModelDefinition {
  valueTypes: readonly ValueTypeDefinition[];
  vocabularies: readonly VocabularyDefinition[];
  types: readonly DomainTypeDefinition[];
  relations: readonly RelationDefinition[];
}

/** One observed issue; callers decide whether an error blocks their workflow. */
export interface DomainModelFinding {
  rule: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
}

/** A change detected between two model versions. */
export interface DomainModelChange {
  kind: "additive" | "breaking";
  subject: "model" | "value-type" | "vocabulary" | "vocabulary-value" | "type" | "field" | "relation" | "relation-property";
  id: string;
  message: string;
}

/** Machine-readable outcome of `compareDomainModels`. */
export interface DomainModelCompatibilityReport {
  compatible: boolean;
  changes: readonly DomainModelChange[];
  previousFindings: readonly DomainModelFinding[];
  nextFindings: readonly DomainModelFinding[];
}

/** One product-owned record captured against a declared domain type. */
export interface DomainRecordDefinition {
  id: string;
  type: string;
  values?: Readonly<Record<string, unknown>>;
}

/** A detached record with an explicit value object. */
export interface DomainRecord {
  id: string;
  type: string;
  values: Readonly<Record<string, unknown>>;
}

/** One directed product-owned relation captured against a declared relation type. */
export interface DomainRelationDefinition {
  type: string;
  from: string;
  to: string;
  values?: Readonly<Record<string, unknown>>;
}

/** A detached directed relation with an explicit value object. */
export interface DomainRelation {
  type: string;
  from: string;
  to: string;
  values: Readonly<Record<string, unknown>>;
}

/** Authoring input for a product-owned collection of records and relations. */
export interface DomainSnapshotDefinition {
  records?: readonly DomainRecordDefinition[];
  relations?: readonly DomainRelationDefinition[];
}

/** A detached domain snapshot with explicit collections. */
export interface DomainSnapshot {
  records: readonly DomainRecord[];
  relations: readonly DomainRelation[];
}

/** One observed issue in a snapshot; callers decide whether an error blocks their workflow. */
export interface DomainSnapshotFinding {
  rule: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
}

export const PRIMITIVE_VALUE_TYPES: readonly PrimitiveValueType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "json",
];

export const RELATION_CARDINALITIES: readonly RelationCardinality[] = [
  "one-to-one",
  "one-to-many",
  "many-to-one",
  "many-to-many",
];
