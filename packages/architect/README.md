# @clossys/architect

The architect role for provider-neutral operating architecture. It answers:

> Do the business ontology, operating boundaries, authoritative systems, and
> interfaces match how material work actually crosses the business?

The package defines business and portfolio scopes, systems, responsibilities,
authoritative ownership, systems of record, and directional interfaces. It
then assesses independent change observations against that declared topology.
It performs no network I/O and has no runtime dependencies. Install it with:

```bash
npm install @clossys/architect
```

## Job charter

Architect operates in **optimize** mode. Its durable objective is to reduce
architecture exception rate while respecting consumer-owned security,
privacy, authority, and lifecycle guardrails:

```text
architecture exception rate
= observed material changes with at least one undeclared boundary crossing
  / all observed material changes
```

No observed material changes means the rate is **indeterminate**, never zero.
The role senses actual changes, judges them against declared boundaries,
proposes architecture changes, verifies subsequent evidence, and learns or
escalates. It does not transfer repositories, mutate GitHub, create systems,
or grant itself authority. A consumer approves changes; an authorized builder
may materialize them.

## Usage

```ts
import {
  assessArchitectureExceptions,
  defineOperatingTopology,
  serializeOperatingTopology,
  validateOperatingTopology,
} from "@clossys/architect";

const topology = defineOperatingTopology({
  id: "example",
  schemaVersion: "0.1.0",
  scope: { id: "example-business", kind: "business" },
  systems: [
    { id: "workspace", kind: "workspace", responsibilities: ["control-plane"], visibility: "private" },
    { id: "product", kind: "repository", responsibilities: ["product"], visibility: "private" },
  ],
  authorities: [
    { responsibility: "control-plane", owner: "business-owner", systemOfRecord: "workspace" },
    { responsibility: "product", owner: "product-owner", systemOfRecord: "product" },
  ],
  interfaces: [
    { id: "workspace-to-product", from: "workspace", to: "product", responsibilities: ["product"] },
  ],
});

if (validateOperatingTopology(topology).length > 0) throw new Error("Invalid topology");
const artifact = serializeOperatingTopology(topology);

const assessment = assessArchitectureExceptions(
  topology,
  [{
    id: "change-1",
    observedAt: "2026-08-23T12:00:00Z",
    material: true,
    crossings: [{ from: "workspace", to: "product", responsibility: "product", interface: "workspace-to-product" }],
  }],
  { maximumExceptionRate: 0.05 },
);
```

Unknown systems, responsibility mismatches, and an interface name that does
not match the declared direction count as undeclared crossings. Observations are consumer-supplied
evidence; the assessment never treats a success flag as proof.

A valid topology has at least one system and authority, represents the
`control-plane` responsibility, binds each authority to a system of record
that implements its responsibility, and declares interfaces only for
responsibilities implemented somewhere in the topology.

## CLI

```bash
architect-check topology topology.json
architect-check exceptions topology.json observations.json --maximum-exception-rate 0.05
```

