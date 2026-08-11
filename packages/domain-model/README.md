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
  serializeDomainModel,
  validateDomainModel,
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
| `PRIMITIVE_VALUE_TYPES` | constant | The supported primitive `PrimitiveValueType` values. |
| `RELATION_CARDINALITIES` | constant | The supported `RelationCardinality` values. |
| `DomainModelDefinition` / `DomainModel` | types | The authoring input and fully populated model shape. |
| `ValueTypeDefinition` / `VocabularyDefinition` | types | Product-defined scalar type and closed vocabulary definitions. |
| `DomainTypeDefinition` / `RelationDefinition` | types | Domain types and directed attributed relations. |
| `FieldDefinition` / `FieldValueType` | types | Stable field definition and its primitive or named value reference. |
| `PrimitiveValueType` / `RelationCardinality` | types | Primitive scalar and relation-cardinality unions. |
| `DomainModelFinding` | type | A reported validation issue: rule, severity, message, and optional path. |
| `DomainModelChange` / `DomainModelCompatibilityReport` | types | A classified change and complete comparison outcome. |

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
