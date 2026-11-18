/**
 * Advisor's L0-L3 tree as data (front-door/tree.json) and the L0-L3 round over it. The round reports;
 * it never moves a node: tree moves are owner-reserved.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Probe { readonly command: string; readonly args: readonly string[]; readonly minMajor?: number }
export interface SlotSpec {
  readonly label: string; readonly verb: string; readonly owner: string; readonly kind: string;
  readonly contract: { readonly record: string; readonly requirements: readonly string[] };
  readonly inputs: readonly string[];
  readonly probe?: Probe; readonly amends?: string; readonly question?: string; readonly feeds?: readonly string[]; readonly loop?: string;
}
export interface TreeL2 { readonly id: string; readonly name: string; readonly splitBy?: string; readonly leaves: readonly string[] }
export interface TreeL1 { readonly id: string; readonly name: string; readonly question?: string; readonly splitBy?: string; readonly children: readonly TreeL2[] }
export interface AdvisorTree {
  readonly schemaVersion: number; readonly agent: string; readonly status: string; readonly ownerReserved: boolean;
  readonly layers: readonly { readonly id: string; readonly label: string; readonly nodes: readonly string[] }[];
  readonly nodes: readonly TreeL1[];
  readonly slots: Readonly<Record<string, SlotSpec>>;
}
export interface LoopStep { readonly id: string; readonly cli: string; readonly checks?: readonly string[] }
export interface LoopDoc { readonly id: string; readonly status?: string; readonly extends: string | null; readonly content: { readonly trigger: readonly string[]; readonly steps: readonly LoopStep[]; readonly handoff?: string } }

export type RowStatus = "green" | "red" | "report";
export interface RoundRow { readonly id: string; readonly status: RowStatus; readonly detail: string }

/** The front-door verbs. Every verb maps to at least one L3, and every L3 names one of these. */
export const VERBS = ["doctor", "install", "init", "intake", "update", "relations", "loop"] as const;
export const TRIGGERS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"] as const;
export const PRODUCER_LOOPS = ["producer/loop.fill", "producer/loop.refine", "producer/loop.create", "producer/loop.choose", "producer/loop.release", "producer/loop.audit", "producer/loop.cascade"] as const;

/** packages/advisor, from dist/front-door or src/front-door. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function readJson<T>(file: string): T { return JSON.parse(readFileSync(file, "utf8")) as T; }
export function loadTree(packageRoot = PACKAGE_ROOT): AdvisorTree { return readJson<AdvisorTree>(join(packageRoot, "front-door", "tree.json")); }
export function loadLoops(tree: AdvisorTree, packageRoot = PACKAGE_ROOT): Record<string, LoopDoc> {
  const loops: Record<string, LoopDoc> = {};
  for (const [id, slot] of Object.entries(tree.slots)) if (slot.loop) loops[id] = readJson<LoopDoc>(join(packageRoot, slot.loop));
  return loops;
}

export function leavesOf(tree: AdvisorTree): string[] { return tree.nodes.flatMap(l1 => l1.children.flatMap(l2 => l2.leaves)); }
export function slotsByVerb(tree: AdvisorTree, verb: string): [string, SlotSpec][] {
  return leavesOf(tree).flatMap(id => { const slot = tree.slots[id]; return slot && slot.verb === verb ? [[id, slot] as [string, SlotSpec]] : []; });
}

/** Director cell ids from an installed or sibling @clossys/director, or null when none is reachable. */
export function directorCells(searchFrom: readonly string[]): Set<string> | null {
  for (const base of searchFrom) {
    const file = join(base, "src", "catalog", "ia", "strategy.json");
    if (existsSync(file)) return new Set(Object.keys(readJson<{ slots?: Record<string, unknown> }>(file).slots ?? {}));
  }
  return null;
}

