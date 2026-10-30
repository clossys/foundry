import { describe, expect, it } from "vitest";
import * as core from "./index.js";
import { checkImportPurity } from "../../../../scripts/lib/import-purity.mjs";
import type { RelationsInput, RelationEdge, RelationNode, RelationsResult } from "./relations.js";

const binding = core.WEB_ROLE_PAIR_BINDINGS[0]!;
const witness = core.WEB_ROLE_PAIR_EVIDENCE[0]!;
const assessed = core.validateBlockRoleBinding(binding, [binding.frameBlockRef, binding.viewBlockRef]);
if (!("identity" in assessed) || !assessed.identity) throw new Error("Missing predecessor identity");
const pair = assessed.identity;
const identity = (ref: string) => ({ ref, sourceRevision: witness.sourceRevision, context: { ...binding.context } });
const provenance = { kind: "declared", sourceDocument: "example-source", sourceRevision: witness.sourceRevision, evidenceRef: "example-evidence" } as const;
const source = { kind: "block", key: "nested" } as const;
const use = { kind: "block-component", from: source, to: { kind: "component", key: "component-small" }, provenance } as const;
function fixture(): RelationsInput {
  return structuredClone({
    knownAdapters: [structuredClone(binding.frameBlockRef), structuredClone(binding.viewBlockRef)],
    routeBindings: [{ key: "route", kind: "route-binding", identity: identity("route:/example") }],
    nodes: [
      { key: "assembly", kind: "assembly", identity: identity("example-web") },
      { key: "instance", kind: "instance", identity: identity("example-instance"), binding },
      { key: "frame", kind: "block", identity: identity("example-frame"), roleIdentity: pair.frameBlockRef },
      { key: "view", kind: "block", identity: identity("example-view"), roleIdentity: pair.viewBlockRef },
      { key: "nested", kind: "block", identity: identity("example-nested") },
      { key: "component-small", kind: "component", identity: identity("example-component?size=small") },
      { key: "component-large", kind: "component", identity: identity("example-component?size=large") },
      { key: "token", kind: "token", identity: identity("example-token") },
    ],
    edges: [
      { kind: "route-instance", from: { kind: "route-binding", key: "route" }, to: { kind: "instance", key: "instance" }, provenance },
      ...["primary", "secondary"].map(placementKey => ({ kind: "placement", from: { kind: "assembly", key: "assembly" },
        to: { kind: "instance", key: "instance" }, placementKey, location: { path: "/example", region: placementKey }, provenance })),
      { kind: "instance-frame", from: { kind: "instance", key: "instance" }, to: { kind: "block", key: "frame" }, provenance },
      { kind: "instance-view", from: { kind: "instance", key: "instance" }, to: { kind: "block", key: "view" }, provenance },
      { kind: "block-block", from: { kind: "block", key: "view" }, to: source, provenance }, use,
      { kind: "component-token", from: { kind: "component", key: "component-small" }, to: { kind: "token", key: "token" },
        provenance: { kind: "derived", extractor: "example-measurer", version: "1", sourceRevision: witness.sourceRevision, evidenceRef: "example-extraction" } },
    ],
  }) as RelationsInput;
}
const validate = (input: unknown) => core.validateRelations(input);
function graph(result: RelationsResult) {
  expect(result.status).toBe("valid");
  if (result.status !== "valid") throw new Error(JSON.stringify(result.reasons));
  return result.graph;
}
function refused(input: unknown, reason: string) {
  const result = validate(input);
  expect(result.status).toBe("refused");
  expect(result).not.toHaveProperty("graph");
  if (result.status === "refused") expect(result.reasons).toContain(reason);
}
describe("exact declared membership and measured source use", () => {
  it("exports the synchronous contract", () => expect(core.validateRelations).toBeTypeOf("function"));
  it("preserves nested edges, two placements and configured Component identities in exact inverse projections", () => {
    const input = fixture(), before = structuredClone(input), result = graph(validate(input));
    expect(input).toEqual(before);
    expect(result.qualification).toBe("unverified");
    expect(Object.values(result.forward).flat()).toEqual(input.edges);
    expect(Object.values(result.reverse).flat()).toHaveLength(input.edges.length);
    for (const edge of input.edges) {
      expect(result.forward[edge.from.key]).toContainEqual(edge);
      expect(result.reverse[edge.to.key]).toContainEqual(edge);
    }
    expect(result.reverse.instance!.filter(edge => edge.kind === "placement")).toEqual(input.edges.slice(1, 3));
    expect(result.reverse["component-small"]).toEqual([use]);
    expect(result.reverse.token).toEqual([input.edges[7]]);
    expect(result.reverse["component-large"]).toEqual([]);
    expect(result.forward.view).toEqual([input.edges[5]]);
    expect(result.nodes).toEqual(input.nodes);
    expect(Object.isFrozen(result.reverse["component-small"])).toBe(true);
    input.nodes[5]!.identity.ref = "changed";
    expect(result.nodes[5]!.identity.ref).toBe("example-component?size=small");
    input.edges.splice(0);
    expect(result.edges).toHaveLength(8);
  });
  it("refuses unknown endpoints and illegal pairs", () => {
    let input = fixture(); input.edges[6] = { ...use, to: { kind: "component", key: "absent" } }; refused(input, "endpoint");
    input = fixture(); input.edges[6] = { ...use, to: { kind: "block", key: "nested" } } as unknown as RelationEdge; refused(input, "endpoint");
  });
  it.each(["from", "to"] as const)("requires exact %s endpoint kind labels", endpoint => {
    const input = fixture();
    input.edges[6] = { ...input.edges[6]!, [endpoint]: { ...input.edges[6]![endpoint], kind: "token" } } as RelationEdge;
    expect(input.edges[5]!.to.kind).toBe("block");
    refused(input, "endpoint");
  });
  it("requires route bindings in the auxiliary collection", () => {
    const input = fixture(), route = input.routeBindings.pop()!;
    input.nodes.push(route as unknown as RelationNode);
    refused(input, "shape");
  });
  it("refuses duplicate complete identities at distinct node keys", () => {
    const input = fixture();
    input.nodes.push({ ...input.nodes[6]!, key: "duplicate-identity" });
    refused(input, "identity");
  });
  it("requires a role-identified Block to participate in an Instance join", () => {
    const input = fixture();
    input.nodes.push({ ...input.nodes[2]!, key: "orphan-role", identity: identity("orphan-role") });
    refused(input, "binding-join");
  });
  it.each([undefined, {}, { region: "" }])("requires nonempty placement location metadata %#", location => {
    const input = fixture(), placement = input.edges[1] as Extract<RelationEdge, { kind: "placement" }>;
    if (location === undefined) delete (placement as Partial<typeof placement>).location;
    else placement.location = location;
    refused(input, "placement-key");
  });
  it.each(["placement", "instance-frame"])("refuses array-coerced %s edge kinds", kind => {
    const input = fixture(), edge = input.edges.find(edge => edge.kind === kind)!;
    input.edges.push({ kind: [kind], from: edge.from, to: edge.to, provenance: edge.provenance } as unknown as RelationEdge);
    refused(input, "endpoint");
  });
  it("refuses self edges", () => {
    const input = fixture(); input.edges.push({ kind: "block-block", from: source, to: source, provenance }); refused(input, "cycle");
  });
  it("refuses nested Block cycles", () => {
    const input = fixture(); input.edges.push({ kind: "block-block", from: source, to: { kind: "block", key: "view" }, provenance }); refused(input, "cycle");
  });
  it("requires occupied assemblies and distinct placement keys without deduplicating repeated Instances", () => {
    let input = fixture(); input.edges = input.edges.filter(edge => edge.kind !== "placement"); refused(input, "empty-assembly");
    input = fixture(); input.edges[2] = input.edges[1]!; refused(input, "placement-key");
    input = fixture(); input.edges.shift(); refused(input, "route-binding");
  });
  it("rejects foreign consumer/brand/medium and revision drift", () => {
    for (const field of ["consumer", "brand", "medium"] as const) {
      const input = fixture(); (input.nodes[5]!.identity.context as Record<string, string>)[field] = field === "medium" ? "email" : "foreign";
      refused(input, "context");
      const consistent = fixture();
      for (const node of [...consistent.nodes, ...consistent.routeBindings]) (node.identity.context as Record<string, string>)[field] = field === "medium" ? "email" : "foreign";
      refused(consistent, "context");
    }
    const input = fixture(); input.nodes[5]!.identity.sourceRevision = "b".repeat(40); refused(input, "revision");
  });
  it("never accepts boolean, candidate or stale records as qualification", () => {
    for (const claim of [true, { ...binding, qualified: true }, { status: "qualified", identity: pair }]) {
      const input = fixture(); (input.nodes[1] as unknown as { binding: unknown }).binding = claim; refused(input, "binding");
    }
    const input = fixture(); Object.assign(input.nodes[1]!, { witness: { record: witness, fresh: { ...witness, sourceRevision: "b".repeat(40) } } });
    refused(input, "witness");
    Object.assign(input.nodes[1]!, { witness: { record: witness, fresh: witness } });
    expect(graph(validate(input)).qualification).toBe("unverified");
  });
  it("refuses boolean and caller-qualified Block descriptors for either peer", () => {
    for (const ref of ["frameBlockRef", "viewBlockRef"] as const) for (const claim of [true, { ...binding[ref], qualified: true }, { ...binding[ref], status: "qualified" }]) {
      const input = fixture(); Object.assign((input.nodes[1] as Extract<RelationNode, { kind: "instance" }>).binding, { [ref]: claim }); refused(input, "binding");
    }
  });
  it("validates both frame and view independently and joins the exact configured identity", () => {
    for (const [ref, main] of [["viewBlockRef", "sole"], ["frameBlockRef", "none"]] as const) {
      const input = fixture(); Object.assign((input.nodes[1] as Extract<RelationNode, { kind: "instance" }>).binding[ref], { web: { main } });
      expect(input.knownAdapters.map(candidate => candidate.web?.main)).toEqual(["sole", "none"]); refused(input, "binding");
    }
    let input = fixture(); Object.assign((input.nodes[3] as Extract<RelationNode, { kind: "block" }>).roleIdentity!, { configDigest: "sha256:wrong" }); refused(input, "binding-join");
    input = fixture(); input.edges = input.edges.filter(edge => edge.kind !== "instance-view"); refused(input, "binding-join");
    for (const key of ["frame", "view"]) {
      const input = fixture(), block = input.nodes.find(node => node.key === key)!;
      block.identity.sourceRevision = "different-role-revision";
      for (const edge of input.edges.filter(edge => edge.from.key === key)) edge.provenance = { ...edge.provenance, sourceRevision: block.identity.sourceRevision };
      refused(input, "binding-join");
    }
  });
  it("requires exact source provenance, refusing imports, missing fields and authored reverse indexes", () => {
    for (const change of [...["import", "alias", "default-fixture"].map(kind => ({ provenance: { ...provenance, kind } })), { provenance: { ...provenance, evidenceRef: "" } },
      { provenance: { kind: "derived", sourceRevision: witness.sourceRevision, evidenceRef: "example" } }]) {
      const input = fixture(); Object.assign(input.edges[6]!, change); refused(input, "provenance");
    }
    const missing = fixture(); delete (missing.edges[6] as Partial<RelationEdge>).provenance; refused(missing, "provenance");
    refused({ ...fixture(), reverse: { "component-small": [] } }, "unknown-field");
  });
  it.each([
    ["declared", "sourceDocument", 6],
    ["derived", "extractor", 7],
    ["derived", "version", 7],
  ] as const)("requires %s provenance field %s independently", (_kind, field, index) => {
    const input = fixture(), record = { ...input.edges[index]!.provenance } as Record<string, unknown>;
    delete record[field];
    Object.assign(input.edges[index]!, { provenance: record });
    refused(input, "provenance");
  });
  it.each([false, true])("refuses import provenance with derived fields (sourceDocument=%s)", sourceDocument => {
    const input = fixture();
    Object.assign(input.edges[6]!, { provenance: {
      kind: "import", extractor: "example-measurer", version: "1",
      sourceRevision: witness.sourceRevision, evidenceRef: "example-import",
      ...(sourceDocument ? { sourceDocument: "example-source" } : {}),
    } });
    refused(input, "provenance");
  });
  it("refuses a source-side Component in a Block-to-Component edge", () => {
    const input = fixture();
    input.edges[6] = { ...input.edges[6]!, from: { kind: "component", key: "component-large" } } as unknown as RelationEdge;
    refused(input, "endpoint");
  });
  it.each(["instance-frame", "instance-view"] as const)("requires exactly one %s edge per Instance", kind => {
    const input = fixture();
    input.edges.push(structuredClone(input.edges.find(edge => edge.kind === kind)!));
    refused(input, "binding-join");
  });
  it.each<[string, (input: RelationsInput) => object, object]>([
    ["Block qualification", input => input.nodes[2]!, { qualified: true }],
    ["Block witness", input => input.nodes[2]!, { witness: {} }],
    ["identity", input => input.nodes[4]!.identity, { extra: true }],
    ["context", input => input.nodes[4]!.identity.context, { extra: true }],
    ["edge", input => input.edges[6]!, { extra: true }],
    ["placement key on source use", input => input.edges[6]!, { placementKey: "misplaced" }],
    ["placement location on source use", input => input.edges[6]!, { location: { region: "misplaced" } }],
  ])("refuses unknown %s fields independently", (_name, target, extra) => {
    const input = fixture(); Object.assign(target(input), extra);
    refused(input, "unknown-field");
  });
  it("refuses unknown provenance keys independently", () => {
    const input = fixture();
    input.edges[6]!.provenance = { ...input.edges[6]!.provenance, extra: true } as RelationEdge["provenance"];
    refused(input, "provenance");
  });
  it("preserves duplicate identical source-use edges in both projections", () => {
    const input = fixture(); input.edges.push(structuredClone(input.edges[6]!));
    const result = graph(validate(input));
    expect(result.edges).toEqual(input.edges);
    expect(result.forward.nested).toEqual([input.edges[6], input.edges[8]]);
    expect(result.reverse["component-small"]).toEqual([input.edges[6], input.edges[8]]);
  });
  it.each([0, 2])("requires exactly one route edge, refusing %s", count => {
    const input = fixture();
    if (count === 0) input.edges.shift(); else input.edges.push(structuredClone(input.edges[0]!));
    refused(input, "route-binding");
  });
  it.each(["nodes", "edges"])("refuses a non-array %s collection", field => {
    refused({ ...fixture(), [field]: {} }, "shape");
  });
  it("requires a nonempty node key", () => {
    const input = fixture(); input.nodes[6]!.key = ""; refused(input, "shape");
  });
  it.each(["ref", "sourceRevision", "consumer", "brand"] as const)("requires nonempty identity %s text", field => {
    const input = fixture(), id = input.nodes[6]!.identity;
    if (field === "ref" || field === "sourceRevision") id[field] = ""; else id.context[field] = "";
    refused(input, "identity");
  });
  it("compares opaque revisions and rejects unknown media", () => {
    const input = fixture(); input.nodes[5]!.identity.sourceRevision = "release/example-v2";
    input.edges[7]!.provenance.sourceRevision = "release/example-v2";
    expect(graph(validate(input)).qualification).toBe("unverified");
    const token = input.nodes[7]!;
    refused({ nodes: [{ ...token, identity: { ...token.identity, context: { ...binding.context, medium: "unknown" } } }], routeBindings: [], edges: [], knownAdapters: [] }, "identity");
  });
  it("refuses supplied lifecycle item references as unknown fields without synthesizing lifecycle data", () => {
    const targets: ((input: RelationsInput) => object)[] = [input => input];
    for (let i = 0; i < fixture().nodes.length; i++) {
      targets.push(
        input => input.nodes[i]!,
        input => input.nodes[i]!.identity,
        input => input.nodes[i]!.identity.context,
      );
    }
    for (let i = 0; i < fixture().routeBindings.length; i++) {
      targets.push(
        input => input.routeBindings[i]!,
        input => input.routeBindings[i]!.identity,
        input => input.routeBindings[i]!.identity.context,
      );
    }
    for (let i = 0; i < fixture().edges.length; i++) {
      targets.push(
        input => input.edges[i]!,
        input => input.edges[i]!.from,
        input => input.edges[i]!.to,
      );
    }
    for (const target of targets) {
      const input = fixture(); Object.assign(target(input), { lifecycleItemRef: "invented" }); refused(input, "unknown-field");
    }
    expect(graph(validate(fixture()))).not.toHaveProperty("lifecycleItemRef");
  });
  it.each<(input: RelationsInput) => object>([
    input => input.knownAdapters[0]!, input => (input.nodes[1] as Extract<RelationNode, { kind: "instance" }>).binding.frameBlockRef,
    input => input.edges[0]!.provenance, input => (input.edges[1] as Extract<RelationEdge, { kind: "placement" }>).location,
    input => Object.assign(input.nodes[1]!, { witness: { record: structuredClone(witness), fresh: structuredClone(witness) } }).witness.record,
  ])("refuses nested lifecycle item references with a stable unknown-field reason %#", target => {
    const input = fixture(); Object.assign(target(input), { lifecycleItemRef: "invented" }); refused(input, "unknown-field");
  });
  it("refuses accessors, inherited fields, sparse and cyclic data without executing getters", () => {
    let calls = 0;
    const getter = Object.defineProperty(fixture(), "edges", { enumerable: true, get() { calls++; return []; } });
    refused(getter, "shape"); expect(calls).toBe(0);
    refused(Object.assign(Object.create({ inherited: true }), fixture()), "shape");
    const sparse = fixture(); delete sparse.nodes[0]; refused(sparse, "shape");
    const cyclic = fixture(); Object.assign(cyclic.nodes[0]!, { cyclic }); refused(cyclic, "shape");
  });
  it("keeps core import purity", () => expect(checkImportPurity({ root: process.cwd(), entries: ["src/core/relations.ts"], allowedBuiltins: [], allowedPackages: [] }).findings).toEqual([]));
});
