/**
 * The real, active wiring: what the pipeline page draws and `clossys pipeline status` prints. It is
 * derived only from what exists and what ran, never from what a step declares it should touch. Step
 * fields are read only through readStepGraph (the generated pipeline/graph.json, never steps/*.ts), so
 * the page follows whatever generates that file; runs are keyed by step id:
 *
 *   nodes   the steps whose command exists in this build (a registered CLI handler, or a script or
 *           npm script that is there), one node per invocation that ran (`check --slots
 *           --readiness` and `check --suites --strict` are two nodes of workspace.check); a step
 *           with no run record is one node in state `never-run`; a check appears once it has run
 *   edges   writer -> reader for every workspace file one node's latest run wrote and another
 *           node's latest run read; `fresh` when the reader saw the bytes the writer left
 *   state   from the node's latest run record only:
 *             never-run  no record
 *             failed     the run exited non-zero
 *             stale      it exited 0, but a file it read has changed since (a file it also wrote
 *                        is compared with what it wrote)
 *             passed     it exited 0 and every file it read is unchanged
 *           every state but never-run cites its record (store file, line, run id)
 *   layout  computeLayout over the observed edges: lanes are the seat holders, columns the stages
 *   undrawn the declared steps with no command in this build (a skill, a module
 *           no handler runs, a step pending on another branch): listed, never drawn
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StepKind } from "./define.js";
import { GRAPH_FILE, GRAPH_SCHEMA } from "./graph.js";
import type { GraphNode, PipelineGraph } from "./graph.js";
import { HANDLERS } from "./handlers.js";
import { computeLayout } from "./layout.js";
import type { NodeLayout, PipelineLayout } from "./layout.js";
import { PACKAGE_ROOT } from "./options.js";
import { laneIds, laneOf, rosterOf } from "./roster.js";
import type { Holder, RosterEntry } from "./roster.js";
import { currentSha, readRuns, RUNS_DIR } from "./trace.js";
import type { RunRecord, StoredRun } from "./trace.js";

export const WIRING_SCHEMA = "clossys.pipeline-wiring/1";
export const RUN_STATES = ["passed", "failed", "stale", "never-run"] as const;
export type RunState = typeof RUN_STATES[number];
/** A check that has not run says so; it is never shown as passing. */
export type CheckState = RunState | "not-run";

/** Where a state comes from: one line of the run store. */
export interface Citation { readonly store: string; readonly line: number; readonly run: string; readonly end: string; readonly exit: number }
export interface WiringCheck { readonly id: string; readonly state: CheckState; readonly citation: Citation | null }
export interface WiringNode {
  readonly id: string;
  /** The defined step (or `check:<id>`) this node runs. */
  readonly step: string;
  readonly kind: StepKind;
  /** The invocation's mode words; null for a step that never ran. */
  readonly invocation: string | null;
  /** What runs it: the invocation as typed, or the step's command when it never ran. */
  readonly command: string;
  readonly holder: Holder;
  readonly stage: string;
  readonly state: RunState;
  readonly citation: Citation | null;
  /** Files the run read that have changed since (stale only), first STALE_SHOWN of them. */
  readonly changed: readonly string[];
  readonly changedCount: number;
  readonly reads: number;
  readonly writes: number;
  readonly checks: readonly WiringCheck[];
  readonly layout: NodeLayout;
}
export interface WiringEdge {
  readonly from: string;
  readonly to: string;
  /** Files the writer wrote and the reader read. */
  readonly files: number;
  /** The first EDGE_SHOWN of them. */
  readonly sample: readonly string[];
  /** Every one of them: the reader saw the bytes the writer left. */
  readonly fresh: boolean;
}
export interface Undrawn { readonly step: string; readonly reason: string }
export interface PipelineWiring {
  readonly schema: typeof WIRING_SCHEMA;
  readonly store: typeof RUNS_DIR;
  readonly nodes: readonly WiringNode[];
  readonly edges: readonly WiringEdge[];
  readonly layout: Omit<PipelineLayout, "nodes">;
  readonly roster: readonly RosterEntry[];
  readonly seats: Readonly<Record<string, { readonly by: string | null }>>;
  readonly undrawn: readonly Undrawn[];
  readonly counts: Readonly<Record<RunState, number>> & { readonly runs: number };
}

