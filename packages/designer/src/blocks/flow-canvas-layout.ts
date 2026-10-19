import type { StatusMarkTone } from "../atoms/StatusMark.js";

/** Which way layers run: left to right (`"horizontal"`) or top to bottom (`"vertical"`). */
export type FlowCanvasOrientation = "horizontal" | "vertical";

/** The orientations `FlowCanvas` accepts, in documentation order. */
export const FLOW_CANVAS_ORIENTATIONS: readonly FlowCanvasOrientation[] = ["horizontal", "vertical"];

/** The largest node count `layoutFlowCanvas` lays out. Larger graphs throw a `RangeError`. */
export const FLOW_CANVAS_NODE_LIMIT = 256;

/** The largest edge count `layoutFlowCanvas` lays out. Larger graphs throw a `RangeError`. */
export const FLOW_CANVAS_EDGE_LIMIT = 1024;

/** One box in the diagram. Every string is host copy; the canvas adds none of its own. */
export interface FlowCanvasNode {
  /** Unique, stable id. Edges, `selectedId` and `onSelect` use it. */
  id: string;
  /** The node's accessible name and visible title. */
  label: string;
  /** Optional short category shown above the label and read as part of the description ("Step", "Gate"). */
  kind?: string;
  /** Optional state shown with a `StatusMark`. The label carries the meaning; the tone only repeats it. */
  status?: { tone: StatusMarkTone; label: string };
}

/** One directed connection from `from` to `to`. Cycles are drawn; self edges are refused. */
export interface FlowCanvasEdge {
  from: string;
  to: string;
  /** Optional words drawn beside the edge and read in the source node's description. */
  label?: string;
}

