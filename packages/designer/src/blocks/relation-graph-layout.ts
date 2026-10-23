import type { RelationGraphEdge, RelationGraphNode } from "./relation-graph-types.js";
export const RELATION_GRAPH_NODE_CAP = 64;
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
export function layoutRelationGraph(nodes: readonly RelationGraphNode[], edges: readonly RelationGraphEdge[], kinds: readonly string[]) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new TypeError("RelationGraph: nodes and edges must be arrays.");
  if (nodes.length > RELATION_GRAPH_NODE_CAP) throw new RangeError("RelationGraph: node cap is 64.");
  if (!Array.isArray(kinds) || !kinds.length || [...kinds].some(kind => !text(kind)) || new Set(kinds).size !== kinds.length) throw new TypeError("RelationGraph: kinds must be a nonempty closed vocabulary.");
  const byId = new Map<string, RelationGraphNode>();
  const incoming = new Map<string, RelationGraphEdge[]>(), outgoing = new Map<string, RelationGraphEdge[]>();
  for (const node of nodes) {
    if (!node || !text(node.id) || !text(node.label) || !kinds.includes(node.kind)) throw new TypeError("RelationGraph: nodes require id, label and an allowed kind.");
    if (byId.has(node.id)) throw new TypeError("RelationGraph: duplicate node ids.");
    for (const value of [node.description, node.status]) if (value !== undefined && !text(value)) throw new TypeError("RelationGraph: description and status must be authored text.");
    byId.set(node.id, node); incoming.set(node.id, []); outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    if (!edge || !byId.has(edge.from) || !byId.has(edge.to)) throw new TypeError("RelationGraph: edge endpoints must refer to nodes.");
    if (edge.from === edge.to) throw new TypeError("RelationGraph: self-edges are refused.");
    if (edge.label !== undefined && !text(edge.label)) throw new TypeError("RelationGraph: edge labels must be authored text.");
    outgoing.get(edge.from)!.push(edge); incoming.get(edge.to)!.push(edge);
  }
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const pending = new Map(nodes.map(node => [node.id, incoming.get(node.id)!.length]));
  const ranks = new Map(nodes.map(node => [node.id, 0]));
  const queue = nodes.filter(node => pending.get(node.id) === 0).map(node => node.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!; visited++;
    for (const edge of outgoing.get(id)!) {
      ranks.set(edge.to, Math.max(ranks.get(edge.to)!, ranks.get(id)! + 1));
      pending.set(edge.to, pending.get(edge.to)! - 1);
      if (pending.get(edge.to) === 0) { queue.push(edge.to); queue.sort((a, b) => index.get(a)! - index.get(b)!); }
    }
  }
  const cyclic = visited !== nodes.length;
  const order = cyclic ? [...nodes] : [...nodes].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)! || index.get(a.id)! - index.get(b.id)!);
  const positions = new Map<string, { layer: number; row: number }>(), rows = new Map<number, number>();
  if (!cyclic) for (const node of order) {
    const layer = ranks.get(node.id)!, row = rows.get(layer) ?? 0;
    positions.set(node.id, { layer, row }); rows.set(layer, row + 1);
  }
  return { order, positions, layers: rows.size, cyclic, incoming, outgoing };
}
export function relationGraphHref(value: unknown): value is string {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\u0000-\u001f\u007f\\]/.test(value) || value.startsWith("//")) return false;
  const scheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (scheme && !/^https:\/\//i.test(value)) return false;
  try {
    const base = new URL("https://relation.invalid/"), url = new URL(value, base);
    return !url.username && !url.password && url.protocol === "https:" && (scheme || url.origin === base.origin);
  } catch { return false; }
}
