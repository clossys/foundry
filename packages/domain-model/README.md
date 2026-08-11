# @vespeneventures/domain-model

Dependency-free machinery for product-owned domain models. It defines stable
identifiers, typed fields, closed vocabularies, directed relations with their
own properties, deterministic JSON artifacts, validation, and compatibility
comparison. It ships no domain values, storage, actions, authorization,
provenance, lifecycle, or code generation.

```bash
npm install @vespeneventures/domain-model
```

## Usage

```ts
import {
  defineDomainModel,
  defineDomainSnapshot,
  serializeDomainSnapshot,
  serializeDomainModel,
  validateDomainModel,
  validateDomainSnapshot,
} from "@vespeneventures/domain-model";

const model = defineDomainModel({
  id: "example",
  schemaVersion: "0.1.0",
  valueTypes: [{ id: "example.score", primitive: "number" }],
  vocabularies: [{ id: "example.state", values: ["draft", "published"] }],
  types: [
    {
      id: "example.article",
      fields: [
        { id: "example.article.title", valueType: "string", required: true },
        { id: "example.article.state", valueType: "example.state" },
      ],
    },
    { id: "example.source", fields: [{ id: "example.source.url", valueType: "string", required: true }] },
  ],
  relations: [
    {
      id: "example.article.cites",
      from: "example.article",
      to: "example.source",
      cardinality: "many-to-many",
      properties: [{ id: "example.article.cites.score", valueType: "example.score" }],
    },
  ],
});

const findings = validateDomainModel(model);
if (findings.some((finding) => finding.severity === "error")) throw new Error("Invalid domain model");

const artifact = serializeDomainModel(model);

const snapshot = defineDomainSnapshot({
  records: [
    {
      id: "article-1",
      type: "example.article",
      values: {
        "example.article.title": "A stable example",
        "example.article.state": "draft",
      },
    },
    {
      id: "source-1",
      type: "example.source",
      values: { "example.source.url": "https://example.test/source" },
    },
  ],
  relations: [
    {
      type: "example.article.cites",
      from: "article-1",
      to: "source-1",
      values: { "example.article.cites.score": 1 },
    },
  ],
});

const snapshotFindings = validateDomainSnapshot(model, snapshot);
if (snapshotFindings.some((finding) => finding.severity === "error")) throw new Error("Invalid domain snapshot");

const snapshotArtifact = serializeDomainSnapshot(snapshot);
```

`id` is the model namespace (`example` above). Every value type, vocabulary,
type, relation, and field must begin with that namespace. Fields must further
begin with their owning type or relation ID. Labels are display metadata, not
stable identity; changing a label does not change a serialized contract's
semantic compatibility.

`schemaVersion` is the consumer model's version. It is intentionally separate
from this package's npm version.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `defineDomainModel(definition)` | function | Returns a detached `DomainModel` for authoring. It does not self-certify validity; use `validateDomainModel`. |
| `validateDomainModel(value)` | function | Reports structural and referential `DomainModelFinding` values without throwing for malformed input. Validates IDs, references, fields, endpoints, cardinality, and relation properties. |
| `normalizeDomainModel(model)` | function | Applies deterministic collection ordering and explicit `required: false` defaults. |
| `serializeDomainModel(model)` | function | Produces canonical, pretty JSON ending in one newline. |
| `compareDomainModels(previous, next)` | function | Returns a `DomainModelCompatibilityReport`, classifying actual additive and breaking changes. Labels and `schemaVersion` do not create changes. |
| `defineDomainSnapshot(definition)` | function | Returns a detached `DomainSnapshot` for authoring. It does not self-certify validity; use `validateDomainSnapshot`. |
| `validateDomainSnapshot(model, value)` | function | Reports structural, referential, value-type, vocabulary, and cardinality `DomainSnapshotFinding` values without throwing for malformed input. |
| `normalizeDomainSnapshot(snapshot)` | function | Applies deterministic collection ordering and recursively ordered value-object keys. |
| `serializeDomainSnapshot(snapshot)` | function | Produces canonical, pretty snapshot JSON ending in one newline. |
| `PRIMITIVE_VALUE_TYPES` | constant | The supported primitive `PrimitiveValueType` values. |
| `RELATION_CARDINALITIES` | constant | The supported `RelationCardinality` values. |
| `DomainModelDefinition` / `DomainModel` | types | The authoring input and fully populated model shape. |
| `ValueTypeDefinition` / `VocabularyDefinition` | types | Product-defined scalar type and closed vocabulary definitions. |
| `DomainTypeDefinition` / `RelationDefinition` | types | Domain types and directed attributed relations. |
| `FieldDefinition` / `FieldValueType` | types | Stable field definition and its primitive or named value reference. |
| `PrimitiveValueType` / `RelationCardinality` | types | Primitive scalar and relation-cardinality unions. |
| `DomainModelFinding` | type | A reported validation issue: rule, severity, message, and optional path. |
| `DomainModelChange` / `DomainModelCompatibilityReport` | types | A classified change and complete comparison outcome. |
| `DomainRecordDefinition` / `DomainRecord` | types | A record authoring input and detached record bound to a declared domain type. |
| `DomainRelationDefinition` / `DomainRelation` | types | A directed relation authoring input and detached relation bound to a declared relation type. |
| `DomainSnapshotDefinition` / `DomainSnapshot` | types | A collection authoring input and detached collection of records and relations. |
| `DomainSnapshotFinding` | type | A reported snapshot validation issue: rule, severity, message, and optional path. |

## Snapshots

`DomainSnapshot` is the product-neutral instance layer over a `DomainModel`.
Record `type` names a declared domain type, and relation `type` names a
declared directed relation. Both carry a `values` object keyed by the stable
field IDs declared by that type or relation. The validator rejects undeclared
values, checks required values and primitive or vocabulary representations,
requires relation endpoints to exist with the declared types, and enforces
the declared directed cardinality.

Snapshots deliberately do not introduce storage, actions, authorization,
provenance, or lifecycle semantics. Record IDs are caller-owned stable
identities. `normalizeDomainSnapshot` sorts records and relations and sorts
nested value-object keys, so equivalent valid snapshots serialize identically.

## Compatibility rules

`compareDomainModels` compares stable IDs and contract structure, not an
author-maintained assertion that a change is safe. It marks these as breaking:

- Removing a value type, vocabulary, vocabulary value, type, field, relation,
  or relation property.
- Changing a value type primitive, field value type, relation endpoint, or
  relation cardinality.
- Making an existing field or relation property required.
- Adding a required field or relation property.
- Changing the model namespace.

Adding an optional field or relation property, a new type, relation, value
type, vocabulary, or vocabulary value is additive. The report also exposes
validation findings for both supplied models, so invalid definitions cannot be
treated as compatible merely because their differences look additive.

## Requirements

Node 20+. ESM only. No runtime dependencies and no I/O.

## Licence

MIT
