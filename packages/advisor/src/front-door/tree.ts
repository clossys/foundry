/**
 * Advisor's L0-L3 tree as data (front-door/tree.json) and the L0-L3 round over it. The round reports;
 * it never moves a node: tree moves are owner-reserved.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProducerFacts } from "./producer.js";
import { FRONT_DOOR_VERBS, LOOP_VERB } from "./verbs.js";

export interface Probe { readonly command: string; readonly args: readonly string[]; readonly minMajor?: number }
export interface SlotSpec {
  readonly label: string; readonly verb: string; readonly owner: string; readonly kind: string;
  readonly contract: { readonly record: string; readonly requirements: readonly string[] };
  readonly inputs: readonly string[];
  readonly probe?: Probe; readonly amends?: string; readonly question?: string; readonly feeds?: readonly string[];
  /** Loop slots: the loop file, and the front-door verbs it runs, in order. */
  readonly loop?: string; readonly runs?: readonly string[];
}
export interface TreeL2 { readonly id: string; readonly name: string; readonly splitBy?: string; readonly leaves: readonly string[] }
export interface TreeL1 { readonly id: string; readonly name: string; readonly question?: string; readonly splitBy?: string; readonly children: readonly TreeL2[] }
export interface TreeAxes {
  readonly L0: { readonly name: string; readonly values: readonly string[] };
  readonly L1: Readonly<Record<string, { readonly name: string; readonly values: readonly string[] }>>;
}
export interface AdvisorTree {
  readonly schemaVersion: number; readonly agent: string; readonly status: string; readonly ownerReserved: boolean;
  readonly layers: readonly { readonly id: string; readonly label: string; readonly nodes: readonly string[] }[];
  readonly axes: TreeAxes;
  /** The split rules an L1 or L2 may name in splitBy, by id. */
  readonly splitRules: Readonly<Record<string, string>>;
  readonly nodes: readonly TreeL1[];
  readonly slots: Readonly<Record<string, SlotSpec>>;
}
export interface LoopStep {
  readonly id: string; readonly cli: string; readonly checks?: readonly string[];
  readonly decider?: unknown; readonly onFail?: { readonly raise?: string; readonly then?: string };
}
export interface LoopDoc { readonly id: string; readonly status?: string; readonly extends: string | null; readonly content: { readonly trigger: readonly string[]; readonly steps: readonly LoopStep[] } & Record<string, unknown> }

export type RowStatus = "green" | "red" | "report";
export interface RoundRow { readonly id: string; readonly status: RowStatus; readonly detail: string }

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

/** Advisor's own conform.json and its declared edge file, as read from the package. */
export interface ConformFiles { readonly adapter: unknown; readonly edges: Readonly<Record<string, unknown>> }
export function loadConformFiles(packageRoot = PACKAGE_ROOT): ConformFiles {
  const adapter = readJson<{ edgeFiles?: { file?: unknown }[] }>(join(packageRoot, "conform.json"));
  const edges: Record<string, unknown> = {};
  for (const entry of adapter.edgeFiles ?? []) if (typeof entry.file === "string") edges[entry.file] = existsSync(join(packageRoot, entry.file)) ? readJson(join(packageRoot, entry.file)) : undefined;
  return { adapter, edges };
}

/** A `clossys run loop.<name>` step: the loop it starts and the trigger it hands over (--trigger, or T1 for --init). */
export function producerRun(cli: string): { loop: string; trigger: string | undefined; init: boolean } | null {
  const words = cli.trim().split(/\s+/);
  if (words[0] !== "clossys" || words[1] !== "run" || !words[2]?.startsWith("loop.")) return null;
  const at = words.indexOf("--trigger");
  const init = words.includes("--init");
  return { loop: words[2], trigger: at >= 0 ? words[at + 1] : init ? "T1" : undefined, init };
}