/** A laid-out node in diagram units (one unit is `--spacing-xs`). */
export interface FlowCanvasLayoutNode {
  id: string;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A laid-out edge in diagram units, in authored direction. */
export interface FlowCanvasLayoutEdge {
  from: string;
  to: string;
  /** True when the edge closes a cycle and runs against the layer direction. */
  reversed: boolean;
  /** The route from the source's port to the arrow tip, through any bends. */
  points: readonly (readonly [number, number])[];
  /** Where the arrowhead's point touches the target. */
  tip: readonly [number, number];
  /** SVG path data for the line, ending at the arrowhead's base. */
  path: string;
  /** SVG path data for the closed arrowhead triangle. */
  arrow: string;
  /** The box the edge label sits in, present only when the edge has a label. */
  label?: { x: number; y: number; width: number; height: number };
}

/** The deterministic result of `layoutFlowCanvas`. Equal inputs give equal output. */
export interface FlowCanvasLayout {
  orientation: FlowCanvasOrientation;
  width: number;
  height: number;
  /** How many layers the graph needed. */
  layers: number;
  /** Nodes in reading order: layer by layer, then along each layer. */
  nodes: readonly FlowCanvasLayoutNode[];
  /** Edges in authored order. */
  edges: readonly FlowCanvasLayoutEdge[];
}

export interface FlowCanvasLayoutOptions {
  /** @default "horizontal" */
  orientation?: FlowCanvasOrientation;
}

const TONES: ReadonlySet<string> = new Set<StatusMarkTone>(["success", "warning", "danger", "info", "neutral"]);
const PAD = 4;
const ARROW_LENGTH = 2;
const ARROW_HALF = 1.25;
const LABEL_BLOCK = 5;
const DUMMY_SIZE = 2;
const DUMMY_GAP = 2;
const SWEEPS = 4;
/** Sizes along the layer direction (`main`) and across it (`cross`), in units. */
interface Geometry { main: number; cross: number; layerGap: number; rowGap: number; labelCross: number }
const ACROSS: Geometry = { main: 52, cross: 26, layerGap: 20, rowGap: 6, labelCross: LABEL_BLOCK };
const DOWN: Geometry = { main: 26, cross: 52, layerGap: 16, rowGap: 6, labelCross: 30 };

type Point = readonly [number, number];
interface Item { key: number; node: number; dummy: boolean; layer: number; size: number; weight: number }
interface Segment { edge: number; from: number; to: number }

const fail = (message: string): never => { throw new TypeError("FlowCanvas: " + message); };
const blank = (value: unknown) => typeof value !== "string" || value.trim() === "";
const round = (value: number) => Math.round(value * 100) / 100 + 0;

function validate(nodes: readonly FlowCanvasNode[], edges: readonly FlowCanvasEdge[], orientation: unknown) {
  if (!Array.isArray(nodes)) fail("nodes must be an array.");
  if (!Array.isArray(edges)) fail("edges must be an array.");
  if (orientation !== "horizontal" && orientation !== "vertical") fail("orientation must be \"horizontal\" or \"vertical\".");
  if (nodes.length > FLOW_CANVAS_NODE_LIMIT) throw new RangeError(`FlowCanvas: at most ${FLOW_CANVAS_NODE_LIMIT} nodes are laid out; received ${nodes.length}.`);
  if (edges.length > FLOW_CANVAS_EDGE_LIMIT) throw new RangeError(`FlowCanvas: at most ${FLOW_CANVAS_EDGE_LIMIT} edges are laid out; received ${edges.length}.`);
  const index = new Map<string, number>();
  nodes.forEach((node, i) => {
    if (node === null || typeof node !== "object") fail(`node ${i} must be an object.`);
    if (blank(node.id)) fail(`node ${i} needs a non-empty id.`);
    if (index.has(node.id)) fail(`node id "${node.id}" is used twice.`);
    if (blank(node.label)) fail(`node "${node.id}" needs a non-empty label.`);
    if (node.kind !== undefined && blank(node.kind)) fail(`node "${node.id}" has an empty kind.`);
    if (node.status !== undefined) {
      if (node.status === null || typeof node.status !== "object" || !TONES.has(node.status.tone)) fail(`node "${node.id}" has an unknown status tone.`);
      if (blank(node.status.label)) fail(`node "${node.id}" needs a non-empty status label.`);
    }
    index.set(node.id, i);
  });
  edges.forEach((edge, i) => {
    if (edge === null || typeof edge !== "object") fail(`edge ${i} must be an object.`);
    if (!index.has(edge.from) || !index.has(edge.to)) fail(`edge ${i} joins an unknown node.`);
    if (edge.from === edge.to) fail(`edge ${i} joins node "${edge.from}" to itself.`);
    if (edge.label !== undefined && blank(edge.label)) fail(`edge ${i} has an empty label.`);
  });
  return index;
}

/** Depth-first search in authored order; every edge that reaches a node whose search is still open is reversed. */
function backEdges(count: number, pairs: readonly (readonly [number, number])[]): boolean[] {
  const out: number[][] = Array.from({ length: count }, () => []);
  const indegree = new Array<number>(count).fill(0);
  pairs.forEach(([from, to], edge) => { out[from]!.push(edge); indegree[to]!++; });
  const state = new Array<number>(count).fill(0);
  const reversed = new Array<boolean>(pairs.length).fill(false);
  const roots = [...Array(count).keys()].sort((a, b) => Number(indegree[a]! > 0) - Number(indegree[b]! > 0) || a - b);
  for (const root of roots) {
    if (state[root]) continue;
    const stack: [number, number][] = [[root, 0]];
    state[root] = 1;
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const edge = out[frame[0]]![frame[1]++];
      if (edge === undefined) { state[frame[0]] = 2; stack.pop(); continue; }
      const next = pairs[edge]![1];
      if (state[next] === 1) reversed[edge] = true;
      else if (state[next] === 0) { state[next] = 1; stack.push([next, 0]); }
    }
  }
  return reversed;
}

/** Longest-path layering by Kahn's algorithm, taking ready nodes in authored order. */
function assignLayers(count: number, pairs: readonly (readonly [number, number])[]): number[] {
  const out: number[][] = Array.from({ length: count }, () => []);
  const indegree = new Array<number>(count).fill(0);
  for (const [from, to] of pairs) { out[from]!.push(to); indegree[to]!++; }
  const layer = new Array<number>(count).fill(0);
  const ready = [...Array(count).keys()].filter(node => indegree[node] === 0);
  for (let head = 0; head < ready.length; head++) {
    const node = ready[head]!;
    for (const next of out[node]!) {
      layer[next] = Math.max(layer[next]!, layer[node]! + 1);
      if (--indegree[next]! === 0) ready.push(next);
    }
  }
  return layer;
}

