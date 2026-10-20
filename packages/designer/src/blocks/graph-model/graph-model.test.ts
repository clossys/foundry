import { describe, expect, it, vi } from "vitest";
import {
  validateGraph, GraphValidationError, neighbors, subgraph, degrees, components,
  shortestPath, groupByKind, radialLayout, forceLayout, edgeRoutingHints,
} from "./index.js";
import type { GraphInput } from "./index.js";

const node = (id: string, kind = "entity") => ({ id, kind, label: id.toUpperCase() });
// Authored node order deliberately differs from edge order and lexical order.
const graph: GraphInput = {
  nodes: [node("a", "program"), node("c"), node("b"), node("d"), node("z", "program")],
  edges: [
    { id: "ab", from: "a", to: "b", kind: "owns" },
    { id: "ac", from: "a", to: "c", kind: "owns" },
    { id: "bd", from: "b", to: "d", kind: "owns" },
    { id: "cd", from: "c", to: "d", kind: "owns" },
    { id: "da", from: "d", to: "a", kind: "links" },
    { id: "aa", from: "a", to: "a", kind: "links" },
    { id: "ab2", from: "b", to: "a", kind: "links", weight: 2 },
  ],
};
const ids = (nodes: readonly { id: string }[]) => nodes.map(n => n.id);
const chain = (count: number): GraphInput => ({
  nodes: Array.from({ length: count }, (_, i) => node(String(i))),
  edges: Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
    id: `e${i}`, from: String(i), to: String(i + 1), kind: "link",
  })),
});
const assertError = (fn: () => unknown, code: string) => {
  try { fn(); throw new Error("Expected graph validation to fail"); }
  catch (error) {
    expect(error).toBeInstanceOf(GraphValidationError);
    expect(error).toMatchObject({ name: "GraphValidationError", code });
  }
};

describe("graph-model validation", () => {
  it("accepts inclusive caps, empty graphs and flagged self-loops", () => {
    expect(validateGraph({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
    expect(validateGraph(chain(500)).nodes).toHaveLength(500);
    const edges = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), from: "a", to: "a", kind: "link" }));
    expect(validateGraph({ nodes: [node("a")], edges }).edges).toHaveLength(2000);
    expect(validateGraph(graph).edges.find(e => e.id === "aa")).toMatchObject({ selfLoop: true });
    expect(validateGraph(graph).edges.find(e => e.id === "ab")).toMatchObject({ selfLoop: false });
  });
  it("rejects caps exceeded by one with typed errors", () => {
    assertError(() => validateGraph(chain(501)), "NODE_CAP");
    assertError(() => validateGraph({ nodes: [node("a")], edges: Array.from({ length: 2001 }, (_, i) => ({ id: String(i), from: "a", to: "a", kind: "link" })) }), "EDGE_CAP");
  });
  it("rejects duplicate ids and unknown endpoints", () => {
    assertError(() => validateGraph({ nodes: [node("a"), node("a")], edges: [] }), "DUPLICATE_NODE");
    assertError(() => validateGraph({ ...graph, edges: [graph.edges[0]!, graph.edges[0]!] }), "DUPLICATE_EDGE");
    assertError(() => validateGraph({ nodes: [node("a")], edges: [{ id: "x", from: "a", to: "missing", kind: "link" }] }), "UNKNOWN_ENDPOINT");
  });
  it("rejects malformed runtime values, nonfinite weights and invalid options", () => {
    for (const input of [null, {}, { nodes: {}, edges: [] }, { nodes: [node("")], edges: [] }, { nodes: [{ ...node("a"), label: 4 }], edges: [] }]) {
      assertError(() => validateGraph(input as GraphInput), "INVALID_INPUT");
    }
    for (const weight of [NaN, Infinity, -1, 0]) {
      assertError(() => validateGraph({ ...graph, edges: [{ ...graph.edges[0]!, weight }] }), "INVALID_INPUT");
    }
    assertError(() => neighbors(graph, "missing"), "UNKNOWN_NODE");
    assertError(() => subgraph(graph, "a", { depth: -1 }), "INVALID_OPTIONS");
    assertError(() => subgraph(graph, "a", { depth: 1.5 }), "INVALID_OPTIONS");
    assertError(() => radialLayout(graph, "a", { ringGap: 0 }), "INVALID_OPTIONS");
    assertError(() => forceLayout(graph, { iterations: Infinity }), "INVALID_OPTIONS");
    assertError(() => forceLayout(graph, { seed: NaN }), "INVALID_OPTIONS");
    assertError(() => neighbors(graph, "a", { direction: "sideways" as "in" }), "INVALID_OPTIONS");
  });
});

