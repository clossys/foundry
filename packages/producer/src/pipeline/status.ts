import { join } from "node:path";
import { STEPS } from "./steps/index.js";
import type { OpenCounter, Step } from "./define.js";
import { PACKAGE_ROOT } from "./options.js";
import { readSeats } from "./seats.js";
import { isModelDir, listModelDir, modelExists, readModelText } from "../records/slots.js";
import { FOLDER_KIND } from "../records/slot-model/types.js";
import { errorMessage, isAbsent } from "../errors.js";
import type { SeatReport } from "./seats.js";
import { buildGraph } from "./graph.js";
import { buildWiring } from "./wiring.js";
import type { Citation, PipelineWiring, RunState, Undrawn, WiringCheck } from "./wiring.js";

/**
 * `clossys pipeline status`: what ran, from the run records alone (trace.ts, wiring.ts). A step's
 * state is its latest run record's: passed, failed (non-zero exit) or stale (an input changed since);
 * a step with no record is never-run, and a check with no record not-run. No declaration, file time
 * or output glob makes a step ready or passing.
 *
 * Open decisions are counted once each: every agent slot with neither a pin nor a not-needed marker,
 * plus every decide-step seat not assigned. Each decide step's own counter is reported beside it
 * (`decisions`), never summed into the total: the counters overlap (slots-undecided:<agent> is part of
 * the agents' count) or count something other than decisions.
 */
export const STATUS_SCHEMA = "clossys.pipeline-status/2";

export interface StepStatus {
  /** The wiring node: the step id, plus the invocation's mode words when it ran with any. */
  readonly id: string;
  readonly step: string;
  readonly kind: Step["kind"];
  readonly invocation: string | null;
  readonly state: RunState;
  /** The run record the state comes from; null only for never-run. */
  readonly citation: Citation | null;
  readonly changed: readonly string[];
  readonly changedCount: number;
  readonly checks: readonly WiringCheck[];
}
export interface DecisionCounter { readonly step: string; readonly counter: OpenCounter; readonly count: number }
export interface SlotCounts { readonly slots: number; readonly candidates: number; readonly pinned: number; readonly notNeeded: number; readonly open: number }
export interface SlotRow { readonly slot: string; readonly candidates: number; readonly pinned: boolean; readonly notNeeded: boolean }
export interface PipelineStatus {
  readonly schema: typeof STATUS_SCHEMA;
  readonly steps: readonly StepStatus[];
  /** Declared steps with no command in this build: not drawn, never run. */
  readonly undrawn: readonly Undrawn[];
  readonly counts: PipelineWiring["counts"];
  readonly decisions: readonly DecisionCounter[];
  readonly agents: Readonly<Record<string, SlotCounts & { readonly bySlot: readonly SlotRow[] }>>;
  /** Open decisions: undecided agent slots plus unassigned seats, each counted once. */
  readonly open: number;
  readonly openParts: { readonly slots: number; readonly seats: number };
}

/** A model JSON record, or undefined when the file is absent; an unreadable or malformed one surfaces. */
export const readJson = (file: string): unknown => {
  let text: string;
  try { text = readModelText(file); } catch (error) { if (isAbsent(error)) return undefined; throw error; }
  try { return JSON.parse(text); } catch (error) { throw new Error(`${file}: not JSON (${errorMessage(error)})`); }
};

/** Per agent, per slot: candidate files, pin, not-needed (slot.json notNeeded), open (neither). */
export function slotCounts(root: string): PipelineStatus["agents"] {
  const agents: Record<string, SlotCounts & { bySlot: SlotRow[] }> = {};
  const dir = join(root, "clossys", "agents");
  if (!modelExists(dir)) return agents;
  for (const agent of listModelDir(dir).sort()) {
    const agentDir = join(dir, agent);
    if (!isModelDir(agentDir)) continue;
    const bySlot: SlotRow[] = [];
    for (const slot of listModelDir(agentDir).sort()) {
      const slotDir = join(agentDir, slot);
      if (!modelExists(join(slotDir, "slot.json"))) continue;
      const doc = readJson(join(slotDir, "slot.json")) as { notNeeded?: unknown } | undefined;
      const candidates = listModelDir(join(slotDir, "candidates")).filter(name => !name.startsWith(".")).length;
      bySlot.push({ slot, candidates, pinned: modelExists(join(slotDir, "pin.json")), notNeeded: Boolean(doc?.notNeeded) });
    }
    if (!bySlot.length) continue;
    agents[agent] = {
      slots: bySlot.length, candidates: bySlot.reduce((sum, row) => sum + row.candidates, 0),
      pinned: bySlot.filter(row => row.pinned).length, notNeeded: bySlot.filter(row => row.notNeeded).length,
      open: bySlot.filter(row => !row.pinned && !row.notNeeded).length, bySlot,
    };
  }
  return agents;
}

