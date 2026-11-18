/**
 * Producer as a conformance subject (foundry-build-0048 U9, amendment 17b): one `clossys conform --all` judges
 * Producer beside the four content agents. Producer decides no content, so its rows judge wiring only: its own
 * L0-L3 tree (loops, queue, ledger), loop<->ledger parity, every queue kind mapped to a loop that fills it, every loop
 * exit landing in a queue kind the runner reads (and every step that can fail having such an exit), every queue entry
 * resuming a loop, its connection loops joining every agent (`loop.connected`), and its skill naming every leaf it
 * runs. Splits are report-only (S2's rule). The queue kinds are the runner's and every kind the queue-entry/2 schema
 * admits (U9 fix r1, blind2 B4), so a kind the schema allows but no loop serves is red. Parity covers loops and
 * ledgers; the queue is judged by kind, not by place.
 *
 * Pure judges over a read model, like assertions.ts: `readProducerModel` reads the package data and the consumer,
 * each `PRODUCER_ASSERTIONS` row returns a Judgement (empty is red). Report-only: nothing here gates.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { PRODUCER_ROOT } from "../package-path.js";
import { CONNECTION_LOOPS, consumerLoopSet, loopConnectedIssues, type LoopSet } from "../loop/agent-loops.js";
import { readPackageLoop } from "../loop/files.js";
import { routesFindings, runsDir } from "../loop/runner.js";
import { ENTRY_NAME, LOOP_NAMES, LOOP_SUBJECT, SLOT_REF, ledgerOf, type LoopName } from "../loop/names.js";
import { PRODUCER_LAYERS, producerSlotPositions, readProducerIa, type ProducerIaLayer, type ProducerLayer } from "../loop/producer-ia.js";
import { QUEUE_NAMES } from "../queue/entry.js";
import { requestIssues, SLOT_QUEUE } from "../records/request.js";
import type { LoopStep } from "../records/types.js";
import type { Judgement } from "./assertions.js";

/** One loop as Producer ships it (package v1), or why it cannot be read. */
export type ProducerLoop = { readonly ok: true; readonly steps: readonly LoopStep[] } | { readonly ok: false; readonly reason: string };
/** One queue entry on the consumer, as the resume row reads it. */
export interface QueueEntryFact { readonly queue: string; readonly id: string; readonly status?: string; readonly subject?: string; readonly issues: readonly string[] }

export interface ProducerModel {
  readonly ia: readonly ProducerIaLayer[];
  /** `readProducerIa` failed: every row that reads the tree is red with this reason. */
  readonly iaIssue?: string;
  readonly loops: ReadonlyMap<LoopName, ProducerLoop>;
  /** The queue kinds: the runner's (the queue-entry/1 queues, the slot request queue) and every kind queue-entry/2 admits. */
  readonly queueKinds: readonly string[];
  /** The queue-entry/2 schema's kind enum could not be read: P1 is red with this reason. */
  readonly queueSchemaIssue?: string;
  readonly loopSet: LoopSet;
  readonly entries: readonly QueueEntryFact[];
  /** The waiting runs' raised and awaited entry names (`queue.<kind>#<id>`). */
  readonly awaited: ReadonlySet<string>;
  readonly skill: { readonly path: string; readonly text?: string };
}

export type ProducerAssertion = (model: ProducerModel) => Judgement;

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const json = (file: string): unknown => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; } };
const leavesOf = (layer: ProducerIaLayer | undefined): string[] => (layer?.nodes ?? []).flatMap(node => node.children.flatMap(child => child.leaves));
const layerOf = (model: ProducerModel, layer: ProducerLayer) => model.ia.find(each => each.layer === layer);
/** Where each leaf of a layer sits: its L1 index, L2 index and order. */
const positions = (layer: ProducerIaLayer | undefined): Map<string, string> => {
  const out = new Map<string, string>();
  (layer?.nodes ?? []).forEach((node, l1) => node.children.forEach((child, l2) => child.leaves.forEach((leaf, order) => out.set(leaf, `${l1}.${l2}.${order}`))));
  return out;
};
/** The queue a step's write lands in (`producer/queue.<kind>/entries/...`), if any. */
const queueWritten = (path: string): string | undefined => /^(?:clossys\/agents\/)?producer\/(queue\.[a-z]+)\/entries(?:\/|$)/.exec(path)?.[1];

