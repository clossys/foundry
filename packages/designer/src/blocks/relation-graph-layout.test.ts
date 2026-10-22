import { describe, expect, it } from "vitest";
import { layoutRelationGraph, relationGraphHref, RELATION_GRAPH_NODE_CAP } from "./relation-graph-layout.js";
import type { RelationGraphNode } from "./relation-graph-types.js";

const nodes = ["d", "a", "e", "b", "c"].map(id => ({ id, label: id.toUpperCase(), kind: "unit" }));
const edges = [{ from: "a", to: "d" }, { from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }];
describe("RelationGraph layout", () => {
  it("uses longest paths, stable ties, disconnected nodes and immutable deterministic data", () => {
    const before = JSON.stringify({ nodes, edges });
    const result = layoutRelationGraph(nodes, edges, ["unit"]);
    expect(result.order.map(node => node.id)).toEqual(["a", "e", "b", "c", "d"]);
    expect([...result.positions]).toEqual([
      ["a", { layer: 0, row: 0 }], ["e", { layer: 0, row: 1 }],
      ["b", { layer: 1, row: 0 }], ["c", { layer: 2, row: 0 }], ["d", { layer: 3, row: 0 }],
    ]);
    expect(result).toEqual(layoutRelationGraph(nodes, edges, ["unit"]));
    expect(result.outgoing.get("a")).toEqual(edges.slice(0, 2));
    expect(result.incoming.get("d")).toEqual([edges[0], edges[3]]);
    expect(JSON.stringify({ nodes, edges })).toBe(before);
  });
  it("retains the entire list but lays out no part of a disconnected cycle", () => {
    const result = layoutRelationGraph(nodes, [...edges, { from: "d", to: "a" }], ["unit"]);
    expect(result.cyclic).toBe(true);
    expect(result.positions.size).toBe(0);
    expect(result.order).toEqual(nodes);
  });
  it("keeps an empty graph empty and enforces the documented cap", () => {
    expect(layoutRelationGraph([], [], ["unit"]).order).toEqual([]);
    const maximum = Array.from({ length: RELATION_GRAPH_NODE_CAP }, (_, i) => ({ id: String(i), label: "Node", kind: "unit" }));
    expect(layoutRelationGraph(maximum, [], ["unit"]).order).toHaveLength(64);
    expect(() => layoutRelationGraph([...maximum, { ...maximum[0]!, id: "extra" }], [], ["unit"])).toThrow(/node cap/i);
  });
  it.each([
    [null, [], ["unit"]], [new Array(1), [], ["unit"]], [[null], [], ["unit"]],
    [[{ ...nodes[0], id: undefined }], [], ["unit"]], [[{ ...nodes[0], id: 1 }], [], ["unit"]],
    [[{ ...nodes[0], label: " " }], [], ["unit"]], [[{ ...nodes[0], kind: "other" }], [], ["unit"]],
    [[nodes[0], nodes[0]], [], ["unit"]], [nodes, null, ["unit"]], [nodes, [null], ["unit"]],
    [nodes, [{ from: "unknown", to: "a" }], ["unit"]], [nodes, [{ from: "a", to: "unknown" }], ["unit"]],
    [nodes, [{ from: "a", to: "a" }], ["unit"]], [nodes, [], []],
  ])("refuses malformed structure without echoing values (%#)", (input, relations, kinds) => {
    expect(() => layoutRelationGraph(input as never, relations as never, kinds as never)).toThrow(/RelationGraph:/);
  });
  it("names endpoint refusal rather than silently discarding the edge", () => {
    expect(() => layoutRelationGraph(nodes, [{ from: "PAYLOAD-SENTINEL", to: "a" }], ["unit"]))
      .toThrow(/^RelationGraph: edge endpoints must refer to nodes\.$/);
  });
  it("refuses a sparse vocabulary instead of accepting an absent kind", () => {
    expect(() => layoutRelationGraph([{ ...nodes[0]!, kind: undefined } as never], [], new Array(1))).toThrow(/kinds/);
  });
  it.each(["/path?x=1#y", "./path", "../path", "path", "https://example.com/path"])("permits safe href %s", href => {
    expect(relationGraphHref(href)).toBe(true);
  });
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "http://example.com", "//example.com", "/\\example.com", " /path", "/path\n", "", "https://name:pass@example.com", null, 1])("refuses unsafe href %s", href => {
    expect(relationGraphHref(href)).toBe(false);
  });
});
