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
const use = { kind: "block-atom", from: source, to: { kind: "atom", key: "atom-small" }, provenance } as const;
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
      { key: "atom-small", kind: "atom", identity: identity("example-atom?size=small") },
      { key: "atom-large", kind: "atom", identity: identity("example-atom?size=large") },
      { key: "token", kind: "token", identity: identity("example-token") },
    ],
    edges: [
      { kind: "route-instance", from: { kind: "route-binding", key: "route" }, to: { kind: "instance", key: "instance" }, provenance },
      ...["primary", "secondary"].map(placementKey => ({ kind: "placement", from: { kind: "assembly", key: "assembly" },
        to: { kind: "instance", key: "instance" }, placementKey, location: { path: "/example", region: placementKey }, provenance })),
      { kind: "instance-frame", from: { kind: "instance", key: "instance" }, to: { kind: "block", key: "frame" }, provenance },
      { kind: "instance-view", from: { kind: "instance", key: "instance" }, to: { kind: "block", key: "view" }, provenance },
      { kind: "block-block", from: { kind: "block", key: "view" }, to: source, provenance }, use,
      { kind: "atom-token", from: { kind: "atom", key: "atom-small" }, to: { kind: "token", key: "token" },
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
  it("preserves nested edges, two placements and configured Atom identities in exact inverse projections", () => {
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
    expect(result.reverse["atom-small"]).toEqual([use]);
    expect(result.reverse.token).toEqual([input.edges[7]]);
    expect(result.reverse["atom-large"]).toEqual([]);
    expect(result.forward.view).toEqual([input.edges[5]]);
    expect(result.nodes).toEqual(input.nodes);
    expect(Object.isFrozen(result.reverse["atom-small"])).toBe(true);
    input.nodes[5]!.identity.ref = "changed";
    expect(result.nodes[5]!.identity.ref).toBe("example-atom?size=small");
    input.edges.splice(0);
    expect(result.edges).toHaveLength(8);
  });
  it("refuses unknown endpoints and illegal pairs", () => {
    let input = fixture(); input.edges[6] = { ...use, to: { kind: "atom", key: "absent" } }; refused(input, "endpoint");
    input = fixture(); input.edges[6] = { ...use, to: { kind: "block", key: "nested" } } as unknown as RelationEdge; refused(input, "endpoint");
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
  });
  it("requires exact source provenance, refusing imports, missing fields and authored reverse indexes", () => {
    for (const change of [...["import", "alias", "default-fixture"].map(kind => ({ provenance: { ...provenance, kind } })), { provenance: { ...provenance, evidenceRef: "" } },
      { provenance: { kind: "derived", sourceRevision: witness.sourceRevision, evidenceRef: "example" } }]) {
      const input = fixture(); Object.assign(input.edges[6]!, change); refused(input, "provenance");
    }
    const missing = fixture(); delete (missing.edges[6] as Partial<RelationEdge>).provenance; refused(missing, "provenance");
    refused({ ...fixture(), reverse: { "atom-small": [] } }, "unknown-field");
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
