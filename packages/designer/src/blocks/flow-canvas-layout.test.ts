import { describe, expect, it } from "vitest";
import { FLOW_CANVAS_NODE_LIMIT, layoutFlowCanvas, type FlowCanvasEdge, type FlowCanvasLayout, type FlowCanvasNode } from "./flow-canvas-layout.js";

const node = (id: string): FlowCanvasNode => ({ id, label: id.toUpperCase() });
const nodesOf = (...ids: string[]) => ids.map(node);
const byId = (layout: FlowCanvasLayout) => new Map(layout.nodes.map(item => [item.id, item]));

function crossings(layout: FlowCanvasLayout): number {
  // Count pairwise crossings between straight chords of consecutive points; adequate for layered output.
  const segments = layout.edges.flatMap(edge => edge.points.slice(1).map((point, i) => [edge.points[i]!, point] as const));
  let count = 0;
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const [[ax, ay], [bx, by]] = segments[i]!, [[cx, cy], [dx, dy]] = segments[j]!;
    if (Math.min(ax, bx) !== Math.min(cx, dx) || Math.max(ax, bx) !== Math.max(cx, dx)) continue;
    if ((ay - cy) * (by - dy) < 0) count++;
  }
  return count;
}

describe("layoutFlowCanvas", () => {
  it("is deterministic and leaves its inputs untouched", () => {
    const nodes = nodesOf("a", "b", "c", "d"), edges: FlowCanvasEdge[] = [{ from: "a", to: "b" }, { from: "a", to: "c", label: "else" }, { from: "b", to: "d" }, { from: "c", to: "d" }];
    const before = JSON.stringify({ nodes, edges });
    const first = layoutFlowCanvas(nodes, edges), second = layoutFlowCanvas(nodes, edges);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify({ nodes, edges })).toBe(before);
  });

  it("assigns longest-path layers and lists nodes in reading order", () => {
    const layout = layoutFlowCanvas(nodesOf("d", "c", "b", "a"), [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "a", to: "d" }]);
    expect(layout.nodes.map(item => [item.id, item.layer])).toEqual([["a", 0], ["b", 1], ["c", 2], ["d", 3]]);
    expect(layout.layers).toBe(4);
  });

  it("puts disconnected nodes in the first layer in authored order", () => {
    const layout = layoutFlowCanvas(nodesOf("x", "a", "y", "b"), [{ from: "a", to: "b" }]);
    expect(layout.nodes.filter(item => item.layer === 0).map(item => item.id)).toEqual(["x", "a", "y"]);
  });

  it("starts every edge on the source's trailing side and ends its arrow tip on the target's leading side", () => {
    for (const orientation of ["horizontal", "vertical"] as const) {
      const layout = layoutFlowCanvas(nodesOf("a", "b", "c"), [{ from: "a", to: "b" }, { from: "a", to: "c" }], { orientation });
      const nodes = byId(layout);
      expect(layout.orientation).toBe(orientation);
      for (const edge of layout.edges) {
        const source = nodes.get(edge.from)!, target = nodes.get(edge.to)!;
        const [sx, sy] = edge.points[0]!, [tx, ty] = edge.tip;
        if (orientation === "horizontal") {
          expect(sx).toBe(source.x + source.width); expect(sy).toBeGreaterThan(source.y); expect(sy).toBeLessThan(source.y + source.height);
          expect(tx).toBe(target.x); expect(ty).toBeGreaterThan(target.y); expect(ty).toBeLessThan(target.y + target.height);
        } else {
          expect(sy).toBe(source.y + source.height); expect(sx).toBeGreaterThan(source.x); expect(sx).toBeLessThan(source.x + source.width);
          expect(ty).toBe(target.y); expect(tx).toBeGreaterThan(target.x); expect(tx).toBeLessThan(target.x + target.width);
        }
        expect(edge.path).toMatch(/^M[\d.]+ [\d.]+ C/);
        expect(edge.arrow).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ L[\d.]+ [\d.]+ Z$/);
      }
    }
  });

  it("gives each edge leaving or entering a node its own port", () => {
    const layout = layoutFlowCanvas(nodesOf("a", "b", "c", "d"), [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }]);
    const starts = layout.edges.filter(edge => edge.from === "a").map(edge => edge.points[0]!.join());
    const tips = layout.edges.filter(edge => edge.to === "d").map(edge => edge.tip.join());
    expect(new Set(starts).size).toBe(2);
    expect(new Set(tips).size).toBe(2);
  });

  it("draws a cycle by reversing one back edge while keeping its authored direction", () => {
    const layout = layoutFlowCanvas(nodesOf("a", "b", "c"), [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a", label: "retry" }]);
    const nodes = byId(layout);
    expect(layout.nodes.map(item => item.layer)).toEqual([0, 1, 2]);
    expect(layout.edges.map(edge => edge.reversed)).toEqual([false, false, true]);
    const back = layout.edges[2]!, a = nodes.get("a")!, c = nodes.get("c")!;
    expect([back.from, back.to]).toEqual(["c", "a"]);
    expect(back.points[0]![0]).toBe(c.x);
    expect(back.tip[0]).toBe(a.x + a.width);
    expect(back.label).toBeDefined();
  });

  it("routes a long edge around intermediate nodes rather than through them", () => {
    const layout = layoutFlowCanvas(nodesOf("a", "b", "c"), [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c" }]);
    const b = byId(layout).get("b")!, long = layout.edges[2]!;
    expect(long.points.length).toBeGreaterThan(2);
    for (const [x, y] of long.points) {
      const insideB = x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
      expect(insideB).toBe(false);
    }
  });

  it("orders each layer to remove avoidable crossings", () => {
    const layout = layoutFlowCanvas(nodesOf("a", "b", "c", "d"), [{ from: "a", to: "d" }, { from: "b", to: "c" }]);
    expect(layout.nodes.map(item => item.id)).toEqual(["a", "b", "d", "c"]);
    expect(crossings(layout)).toBe(0);
  });

  it("places edge labels in the gap after the source", () => {
    const layout = layoutFlowCanvas(nodesOf("a", "b"), [{ from: "a", to: "b", label: "approves" }, { from: "a", to: "b" }]);
    const [a, b] = layout.nodes;
    const label = layout.edges[0]!.label!;
    expect(label.x).toBeGreaterThan(a!.x + a!.width);
    expect(label.x).toBeLessThan(b!.x);
    expect(label.width).toBeGreaterThan(0);
    expect(layout.edges[1]!.label).toBeUndefined();
  });

  it("lays out an empty graph and a single node", () => {
    const empty = layoutFlowCanvas([], []);
    expect(empty).toMatchObject({ nodes: [], edges: [], layers: 0 });
    expect(empty.width).toBeGreaterThanOrEqual(0);
    const single = layoutFlowCanvas([{ id: "only", label: "Only", kind: "step" }], []);
    expect(single.nodes).toHaveLength(1);
    expect(single.edges).toEqual([]);
    expect(single.width).toBeGreaterThan(single.nodes[0]!.x + single.nodes[0]!.width);
    expect(single.height).toBeGreaterThan(single.nodes[0]!.y + single.nodes[0]!.height);
  });

  it("keeps a large graph deterministic, finite and free of node overlap", () => {
    const count = 200;
    const nodes = Array.from({ length: count }, (_, i) => node("n" + i));
    const edges: FlowCanvasEdge[] = [];
    for (let i = 1; i < count; i++) {
      edges.push({ from: "n" + Math.floor((i - 1) / 3), to: "n" + i });
      if (i % 7 === 0) edges.push({ from: "n" + (i - 5), to: "n" + i });
    }
    edges.push({ from: "n150", to: "n2" });
    const started = performance.now();
    const layout = layoutFlowCanvas(nodes, edges);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(layoutFlowCanvas(nodes, edges)).toEqual(layout);
    expect(layout.nodes).toHaveLength(count);
    expect(layout.edges).toHaveLength(edges.length);
    for (const edge of layout.edges) for (const value of [...edge.points.flat(), ...edge.tip]) expect(Number.isFinite(value)).toBe(true);
    const layers = new Map<number, typeof layout.nodes>();
    for (const item of layout.nodes) layers.set(item.layer, [...(layers.get(item.layer) ?? []), item]);
    for (const members of layers.values()) {
      const sorted = [...members].sort((p, q) => p.y - q.y);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.height);
    }
    for (const item of layout.nodes) {
      expect(item.x).toBeGreaterThanOrEqual(0); expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x + item.width).toBeLessThanOrEqual(layout.width); expect(item.y + item.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it.each([
    ["non-array nodes", null, []],
    ["non-array edges", [node("a")], null],
    ["missing id", [{ label: "A" }], []],
    ["blank label", [{ id: "a", label: " " }], []],
    ["duplicate id", [node("a"), node("a")], []],
    ["blank kind", [{ id: "a", label: "A", kind: "" }], []],
    ["unknown status tone", [{ id: "a", label: "A", status: { tone: "loud", label: "Loud" } }], []],
    ["blank status label", [{ id: "a", label: "A", status: { tone: "info", label: "" } }], []],
    ["unknown endpoint", [node("a")], [{ from: "a", to: "zz" }]],
    ["self edge", [node("a")], [{ from: "a", to: "a" }]],
    ["blank edge label", [node("a"), node("b")], [{ from: "a", to: "b", label: "" }]],
  ])("refuses %s with a named error", (_name, nodes, edges) => {
    expect(() => layoutFlowCanvas(nodes as never, edges as never)).toThrow(/^FlowCanvas: /);
  });

  it("refuses an unknown orientation and more nodes than the documented limit", () => {
    expect(() => layoutFlowCanvas([], [], { orientation: "diagonal" as never })).toThrow(/^FlowCanvas: /);
    const many = Array.from({ length: FLOW_CANVAS_NODE_LIMIT + 1 }, (_, i) => node("n" + i));
    expect(() => layoutFlowCanvas(many, [])).toThrow(/^FlowCanvas: /);
    expect(layoutFlowCanvas(many.slice(1), []).nodes).toHaveLength(FLOW_CANVAS_NODE_LIMIT);
  });
});
