/**
 * Deterministic layered layout for the pipeline canvas, computed by the graph generator so the
 * canvas only reads positions (no elkjs or dagre, no layout at render time).
 *
 *   lane  the step's actor: owner, planner, agent:* (by name), then code
 *   rank  longest-path topological rank over the derived edges; cycles are broken in step id
 *         order (a depth-first walk from the sources, then every step, successors by id, drops
 *         each edge back into the walk) and every edge it skips is listed in `cycleBreaks`
 *   x, y  from fixed constants: x by rank, y by lane top plus the step's row in its lane/rank cell
 *         (steps sharing a cell stack by id); ranks run left to right and lanes are swim rows, each
 *         lane's label sits once at the row's start (x = -laneLabelWidth)
 *
 * The constants are sized for the canvas's compact step node (title, kind, one labeled handle per
 * side), so no two node boxes intersect: rowGap > nodeHeight and rankGap > nodeWidth.
 *
 * The same steps and edges always give byte-identical output: every iteration is over sorted ids.
 */
import type { Step } from "./define.js";

export const LAYOUT_CONSTANTS = Object.freeze({
  nodeWidth: 240,
  nodeHeight: 120,
  /** Horizontal distance between rank columns. */
  rankGap: 320,
  /** Vertical distance between stacked steps in one lane/rank cell. */
  rowGap: 144,
  /** Vertical space between two lanes. */
  laneGap: 48,
  /** Width of the lane label column left of rank 0. */
  laneLabelWidth: 160,
});

export interface NodeLayout { readonly lane: string; readonly rank: number; readonly x: number; readonly y: number }
export interface LaneLayout { readonly id: string; readonly index: number; readonly x: number; readonly y: number; readonly height: number }
export interface CycleBreak { readonly from: string; readonly to: string }
export interface PipelineLayout {
  readonly constants: typeof LAYOUT_CONSTANTS;
  readonly lanes: readonly LaneLayout[];
  readonly cycleBreaks: readonly CycleBreak[];
  readonly nodes: Readonly<Record<string, NodeLayout>>;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Lane order: owner, planner, agents by name, code; any other actor sorts after agents by name. */
export function laneOrder(actors: Iterable<string>): string[] {
  const weight = (actor: string): number => actor === "owner" ? 0 : actor === "planner" ? 1 : actor === "code" ? 3 : 2;
  return [...new Set(actors)].sort((a, b) => weight(a) - weight(b) || byId(a, b));
}

/**
 * Edges that close a cycle: a depth-first walk in step id order (sources first, then every other
 * step; successors by id) and every edge back to a step still on the walk's stack.
 */
function backEdges(ids: readonly string[], next: ReadonlyMap<string, readonly string[]>, sources: readonly string[]): Set<string> {
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const visit = (v: string): void => {
    state.set(v, 1);
    for (const w of next.get(v) ?? []) {
      if (state.get(w) === 1) back.add(`${v}\0${w}`);
      else if (!state.has(w)) visit(w);
    }
    state.set(v, 2);
  };
  for (const id of [...sources, ...ids]) if (!state.has(id)) visit(id);
  return back;
}

export function computeLayout(steps: readonly Pick<Step, "id" | "actor">[], edges: readonly { readonly from: string; readonly to: string }[]): PipelineLayout {
  const ids = steps.map(step => step.id).sort(byId);
  const known = new Set(ids);
  const pairs = [...new Map(edges.filter(edge => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to).map(edge => [`${edge.from}\0${edge.to}`, edge])).values()]
    .sort((a, b) => byId(a.from, b.from) || byId(a.to, b.to));
  const next = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const { from, to } of pairs) next.get(from)!.push(to);
  const hasIncoming = new Set(pairs.map(edge => edge.to));
  const back = backEdges(ids, next, ids.filter(id => !hasIncoming.has(id)));

  // Edges that close a cycle do not rank; they are reported, never dropped silently.
  const cycleBreaks: CycleBreak[] = [];
  const preds = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const { from, to } of pairs) {
    if (back.has(`${from}\0${to}`)) { cycleBreaks.push({ from, to }); continue; }
    preds.get(to)!.push(from);
  }

  // Longest path: Kahn's order with the ready set kept sorted by id.
  const indegree = new Map(ids.map(id => [id, preds.get(id)!.length]));
  const succ = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const id of ids) for (const from of preds.get(id)!) succ.get(from)!.push(id);
  const rank = new Map<string, number>(ids.map(id => [id, 0]));
  const ready = ids.filter(id => indegree.get(id) === 0);
  while (ready.length) {
    ready.sort(byId);
    const id = ready.shift()!;
    for (const to of succ.get(id)!) {
      rank.set(to, Math.max(rank.get(to)!, rank.get(id)! + 1));
      indegree.set(to, indegree.get(to)! - 1);
      if (indegree.get(to) === 0) ready.push(to);
    }
  }

  const actorOf = new Map(steps.map(step => [step.id, step.actor]));
  const lanes = laneOrder(steps.map(step => step.actor));
  const cells = new Map<string, string[]>();
  for (const id of ids) {
    const key = `${actorOf.get(id)}\0${rank.get(id)}`;
    cells.set(key, [...(cells.get(key) ?? []), id]);
  }
  const C = LAYOUT_CONSTANTS;
  const laneLayouts: LaneLayout[] = [];
  const nodes: Record<string, NodeLayout> = {};
  let top = 0;
  lanes.forEach((lane, index) => {
    const rows = Math.max(1, ...[...cells].filter(([key]) => key.startsWith(`${lane}\0`)).map(([, members]) => members.length));
    const height = (rows - 1) * C.rowGap + C.nodeHeight;
    laneLayouts.push({ id: lane, index, x: -C.laneLabelWidth, y: top, height });
    for (const [key, members] of [...cells].filter(([key]) => key.startsWith(`${lane}\0`))) {
      const cellRank = Number(key.slice(lane.length + 1));
      members.forEach((id, row) => { nodes[id] = { lane, rank: cellRank, x: cellRank * C.rankGap, y: top + row * C.rowGap }; });
    }
    top += height + C.laneGap;
  });
  const ordered: Record<string, NodeLayout> = {};
  for (const id of ids) ordered[id] = nodes[id]!;
  return { constants: C, lanes: laneLayouts, cycleBreaks, nodes: ordered };
}
