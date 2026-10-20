/** Serializable graph records. Node and edge identities each have their own namespace. */
export interface GraphNode { readonly id: string; readonly kind: string; readonly label: string }
export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly weight?: number;
}
export interface GraphInput { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] }
export interface GraphModelEdge extends GraphEdge { readonly selfLoop: boolean }
export interface GraphModel { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphModelEdge[] }
export type GraphErrorCode = "INVALID_INPUT" | "NODE_CAP" | "EDGE_CAP" | "DUPLICATE_NODE" | "DUPLICATE_EDGE" | "UNKNOWN_ENDPOINT" | "UNKNOWN_NODE" | "INVALID_OPTIONS";
export class GraphValidationError extends Error {
  readonly code: GraphErrorCode;
  constructor(code: GraphErrorCode, message: string) {
    super(message);
    this.name = "GraphValidationError";
    this.code = code;
  }
}
export interface GraphNeighborOptions { readonly direction?: "in" | "out" | "both"; readonly edgeKinds?: readonly string[] }
export interface GraphSubgraphOptions { readonly depth: number; readonly edgeKinds?: readonly string[]; readonly nodeKinds?: readonly string[] }
export interface GraphDegree { readonly id: string; readonly in: number; readonly out: number; readonly total: number }
export interface GraphKindGroup { readonly kind: string; readonly nodes: readonly GraphNode[] }
export interface GraphPosition { readonly id: string; readonly x: number; readonly y: number }
export interface GraphRadialOptions { readonly ringGap?: number }
export interface GraphForceOptions { readonly iterations?: number; readonly seed?: number }
export interface GraphEdgeRoutingHint {
  readonly id: string;
  readonly type: "straight";
  readonly selfLoop: boolean;
  readonly parallelIndex: number;
  readonly parallelCount: number;
}

