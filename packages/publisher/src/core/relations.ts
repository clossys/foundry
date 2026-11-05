import { CHANNELS } from "./types.js";
import { validateBlockRoleBinding } from "./block-role-binding.js";
import type { InstanceBlockBinding, BlockRoleBindingRefIdentity } from "./block-role-binding.js";
import type { BlockRoleAdapterContract } from "./block-role.js";
import { validateWebRolePairEvidence } from "./web-role-pair-evidence.js";
import type { WebRolePairEvidence } from "./web-role-pair-evidence.js";

export interface RelationIdentity {
  ref: string;
  sourceRevision: string;
  context: InstanceBlockBinding["context"];
}
export type RelationNodeKind = "assembly" | "instance" | "block" | "component" | "token";
type BaseNode<Kind extends string> = Kind extends string ? { kind: Kind; key: string; identity: RelationIdentity } : never;
export type RelationNode = BaseNode<"assembly" | "component" | "token"> |
  (BaseNode<"block"> & { roleIdentity?: BlockRoleBindingRefIdentity }) |
  (BaseNode<"instance"> & { binding: InstanceBlockBinding; witness?: { record: WebRolePairEvidence; fresh: WebRolePairEvidence } });
export type RelationRouteBinding = BaseNode<"route-binding">;
export type RelationEndpoint<Kind extends RelationNodeKind | "route-binding"> = { kind: Kind; key: string };
export type RelationProvenance = { sourceRevision: string; evidenceRef: string } & (
  { kind: "declared"; sourceDocument: string } | { kind: "derived"; extractor: string; version: string });
type Edge<Kind extends string, From extends RelationNodeKind | "route-binding", To extends RelationNodeKind> = Kind extends string ? {
  kind: Kind; from: RelationEndpoint<From>; to: RelationEndpoint<To>; provenance: RelationProvenance;
} : never;
export type RelationEdge = Edge<"route-instance", "route-binding", "instance"> |
  (Edge<"placement", "assembly", "instance"> & { placementKey: string; location: Readonly<Record<string, string>> }) |
  Edge<"instance-frame" | "instance-view", "instance", "block"> |
  Edge<"block-block", "block", "block"> | Edge<"block-component", "block", "component"> | Edge<"component-token", "component", "token">;
export interface RelationsInput {
  nodes: RelationNode[];
  routeBindings: RelationRouteBinding[];
  edges: RelationEdge[];
  knownAdapters: readonly BlockRoleAdapterContract[];
}
export interface RelationsGraph {
  qualification: "unverified";
  nodes: readonly RelationNode[];
  routeBindings: readonly RelationRouteBinding[];
  edges: readonly RelationEdge[];
  forward: Readonly<Record<string, readonly RelationEdge[]>>;
  reverse: Readonly<Record<string, readonly RelationEdge[]>>;
}
export type RelationsReason = "shape" | "unknown-field" | "identity" | "endpoint" | "context" | "revision" | "provenance" |
  "placement-key" | "empty-assembly" | "route-binding" | "cycle" | "binding" | "binding-join" | "witness";