/** Every route by which a loop's steps hand work to a queue: an owner step's raise, a failure route, a queue write. */
export function loopRoutes(steps: readonly LoopStep[]): { step: string; queue: string; how: "raise" | "onFail" | "writes"; then?: string }[] {
  const out: { step: string; queue: string; how: "raise" | "onFail" | "writes"; then?: string }[] = [];
  for (const step of steps) {
    if (step.decider?.by === "human") out.push({ step: step.id, queue: step.decider.raise, how: "raise" });
    if (step.onFail) out.push({ step: step.id, queue: step.onFail.raise, how: "onFail", then: step.onFail.then });
    for (const path of step.writes ?? []) { const queue = queueWritten(path); if (queue) out.push({ step: step.id, queue, how: "writes" }); }
  }
  return out;
}

/**
 * U9 fix r1 (blind2 B2): the steps whose failure lands in no queue. A step with no `onFail` that fails stops the run
 * (a "stopped" ledger entry, no queue entry, read by no loop) unless the step right after is the code route step that
 * hands its findings on (the runner's `routesFindings`). An owner step is no dead end: its raise is the queue entry the
 * owner answers, so its outcome is already on the queue.
 */
export function deadEndSteps(steps: readonly LoopStep[]): string[] {
  return steps.filter((step, at) => !step.onFail && step.decider?.by !== "human" && !routesFindings(steps[at + 1])).map(step => step.id);
}

/** The `queue.<kind>` names the queue-entry/2 schema's `kind` enum admits, or why they cannot be read. */
export function schemaQueueKinds(file = join(PRODUCER_ROOT, "schemas", "queue-entry-2.json")): { kinds: string[] } | { issue: string } {
  const doc = json(file);
  const kinds = object(doc) && object(doc.properties) && object(doc.properties.kind) ? doc.properties.kind.enum : undefined;
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => typeof kind !== "string")) return { issue: `${file} names no kind enum` };
  return { kinds: (kinds as string[]).map(kind => `queue.${kind}`) };
}

/** True when a loop takes an entry of this queue kind back: `clossys run --from` (queue-entry/1) or a request run (loop.slot). */
export function kindResumes(kind: string, loops: ReadonlyMap<LoopName, ProducerLoop>): boolean {
  if (kind === SLOT_QUEUE) return LOOP_NAMES.some(loop => LOOP_SUBJECT[loop] === "request" && loops.get(loop)?.ok === true);
  return ENTRY_NAME.test(`${kind}#20261117T1200Z-probe`);
}

const PUBLICATION_SUBJECT = /^publisher\/release\.[a-z][a-z0-9-]*$/;