function fail(code: GraphErrorCode, message: string): never { throw new GraphValidationError(code, message); }
function identity(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

/** Validate and copy known fields; never attach flags to caller-owned records. */
export function validateGraph(input: GraphInput): GraphModel {
  if (!input || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) fail("INVALID_INPUT", "Graph nodes and edges must be arrays");
  if (input.nodes.length > 500) fail("NODE_CAP", "Graph supports at most 500 nodes");
  if (input.edges.length > 2000) fail("EDGE_CAP", "Graph supports at most 2000 edges");
  const nodeIds = new Set<string>();
  const nodes = Array.from(input.nodes, node => {
    if (!node || !identity(node.id) || !identity(node.kind) || typeof node.label !== "string") fail("INVALID_INPUT", "Node needs an id, kind and string label");
    if (nodeIds.has(node.id)) fail("DUPLICATE_NODE", `Duplicate node: ${node.id}`);
    nodeIds.add(node.id);
    return { id: node.id, kind: node.kind, label: node.label };
  });
  const edgeIds = new Set<string>();
  const edges = Array.from(input.edges, edge => {
    if (!edge || !identity(edge.id) || !identity(edge.from) || !identity(edge.to) || !identity(edge.kind) ||
        (edge.weight !== undefined && (typeof edge.weight !== "number" || !Number.isFinite(edge.weight) || edge.weight <= 0))) {
      fail("INVALID_INPUT", "Edge needs an id, endpoints, kind and optional finite positive weight");
    }
    if (edgeIds.has(edge.id)) fail("DUPLICATE_EDGE", `Duplicate edge: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail("UNKNOWN_ENDPOINT", `Unknown endpoint on edge: ${edge.id}`);
    return { id: edge.id, from: edge.from, to: edge.to, kind: edge.kind,
      ...(edge.weight === undefined ? {} : { weight: edge.weight }), selfLoop: edge.from === edge.to };
  });
  return { nodes, edges };
}

function requireNode(graph: GraphModel, id: string): void {
  if (!graph.nodes.some(node => node.id === id)) fail("UNKNOWN_NODE", `Unknown node: ${id}`);
}
function checkOptions(options: unknown): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) fail("INVALID_OPTIONS", "Options must be an object");
}
function checkKinds(kinds: readonly string[] | undefined): void {
  if (kinds !== undefined && (!Array.isArray(kinds) || !kinds.every(identity))) fail("INVALID_OPTIONS", "Kind filters must be arrays of nonempty strings");
}
function adjacent(graph: GraphModel, id: string, direction: "in" | "out" | "both", kinds?: readonly string[]): GraphNode[] {
  const found = new Set<string>();
  for (const edge of graph.edges) {
    if (kinds !== undefined && !kinds.includes(edge.kind)) continue;
    if (direction !== "in" && edge.from === id) found.add(edge.to);
    if (direction !== "out" && edge.to === id) found.add(edge.from);
  }
  return graph.nodes.filter(node => found.has(node.id));
}

/** Unique adjacent nodes in authored node order. A loop contributes its own node. */
export function neighbors(input: GraphInput, id: string, options: GraphNeighborOptions = {}): GraphNode[] {
  const graph = validateGraph(input);
  requireNode(graph, id);
  checkOptions(options);
  const direction = options.direction ?? "both";
  if (!["in", "out", "both"].includes(direction)) fail("INVALID_OPTIONS", "Direction must be in, out or both");
  checkKinds(options.edgeKinds);
  return adjacent(graph, id, direction, options.edgeKinds);
}

/** Undirected BFS. Node-kind filters prune traversal; the focus is retained. */
export function subgraph(input: GraphInput, focusId: string, options: GraphSubgraphOptions): GraphModel {
  const graph = validateGraph(input);
  requireNode(graph, focusId);
  if (!options || !Number.isInteger(options.depth) || options.depth < 0) fail("INVALID_OPTIONS", "Depth must be a nonnegative integer");
  checkKinds(options.edgeKinds); checkKinds(options.nodeKinds);
  const seen = new Set([focusId]);
  const queue = [{ id: focusId, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    if (current.depth >= options.depth) continue;
    for (const node of adjacent(graph, current.id, "both", options.edgeKinds)) {
      if (seen.has(node.id) || (options.nodeKinds !== undefined && !options.nodeKinds.includes(node.kind))) continue;
      seen.add(node.id);
      queue.push({ id: node.id, depth: current.depth + 1 });
    }
  }
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  return {
    nodes: queue.map(entry => byId.get(entry.id)!),
    edges: graph.edges.filter(edge => seen.has(edge.from) && seen.has(edge.to) && (options.edgeKinds === undefined || options.edgeKinds.includes(edge.kind))),
  };
}

/** Incidence counts: a self-loop adds one incoming and one outgoing edge. */
export function degrees(input: GraphInput): GraphDegree[] {
  const graph = validateGraph(input);
  const result = graph.nodes.map(node => ({ id: node.id, in: 0, out: 0, total: 0 }));
  const byId = new Map(result.map(value => [value.id, value]));
  for (const edge of graph.edges) {
    const from = byId.get(edge.from)!; const to = byId.get(edge.to)!;
    from.out++; from.total++; to.in++; to.total++;
  }
  return result;
}

function weakComponents(graph: GraphModel): GraphNode[][] {
  const seen = new Set<string>();
  const result: GraphNode[][] = [];
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;
    const members = new Set([node.id]);
    const queue = [node.id];
    seen.add(node.id);
    for (let index = 0; index < queue.length; index++) {
      for (const neighbor of adjacent(graph, queue[index]!, "both")) {
        if (seen.has(neighbor.id)) continue;
        seen.add(neighbor.id); members.add(neighbor.id); queue.push(neighbor.id);
      }
    }
    result.push(graph.nodes.filter(member => members.has(member.id)));
  }
  return result;
}

/** Weak components ordered by their first authored node; members retain authored order. */
export function components(input: GraphInput): GraphNode[][] { return weakComponents(validateGraph(input)); }

/** Unweighted undirected BFS, resolving equal-length paths in authored node order. */
export function shortestPath(input: GraphInput, from: string, to: string): GraphNode[] | null {
  const graph = validateGraph(input);
  requireNode(graph, from); requireNode(graph, to);
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    if (current === to) break;
    for (const node of adjacent(graph, current, "both")) {
      if (previous.has(node.id)) continue;
      previous.set(node.id, current); queue.push(node.id);
    }
  }
  if (!previous.has(to)) return null;
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const path: GraphNode[] = [];
  for (let current: string | null = to; current !== null; current = previous.get(current)!) path.push(byId.get(current)!);
  return path.reverse();
}

export function groupByKind(input: GraphInput): GraphKindGroup[] {
  const graph = validateGraph(input);
  const groups = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const group = groups.get(node.kind);
    if (group) group.push(node); else groups.set(node.kind, [node]);
  }
  return Array.from(groups, ([kind, nodes]) => ({ kind, nodes }));
}

/** Straight routing hints group both directions of each endpoint pair, including loops. */
export function edgeRoutingHints(input: GraphInput): GraphEdgeRoutingHint[] {
  const graph = validateGraph(input);
  const pair = (edge: GraphEdge) => JSON.stringify(edge.from <= edge.to ? [edge.from, edge.to] : [edge.to, edge.from]);
  const counts = new Map<string, number>();
  for (const edge of graph.edges) { const key = pair(edge); counts.set(key, (counts.get(key) ?? 0) + 1); }
  const indices = new Map<string, number>();
  return graph.edges.map(edge => {
    const key = pair(edge); const parallelIndex = indices.get(key) ?? 0;
    indices.set(key, parallelIndex + 1);
    return { id: edge.id, type: "straight", selfLoop: edge.selfLoop, parallelIndex, parallelCount: counts.get(key)! };
  });
}

export function radialLayout(input: GraphInput, focusId: string, options: GraphRadialOptions = {}): GraphPosition[] {
  const graph = validateGraph(input);
  requireNode(graph, focusId);
  checkOptions(options);
  const ringGap = options.ringGap ?? 100;
  if (!Number.isFinite(ringGap) || ringGap <= 0 || ringGap > 1_000_000) fail("INVALID_OPTIONS", "Ring gap must be positive and at most 1000000");
  const depths = new Map([[focusId, 0]]);
  const queue = [focusId];
  let maximum = 0;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    for (const node of adjacent(graph, current, "both")) {
      if (depths.has(node.id)) continue;
      maximum = depths.get(current)! + 1;
      depths.set(node.id, maximum); queue.push(node.id);
    }
  }
  const rings = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const depth = depths.get(node.id) ?? maximum + 1;
    const ring = rings.get(depth);
    if (ring) ring.push(node); else rings.set(depth, [node]);
  }
  const positions = new Map<string, GraphPosition>();
  for (const [depth, nodes] of rings) nodes.forEach((node, index) => {
    const angle = index * 2 * Math.PI / nodes.length;
    const x = Math.round(Math.cos(angle) * depth * ringGap) || 0;
    const y = Math.round(Math.sin(angle) * depth * ringGap) || 0;
    positions.set(node.id, { id: node.id, x, y });
  });
  return graph.nodes.map(node => positions.get(node.id)!);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed-step Fruchterman–Reingold, integer separation, then horizontal component packing. */
export function forceLayout(input: GraphInput, options: GraphForceOptions = {}): GraphPosition[] {
  const graph = validateGraph(input);
  checkOptions(options);
  const iterations = options.iterations ?? 300; const seed = options.seed ?? 1;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10000 ||
      !Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) fail("INVALID_OPTIONS", "Iterations must be 1..10000 and seed an unsigned 32-bit integer");
  const random = mulberry32(seed);
  const positions = new Map<string, GraphPosition>();
  let offset = 0;
  for (const members of weakComponents(graph)) {
    const indices = new Map(members.map((node, index) => [node.id, index]));
    const edges = graph.edges.filter(edge => !edge.selfLoop && indices.has(edge.from) && indices.has(edge.to));
    const size = Math.sqrt(members.length) * 80;
    const points = members.map(node => ({ id: node.id, x: (random() - 0.5) * size, y: (random() - 0.5) * size }));
    const displacementX = new Float64Array(points.length); const displacementY = new Float64Array(points.length);
    for (let step = 0; step < iterations; step++) {
      displacementX.fill(0); displacementY.fill(0);
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const first = points[i]!; const second = points[j]!;
        const dx = first.x - second.x; const dy = first.y - second.y;
        const squared = Math.max(dx * dx + dy * dy, 0.0001);
        const scale = 6400 / squared;
        displacementX[i]! += dx * scale; displacementY[i]! += dy * scale;
        displacementX[j]! -= dx * scale; displacementY[j]! -= dy * scale;
      }
      for (const edge of edges) {
        const i = indices.get(edge.from)!; const j = indices.get(edge.to)!;
        const dx = points[i]!.x - points[j]!.x; const dy = points[i]!.y - points[j]!.y;
        const scale = Math.sqrt(dx * dx + dy * dy) / 80;
        displacementX[i]! -= dx * scale; displacementY[i]! -= dy * scale;
        displacementX[j]! += dx * scale; displacementY[j]! += dy * scale;
      }
      // Linear cooling depends only on the configured step count, never elapsed time.
      const temperature = (size / 10) * (1 - step / iterations);
      points.forEach((point, i) => {
        const dx = displacementX[i]!; const dy = displacementY[i]!;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) { const scale = Math.min(length, temperature) / length; point.x += dx * scale; point.y += dy * scale; }
      });
    }
    const rounded: { id: string; x: number; y: number }[] = [];
    for (const point of points) {
      const placed = { id: point.id, x: Math.round(point.x), y: Math.round(point.y) };
      // Each collision advances past a previous point's rightmost exclusion boundary.
      // x strictly increases; at most one boundary per previous node can be crossed.
      let collision = rounded.find(other => Math.hypot(placed.x - other.x, placed.y - other.y) < 24);
      while (collision) {
        placed.x = collision.x + 24;
        collision = rounded.find(other => Math.hypot(placed.x - other.x, placed.y - other.y) < 24);
      }
      rounded.push(placed);
    }
    const minX = Math.min(...rounded.map(point => point.x)); const minY = Math.min(...rounded.map(point => point.y));
    const maxX = Math.max(...rounded.map(point => point.x));
    for (const point of rounded) positions.set(point.id, { id: point.id, x: point.x - minX + offset, y: point.y - minY });
    offset += maxX - minX + 80;
  }
  return graph.nodes.map(node => positions.get(node.id)!);
}
