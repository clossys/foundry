/**
 * Deterministic layered layout for the pipeline canvas, computed by the graph generator so the
 * canvas only reads positions (no elkjs or dagre, no layout at render time).
 *
 *   lane  the step's actor: owner, planner, agent:* (by name), then code
 *   rank  longest-path topological rank over the derived edges; cycles are broken in step id
 *         order (a depth-first walk from the sources, then every step, successors by id, drops
 *         each edge back into the walk) and every edge it skips is listed in `cycleBreaks`
 *   order inside each lane/rank cell: id order, then `BARYCENTER_SWEEPS` alternating barycenter
 *         sweeps (left to right over predecessors, right to left over successors; ties by id); the
 *         order with the fewest edge crossings seen is kept, and both counts are in `crossings`
 *   x, y  from fixed constants: a cell stacks at most `cellRows` steps; more wrap into sub-columns
 *         inside the rank band, so a band is as wide as its widest cell. x by band plus sub-column,
 *         y by lane top plus the step's row; ranks run left to right and lanes are swim rows, each
 *         lane's label sits once at the row's start (x = -laneLabelWidth)
 *   crossings  pairs of edges whose straight segments (source right middle to target left middle)
 *         cross, counted with id order (`before`) and with the kept order (`after`)
 *
 * The constants are sized for the canvas's compact step node (title, kind, one labeled handle per
 * side), so no two node boxes intersect: rowGap > nodeHeight, columnGap > nodeWidth and
 * rankGap > nodeWidth.
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
  /** Most steps one lane/rank cell stacks before wrapping into another sub-column. */
  cellRows: 3,
  /** Horizontal distance between two sub-columns of one cell. */
  columnGap: 280,
});

/** Fixed number of barycenter sweeps; the layout never iterates to convergence. */
export const BARYCENTER_SWEEPS = 4;

export interface NodeLayout { readonly lane: string; readonly rank: number; readonly x: number; readonly y: number }
export interface LaneLayout { readonly id: string; readonly index: number; readonly x: number; readonly y: number; readonly height: number }
export interface CycleBreak { readonly from: string; readonly to: string }
export interface Crossings { readonly before: number; readonly after: number }
export interface PipelineLayout {
  readonly constants: typeof LAYOUT_CONSTANTS;
  readonly crossings: Crossings;
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
  const C = LAYOUT_CONSTANTS;
  const ranks = [...new Set(ids.map(id => rank.get(id)!))].sort((a, b) => a - b);
  // Cells in lane then rank order; each holds its steps in id order to start.
  const cellOf = (lane: string, r: number): string => `${lane}\0${r}`;
  const cells = new Map<string, string[]>();
  for (const lane of lanes) for (const r of ranks) cells.set(cellOf(lane, r), []);
  for (const id of ids) cells.get(cellOf(actorOf.get(id)!, rank.get(id)!))!.push(id);
  for (const [key, members] of [...cells]) if (!members.length) cells.delete(key);

  const laneRows = (lane: string): number => Math.max(1, ...[...cells].filter(([key]) => key.startsWith(`${lane}\0`)).map(([, members]) => Math.min(members.length, C.cellRows)));
  const bandColumns = (r: number): number => Math.max(1, ...[...cells].filter(([key]) => Number(key.slice(key.indexOf("\0") + 1)) === r).map(([, members]) => Math.ceil(members.length / C.cellRows)));
  const laneTops = new Map<string, number>();
  const laneLayouts: LaneLayout[] = [];
  let top = 0;
  lanes.forEach((lane, index) => {
    const height = (laneRows(lane) - 1) * C.rowGap + C.nodeHeight;
    laneTops.set(lane, top);
    laneLayouts.push({ id: lane, index, x: -C.laneLabelWidth, y: top, height });
    top += height + C.laneGap;
  });
  const bandX = new Map<number, number>();
  let left = 0;
  for (const r of ranks) { bandX.set(r, left); left += (bandColumns(r) - 1) * C.columnGap + C.rankGap; }

  const place = (order: ReadonlyMap<string, readonly string[]>): Record<string, NodeLayout> => {
    const nodes: Record<string, NodeLayout> = {};
    for (const [key, members] of order) {
      const lane = key.slice(0, key.indexOf("\0"));
      const cellRank = Number(key.slice(lane.length + 1));
      members.forEach((id, at) => {
        nodes[id] = { lane, rank: cellRank, x: bandX.get(cellRank)! + Math.floor(at / C.cellRows) * C.columnGap, y: laneTops.get(lane)! + (at % C.cellRows) * C.rowGap };
      });
    }
    return nodes;
  };
  const crossingCount = (nodes: Readonly<Record<string, NodeLayout>>): number => {
    const segs = pairs.map(({ from, to }) => ({ from, to, a: [nodes[from]!.x + C.nodeWidth, nodes[from]!.y + C.nodeHeight / 2], b: [nodes[to]!.x, nodes[to]!.y + C.nodeHeight / 2] }));
    const side = (p: number[], q: number[], r: number[]): number => Math.sign((q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!));
    let count = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!, t = segs[j]!;
      if (s.from === t.from || s.from === t.to || s.to === t.from || s.to === t.to) continue;
      const d1 = side(s.a, s.b, t.a), d2 = side(s.a, s.b, t.b), d3 = side(t.a, t.b, s.a), d4 = side(t.a, t.b, s.b);
      if (d1 * d2 < 0 && d3 * d4 < 0) count++;
    }
    return count;
  };

  // Barycenter sweeps: a step's weight is the mean vertical place (lane top + row) of its neighbours
  // on the sweep's side; a step with none keeps its place. Sorting is by weight, then id.
  const order = new Map([...cells].map(([key, members]) => [key, [...members]]));
  const vertical = (nodes: Readonly<Record<string, NodeLayout>>, id: string): number => nodes[id]!.y;
  const before = crossingCount(place(order));
  let best = { count: before, order: new Map([...order].map(([key, members]) => [key, [...members]])) };
  for (let sweep = 0; sweep < BARYCENTER_SWEEPS; sweep++) {
    const forward = sweep % 2 === 0;
    const neighbours = forward ? preds : succ;
    for (const r of forward ? ranks : [...ranks].reverse()) {
      const nodes = place(order);
      for (const [key, members] of order) {
        if (Number(key.slice(key.indexOf("\0") + 1)) !== r || members.length < 2) continue;
        const weight = new Map(members.map(id => {
          const near = neighbours.get(id)!;
          return [id, near.length ? near.reduce((sum, other) => sum + vertical(nodes, other), 0) / near.length : vertical(nodes, id)];
        }));
        members.sort((a, b) => weight.get(a)! - weight.get(b)! || byId(a, b));
      }
    }
    const count = crossingCount(place(order));
    if (count < best.count) best = { count, order: new Map([...order].map(([key, members]) => [key, [...members]])) };
  }
  const nodes = place(best.order);
  const ordered: Record<string, NodeLayout> = {};
  for (const id of ids) ordered[id] = nodes[id]!;
  return { constants: C, crossings: { before, after: best.count }, lanes: laneLayouts, cycleBreaks, nodes: ordered };
}