export const PRODUCER_ASSERTIONS: Readonly<Record<string, ProducerAssertion>> = {
  // P1 tree: the L0-L3 round of Producer's own tree. Each layer holds an L1, every leaf is placed once, and the leaves
  // are what the runner uses: its loop names, one ledger per loop, and every queue kind it reads and writes (the
  // queue-entry/1 queues and the slot request queue).
  P1: model => {
    if (model.iaIssue) return { rows: [`producer IA cannot be read: ${model.iaIssue}`], evidence: 0 };
    const rows: string[] = model.queueSchemaIssue ? [`queue kinds cannot be read: ${model.queueSchemaIssue}`] : [];
    try { producerSlotPositions(model.ia); } catch (error) { rows.push((error as Error).message); }
    const want: Record<ProducerLayer, readonly string[]> = { loops: LOOP_NAMES, ledger: LOOP_NAMES.map(ledgerOf), queue: model.queueKinds };
    for (const layer of PRODUCER_LAYERS) {
      const tree = layerOf(model, layer);
      if (!tree?.nodes.length) { rows.push(`producer IA ${layer}: no L1`); continue; }
      const placed = new Set(leavesOf(tree));
      for (const leaf of want[layer]) if (!placed.has(leaf)) rows.push(`producer IA ${layer}: ${leaf} is not placed`);
      for (const leaf of placed) if (!want[layer].includes(leaf)) rows.push(`producer IA ${layer}: ${leaf} is not a ${layer} slot`);
    }
    return { rows, evidence: model.ia.reduce((count, layer) => count + leavesOf(layer).length, 0) };
  },
  // P2 parity: each loop's ledger sits where the loop sits (same L1, L2 and order), and no ledger names no loop.
  P2: model => {
    if (model.iaIssue) return { rows: [`producer IA cannot be read: ${model.iaIssue}`], evidence: 0 };
    const loops = positions(layerOf(model, "loops")), ledgers = positions(layerOf(model, "ledger"));
    const rows: string[] = [];
    const named = new Set<string>();
    for (const [loop, at] of loops) {
      if (!(LOOP_NAMES as readonly string[]).includes(loop)) continue;
      const ledger = ledgerOf(loop as LoopName);
      named.add(ledger);
      const there = ledgers.get(ledger);
      if (there === undefined) rows.push(`${loop}: its ledger ${ledger} is not placed`);
      else if (there !== at) rows.push(`${loop}: its ledger ${ledger} sits at ${there}, the loop at ${at} (L1.L2.order)`);
    }
    for (const ledger of ledgers.keys()) if (!named.has(ledger)) rows.push(`${ledger}: a ledger with no placed loop`);
    return { rows, evidence: loops.size };
  },
  // P3 queue: every queue kind the runner uses, and every one a loop routes to, is filled by some loop.
  P3: model => {
    const routes = [...model.loops].flatMap(([loop, read]) => read.ok ? loopRoutes(read.steps).map(route => ({ loop, ...route })) : []);
    const kinds = [...new Set([...model.queueKinds, ...routes.map(route => route.queue)])].sort();
    return { rows: kinds.filter(kind => !routes.some(route => route.queue === kind)).map(kind => `${kind}: no loop fills it (no owner step raises it, no failure routes to it, no step writes it)`), evidence: kinds.length };
  },
  // P4 exits: every loop reads, every route out of it lands in a queue kind the runner reads, then retries or goes on to a
  // loop, and every step that can fail has such a route (U9 fix r1, blind2 B2: a failed run must land in the queue).
  P4: model => {
    const known = new Set(model.queueKinds);
    const rows: string[] = [];
    let evidence = 0;
    for (const loop of LOOP_NAMES) {
      const read = model.loops.get(loop);
      if (!read) { rows.push(`${loop}: Producer ships no version`); continue; }
      if (!read.ok) { rows.push(`${loop}: cannot be read: ${read.reason}`); continue; }
      const routes = loopRoutes(read.steps);
      evidence += 1 + routes.length + read.steps.length;
      for (const step of deadEndSteps(read.steps)) rows.push(`${loop}: step ${step} has no failure route: a failed run stops and lands in no queue`);
      for (const route of routes) {
        if (!known.has(route.queue)) rows.push(`${loop}: step ${route.step} lands in ${route.queue} (${route.how}), which is no queue the runner reads`);
        if (route.then !== undefined && route.then !== "retry" && !(LOOP_NAMES as readonly string[]).includes(route.then)) rows.push(`${loop}: step ${route.step} goes on to ${route.then}, which is no loop`);
      }
    }
    return { rows, evidence };
  },
  // P5 resume: every queue kind is taken back by a loop, and every open entry on the consumer resumes one.
  P5: model => {
    const rows: string[] = [];
    for (const kind of model.queueKinds) if (!kindResumes(kind, model.loops)) rows.push(`${kind}: no loop takes its entries back (clossys run --from or a request run)`);
    for (const entry of model.entries) {
      const name = `${entry.queue}#${entry.id}`;
      if (entry.issues.length) { rows.push(`${name}: unreadable, so no loop can take it: ${entry.issues.slice(0, 3).join("; ")}`); continue; }
      if (entry.status !== "open") continue;
      if (!kindResumes(entry.queue, model.loops)) { rows.push(`${name}: open, and no loop takes ${entry.queue} entries`); continue; }
      if (entry.queue === SLOT_QUEUE || model.awaited.has(name)) continue;
      const subject = entry.subject ?? "";
      if (!SLOT_REF.test(subject.split("/").slice(0, 2).join("/")) && !PUBLICATION_SUBJECT.test(subject)) rows.push(`${name}: open, no waiting run holds it, and its subject ${subject || "(none)"} is no slot or publication a run can start from`);
    }
    return { rows, evidence: model.queueKinds.length + model.entries.length };
  },
  // P6 connected (amendment 17b): Producer's connection loops join every agent's loops into one chain.
  P6: model => ({ rows: loopConnectedIssues(model.loopSet), evidence: CONNECTION_LOOPS.filter(loop => model.loopSet.standards.has(loop)).length + model.loopSet.versions.size }),
  // P7 split (report-only, S2's rule): an L1 with one L2 or an L2 with one leaf is listed, never red.
  P7: model => {
    if (model.iaIssue) return { rows: [`producer IA cannot be read: ${model.iaIssue}`], evidence: 0 };
    const findings: string[] = [];
    let evidence = 0;
    for (const layer of model.ia) for (const node of layer.nodes) {
      evidence++;
      if (node.children.length === 1) findings.push(`suspicious split: ${layer.layer} ${node.id} has one L2 (${node.children[0]!.id})`);
      for (const child of node.children) if (child.leaves.length <= 1) findings.push(`suspicious split: ${layer.layer} ${node.id}/${child.id} has ${child.leaves.length === 0 ? "no" : "one"} L3`);
    }
    return { rows: [], evidence, findings };
  },
  // P8 skill: Producer's skill names every loop and queue leaf it runs, so an operator reaches each from the skill.
  P8: model => {
    if (model.skill.text === undefined) return { rows: [`${model.skill.path}: missing`], evidence: 0 };
    const leaves = [...leavesOf(layerOf(model, "loops")), ...leavesOf(layerOf(model, "queue"))];
    const named = (leaf: string) => new RegExp(`(^|[^a-z.])${leaf.replace(/\./g, "\\.")}($|[^a-z])`).test(model.skill.text!);
    return { rows: leaves.filter(leaf => !named(leaf)).map(leaf => `${leaf}: ${model.skill.path} does not name it`), evidence: leaves.length };
  },
};