const STALE_SHOWN = 10;
const EDGE_SHOWN = 5;
const CHECKS_HOLDER: Holder = Object.freeze({ id: "checks", kind: "code", source: "derived", tier: null });

/** Why a declared step cannot run in this build, or null when its command exists. */
export function whyNotRunnable(step: GraphNode, packageRoot = PACKAGE_ROOT): string | null {
  if (step.pending?.change === "adds") return `pending: lands on ${step.pending.branch}`;
  const command = step.command;
  if (command.cli) return command.entry && HANDLERS[command.entry] ? null : `no handler is registered for ${command.entry ?? command.cli.verb}`;
  if (command.script !== undefined) return existsSync(join(packageRoot, command.script)) ? null : `script ${command.script} does not exist`;
  if (command.npm !== undefined) return npmScripts(packageRoot)[command.npm] !== undefined ? null : `npm script ${command.npm} does not exist`;
  if (command.skill !== undefined) return `skill only (${command.skill}); no command runs it`;
  if (command.module !== undefined) return `module ${[command.module].flat().join(", ")} has no command that runs it`;
  return "names nothing that runs it";
}
const npmCache = new Map<string, Readonly<Record<string, string>>>();
function npmScripts(packageRoot: string): Readonly<Record<string, string>> {
  let scripts = npmCache.get(packageRoot);
  if (!scripts) {
    try { scripts = (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}; }
    catch { scripts = {}; }
    npmCache.set(packageRoot, scripts);
  }
  return scripts;
}

/** A step's command when it never ran: the CLI verb and its mode flags, else the script it runs. */
function declaredCommand(step: GraphNode): string {
  const cli = step.command.cli;
  if (cli) return ["clossys", cli.verb, ...(cli.target ? [`${cli.target}/<slot>`] : []), ...(cli.flags ?? [])].join(" ");
  if (step.command.npm !== undefined && step.command.npm !== "build") return `npm run ${step.command.npm}`;
  return `node ${step.command.script ?? ""}`.trim();
}

/** The latest record per (step, invocation). */
function latestRuns(runs: readonly StoredRun[]): Map<string, Map<string, StoredRun>> {
  const latest = new Map<string, Map<string, StoredRun>>();
  for (const run of runs) {
    const byInvocation = latest.get(run.record.step) ?? new Map<string, StoredRun>();
    const seen = byInvocation.get(run.record.invocation);
    if (!seen || seen.record.end <= run.record.end) byInvocation.set(run.record.invocation, run);
    latest.set(run.record.step, byInvocation);
  }
  return latest;
}

/** One run's state against the workspace now, with the files that changed since it read them. */
export function runState(root: string, record: RunRecord, sha: (path: string) => string | null = path => currentSha(root, path)): { state: Exclude<RunState, "never-run">; changed: string[] } {
  const wrote = new Map(record.writes.map(entry => [entry.path, entry.sha256]));
  const changed = record.reads.filter(entry => sha(entry.path) !== (wrote.has(entry.path) ? wrote.get(entry.path) : entry.sha256)).map(entry => entry.path);
  return { state: record.exit !== 0 ? "failed" : changed.length ? "stale" : "passed", changed };
}
const citationOf = (run: StoredRun): Citation => ({ store: run.store, line: run.line, run: run.record.run, end: run.record.end, exit: run.record.exit });

/** A node id: the step id, then the invocation's words beyond the step's own verb and flags. */
export function nodeId(step: Pick<GraphNode, "command"> | null, stepId: string, invocation: string | null): string {
  if (invocation === null) return stepId;
  const base = step?.command.cli ? [step.command.cli.verb, ...(step.command.cli.target ? [step.command.cli.target] : []), ...(step.command.cli.flags ?? [])] : [];
  const words = invocation.split(" ").filter(Boolean);
  const rest = base.length && base.every(word => words.includes(word)) ? words.filter(word => !base.includes(word)) : step?.command.cli ? words : [];
  return rest.length ? `${stepId}[${rest.join(" ")}]` : stepId;
}

/**
 * The page's one reader of step contracts: the generated graph file (pipeline/graph.json), never
 * steps/*.ts. When the generator moves to the action registry, the page follows with no rewrite.
 */
