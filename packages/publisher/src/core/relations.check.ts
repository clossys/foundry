import { validateRelations } from "./index.js";
import type { RelationNodeKind, RelationNode, RelationEdge, RelationsGraph, RelationsResult, RelationProvenance } from "./index.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Kinds = Assert<Equal<RelationNodeKind, "assembly" | "instance" | "block" | "component" | "token">>;
type Nodes = Assert<Equal<RelationNode["kind"], RelationNodeKind>>;
type EdgeKinds = Assert<Equal<RelationEdge["kind"], "route-instance" | "placement" | "instance-frame" | "instance-view" | "block-block" | "block-component" | "component-token">>;
type Pair<E> = E extends { from: { kind: infer F }; to: { kind: infer T } } ? `${F & string}->${T & string}` : never;
type Pairs = Assert<Equal<Pair<RelationEdge>, "route-binding->instance" | "assembly->instance" | "instance->block" | "block->block" | "block->component" | "component->token">>;
type Status = Assert<Equal<RelationsResult["status"], "valid" | "refused">>;
type Qualification = Assert<Equal<RelationsGraph["qualification"], "unverified">>;
type Provenance = Assert<Equal<RelationProvenance["kind"], "declared" | "derived">>;
type Refused = Assert<Equal<keyof Extract<RelationsResult, { status: "refused" }>, "status" | "reasons">>;
// @ts-expect-error Routes are auxiliary bindings, never an additional tier.
const route: RelationNodeKind = "route-binding";
// @ts-expect-error An Component cannot point at an assembly.
const illegal: RelationEdge = { kind: "component-token", from: { kind: "component", key: "a" }, to: { kind: "assembly", key: "b" }, provenance: { kind: "declared", sourceRevision: "a", evidenceRef: "e", sourceDocument: "d" } };
const validate: (input: unknown) => RelationsResult = validateRelations;
void [validate, route, illegal];
export type { Kinds, Nodes, EdgeKinds, Pairs, Status, Qualification, Provenance, Refused };