/** Every queue entry under the consumer's queue folders (`queueKinds`), read for the resume row. */
function readEntries(consumer: string, kinds: readonly string[]): QueueEntryFact[] {
  const out: QueueEntryFact[] = [];
  for (const queue of kinds) {
    const dir = join(consumer, "agents", "producer", queue, "entries");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter(file => file.endsWith(".json") && !file.startsWith(".")).sort()) {
      const id = name.slice(0, -".json".length);
      const doc = json(join(dir, name));
      if (!object(doc)) { out.push({ queue, id, issues: ["not JSON"] }); continue; }
      const issues = queue === SLOT_QUEUE ? requestIssues(doc) : [];
      const subject = object(doc.subject) && typeof doc.subject.to === "string" ? doc.subject.to : undefined;
      out.push({ queue, id, ...(typeof doc.status === "string" ? { status: doc.status } : {}), ...(subject ? { subject } : {}), issues });
    }
  }
  return out;
}

/** The entry names the consumer's waiting runs raised or wait on (the runner's run states, status waiting or running). */
function awaitedEntries(root: string): Set<string> {
  const dir = runsDir(root);
  const out = new Set<string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter(file => file.endsWith(".json"))) {
    const state = json(join(dir, name));
    if (!object(state) || (state.status !== "waiting" && state.status !== "running")) continue;
    for (const raised of Array.isArray(state.raised) ? state.raised : []) if (typeof raised === "string") out.add(raised);
    if (object(state.waiting) && typeof state.waiting.entry === "string") out.add(state.waiting.entry);
  }
  return out;
}

/** Producer's read model: its package tree, its package loops and skill, and the consumer's loops, queues and runs. */
export function readProducerModel(consumer: string): ProducerModel {
  let ia: ProducerIaLayer[] = [], iaIssue: string | undefined;
  try { ia = readProducerIa(); } catch (error) { iaIssue = error instanceof Error ? error.message : String(error); }
  const loops = new Map<LoopName, ProducerLoop>();
  for (const loop of LOOP_NAMES) {
    const read = readPackageLoop(loop);
    loops.set(loop, read.ok ? { ok: true, steps: object(read.content) && Array.isArray(read.content.steps) ? read.content.steps as LoopStep[] : [] } : { ok: false, reason: read.reason });
  }
  const fromSchema = schemaQueueKinds();
  const queueKinds = [...new Set([...QUEUE_NAMES, SLOT_QUEUE, ...("kinds" in fromSchema ? fromSchema.kinds : [])])];
  const root = dirname(consumer);
  const skillPath = join(PRODUCER_ROOT, "skill", "SKILL.md");
  let text: string | undefined;
  try { text = readFileSync(skillPath, "utf8"); } catch { text = undefined; }
  return {
    ia, ...(iaIssue ? { iaIssue } : {}), loops, queueKinds, ...("issue" in fromSchema ? { queueSchemaIssue: fromSchema.issue } : {}), loopSet: consumerLoopSet(root),
    entries: readEntries(consumer, queueKinds), awaited: awaitedEntries(root),
    skill: { path: "packages/producer/skill/SKILL.md", ...(text !== undefined ? { text } : {}) },
  };
}