export function readStepGraph(packageRoot = PACKAGE_ROOT): PipelineGraph {
  const path = join(packageRoot, GRAPH_FILE);
  const graph = JSON.parse(readFileSync(path, "utf8")) as PipelineGraph;
  if (graph?.schema !== GRAPH_SCHEMA || !Array.isArray(graph.nodes)) throw new Error(`${path} is not a ${GRAPH_SCHEMA} graph`);
  return graph;
}

export interface WiringOptions { readonly graph?: PipelineGraph; readonly packageRoot?: string; readonly runs?: readonly StoredRun[] }

export function buildWiring(root: string, options: WiringOptions = {}): PipelineWiring {
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  const graph = options.graph ?? readStepGraph(packageRoot);
  const steps = graph.nodes;
  const runs = options.runs ?? readRuns(root);
  const latest = latestRuns(runs);
  const shaCache = new Map<string, string | null>();
  const sha = (path: string) => { if (!shaCache.has(path)) shaCache.set(path, currentSha(root, path)); return shaCache.get(path)!; };

  interface Draft { id: string; step: string; kind: StepKind; invocation: string | null; command: string; holder: Holder; stage: string; run: StoredRun | null; checkIds: readonly string[] }
  const drafts: Draft[] = [];
  const undrawn: Undrawn[] = [];
  for (const step of steps) {
    const why = whyNotRunnable(step, packageRoot);
    const ran = latest.get(step.id);
    if (why && !ran) { undrawn.push({ step: step.id, reason: why }); continue; }
    const holder = step.holder;
    if (!ran?.size) { drafts.push({ id: step.id, step: step.id, kind: step.kind, invocation: null, command: declaredCommand(step), holder, stage: step.stage, run: null, checkIds: step.checks }); continue; }
    for (const [invocation, run] of [...ran].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      drafts.push({ id: nodeId(step, step.id, invocation), step: step.id, kind: step.kind, invocation, command: `clossys ${run.record.argv.join(" ")}`.replace(/^clossys (node|npm) /, "$1 "), holder, stage: step.stage, run, checkIds: step.checks });
    }
  }
  // A run whose step id is not (or no longer) defined is still shown: it ran.
  const defined = new Set(steps.map(step => step.id));
  const checkIds = new Set(steps.flatMap(step => step.checks));
  for (const [stepId, byInvocation] of [...latest].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (defined.has(stepId)) continue;
    const check = stepId.startsWith("check:") ? stepId.slice("check:".length) : null;
    const stage = check ? steps.find(step => step.checks.includes(check))?.stage ?? "publish.check" : "publish.check";
    for (const [invocation, run] of [...byInvocation].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      drafts.push({ id: byInvocation.size > 1 ? `${stepId}[${invocation}]` : stepId, step: stepId, kind: "plumb", invocation, command: run.record.argv.join(" "),
        holder: CHECKS_HOLDER, stage, run, checkIds: [] });
    }
    if (check && !checkIds.has(check)) undrawn.push({ step: stepId, reason: `ran, but no step in the graph names check ${check}` });
    else if (!check) undrawn.push({ step: stepId, reason: "ran, but the graph has no such step" });
  }

  const states = new Map(drafts.map(draft => [draft.id, draft.run ? runState(root, draft.run.record, sha) : null]));
  const checkState = (id: string): WiringCheck => {
    const ran = latest.get(`check:${id}`);
    if (!ran?.size) return { id, state: "not-run", citation: null };
    const newest = [...ran.values()].sort((a, b) => a.record.end < b.record.end ? 1 : -1)[0]!;
    return { id, state: runState(root, newest.record, sha).state, citation: citationOf(newest) };
  };

  // Edges: a file one node's latest run wrote and another's read.
  const writers = new Map<string, { id: string; sha: string | null }[]>();
  for (const draft of drafts) for (const entry of draft.run?.record.writes ?? []) {
    if (entry.path.endsWith("/")) continue;
    writers.set(entry.path, [...(writers.get(entry.path) ?? []), { id: draft.id, sha: entry.sha256 }]);
  }
  const edgeFiles = new Map<string, { from: string; to: string; files: string[]; fresh: boolean }>();
  for (const draft of drafts) for (const entry of draft.run?.record.reads ?? []) {
    for (const writer of writers.get(entry.path) ?? []) {
      if (writer.id === draft.id) continue;
      const key = `${writer.id}\0${draft.id}`;
      const edge = edgeFiles.get(key) ?? { from: writer.id, to: draft.id, files: [], fresh: true };
      edge.files.push(entry.path);
      if (writer.sha !== entry.sha256) edge.fresh = false;
      edgeFiles.set(key, edge);
    }
  }
  const edges: WiringEdge[] = [...edgeFiles.values()]
    .sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0)
    .map(edge => ({ from: edge.from, to: edge.to, files: edge.files.length, sample: edge.files.slice().sort().slice(0, EDGE_SHOWN), fresh: edge.fresh }));

  const holders = drafts.map(draft => draft.holder);
  const { nodes: positions, ...layout } = computeLayout(
    drafts.map(draft => ({ id: draft.id, lane: laneOf(draft.holder), stage: draft.stage })), edges,
    {
      lanes: laneIds(holders),
      stages: [...graph.layout.stages].sort((a, b) => a.index - b.index).map(stage => stage.id),
      rounds: [...graph.layout.rounds].sort((a, b) => a.index - b.index).map(round => ({ id: round.id, stages: round.stages })),
    },
  );
  const counts: Record<RunState, number> = { passed: 0, failed: 0, stale: 0, "never-run": 0 };
  const nodes = drafts.map((draft): WiringNode => {
    const ran = states.get(draft.id);
    const state: RunState = ran?.state ?? "never-run";
    counts[state]++;
    return {
      id: draft.id, step: draft.step, kind: draft.kind, invocation: draft.invocation, command: draft.command, holder: draft.holder, stage: draft.stage,
      state, citation: draft.run ? citationOf(draft.run) : null,
      changed: state === "stale" ? ran!.changed.slice(0, STALE_SHOWN) : [], changedCount: state === "stale" ? ran!.changed.length : 0,
      reads: draft.run?.record.reads.length ?? 0, writes: draft.run?.record.writes.length ?? 0,
      checks: draft.checkIds.map(checkState), layout: positions[draft.id]!,
    };
  });
  return {
    schema: WIRING_SCHEMA, store: RUNS_DIR, nodes, edges, layout, roster: rosterOf(holders),
    seats: Object.fromEntries(Object.entries(graph.seats).map(([id, seat]) => [id, { by: seat.by ?? null }])),
    undrawn, counts: { ...counts, runs: runs.length },
  };
}