/** Inversions between two adjacent layers, counted by merge sort. */
function countCrossings(segments: readonly Segment[], position: readonly number[]): number {
  const ordered = [...segments].sort((a, b) => position[a.from]! - position[b.from]! || position[a.to]! - position[b.to]!).map(item => position[item.to]!);
  const sort = (values: number[]): [number[], number] => {
    if (values.length < 2) return [values, 0];
    const middle = values.length >> 1;
    const [left, a] = sort(values.slice(0, middle)), [right, b] = sort(values.slice(middle));
    const merged: number[] = [];
    let crossings = a + b, i = 0, j = 0;
    while (i < left.length && j < right.length) {
      if (left[i]! <= right[j]!) merged.push(left[i++]!);
      else { crossings += left.length - i; merged.push(right[j++]!); }
    }
    return [[...merged, ...left.slice(i), ...right.slice(j)], crossings];
  };
  return sort(ordered)[1];
}

/** Weighted isotonic regression (pool adjacent violators): the closest non-decreasing sequence. */
function isotonic(values: readonly number[], weights: readonly number[]): number[] {
  const blocks: { value: number; weight: number; size: number }[] = [];
  values.forEach((value, i) => {
    blocks.push({ value, weight: weights[i]!, size: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2]!.value > blocks[blocks.length - 1]!.value) {
      const last = blocks.pop()!, previous = blocks[blocks.length - 1]!;
      const weight = previous.weight + last.weight;
      previous.value = (previous.value * previous.weight + last.value * last.weight) / weight;
      previous.weight = weight;
      previous.size += last.size;
    }
  });
  return blocks.flatMap(block => new Array<number>(block.size).fill(block.value));
}

function curve(from: Point, to: Point, horizontal: boolean): string {
  const [fx, fy] = from, [tx, ty] = to;
  if (horizontal) { const mid = round((fx + tx) / 2); return `C${mid} ${fy} ${mid} ${ty} ${tx} ${ty}`; }
  const mid = round((fy + ty) / 2);
  return `C${fx} ${mid} ${tx} ${mid} ${tx} ${ty}`;
}

/**
 * Lays out a directed graph in layers without measuring the DOM, so the
 * server and the client draw the same picture. Cycles are broken by
 * reversing the edges a depth-first search in authored order finds closing
 * back on its path; those edges keep their authored direction in the
 * output (`reversed: true`). Layers come from the longest path, long edges
 * bend around the layers they cross, each layer is ordered by barycentre
 * sweeps that keep the fewest crossings found, and nodes are aligned with
 * their neighbours without overlapping. Throws a `TypeError` naming the
 * problem for invalid input and a `RangeError` past the documented limits.
 */
