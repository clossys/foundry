/**
 * Deterministic swimlane layout for the pipeline canvas, computed by the graph generator so the
 * canvas only reads positions (no elkjs or dagre, no layout at render time).
 *
 *   lane  WHO: the step's seat holder (roster.ts), one swim row per lane in the order the caller
 *         gives (the roster, then `unassigned`); a lane holding no step keeps one empty row
 *   stage WHEN: the step's stage (define.ts STAGES), one column per stage in STAGES order; a step
 *         whose stage is not a declared stage sits in a trailing `unstaged` column (check:pipeline
 *         fails it as stage.missing)
 *   round the stages' rounds (define.ts ROUNDS) when the caller gives them: each round spans its
 *         stage columns, from its first stage's left edge to its last stage's right edge, and each
 *         stage records its round and its name inside the round
 *   rank  longest-path topological rank over the derived edges; cycles are broken in step id
 *         order (a depth-first walk from the sources, then every step, successors by id, drops
 *         each edge back into the walk) and every edge it skips is listed in `cycleBreaks`. Inside
 *         one stage column the ranks run left to right: each rank present in the stage gets its own
 *         block of sub-columns, in rank order, so a lower rank always starts further left
 *   order inside each lane/stage/rank cell: id order, then `BARYCENTER_SWEEPS` alternating
 *         barycenter sweeps (left to right over predecessors, right to left over successors; ties
 *         by id); the order with the fewest edge crossings seen is kept, and both counts are in
 *         `crossings`
 *   x, y  from fixed constants: a cell stacks at most `cellRows` steps; more wrap into sub-columns
 *         inside its rank block, so a block is as wide as its widest cell and a stage column as wide
 *         as its blocks together. x by stage column plus rank block plus sub-column, y by lane top
 *         plus the step's row. Each lane's label sits once at the
 *         row's start (x = -laneLabelWidth); each stage's label sits once above its column
 *         (y = -stageLabelHeight) and each round's label once above its first stage's label
 *         (y = -stageLabelHeight - roundLabelHeight)
 *   crossings  pairs of edges whose straight segments (source right middle to target left middle)
 *         cross, counted with the starting order (`before`) and with the kept order (`after`)
 *
 * The constants are sized for the canvas's step node at its tallest (the stock Item header wraps
 * the kind badge under a long title; one labeled handle per side), so no two node boxes intersect: rowGap > nodeHeight, columnGap > nodeWidth and
 * rankGap > nodeWidth.
 *
 * The same steps and edges always give byte-identical output: every iteration is over sorted ids.
 */

export const LAYOUT_CONSTANTS = Object.freeze({
  nodeWidth: 240,
  nodeHeight: 148,
  /** Horizontal distance between two stage columns (from the last sub-column of one to the next). */
  rankGap: 320,
  /** Vertical distance between stacked steps in one lane/rank cell. */
  rowGap: 172,
  /** Vertical space between two lanes. */
  laneGap: 48,
  /** Width of the lane label column left of the first stage. */
  laneLabelWidth: 160,
  /** Height of the stage label row above the first lane. */
  stageLabelHeight: 72,
  /** Height of the round label row above the stage label row. */
  roundLabelHeight: 56,
  /** Most steps one lane/rank cell stacks before wrapping into another sub-column. */
  cellRows: 3,
  /** Horizontal distance between two sub-columns of one cell. */
  columnGap: 280,
});

/** Fixed number of barycenter sweeps; the layout never iterates to convergence. */
export const BARYCENTER_SWEEPS = 4;

/** The column of a step whose stage is not a declared stage. */
export const UNSTAGED = "unstaged";