function iaSlots(root: string, agent: string): string[] {
  const ia = readJson(join(root, "clossys", "agents", agent, "ia.json")) as { nodes?: { children?: { slots?: unknown[] }[] }[] } | undefined;
  return (ia?.nodes ?? []).flatMap(node => (node.children ?? []).flatMap(child => (child.slots ?? []).filter((slot): slot is string => typeof slot === "string")));
}

/**
 * Writer keys awaiting a decision, per Writer slot: keys a slot's candidates propose that its pinned
 * candidate does not hold (every key of an unpinned slot's newest candidate). A pinned key is decided.
 * Pin = approval (owner Producer round 2): an owner pin (`pinApproved`: basis picked or bulk) is the
 * editorial approval (`clossys approve writer/<slot>`; no `status: approved` field exists in the Writer
 * record format); a planner or agent pin stays a confirm item until the owner pins. `records/writer-copy.ts`
 * reads the same rule.
 */
export function writerKeysUnapproved(root: string): ReadonlyMap<string, readonly string[]> {
  const unapproved = new Map<string, string[]>();
  const dir = join(root, "clossys", "agents", "writer");
  if (!modelExists(dir)) return unapproved;
  const keysOf = (file: string): Set<string> => {
    const keys = new Set<string>();
    for (const match of readModelText(file).matchAll(/^<!-- (\{.*\}) -->$/gm)) {
      let meta: { id?: unknown } | undefined;
      try { meta = JSON.parse(match[1]!); }
      catch (error) { throw new Error(`${file}: malformed record line ${match[0]} (${errorMessage(error)})`); }
      if (typeof meta?.id === "string") keys.add(meta.id);
    }
    return keys;
  };
  const version = (name: string) => Number(/-v(\d+)\.md$/.exec(name)?.[1] ?? 0);
  for (const slot of listModelDir(dir).sort()) {
    const candidates = join(dir, slot, "candidates");
    const names = listModelDir(candidates).filter(name => name.endsWith(".md")).sort((a, b) => version(a) - version(b));
    if (!names.length) continue;
    const pin = readJson(join(dir, slot, "pin.json")) as { candidate?: unknown } | undefined;
    const pinned = typeof pin?.candidate === "string" && names.includes(pin.candidate) ? keysOf(join(candidates, pin.candidate)) : new Set<string>();
    const proposed = new Set<string>();
    const after = typeof pin?.candidate === "string" ? names.filter(name => version(name) > version(pin.candidate as string)) : names.slice(-1);
    for (const name of after) for (const key of keysOf(join(candidates, name))) if (!pinned.has(key)) proposed.add(key);
    if (proposed.size) unapproved.set(slot, [...proposed].sort());
  }
  return unapproved;
}

function openCount(counter: OpenCounter, root: string, agents: PipelineStatus["agents"], seats: Record<string, SeatReport>): number {
  if (counter.startsWith("slots-undecided:")) return agents[counter.slice("slots-undecided:".length)]?.open ?? 0;
  if (counter === "writer-keys-unapproved") return [...writerKeysUnapproved(root).values()].reduce((sum, keys) => sum + keys.length, 0);
  if (counter === "seats-open") return Object.values(seats).filter(seat => seat.state !== "assigned").length;
  if (counter === "slots-without-slot-json") {
    const dir = join(root, "clossys", "agents");
    if (!modelExists(dir)) return 0;
    // The seat tree's ia.json places seats, which have no slot.json (slot-model FOLDER_KIND).
    return listModelDir(dir).filter(agent => (FOLDER_KIND as Readonly<Record<string, string>>)[agent] !== "seat").reduce((sum, agent) => sum + iaSlots(root, agent).filter(slot => !modelExists(join(dir, agent, slot, "slot.json"))).length, 0);
  }
  const agent = counter.slice("slots-without-candidates:".length);
  return (agents[agent]?.bySlot ?? []).filter(row => row.candidates === 0).length;
}

export function pipelineStatus(root: string, steps: readonly Step[] = STEPS, packageRoot = PACKAGE_ROOT): PipelineStatus {
  const agents = slotCounts(root);
  const seats = readSeats(root, steps);
  const graph = buildGraph(root, steps, packageRoot);
  const wiring = buildWiring(root, { graph, packageRoot });
  // Step fields are read through the graph (the step standard's normalized form), never the definitions.
  const decisions = graph.nodes.flatMap(node => node.open ? [{ step: node.id, counter: node.open, count: openCount(node.open, root, agents, seats) }] : []);
  const slots = Object.values(agents).reduce((sum, counts) => sum + counts.open, 0);
  const seatsOpen = Object.values(seats).filter(seat => seat.state !== "assigned").length;
  return {
    schema: STATUS_SCHEMA,
    steps: wiring.nodes.map(node => ({ id: node.id, step: node.step, kind: node.kind, invocation: node.invocation, state: node.state, citation: node.citation, changed: node.changed, changedCount: node.changedCount, checks: node.checks })),
    undrawn: wiring.undrawn, counts: wiring.counts, decisions, agents,
    open: slots + seatsOpen, openParts: { slots, seats: seatsOpen },
  };
}