export function runRound(tree: AdvisorTree, loops: Readonly<Record<string, LoopDoc>>, cells: Set<string> | null, producer: ProducerFacts | null, files?: ConformFiles): RoundRow[] {
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

  // A.R3 every L1/L2 splits by a rule the tree declares, every L0 and L1 name is a declared axis value (and every
  // axis value is used); single-child or empty groups and unused rules are reported only.
  const r3: string[] = []; const r3report: string[] = [];
  const rules = tree.splitRules ?? {};
  const used = new Set<string>();
  const split = (kind: string, id: string, rule: string | undefined) => {
    if (!rule?.trim()) r3.push(`${kind} ${id} states no split rule`);
    else if (!Object.hasOwn(rules, rule) || !rules[rule]?.trim()) r3.push(`${kind} ${id} splits by ${rule}, which splitRules does not declare`);
    else used.add(rule);
  };
  for (const l1 of tree.nodes) {
    split("L1", l1.id, l1.splitBy);
    if (l1.children.length === 0) r3report.push(`L1 ${l1.id} is empty`); else if (l1.children.length === 1) r3report.push(`L1 ${l1.id} has one child`);
    for (const l2 of l1.children) {
      split("L2", l2.id, l2.splitBy);
      if (l2.leaves.length === 0) r3report.push(`L2 ${l2.id} is empty`); else if (l2.leaves.length === 1) r3report.push(`L2 ${l2.id} has one leaf`);
    }
  }
  for (const rule of Object.keys(rules)) if (!used.has(rule)) r3report.push(`split rule ${rule} is unused`);
  const l0Values = tree.axes?.L0?.values ?? [];
  const labels = tree.layers.map(layer => layer.label);
  for (const label of labels) if (!l0Values.includes(label)) r3.push(`L0 ${label} is not an L0 axis value`);
  for (const value of l0Values) if (!labels.includes(value)) r3.push(`L0 axis value ${value} has no layer`);
  for (const layer of tree.layers) {
    const axis = tree.axes?.L1?.[layer.id];
    if (!axis) { r3.push(`L0 ${layer.id} declares no L1 axis`); continue; }
    const names = layer.nodes.map(id => tree.nodes.find(l1 => l1.id === id)?.name ?? id);
    for (const name of names) if (!axis.values.includes(name)) r3.push(`L1 ${name} is not a value of the ${layer.id} axis`);
    for (const value of axis.values) if (!names.includes(value)) r3.push(`${layer.id} axis value ${value} has no L1`);
  }
  row("A.R3", r3, "every L1 and L2 splits by a declared rule and every L0/L1 is a declared axis value", r3report);

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

  // A.W1 the CLI's verbs <-> L3: every front-door verb has an L3, every L3 names a front-door verb or the loop verb.
  const w1: string[] = [];
  const treeVerbs: readonly string[] = [...FRONT_DOOR_VERBS, LOOP_VERB];
  for (const verb of treeVerbs) if (!slotsByVerb(tree, verb).length) w1.push(`verb ${verb} has no L3`);
  for (const id of leaves) { const verb = tree.slots[id]?.verb; if (!verb || !treeVerbs.includes(verb)) w1.push(`${id} names unknown verb ${verb ?? "none"}`); }
  for (const [id, slot] of slotsByVerb(tree, "doctor")) if (!slot.probe) w1.push(`${id} has no probe`);
  for (const [id, slot] of slotsByVerb(tree, "intake")) if (!slot.question?.trim() || !slot.feeds?.length) w1.push(`${id} needs a question and feeds`);
  row("A.W1", w1, `every verb (${treeVerbs.join(", ")}) has an L3 and every L3 names a verb`);

  // A.W2 each loop is a valid clossys.loop-version/1 (Producer's schema), on Producer's triggers; its advisor steps are
  // exactly the verbs its slot says it runs, in order, each checking only that verb's L3; and it reaches Producer only
  // through Producer's own loops: a `clossys run loop.<name>` step on a trigger that loop takes, or an onFail raise
  // whose `then` loop takes the failed-check trigger. extends stays null until Producer ships a loop of the same name.
  const w2: string[] = []; const w2report: string[] = [];
  if (!producer) w2.push("no built @clossys/producer reachable; loops cannot be checked against Producer's loop names, triggers and clossys.loop-version/1");
  const failedCheck = producer ? Object.entries(producer.triggerKinds).find(([, kind]) => kind === "failed-check")?.[0] : undefined;
  for (const [id, slot] of slotsByVerb(tree, LOOP_VERB)) {
    const doc = loops[id]; if (!doc) { w2.push(`${id} loop file missing`); continue; }
    if (doc.id !== `advisor/${id}`) w2.push(`${id} loop id is ${doc.id}`);
    const content = doc.content as LoopDoc["content"] | undefined;
    if (producer) for (const issue of producer.loopIssues(content)) w2.push(`${id} is not a clossys.loop-version/1: ${issue}`);
    if (!content?.trigger?.length) w2.push(`${id} has no trigger`);
    if (producer) for (const trigger of content?.trigger ?? []) if (!Object.hasOwn(producer.triggerKinds, trigger)) w2.push(`${id} trigger ${trigger} is not a Producer trigger`);
    const steps = Array.isArray(content?.steps) ? content.steps : [];
    const ran: string[] = [];
    let handoffs = 0;
    for (const step of steps) {
      const cli = typeof step?.cli === "string" ? step.cli.trim() : "";
      const words = cli.split(/\s+/);
      if (words[0] === "advisor") {
        const verb = words[1] ?? "";
        if (!(FRONT_DOOR_VERBS as readonly string[]).includes(verb)) { w2.push(`${id} step ${step.id} runs ${cli}, not a front-door verb`); continue; }
        ran.push(verb);
        for (const check of step.checks ?? []) if (tree.slots[check]?.verb !== verb) w2.push(`${id} step ${step.id} checks ${check}, which is not an L3 of ${verb}`);
      } else if (words[0] === "clossys") {
        const run = producerRun(cli);
        if (run) {
          handoffs++;
          if (producer && !producer.loopNames.includes(run.loop)) w2.push(`${id} step ${step.id} starts ${run.loop}, not a Producer loop`);
          else if (run.init && run.loop !== "loop.fill") w2.push(`${id} step ${step.id}: --init starts loop.fill only`);
          else if (run.trigger === undefined) w2.push(`${id} step ${step.id} starts ${run.loop} without naming its trigger (--trigger <Tn> or --init)`);
          else if (producer && !(producer.loopTriggers[run.loop] ?? []).includes(run.trigger)) w2.push(`${id} step ${step.id} hands ${run.trigger} to ${run.loop}, which takes ${(producer.loopTriggers[run.loop] ?? []).join(", ") || "nothing"}`);
        } else if (cli !== "clossys check") w2.push(`${id} step ${step.id} runs ${cli}; a loop step runs advisor <verb>, clossys check or clossys run loop.<name>`);
      } else w2.push(`${id} step ${step.id} runs ${cli || "nothing"}`);
      const then = step.onFail?.then;
      if (then && then !== "retry") {
        handoffs++;
        if (producer && !producer.loopNames.includes(then)) w2.push(`${id} step ${step.id} raises to ${then}, not a Producer loop`);
        else if (producer && (!failedCheck || !(producer.loopTriggers[then] ?? []).includes(failedCheck))) w2.push(`${id} step ${step.id} raises ${step.onFail?.raise ?? "nothing"} to ${then}, which does not take the failed-check trigger ${failedCheck ?? "(none)"}`);
      }
    }
    const runs = slot.runs ?? [];
    if (!runs.length) w2.push(`${id} slot names no runs`);
    else if (ran.join(" ") !== runs.join(" ")) w2.push(`${id} runs ${ran.join(", ") || "no verb"}; its slot says ${runs.join(", ")}, in that order`);
    if (handoffs === 0) w2.push(`${id} reaches no Producer loop`);
    if (doc.extends === null) w2report.push(`${id} extends no Producer loop yet`);
    else if (!producer || !producer.loopNames.map(name => `producer/${name}`).includes(doc.extends)) w2.push(`${id} extends unknown ${doc.extends}`);
  }
  row("A.W2", w2, "every loop is a clossys.loop-version/1 on Producer triggers, runs its slot's verbs in order and reaches Producer through Producer loops", w2report);

  // A.E1 intake feeds resolve to Director cells.
  if (cells === null) rows.push({ id: "A.E1", status: "report", detail: "no @clossys/director tree reachable; intake feeds not resolved" });
  else {
    const e1: string[] = [];
    for (const [id, slot] of slotsByVerb(tree, "intake")) for (const cell of slot.feeds ?? []) if (!cells.has(cell)) e1.push(`${id} feeds unknown Director cell ${cell}`);
    row("A.E1", e1, "every intake answer feeds existing Director cells");
  }

  // A.C1 conform.json is a clossys.conform-adapter/1 (Producer's own check), names this tree, and its slots edge file
  // lists exactly the intake answers and the Director cells each one feeds.
  if (files === undefined) rows.push({ id: "A.C1", status: "report", detail: "conform.json not read" });
  else {
    const c1: string[] = [];
    if (!producer) c1.push("no built @clossys/producer reachable; conform.json cannot be checked against clossys.conform-adapter/1");
    else c1.push(...producer.adapterIssues(files.adapter, "advisor"));
    const adapter = (files.adapter ?? {}) as { trees?: { file?: string }[]; edgeFiles?: { file?: string; format?: string; feedsTo?: string }[] };
    if (!(adapter.trees ?? []).some(entry => entry.file === "front-door/tree.json")) c1.push("conform.json trees does not name front-door/tree.json");
    const intake = new Map(slotsByVerb(tree, "intake").map(([id, slot]) => [id, [...(slot.feeds ?? [])].sort().join(",")]));
    const edgeFile = (adapter.edgeFiles ?? []).find(entry => entry.format === "slots" && entry.feedsTo === "director");
    const doc = edgeFile?.file ? files.edges[edgeFile.file] as { slots?: { id?: string; feeds?: string[] }[] } | undefined : undefined;
    if (!edgeFile) c1.push("conform.json declares no slots edge file feeding director");
    else if (!doc || !Array.isArray(doc.slots)) c1.push(`${edgeFile.file} is missing or has no slots array`);
    else {
      const listed = new Map(doc.slots.map(entry => [String(entry.id), [...(entry.feeds ?? [])].sort().join(",")]));
      for (const [id, feeds] of intake) if (listed.get(id) !== feeds) c1.push(`${edgeFile.file} lists ${id} feeding ${listed.get(id) ?? "nothing"}; the tree says ${feeds}`);
      for (const id of listed.keys()) if (!intake.has(id)) c1.push(`${edgeFile.file} lists ${id}, which is not an intake L3`);
    }
    row("A.C1", c1, "conform.json is a clossys.conform-adapter/1 and its edge file matches the intake feeds");
  }

  // A.S1 draft and owner-reserved status is reported, never green-washed.
  rows.push({ id: "A.S1", status: "report", detail: `tree status ${tree.status}${tree.ownerReserved ? ", owner-reserved" : ""}; no leaf freeze` });
  return rows;
}