describe("graph-model queries", () => {
  it("honors direction, edge kinds, authored order, deduplication and self-loops", () => {
    expect(ids(neighbors(graph, "a", { direction: "out", edgeKinds: ["owns"] }))).toEqual(["c", "b"]);
    expect(ids(neighbors(graph, "a", { direction: "in", edgeKinds: ["owns"] }))).toEqual([]);
    expect(ids(neighbors(graph, "a", { direction: "in" }))).toEqual(["a", "b", "d"]);
    expect(ids(neighbors(graph, "a"))).toEqual(["a", "c", "b", "d"]);
    expect(neighbors(graph, "a", { edgeKinds: [] })).toEqual([]);
  });
  it("bounds BFS depth and prunes filters while retaining the focus", () => {
    expect(ids(subgraph(graph, "a", { depth: 0 }).nodes)).toEqual(["a"]);
    expect(ids(subgraph(graph, "a", { depth: 1, edgeKinds: ["owns"] }).nodes)).toEqual(["a", "c", "b"]);
    const result = subgraph(graph, "a", { depth: 2, edgeKinds: ["owns"] });
    expect(ids(result.nodes)).toEqual(["a", "c", "b", "d"]);
    expect(ids(result.edges)).toEqual(["ab", "ac", "bd", "cd"]);
    expect(ids(subgraph(graph, "a", { depth: 4, nodeKinds: ["program"] }).nodes)).toEqual(["a"]);
    expect(ids(subgraph(graph, "z", { depth: 50 }).nodes)).toEqual(["z"]);
    expect(ids(subgraph(chain(4), "0", { depth: 2 }).nodes)).toEqual(["0", "1", "2"]);
  });
  it("counts directed incidence including both ends of loops", () => {
    expect(degrees(graph)).toEqual([
      { id: "a", in: 3, out: 3, total: 6 },
      { id: "c", in: 1, out: 1, total: 2 },
      { id: "b", in: 1, out: 2, total: 3 },
      { id: "d", in: 2, out: 1, total: 3 },
      { id: "z", in: 0, out: 0, total: 0 },
    ]);
  });
  it("keeps weak components separate, stable and inclusive of isolates", () => {
    expect(components(graph).map(ids)).toEqual([["a", "c", "b", "d"], ["z"]]);
    expect(components({ nodes: [node("q"), node("p"), node("r")], edges: [{ id: "e", from: "r", to: "p", kind: "link" }] }).map(ids)).toEqual([["q"], ["p", "r"]]);
    expect(components({ nodes: [], edges: [] })).toEqual([]);
  });
  it("finds unweighted undirected shortest paths with authored node ties", () => {
    const diamond = { ...graph, edges: graph.edges.slice(0, 4) };
    expect(ids(shortestPath(diamond, "a", "d")!)).toEqual(["a", "c", "d"]);
    expect(ids(shortestPath(diamond, "d", "a")!)).toEqual(["d", "c", "a"]);
    expect(ids(shortestPath(graph, "a", "a")!)).toEqual(["a"]);
    expect(shortestPath(graph, "a", "z")).toBeNull();
    assertError(() => shortestPath(graph, "a", "missing"), "UNKNOWN_NODE");
  });
  it("groups by first-seen kind without object-key hazards", () => {
    expect(groupByKind(graph).map(group => ({ kind: group.kind, ids: ids(group.nodes) }))).toEqual([
      { kind: "program", ids: ["a", "z"] }, { kind: "entity", ids: ["c", "b", "d"] },
    ]);
    expect(groupByKind({ nodes: [node("a", "__proto__")], edges: [] })[0]?.kind).toBe("__proto__");
  });
  it("routes opposite-direction parallel edges together in authored edge order", () => {
    const hints = edgeRoutingHints(graph);
    expect(hints.find(e => e.id === "ab")).toEqual({ id: "ab", type: "straight", selfLoop: false, parallelIndex: 0, parallelCount: 2 });
    expect(hints.find(e => e.id === "ab2")).toMatchObject({ parallelIndex: 1, parallelCount: 2 });
    expect(hints.find(e => e.id === "aa")).toMatchObject({ selfLoop: true, parallelIndex: 0, parallelCount: 1 });
  });
});