export function runRound(tree: AdvisorTree, loops: Readonly<Record<string, LoopDoc>>, cells: Set<string> | null): RoundRow[] {
  const rows: RoundRow[] = [];
  const row = (id: string, problems: readonly string[], good: string, reports: readonly string[] = []) => {
    if (problems.length) rows.push({ id, status: "red", detail: problems.join("; ") });
    else if (reports.length) rows.push({ id, status: "report", detail: `${good}; reported: ${reports.join("; ")}` });
    else rows.push({ id, status: "green", detail: good });
  };
  const leaves = leavesOf(tree);
  const slotIds = Object.keys(tree.slots);

  // A.R1 every L3 placed exactly once, every leaf has a slot, every L1 sits in exactly one L0.
  const r1: string[] = [];
  const seen = new Map<string, number>();
  for (const leaf of leaves) seen.set(leaf, (seen.get(leaf) ?? 0) + 1);
  for (const [leaf, count] of seen) if (count > 1) r1.push(`${leaf} placed ${count} times`);
  for (const leaf of leaves) if (!tree.slots[leaf]) r1.push(`${leaf} has no slot`);
  for (const id of slotIds) if (!seen.has(id)) r1.push(`slot ${id} is not placed`);
  const l1InLayers = tree.layers.flatMap(layer => layer.nodes);
  for (const l1 of tree.nodes) { const count = l1InLayers.filter(id => id === l1.id).length; if (count !== 1) r1.push(`L1 ${l1.id} sits in ${count} L0 layers`); }
  for (const id of l1InLayers) if (!tree.nodes.some(l1 => l1.id === id)) r1.push(`L0 names missing L1 ${id}`);
  for (const l1 of tree.nodes) for (const l2 of l1.children) {
    if (!l2.id.startsWith(`${l1.id}.`)) r1.push(`L2 ${l2.id} is not under ${l1.id}`);
    for (const leaf of l2.leaves) if (!leaf.startsWith(`${l1.id}.`)) r1.push(`L3 ${leaf} is not under ${l1.id}`);
  }
  row("A.R1", r1, `${leaves.length} L3 placed once`);

  // A.R2 no overlap: no two L3 write the same record, and no Director cell is fed by two answers.
  const r2: string[] = [];
  const records = new Map<string, string>();
  for (const id of leaves) {
    const slot = tree.slots[id]; if (!slot) continue;
    const record = slot.contract?.record;
    if (record && !record.startsWith("stdout:")) {
      const other = records.get(record);
      if (!other) records.set(record, id);
      else if (slot.amends !== other) r2.push(`${id} and ${other} both write ${record}`);
    }
  }
  const fed = new Map<string, string>();
  for (const [id, slot] of slotsByVerb(tree, "intake")) for (const cell of slot.feeds ?? []) { const other = fed.get(cell); if (other) r2.push(`${cell} fed by ${id} and ${other}`); else fed.set(cell, id); }
  row("A.R2", r2, "no two L3 overlap");

  // A.R3 every L1/L2 splits by its own stated rule; single-child or empty groups are reported only.
  const r3: string[] = []; const r3report: string[] = [];
  for (const l1 of tree.nodes) {
    if (!l1.splitBy?.trim()) r3.push(`L1 ${l1.id} states no split rule`);
    if (l1.children.length === 0) r3report.push(`L1 ${l1.id} is empty`); else if (l1.children.length === 1) r3report.push(`L1 ${l1.id} has one child`);
    for (const l2 of l1.children) {
      if (!l2.splitBy?.trim()) r3.push(`L2 ${l2.id} states no split rule`);
      if (l2.leaves.length === 0) r3report.push(`L2 ${l2.id} is empty`); else if (l2.leaves.length === 1) r3report.push(`L2 ${l2.id} has one leaf`);
    }
  }
  row("A.R3", r3, "every L1 and L2 states its split rule", r3report);

  // A.R4 every L3 has a contract, an owner and inputs that resolve.
  const r4: string[] = [];
  for (const id of leaves) {
    const slot = tree.slots[id]; if (!slot) continue;
    if (slot.owner !== "advisor") r4.push(`${id} owner is ${slot.owner || "missing"}`);
    if (!slot.contract?.record || !slot.contract.requirements?.length) r4.push(`${id} has no contract`);
    if (!slot.inputs?.length) r4.push(`${id} has no inputs`);
    for (const input of slot.inputs ?? []) {
      if (input.startsWith("advisor/")) { if (!tree.slots[input.slice("advisor/".length)]) r4.push(`${id} input ${input} does not resolve`); }
      else if (!/^(host|owner):[a-z][a-z-]*$/.test(input)) r4.push(`${id} input ${input} is not advisor/<id>, host:<x> or owner:<x>`);
    }
  }
  row("A.R4", r4, "every L3 has a contract, owner advisor and resolving inputs");

  // A.W1 verbs <-> L3.
  const w1: string[] = [];
  for (const verb of VERBS) if (!slotsByVerb(tree, verb).length) w1.push(`verb ${verb} has no L3`);
  for (const id of leaves) { const verb = tree.slots[id]?.verb; if (verb && !(VERBS as readonly string[]).includes(verb)) w1.push(`${id} names unknown verb ${verb}`); }
  for (const [id, slot] of slotsByVerb(tree, "doctor")) if (!slot.probe) w1.push(`${id} has no probe`);
  for (const [id, slot] of slotsByVerb(tree, "intake")) if (!slot.question?.trim() || !slot.feeds?.length) w1.push(`${id} needs a question and feeds`);
  row("A.W1", w1, `every verb (${VERBS.join(", ")}) has an L3 and every L3 names a verb`);

  // A.W2 loops use real verbs, known triggers, real checks and a Producer handoff; extends stays null until Producer ships a loop to extend.
  const w2: string[] = []; const w2report: string[] = [];
  for (const [id, slot] of slotsByVerb(tree, "loop")) {
    const doc = loops[id]; if (!doc) { w2.push(`${id} loop file missing`); continue; }
    if (doc.id !== `advisor/${id}`) w2.push(`${id} loop id is ${doc.id}`);
    if (!doc.content?.trigger?.length) w2.push(`${id} has no trigger`);
    for (const trigger of doc.content?.trigger ?? []) if (!(TRIGGERS as readonly string[]).includes(trigger)) w2.push(`${id} trigger ${trigger} unknown`);
    for (const step of doc.content?.steps ?? []) {
      const verb = /^advisor ([a-z]+)/.exec(step.cli)?.[1];
      if (!verb || verb === "loop" || !(VERBS as readonly string[]).includes(verb)) w2.push(`${id} step ${step.id} runs ${step.cli}`);
      for (const check of step.checks ?? []) if (!tree.slots[check]) w2.push(`${id} step ${step.id} checks unknown ${check}`);
    }
    const handoff = doc.content?.handoff;
    if (!handoff || !(PRODUCER_LOOPS as readonly string[]).includes(handoff)) w2.push(`${id} hands off to ${handoff ?? "nothing"}`);
    if (doc.extends === null) w2report.push(`${id} extends no Producer loop yet`);
    else if (!(PRODUCER_LOOPS as readonly string[]).includes(doc.extends)) w2.push(`${id} extends unknown ${doc.extends}`);
  }
  row("A.W2", w2, "every loop runs front-door verbs on known triggers and hands off to a Producer loop", w2report);

  // A.E1 intake feeds resolve to Director cells.
  if (cells === null) rows.push({ id: "A.E1", status: "report", detail: "no @clossys/director tree reachable; intake feeds not resolved" });
  else {
    const e1: string[] = [];
    for (const [id, slot] of slotsByVerb(tree, "intake")) for (const cell of slot.feeds ?? []) if (!cells.has(cell)) e1.push(`${id} feeds unknown Director cell ${cell}`);
    row("A.E1", e1, "every intake answer feeds existing Director cells");
  }

  // A.S1 draft and owner-reserved status is reported, never green-washed.
  rows.push({ id: "A.S1", status: "report", detail: `tree status ${tree.status}${tree.ownerReserved ? ", owner-reserved" : ""}; no leaf freeze` });
  return rows;
}