Both commands emit JSON. Exit codes are `0` satisfied, `1` violated, and `2`
indeterminate or unable to run. Invalid topology is a violation for the
`topology` conformance command. Invalid inputs make the exception rate
indeterminate because no valid measurement can be computed.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `defineOperatingTopology(definition)` | function | Returns a detached, fully populated topology without claiming it is valid. |
| `validateOperatingTopology(value)` | function | Reports structural, identity, responsibility, authority, system-of-record, and interface findings. |
| `normalizeOperatingTopology(definition)` | function | Applies deterministic property and collection ordering. |
| `serializeOperatingTopology(definition)` | function | Produces canonical pretty JSON ending in one newline. |
| `compareOperatingTopologies(previous, next)` | function | Classifies additive and breaking topology contract changes. |
| `validateArchitectureChangeObservations(value)` | function | Validates independent material-change evidence without certifying it. |
| `assessArchitectureExceptions(topology, observations, options)` | function | Computes architecture exception rate and satisfied, violated, or indeterminate state. |
| `OPERATING_SCOPE_KINDS` | constant | Supported `portfolio` and `business` scope kinds. |
| `OPERATING_SYSTEM_KINDS` | constant | Provider-neutral system kinds. |
| `OPERATING_RESPONSIBILITIES` | constant | Stable operating-responsibility vocabulary. |
| `OperatingTopologyDefinition` / `OperatingTopology` | types | Authoring and detached topology shapes. |
| `OperatingScopeDefinition` / `OperatingScopeKind` | types | Consumer operating boundary and its kind. |
| `OperatingSystemDefinition` / `OperatingSystemKind` | types | One addressable system and its kind. |
| `OperatingResponsibility` | type | Stable responsibility assigned to systems and authorities. |
| `AuthorityDefinition` | type | Consumer-owned responsibility, owner, and system-of-record binding. |
| `OperatingInterfaceDefinition` | type | One allowed directional system crossing. |
| `ArchitectureFinding` / `ArchitectureFindingSeverity` | types | Validation issue and severity. |
| `OperatingTopologyChange` / `OperatingTopologyCompatibilityReport` | types | Classified topology change and compatibility report. |
| `BoundaryCrossingObservation` / `ArchitectureChangeObservation` | types | One observed crossing and material change. |
| `ArchitectureAssessmentOptions` / `ArchitectureAssessmentState` | types | Assessment setpoint and three-state result vocabulary. |
| `AssessedBoundaryCrossing` / `AssessedArchitectureChange` | types | Evidence annotated with declaration and exception status. |
| `ArchitectureExceptionAssessment` | type | Metric counts, rate, state, evidence details, and findings. |

## Ontology

`@clossys/architect/ontology` contains the ontology mechanism used by
the role. Its public model and snapshot API is compatible with the former
standalone domain package.

| Export | Kind | Purpose |
| --- | --- | --- |
| `defineDomainModel(definition)` | function | Returns a detached domain model for authoring. |
| `validateDomainModel(value)` | function | Validates identifiers, fields, references, relations, and cardinality. |
| `normalizeDomainModel(model)` | function | Canonically orders a domain model. |
| `serializeDomainModel(model)` | function | Serializes a canonical domain model. |
| `compareDomainModels(previous, next)` | function | Classifies additive and breaking model changes. |
| `defineDomainSnapshot(definition)` | function | Returns a detached collection of records and relations. |
| `validateDomainSnapshot(model, value)` | function | Validates instance values, types, endpoints, and cardinality. |
| `normalizeDomainSnapshot(snapshot)` | function | Canonically orders a snapshot and nested values. |
| `serializeDomainSnapshot(snapshot)` | function | Serializes a canonical snapshot. |
| `PRIMITIVE_VALUE_TYPES` | constant | Supported primitive value types. |
| `RELATION_CARDINALITIES` | constant | Supported directed relation cardinalities. |
| `DomainModelDefinition` / `DomainModel` | types | Model authoring and detached shapes. |
| `ValueTypeDefinition` / `VocabularyDefinition` | types | Scalar and closed vocabulary declarations. |
| `DomainTypeDefinition` / `RelationDefinition` | types | Domain types and directed attributed relations. |
| `FieldDefinition` / `FieldValueType` | types | Stable field and value reference. |
| `PrimitiveValueType` / `RelationCardinality` | types | Primitive and relation-cardinality vocabularies. |
| `DomainModelFinding` | type | Domain model validation issue. |
| `DomainModelChange` / `DomainModelCompatibilityReport` | types | Classified model change and report. |
| `DomainRecordDefinition` / `DomainRecord` | types | Snapshot record authoring and detached shapes. |
| `DomainRelationDefinition` / `DomainRelation` | types | Snapshot relation authoring and detached shapes. |
| `DomainSnapshotDefinition` / `DomainSnapshot` | types | Snapshot authoring and detached shapes. |
| `DomainSnapshotFinding` | type | Snapshot validation issue. |

## Topology compatibility

Removing a system, authority, or interface is breaking. Changing a system's
kind, responsibilities, provider binding, locator, visibility, an authority's
owner or system of record, or an interface's direction or responsibilities is
also breaking. Adding a system, authority, or interface is additive. Labels,
descriptions, and `schemaVersion` do not determine compatibility.

## Requirements

Node 20+. ESM only. No runtime dependencies and no I/O in the library API.

## Licence

MIT