export function layoutFlowCanvas(nodes: readonly FlowCanvasNode[], edges: readonly FlowCanvasEdge[], options: FlowCanvasLayoutOptions = {}): FlowCanvasLayout {
  const orientation = options.orientation ?? "horizontal";
  const index = validate(nodes, edges, orientation);
  const horizontal = orientation === "horizontal";
  const geometry = horizontal ? ACROSS : DOWN;
  if (nodes.length === 0) return { orientation, width: 0, height: 0, layers: 0, nodes: [], edges: [] };

  const authored = edges.map(edge => [index.get(edge.from)!, index.get(edge.to)!] as const);
  const reversed = backEdges(nodes.length, authored);
  const pairs = authored.map(([from, to], i) => (reversed[i] ? [to, from] as const : [from, to] as const));
  const nodeLayer = assignLayers(nodes.length, pairs);
  const layerCount = Math.max(...nodeLayer) + 1;

  // Items are real nodes followed by bend points; each edge becomes a chain of segments between adjacent layers.
  const items: Item[] = nodes.map((_, node) => ({ key: node, node, dummy: false, layer: nodeLayer[node]!, size: geometry.cross, weight: 1 }));
  const chains: number[][] = pairs.map(([from, to], edge) => {
    const chain = [from];
    for (let layer = nodeLayer[from]! + 1; layer < nodeLayer[to]!; layer++) {
      chain.push(items.length);
      items.push({ key: nodes.length + edge, node: -1, dummy: true, layer, size: DUMMY_SIZE, weight: 2 });
    }
    chain.push(to);
    return chain;
  });
  const segments: Segment[][] = Array.from({ length: layerCount }, () => []);
  const preds: number[][] = items.map(() => []), succs: number[][] = items.map(() => []);
  chains.forEach((chain, edge) => chain.slice(1).forEach((to, i) => {
    const from = chain[i]!;
    segments[items[from]!.layer]!.push({ edge, from, to });
    succs[from]!.push(to);
    preds[to]!.push(from);
  }));

  // Order each layer: authored order first, then barycentre sweeps, keeping the strictly best order seen.
  let order: number[][] = Array.from({ length: layerCount }, () => []);
  items.forEach((item, i) => order[item.layer]!.push(i));
  const position = new Array<number>(items.length).fill(0);
  const place = (layers: number[][]) => layers.forEach(layer => layer.forEach((item, i) => { position[item] = i; }));
  const total = () => segments.reduce((sum, layer) => sum + countCrossings(layer, position), 0);
  place(order);
  let best = order.map(layer => [...layer]), fewest = total();
  const sweep = (layer: number, neighbours: number[][]) => {
    const keyed = order[layer]!.map(item => {
      const linked = neighbours[item]!;
      const key = linked.length ? linked.reduce((sum, other) => sum + position[other]!, 0) / linked.length : position[item]!;
      return { item, key };
    });
    keyed.sort((a, b) => a.key - b.key || position[a.item]! - position[b.item]!);
    order[layer] = keyed.map(entry => entry.item);
    order[layer]!.forEach((item, i) => { position[item] = i; });
  };
  for (let pass = 0; pass < SWEEPS && fewest > 0; pass++) {
    for (let layer = 1; layer < layerCount; layer++) sweep(layer, preds);
    for (let layer = layerCount - 2; layer >= 0; layer--) sweep(layer, succs);
    const crossings = total();
    if (crossings < fewest) { fewest = crossings; best = order.map(layer => [...layer]); }
  }
  order = best;
  place(order);

  // Cross-axis coordinates: align with neighbours, never closer than the gap between adjacent items.
  const centre = new Array<number>(items.length).fill(0);
  const offsets = order.map(layer => {
    const offset: number[] = [];
    layer.forEach((item, i) => {
      if (i === 0) { offset.push(0); return; }
      const previous = items[layer[i - 1]!]!, current = items[item]!;
      const gap = previous.dummy && current.dummy ? DUMMY_GAP : geometry.rowGap;
      offset.push(offset[i - 1]! + previous.size / 2 + gap + current.size / 2);
    });
    return offset;
  });
  order.forEach((layer, l) => {
    const offset = offsets[l]!, span = offset[offset.length - 1] ?? 0;
    layer.forEach((item, i) => { centre[item] = offset[i]! - span / 2; });
  });
  const align = (layer: number, neighbours: (item: number) => number[]) => {
    const members = order[layer]!, offset = offsets[layer]!;
    const desired = members.map((item, i) => {
      const linked = neighbours(item);
      const target = linked.length ? linked.reduce((sum, other) => sum + centre[other]!, 0) / linked.length : centre[item]!;
      return target - offset[i]!;
    });
    isotonic(desired, members.map(item => items[item]!.weight)).forEach((value, i) => { centre[members[i]!] = value + offset[i]!; });
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let layer = 1; layer < layerCount; layer++) align(layer, item => preds[item]!);
    for (let layer = layerCount - 2; layer >= 0; layer--) align(layer, item => succs[item]!);
  }
  for (let layer = 0; layer < layerCount; layer++) align(layer, item => [...preds[item]!, ...succs[item]!]);
  const start = items.map((item, i) => Math.round(centre[i]! - item.size / 2));
  const lowest = Math.min(...start), highest = Math.max(...items.map((item, i) => start[i]! + item.size));
  const crossStart = start.map(value => value - lowest + PAD);
  const crossExtent = highest - lowest + PAD * 2;
  const mainStart = (layer: number) => PAD + layer * (geometry.main + geometry.layerGap);
  const mainExtent = PAD * 2 + layerCount * geometry.main + (layerCount - 1) * geometry.layerGap;
  const toPoint = (main: number, cross: number): Point => (horizontal ? [round(main), round(cross)] : [round(cross), round(main)]);

  // Ports: each segment leaving or entering a node gets its own slot, sorted by where the other end sits.
  const portOf = new Map<string, number>();
  const assignPorts = (item: number, ends: number[], side: "out" | "in") => {
    const links = ends.map((other, i) => ({ other, i })).sort((a, b) => crossStart[a.other]! - crossStart[b.other]! || a.i - b.i);
    links.forEach((link, slot) => portOf.set(`${side}:${item}:${link.i}`, crossStart[item]! + (items[item]!.size * (slot + 1)) / (links.length + 1)));
  };
  // Per-node link lists in authored edge order, so each slot key names its edge.
  const outgoing: number[][] = nodes.map(() => []), incoming: number[][] = nodes.map(() => []);
  const outEdges: number[][] = nodes.map(() => []), inEdges: number[][] = nodes.map(() => []);
  chains.forEach((chain, edge) => {
    outgoing[chain[0]!]!.push(chain[1]!); outEdges[chain[0]!]!.push(edge);
    incoming[chain[chain.length - 1]!]!.push(chain[chain.length - 2]!); inEdges[chain[chain.length - 1]!]!.push(edge);
  });
  nodes.forEach((_, node) => { assignPorts(node, outgoing[node]!, "out"); assignPorts(node, incoming[node]!, "in"); });
  const portFor = (side: "out" | "in", node: number, edge: number) => portOf.get(`${side}:${node}:${(side === "out" ? outEdges : inEdges)[node]!.indexOf(edge)}`)!;

  const laidEdges: FlowCanvasLayoutEdge[] = chains.map((chain, edge) => {
    const from = chain[0]!, to = chain[chain.length - 1]!;
    const route: Point[] = [toPoint(mainStart(nodeLayer[from]!) + geometry.main, portFor("out", from, edge))];
    for (const dummy of chain.slice(1, -1)) {
      const cross = crossStart[dummy]! + DUMMY_SIZE / 2, layer = items[dummy]!.layer;
      route.push(toPoint(mainStart(layer), cross), toPoint(mainStart(layer) + geometry.main, cross));
    }
    route.push(toPoint(mainStart(nodeLayer[to]!), portFor("in", to, edge)));
    if (reversed[edge]) route.reverse();
    const mainOf = (point: Point) => (horizontal ? point[0] : point[1]);
    const crossOf = (point: Point) => (horizontal ? point[1] : point[0]);
    const tip = route[route.length - 1]!, before = route[route.length - 2]!;
    const direction = Math.sign(mainOf(tip) - mainOf(before));
    const base = toPoint(mainOf(tip) - direction * ARROW_LENGTH, crossOf(tip));
    const wing = (side: number) => toPoint(mainOf(base), crossOf(tip) + side * ARROW_HALF);
    const commands = [`M${route[0]![0]} ${route[0]![1]}`];
    for (let i = 1; i < route.length; i++) {
      const target = i === route.length - 1 ? base : route[i]!;
      commands.push(i % 2 === 1 ? curve(route[i - 1]!, target, horizontal) : `L${target[0]} ${target[1]}`);
    }
    const [left, right] = [wing(-1), wing(1)];
    const laid: FlowCanvasLayoutEdge = {
      from: edges[edge]!.from,
      to: edges[edge]!.to,
      reversed: reversed[edge]!,
      points: route,
      tip,
      path: commands.join(" "),
      arrow: `M${tip[0]} ${tip[1]} L${left[0]} ${left[1]} L${right[0]} ${right[1]} Z`,
    };
    if (edges[edge]!.label !== undefined) {
      const [p, q] = [route[0]!, route[1]!];
      const gapStart = Math.min(mainOf(p), mainOf(q)), gapEnd = Math.max(mainOf(p), mainOf(q));
      const crossMid = (crossOf(p) + crossOf(q)) / 2;
      const crossBox = Math.min(Math.max(crossMid - geometry.labelCross / 2, 0), crossExtent - geometry.labelCross);
      laid.label = horizontal
        ? { x: round(gapStart + 1), y: round(crossBox), width: round(gapEnd - gapStart - 2), height: LABEL_BLOCK }
        : { x: round(crossBox), y: round((gapStart + gapEnd - LABEL_BLOCK) / 2), width: geometry.labelCross, height: LABEL_BLOCK };
    }
    return laid;
  });

  const laidNodes: FlowCanvasLayoutNode[] = order.flatMap((layer, l) => layer.filter(item => !items[item]!.dummy).map(item => {
    const [x, y] = toPoint(mainStart(l), crossStart[item]!);
    return { id: nodes[item]!.id, layer: l, x, y, width: horizontal ? geometry.main : geometry.cross, height: horizontal ? geometry.cross : geometry.main };
  }));
  return {
    orientation,
    width: horizontal ? mainExtent : crossExtent,
    height: horizontal ? crossExtent : mainExtent,
    layers: layerCount,
    nodes: laidNodes,
    edges: laidEdges,
  };
}