export interface NodeLayout { readonly lane: string; readonly stage: string; readonly rank: number; readonly x: number; readonly y: number }
/** One stage column: its left edge and width (its widest cell's sub-columns), and its label's place; with rounds, its round and its name inside it. */
export interface StageLayout { readonly id: string; readonly index: number; readonly x: number; readonly y: number; readonly width: number; readonly round?: string; readonly name?: string }
/** One round: the stage columns it spans, left to right, and its label's place. */
export interface RoundLayout { readonly id: string; readonly index: number; readonly x: number; readonly y: number; readonly width: number; readonly stages: readonly string[] }
export interface LaneLayout { readonly id: string; readonly index: number; readonly x: number; readonly y: number; readonly height: number }
export interface CycleBreak { readonly from: string; readonly to: string }
export interface Crossings { readonly before: number; readonly after: number }
export interface PipelineLayout {
  readonly constants: typeof LAYOUT_CONSTANTS;
  readonly crossings: Crossings;
  readonly lanes: readonly LaneLayout[];
  readonly stages: readonly StageLayout[];
  readonly rounds: readonly RoundLayout[];
  readonly cycleBreaks: readonly CycleBreak[];
  readonly nodes: Readonly<Record<string, NodeLayout>>;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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

/** A step as the layout reads it: its id, the lane it sits in (its holder) and its stage. */
export interface LayoutStep { readonly id: string; readonly lane: string; readonly stage: string }
/** One round as the caller declares it: its id and its stage ids, in order. */
export interface LayoutRound { readonly id: string; readonly stages: readonly string[] }
/** The lanes top to bottom, the stages left to right and the rounds that group them; none is listed by the layout itself. */
export interface LayoutAxes { readonly lanes: readonly string[]; readonly stages: readonly string[]; readonly rounds?: readonly LayoutRound[] }

export function computeLayout(steps: readonly LayoutStep[], edges: readonly { readonly from: string; readonly to: string }[], axes: LayoutAxes): PipelineLayout {
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

  const laneOf = new Map(steps.map(step => [step.id, step.lane]));
  const lanes = [...new Set([...axes.lanes, ...steps.map(step => step.lane).filter(lane => !axes.lanes.includes(lane)).sort(byId)])];
  const stageOf = new Map(steps.map(step => [step.id, axes.stages.includes(step.stage) ? step.stage : UNSTAGED]));
  const stages = [...axes.stages, ...(steps.some(step => !axes.stages.includes(step.stage)) ? [UNSTAGED] : [])];
  const C = LAYOUT_CONSTANTS;
  // Cells in lane, stage, then rank order; each holds its steps in id order to start.
  const cellOf = (lane: string, stage: string, at: number): string => `${lane}\0${stage}\0${at}`;
  const ranksIn = new Map(stages.map(stage => [stage, [...new Set(ids.filter(id => stageOf.get(id) === stage).map(id => rank.get(id)!))].sort((a, b) => a - b)]));
  const cells = new Map<string, string[]>();
  for (const lane of lanes) for (const stage of stages) for (const at of ranksIn.get(stage)!) cells.set(cellOf(lane, stage, at), []);
  for (const id of ids) cells.get(cellOf(laneOf.get(id)!, stageOf.get(id)!, rank.get(id)!))!.push(id);
  for (const [key, members] of [...cells]) if (!members.length) cells.delete(key);
  const keyParts = (key: string): [string, string, number] => { const [lane, stage, at] = key.split("\0"); return [lane!, stage!, Number(at)]; };
  const keyLane = (key: string): string => keyParts(key)[0];
  const keyStage = (key: string): string => keyParts(key)[1];

  const laneRows = (lane: string): number => Math.max(1, ...[...cells].filter(([key]) => keyLane(key) === lane).map(([, members]) => Math.min(members.length, C.cellRows)));
  // A rank block is as wide as its widest cell; a stage column holds its rank blocks side by side.
  const blockColumns = (stage: string, at: number): number => Math.max(1, ...[...cells].filter(([key]) => keyStage(key) === stage && keyParts(key)[2] === at).map(([, members]) => Math.ceil(members.length / C.cellRows)));
  const blockOffset = new Map<string, number>();
  const stageColumns = (stage: string): number => {
    let columns = 0;
    for (const at of ranksIn.get(stage)!) { blockOffset.set(`${stage}\0${at}`, columns); columns += blockColumns(stage, at); }
    return Math.max(1, columns);
  };
  const laneTops = new Map<string, number>();
  const laneLayouts: LaneLayout[] = [];
  let top = 0;
  lanes.forEach((lane, index) => {
    const height = (laneRows(lane) - 1) * C.rowGap + C.nodeHeight;
    laneTops.set(lane, top);
    laneLayouts.push({ id: lane, index, x: -C.laneLabelWidth, y: top, height });
    top += height + C.laneGap;
  });
  const stageX = new Map<string, number>();
  const stageLayouts: StageLayout[] = [];
  const roundOfStage = new Map((axes.rounds ?? []).flatMap(round => round.stages.map(stage => [stage, round.id] as const)));
  let left = 0;
  stages.forEach((stage, index) => {
    const width = (stageColumns(stage) - 1) * C.columnGap + C.nodeWidth;
    stageX.set(stage, left);
    const round = roundOfStage.get(stage);
    stageLayouts.push({ id: stage, index, x: left, y: -C.stageLabelHeight, width, ...(round !== undefined ? { round, name: stage.startsWith(`${round}.`) ? stage.slice(round.length + 1) : stage } : {}) });
    left += (stageColumns(stage) - 1) * C.columnGap + C.rankGap;
  });
  const roundLayouts: RoundLayout[] = (axes.rounds ?? []).map((round, index) => {
    const spanned = stageLayouts.filter(stage => round.stages.includes(stage.id));
    const x = spanned.length ? spanned[0]!.x : 0, right = spanned.length ? spanned.at(-1)!.x + spanned.at(-1)!.width : 0;
    return { id: round.id, index, x, y: -C.stageLabelHeight - C.roundLabelHeight, width: right - x, stages: spanned.map(stage => stage.id) };
  });

  const place = (order: ReadonlyMap<string, readonly string[]>): Record<string, NodeLayout> => {
    const nodes: Record<string, NodeLayout> = {};
    for (const [key, members] of order) {
      const [lane, stage, block] = keyParts(key);
      const offset = blockOffset.get(`${stage}\0${block}`)!;
      members.forEach((id, at) => {
        nodes[id] = { lane, stage, rank: rank.get(id)!, x: stageX.get(stage)! + (offset + Math.floor(at / C.cellRows)) * C.columnGap, y: laneTops.get(lane)! + (at % C.cellRows) * C.rowGap };
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
    for (const stage of forward ? stages : [...stages].reverse()) {
      const nodes = place(order);
      for (const [key, members] of order) {
        if (keyStage(key) !== stage || members.length < 2) continue;
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
  return { constants: C, crossings: { before, after: best.count }, lanes: laneLayouts, stages: stageLayouts, rounds: roundLayouts, cycleBreaks, nodes: ordered };
}