describe("graph-model layouts and purity", () => {
  it("places radial BFS rings, the unreachable outer ring, and authored angles", () => {
    const input = { nodes: [...chain(4).nodes, node("isolated")], edges: chain(4).edges };
    const result = radialLayout(input, "0", { ringGap: 100 });
    expect(result).toEqual([
      { id: "0", x: 0, y: 0 }, { id: "1", x: 100, y: 0 },
      { id: "2", x: 200, y: 0 }, { id: "3", x: 300, y: 0 },
      { id: "isolated", x: 400, y: 0 },
    ]);
    const radial = radialLayout({ ...graph, edges: graph.edges.slice(0, 4) }, "a", { ringGap: 100 });
    expect(radial).toEqual([
      { id: "a", x: 0, y: 0 }, { id: "c", x: 100, y: 0 },
      { id: "b", x: -100, y: 0 }, { id: "d", x: 200, y: 0 }, { id: "z", x: 300, y: 0 },
    ]);
    expect(radialLayout(input, "0", { ringGap: 100 })).toEqual(result);
  });
  it("uses a seeded PRNG without random or clock access and fixed defaults", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("ambient random is forbidden"); });
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("clock is forbidden"); });
    try {
      const first = forceLayout(graph);
      expect(JSON.stringify(forceLayout(graph))).toBe(JSON.stringify(first));
      expect(forceLayout(graph, { iterations: 300, seed: 1 })).toEqual(first);
      expect(forceLayout(graph, { seed: 2 })).not.toEqual(first);
      expect(first.every(p => Number.isInteger(p.x) && Number.isInteger(p.y))).toBe(true);
      expect(random).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
    } finally { random.mockRestore(); now.mockRestore(); }
  });
  it("separates a 50-node fixture by at least 24 coordinate units", () => {
    const result = forceLayout(chain(50));
    expect(result).toHaveLength(50);
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
      expect(Math.hypot(result[i]!.x - result[j]!.x, result[i]!.y - result[j]!.y)).toBeGreaterThanOrEqual(24);
    }
  });
  it("packs weak components side by side with an 80-unit gap", () => {
    const result = forceLayout(graph);
    const connected = result.filter(p => p.id !== "z");
    expect(result.find(p => p.id === "z")!.x - Math.max(...connected.map(p => p.x))).toBeGreaterThanOrEqual(80);
    expect(forceLayout({ nodes: [], edges: [] })).toEqual([]);
    expect(forceLayout({ nodes: [node("only")], edges: [] })).toEqual([{ id: "only", x: 0, y: 0 }]);
  });
  it("lays out the 500-node cap with 300 iterations within a 4000ms fixture budget", () => {
    const start = performance.now();
    const result = forceLayout(chain(500));
    expect(performance.now() - start).toBeLessThan(4000);
    expect(result).toHaveLength(500);
    expect(result.every(p => Number.isInteger(p.x) && Number.isInteger(p.y))).toBe(true);
  });
  it("does not mutate frozen input, options, or caller-owned nested values", () => {
    const input = structuredClone(graph);
    const original = JSON.stringify(input);
    input.nodes.forEach(Object.freeze); input.edges.forEach(Object.freeze);
    Object.freeze(input.nodes); Object.freeze(input.edges); Object.freeze(input);
    const kinds = Object.freeze(["owns"]);
    const options = Object.freeze({ depth: 2, edgeKinds: kinds });
    validateGraph(input); neighbors(input, "a", { edgeKinds: kinds }); subgraph(input, "a", options);
    degrees(input); components(input); shortestPath(input, "a", "d"); groupByKind(input);
    radialLayout(input, "a"); forceLayout(input); edgeRoutingHints(input);
    expect(JSON.stringify(input)).toBe(original);
    const cloned = validateGraph(input);
    expect(cloned.nodes[0]).not.toBe(input.nodes[0]);
    expect(cloned.edges[0]).not.toBe(input.edges[0]);
  });
});