/**
 * Every problem with a wiring's statuses (check:pipeline status.uncited): a state other than
 * never-run must cite a store line that holds a record of that step and invocation with that exit,
 * and recomputing the state from that record must give the same state; never-run cites nothing.
 */
export function wiringCitationIssues(root: string, wiring: PipelineWiring, runs: readonly StoredRun[] = readRuns(root)): string[] {
  const issues: string[] = [];
  const at = new Map(runs.map(run => [`${run.store}:${run.line}`, run]));
  for (const node of wiring.nodes) {
    if (node.state === "never-run") { if (node.citation) issues.push(`${node.id}: never-run but cites ${node.citation.store}:${node.citation.line}`); continue; }
    if (!node.citation) { issues.push(`${node.id}: shows ${node.state} without a run record`); continue; }
    const run = at.get(`${node.citation.store}:${node.citation.line}`);
    if (!run) { issues.push(`${node.id}: cites ${node.citation.store}:${node.citation.line}, which holds no run record`); continue; }
    if (run.record.run !== node.citation.run || run.record.step !== node.step || run.record.invocation !== node.invocation || run.record.exit !== node.citation.exit) {
      issues.push(`${node.id}: cites ${node.citation.store}:${node.citation.line}, a record of ${run.record.step} \`${run.record.invocation}\` exit ${run.record.exit}, not this node`);
      continue;
    }
    const recomputed = runState(root, run.record).state;
    if (recomputed !== node.state) issues.push(`${node.id}: shows ${node.state}, but its record says ${recomputed}`);
    for (const check of node.checks) if (check.state !== "not-run" && !check.citation) issues.push(`${node.id}: check ${check.id} shows ${check.state} without a run record`);
  }
  return issues;
}