export type RelationsResult = { status: "valid"; graph: RelationsGraph } | { status: "refused"; reasons: readonly RelationsReason[] };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const keys = (value: unknown, allowed: readonly string[]): value is Record<string, unknown> => object(value) && Object.keys(value).every(key => allowed.includes(key));
function copy(value: unknown, depth = 0): any {
  if (value === null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value)) return value;
  if (depth > 64 || !object(value) && !Array.isArray(value)) throw new Error("Invalid data");
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && (array || prototype !== null)) throw new Error("Invalid prototype");
  const fields = Object.getOwnPropertyDescriptors(value), result: any = array ? [] : Object.create(null);
  for (const key of Reflect.ownKeys(fields)) {
    if (array && key === "length") continue;
    if (typeof key !== "string" || !fields[key]!.enumerable || !("value" in fields[key]!)) throw new Error("Invalid field");
    if (key === "lifecycleItemRef") throw new Error("Unknown lifecycle item reference");
    Object.defineProperty(result, key, { value: copy(fields[key]!.value, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  if (array && (Object.keys(result).length !== value.length || Object.keys(result).some((key, i) => key !== String(i)))) throw new Error("Sparse array");
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return object(value) ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}" : JSON.stringify(value);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const pairs = {
  "route-instance": ["route-binding", "instance"], placement: ["assembly", "instance"],
  "instance-frame": ["instance", "block"], "instance-view": ["instance", "block"],
  "block-block": ["block", "block"], "block-component": ["block", "component"], "component-token": ["component", "token"],
} as const;
/** Validates membership and exact use, never renderer authentication or qualification. */
export function validateRelations(value: unknown): RelationsResult {
  const reasons = new Set<RelationsReason>();
  const refuse = (...codes: RelationsReason[]): RelationsResult => ({ status: "refused", reasons: [...new Set([...reasons, ...codes])] });
  try {
    const raw = copy(value);
    if (!object(raw)) return refuse("shape");
    if (!keys(raw, ["nodes", "routeBindings", "edges", "knownAdapters"])) return refuse("unknown-field");
    if (![raw.nodes, raw.routeBindings, raw.edges, raw.knownAdapters].every(Array.isArray)) return refuse("shape");
    const input = raw as unknown as RelationsInput;
    const nodes = new Map<string, RelationNode | RelationRouteBinding>(), identities = new Set<string>();
    for (const node of [...input.routeBindings, ...input.nodes]) {
      if (!object(node) || !text(node.key) || !text(node.kind)) return refuse("shape");
      if (!keys(node, ["kind", "key", "identity", ...(node.kind === "instance" ? ["binding", "witness"] : node.kind === "block" ? ["roleIdentity"] : [])])) return refuse("unknown-field");
      if (!(node.kind === "route-binding" ? input.routeBindings.includes(node) :
        input.nodes.includes(node as RelationNode) && ["assembly", "instance", "block", "component", "token"].includes(node.kind))) return refuse("shape");
      const id = node.identity;
      if (!object(id)) return refuse("identity");
      if (!keys(id, ["ref", "sourceRevision", "context"]) || object(id.context) && !keys(id.context, ["consumer", "brand", "medium"])) return refuse("unknown-field");
      if (!text(id.ref) || !text(id.sourceRevision) || !object(id.context) || ![id.context.consumer, id.context.brand].every(text) || ![...CHANNELS, "video"].includes(id.context.medium as string) || nodes.has(node.key)) return refuse("identity");
      const identityKey = canonical(id);
      if (identities.has(identityKey)) return refuse("identity");
      identities.add(identityKey); nodes.set(node.key, node);
    }
    const forward: Record<string, RelationEdge[]> = Object.create(null), reverse: Record<string, RelationEdge[]> = Object.create(null);
    for (const key of nodes.keys()) { forward[key] = []; reverse[key] = []; }
    const placements = new Set<string>();
    for (const edge of input.edges) {
      if (!object(edge)) return refuse("endpoint");
      if (!keys(edge, ["kind", "from", "to", "provenance", ...(edge.kind === "placement" ? ["placementKey", "location"] : [])]) ||
        [edge.from, edge.to].some(endpoint => object(endpoint) && !keys(endpoint, ["kind", "key"]))) return refuse("unknown-field");
      if (!text(edge.kind) || !Object.hasOwn(pairs, edge.kind) || !keys(edge.from, ["kind", "key"]) || !keys(edge.to, ["kind", "key"])) return refuse("endpoint");
      const source = nodes.get(edge.from.key), target = nodes.get(edge.to.key), expected = pairs[edge.kind];
      if (!source || !target || source.kind !== expected[0] || target.kind !== expected[1] || source.kind !== edge.from.kind || target.kind !== edge.to.kind) return refuse("endpoint");
      if (canonical(source.identity.context) !== canonical(target.identity.context)) reasons.add("context");
      const p = edge.provenance;
      if (!keys(p, ["kind", "sourceRevision", "evidenceRef", ...(p?.kind === "declared" ? ["sourceDocument"] : ["extractor", "version"])]) ||
        !text(p.evidenceRef) || !text(p.sourceRevision) || !(p.kind === "declared" ? text(p.sourceDocument) : p.kind === "derived" && text(p.extractor) && text(p.version))) reasons.add("provenance");
      else if (p.sourceRevision !== source.identity.sourceRevision) reasons.add("revision");
      if (edge.kind === "placement") {
        const key = canonical([edge.from.key, edge.placementKey]);
        if (!text(edge.placementKey) || placements.has(key) || !object(edge.location) || !Object.keys(edge.location).length || !Object.values(edge.location).every(text)) reasons.add("placement-key");
        placements.add(key);
      }
      forward[source.key]!.push(edge);
      reverse[target.key]!.push(edge);
    }
    for (const route of input.routeBindings) if (forward[route.key]!.length !== 1) reasons.add("route-binding");
    for (const node of input.nodes) {
      if (node.kind === "block" && node.roleIdentity !== undefined && !reverse[node.key]!.some(edge => edge.kind === "instance-frame" || edge.kind === "instance-view")) reasons.add("binding-join");
      if (node.kind === "assembly" && !forward[node.key]!.some(edge => edge.kind === "placement")) reasons.add("empty-assembly");
      if (node.kind !== "instance") continue;
      const binding = node.binding;
      const result = validateBlockRoleBinding(binding, input.knownAdapters);
      if (result.status !== "unverified" || !result.identity || result.reasons.some(reason => reason.code !== "measurement-required") ||
        [binding?.frameBlockRef, binding?.viewBlockRef].some(ref => object(ref) && (Object.hasOwn(ref, "qualified") || Object.hasOwn(ref, "status")))) { reasons.add("binding"); continue; }
      if (canonical(result.identity.context) !== canonical(node.identity.context)) reasons.add("context");
      for (const [kind, ref] of [["instance-frame", result.identity.frameBlockRef], ["instance-view", result.identity.viewBlockRef]] as const) {
        const links = forward[node.key]!.filter(edge => edge.kind === kind);
        const target = links.length === 1 ? nodes.get(links[0]!.to.key) : undefined;
        if (!target || target.kind !== "block" || canonical(target.roleIdentity) !== canonical(ref) || target.identity.sourceRevision !== ref.sourceRevision) reasons.add("binding-join");
      }
      if (node.witness !== undefined && (!keys(node.witness, ["record", "fresh"]) ||
        validateWebRolePairEvidence(node.witness.record, binding, node.witness.fresh).status !== "measured")) reasons.add("witness");
    }
    const visiting = new Set<string>(), visited = new Set<string>();
    function visit(key: string): void {
      if (visiting.has(key)) { reasons.add("cycle"); return; }
      if (visited.has(key)) return;
      visiting.add(key);
      for (const edge of forward[key]!) visit(edge.to.key);
      visiting.delete(key); visited.add(key);
    }
    for (const key of nodes.keys()) visit(key);
    return reasons.size ? refuse() : { status: "valid", graph: freeze({ qualification: "unverified", nodes: input.nodes, routeBindings: input.routeBindings, edges: input.edges, forward, reverse }) };
  } catch (error) { return refuse(error instanceof Error && error.message === "Unknown lifecycle item reference" ? "unknown-field" : "shape"); }
}
