/**
 * `clossys ia sync`: the package IA, refreshed into a consumer (foundry-feedback-0022, SOURCE OF TRUTH).
 *
 * The package catalog owns every agent's L0-L3: nodes, groups, labels, order, layers, axes and slot
 * contracts. A consumer's ia.json and the structure fields of its slot.json files are generated
 * views of the package version it resolves, plus the extensions it declares. `syncDrift` lists every
 * difference between the two, which `sync --check` reports and fails on. `syncPlan` lists the files
 * a sync writes. Candidates, pins, ledgers and evidence are never touched, and an extension keeps
 * its own contract.
 *
 * The slot behaviour is package data too (SOURCE-MIGRATE step 4): `standard` and non-derived
 * `inputs` from the agent's src/catalog/slot-defaults.json, `options`/`varyOn` from the producer
 * option classes, and every other `inputs` derived from the read graph. A consumer's `uses` stay its
 * own: they follow the candidates it pins.
 */
import { isDeepStrictEqual } from "node:util";
import { deriveRefs, feedsIndex } from "./derive.js";
import { designerIa, directorIa, producerIa, slotPositions, writerIa, type FoundryIa, type FoundrySlot } from "./foundry-ia.js";
import { iaPath, jsonBytes, slotDir, slotFile } from "./layout.js";
import { FOUNDRY_IA_AGENTS, SLOT_AGENTS, SLOT_SCHEMA, type IaDoc, type IaLeafGroup, type IaNode, type SlotAgent, type SlotPosition } from "./types.js";
import { modelExists, readModelText } from "../slots.js";
import { classify } from "../slot-options.js";
import { OPTION_TABLE } from "./option-classes.js";

/**
 * The agents whose IA a package owns: the three catalog agents and the Producer seat tree
 * (pipeline/seats.json, step 5). The Publisher tree is synced in its own step.
 */
export const SYNC_AGENTS = [...FOUNDRY_IA_AGENTS, "producer"] as const;
export type SyncAgent = typeof SYNC_AGENTS[number];
const PACKAGE_IA: Readonly<Record<SyncAgent, () => FoundryIa>> = { director: directorIa, designer: designerIa, writer: writerIa, producer: producerIa };
/** Agents whose consumer tree `ia sync` creates when it is missing: the seat tree is package-owned whole (the catalog agents adopt first). */
const CREATED_BY_SYNC: ReadonlySet<SyncAgent> = new Set(["producer"]);

export const SYNC_KINDS = [
  "undeclared-leaf", "unadopted-leaf", "redefined", "source", "layers", "axes", "node", "group", "order", "contract", "kind", "behaviour", "position", "slot-missing",
] as const;
export type SyncKind = typeof SYNC_KINDS[number];
export interface SyncFinding { readonly agent: SyncAgent; readonly kind: SyncKind; readonly slot?: string; readonly detail: string }

type Doc = Record<string, unknown>;
const readDoc = (path: string): Doc => JSON.parse(readModelText(path)) as Doc;
const placedIds = (ia: Pick<IaDoc, "nodes">): string[] => ia.nodes.flatMap(node => node.children.flatMap(child => [...child.slots]));

/** Where each slot sits in a consumer IA: its L1 and L2 ids and labels, and the slot before it in that group. */
interface Seat {
  readonly l1: string; readonly l1Label: string; readonly l2: string; readonly l2Label: string;
  /** The slots, groups and L1 nodes before this one in the consumer IA, nearest first. */
  readonly after: readonly string[]; readonly groupsBefore: readonly string[]; readonly nodesBefore: readonly string[];
}
function seats(ia: Pick<IaDoc, "nodes">): Map<string, Seat> {
  const out = new Map<string, Seat>();
  ia.nodes.forEach((node, n) => node.children.forEach((child, g) => child.slots.forEach((slot, index) => {
    out.set(slot, {
      l1: node.id, l1Label: node.label, l2: child.id, l2Label: child.label, after: child.slots.slice(0, index).reverse(),
      groupsBefore: node.children.slice(0, g).map(group => group.id).reverse(), nodesBefore: ia.nodes.slice(0, n).map(prior => prior.id).reverse(),
    });
  })));
  return out;
}
/** Insert `item` right after the nearest of `before` that `list` holds, else first. */
function insertAfter<T extends { id: string }>(list: T[], item: T, before: readonly string[]): void {
  const prior = before.find(id => list.some(entry => entry.id === id));
  list.splice(prior === undefined ? 0 : list.findIndex(entry => entry.id === prior) + 1, 0, item);
}

/**
 * The target ia.json: the package IA with each declared extension at its consumer place (after
 * the nearest slot before it in its consumer group, or first; a group or L1 the package lacks is
 * added after the package's own), the consumer's `changes[]` history kept.
 */
export function targetIa(agent: SyncAgent, pkg: IaDoc, consumer: IaDoc | undefined): IaDoc {
  const extensions = [...(consumer?.extensions ?? [])];
  const nodes = pkg.nodes.map(node => ({ id: node.id, label: node.label, children: node.children.map(child => ({ id: child.id, label: child.label, slots: [...child.slots] })) }));
  const where = consumer ? seats(consumer) : new Map<string, Seat>();
  const packaged = new Set(placedIds(pkg));
  for (const id of extensions) {
    if (packaged.has(id)) continue;
    const seat = where.get(id);
    if (!seat) continue;
    let node = nodes.find(candidate => candidate.id === seat.l1);
    if (!node) { node = { id: seat.l1, label: seat.l1Label, children: [] }; insertAfter(nodes, node, seat.nodesBefore); }
    let group = node.children.find(candidate => candidate.id === seat.l2);
    if (!group) { group = { id: seat.l2, label: seat.l2Label, slots: [] }; insertAfter(node.children, group, seat.groupsBefore); }
    const before = seat.after.find(prior => group!.slots.includes(prior));
    group.slots.splice(before === undefined ? 0 : group.slots.indexOf(before) + 1, 0, id);
  }
  const doc: Record<string, unknown> = { schema: pkg.schema, source: pkg.source, extensions, nodes };
  if (pkg.layers !== undefined) doc.layers = pkg.layers;
  if (pkg.axes !== undefined) doc.axes = pkg.axes;
  if (consumer?.changes !== undefined) doc.changes = consumer.changes;
  return doc as unknown as IaDoc;
}

/** The structure fields a package slot's slot.json takes from the package (an extension keeps its own). */
function packageFields(slot: FoundrySlot): Doc {
  return { kind: slot.kind, contract: slot.contract };
}

/** The read-graph context a slot's refs resolve in: every placed slot id, and the Director feeds. */
export interface RefContext { readonly known: ReadonlySet<string>; readonly feeds: ReadonlyMap<string, readonly string[]> }
export function refContext(consumerDir: string, agent: SyncAgent, state: SyncState): RefContext {
  const known = knownSlots(consumerDir, agent, state);
  const feeds = feedsIndex([...(agent === "director" ? state.pkg : directorIa()).slots.values()].map(slot => [slot.id, slot.feeds] as const), known);
  return { known, feeds };
}

/** The behaviour fields the package gives one slot.json, in slot.json key order; an absent key is removed. */
export const BEHAVIOUR_KEYS = ["inputs", "options", "varyOn", "standard"] as const;
export interface SlotBehaviour { readonly inputs: string[]; readonly options?: number; readonly varyOn?: string; readonly standard?: string; readonly uses: string[]; readonly dropped: string[] }
/**
 * One package slot's behaviour: its inputs (the package's listed inputs that name a placed slot, else
 * derived from the read graph), its option class (options/varyOn when it offers more than one) and
 * its standard; `uses` is the derived default an adopted leaf starts from.
 */
export function packageBehaviour(agent: SyncAgent, id: string, slot: FoundrySlot, position: Pick<SlotPosition, "l1" | "l2">, ctx: RefContext): SlotBehaviour {
  const derived = deriveRefs(agent as SlotAgent, slot.kind, id, { inputs: slot.declaredInputs, uses: slot.declaredUses }, ctx);
  const listed = slot.defaults.inputs;
  const inputs = listed ? listed.filter(ref => ctx.known.has(ref) && ref !== id) : derived.inputs;
  // Listed inputs replace the derived ones, so only the dropped `uses` refs and the unplaced listed inputs count.
  const usesDropped = listed ? deriveRefs(agent as SlotAgent, slot.kind, id, { inputs: [], uses: slot.declaredUses }, { known: ctx.known, feeds: new Map() }).dropped : [];
  const dropped = listed ? [...new Set([...usesDropped, ...listed.filter(ref => !ctx.known.has(ref))])].sort() : derived.dropped;
  const classId = classify(agent as SlotAgent, id, `${position.l1}/${position.l2}`)?.classId;
  const klass = classId ? OPTION_TABLE.classes[classId] : undefined;
  return {
    inputs,
    ...(klass && klass.options > 1 ? { options: klass.options, ...(klass.varyOn ? { varyOn: klass.varyOn } : {}) } : {}),
    ...(slot.defaults.standard !== undefined ? { standard: slot.defaults.standard } : {}),
    uses: derived.uses, dropped,
  };
}
/** `doc` with the package behaviour applied: present keys set in place (a new key appended), absent ones removed. */
function withBehaviour(doc: Doc, behaviour: SlotBehaviour): Doc {
  const out: Doc = { ...doc };
  for (const key of BEHAVIOUR_KEYS) {
    const value = behaviour[key];
    if (value === undefined) delete out[key]; else out[key] = value;
  }
  return out;
}
/** A newly adopted package leaf's slot.json: structure, derived refs and the package behaviour. */
export function adoptedSlotDoc(agent: SyncAgent, id: string, slot: FoundrySlot, position: SlotPosition, ctx: RefContext): { doc: Doc; dropped: string[] } {
  const behaviour = packageBehaviour(agent, id, slot, position, ctx);
  const doc = withBehaviour({ schema: SLOT_SCHEMA, id, agent, ia: { ...position }, ...packageFields(slot), inputs: behaviour.inputs, uses: behaviour.uses }, behaviour);
  return { doc, dropped: behaviour.dropped };
}

export interface SyncState {
  readonly agent: SyncAgent;
  readonly pkg: FoundryIa;
  readonly consumer?: IaDoc;
  readonly target: IaDoc;
  readonly positions: ReadonlyMap<string, SlotPosition>;
  readonly undeclared: readonly string[];
}

export function syncState(consumerDir: string, agent: SyncAgent, pkg: FoundryIa = PACKAGE_IA[agent]()): SyncState {
  const file = iaPath(consumerDir, agent);
  const consumer = modelExists(file) ? readDoc(file) as unknown as IaDoc : undefined;
  const packaged = new Set(pkg.slots.keys());
  const declared = new Set(consumer?.extensions ?? []);
  const undeclared = consumer ? placedIds(consumer).filter(id => !packaged.has(id) && !declared.has(id)) : [];
  const target = targetIa(agent, pkg.ia, consumer);
  return { agent, pkg, consumer, target, positions: slotPositions(agent, target), undeclared };
}

const sameJson = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)));
const sameIa = (a: unknown, b: unknown) => sameJson(
  a && typeof a === "object" ? { ...(a as Doc), order: undefined } : a,
  b && typeof b === "object" ? { ...(b as Doc), order: undefined } : b,
);

/** Every difference between a consumer and its package IA (extensions allowed), by kind. */
export function syncDrift(consumerDir: string, agent: SyncAgent, state: SyncState = syncState(consumerDir, agent)): SyncFinding[] {
  const { pkg, consumer, target, positions } = state;
  const ctx = consumer ? refContext(consumerDir, agent, state) : undefined;
  const findings: SyncFinding[] = [];
  const add = (kind: SyncKind, detail: string, slot?: string) => findings.push({ agent, kind, ...(slot ? { slot } : {}), detail });
  if (!consumer) { add("slot-missing", `${agent} has no ia.json (${CREATED_BY_SYNC.has(agent) ? "clossys ia sync" : `clossys ia ${agent} --adopt`})`); return findings; }
  const placed = new Set(placedIds(consumer));
  for (const id of state.undeclared) add("undeclared-leaf", `${id} is placed in the consumer but is neither a package leaf nor a declared extension`, id);
  for (const id of pkg.slots.keys()) if (!placed.has(id)) add("unadopted-leaf", `${id} is a package leaf the consumer has not adopted`, id);
  for (const id of consumer.extensions ?? []) if (pkg.slots.has(id)) add("redefined", `${id} is declared as an extension but is a package leaf`, id);
  if (consumer.source !== target.source) add("source", `source ${JSON.stringify(consumer.source)} is not the package's ${JSON.stringify(target.source)}`);
  if (!sameJson(consumer.layers, target.layers)) add("layers", `layers differ from the package (${consumer.layers ? consumer.layers.map(layer => layer.id).join(", ") : "none"} vs ${target.layers ? target.layers.map(layer => layer.id).join(", ") : "none"})`);
  if (!sameJson(consumer.axes, target.axes)) add("axes", `axes differ from the package (${consumer.axes ? "declared" : "none"} vs ${target.axes ? "declared" : "none"})`);
  // Nodes and groups: the package's labels and membership, compared only for package slots.
  const mine = seats(consumer), theirs = seats(pkg.ia);
  const nodeLabel = new Map(consumer.nodes.map(node => [node.id, node.label]));
  for (const node of pkg.ia.nodes) {
    if (nodeLabel.has(node.id) && nodeLabel.get(node.id) !== node.label) add("node", `L1 ${node.id} is labelled ${JSON.stringify(nodeLabel.get(node.id))}, the package says ${JSON.stringify(node.label)}`);
  }
  const groupLabel = new Map<string, string>(consumer.nodes.flatMap(node => node.children.map(child => [`${node.id}/${child.id}`, child.label] as [string, string])));
  for (const node of pkg.ia.nodes) for (const child of node.children) {
    const key = `${node.id}/${child.id}`;
    if (groupLabel.has(key) && groupLabel.get(key) !== child.label) add("group", `L2 ${key} is labelled ${JSON.stringify(groupLabel.get(key))}, the package says ${JSON.stringify(child.label)}`);
  }
  for (const [id, seat] of theirs) {
    const at = mine.get(id);
    if (at && (at.l1 !== seat.l1 || at.l2 !== seat.l2)) add("group", `${id} sits in ${at.l1}/${at.l2}, the package places it in ${seat.l1}/${seat.l2}`, id);
  }
  const order = (ia: Pick<IaDoc, "nodes">) => placedIds(ia).filter(id => pkg.slots.has(id) && placed.has(id));
  if (!sameJson(order(consumer), order(pkg.ia))) add("order", "the package slots are not in package order");
  // slot.json: the package's kind and contract, and the position the target IA gives.
  for (const [id, position] of positions) {
    const file = slotFile(slotDir(consumerDir, agent, id));
    if (!modelExists(file)) { if (placed.has(id)) add("slot-missing", `${id} is placed but has no slot.json`, id); continue; }
    const doc = readDoc(file);
    const slot = pkg.slots.get(id);
    if (slot) {
      if (doc.kind !== slot.kind) add("kind", `${id} is kind ${String(doc.kind)}, the package says ${slot.kind}`, id);
      if (!sameJson(doc.contract, slot.contract)) add("contract", `${id} contract differs from the package`, id);
      const behaviour = packageBehaviour(agent, id, slot, position, ctx!);
      const off = BEHAVIOUR_KEYS.filter(key => !sameJson(doc[key], behaviour[key]));
      if (off.length) add("behaviour", `${id} ${off.join(", ")} differ from the package (${off.map(key => `${key} ${JSON.stringify(doc[key] ?? null)} vs ${JSON.stringify(behaviour[key] ?? null)}`).join("; ")})`, id);
    }
    if (!sameIa(doc.ia, position)) add("position", `${id} slot.json ia ${JSON.stringify(doc.ia)} is not ${JSON.stringify(position)}`, id);
  }
  return findings;
}

/** Counts per kind, in SYNC_KINDS order (the --check summary). */
export function driftCounts(findings: readonly SyncFinding[]): Partial<Record<SyncKind, number>> {
  const counts: Partial<Record<SyncKind, number>> = {};
  for (const kind of SYNC_KINDS) {
    const n = findings.filter(finding => finding.kind === kind).length;
    if (n) counts[kind] = n;
  }
  return counts;
}

/**
 * The files a sync writes: ia.json (target) and every slot.json whose structure fields differ, a
 * newly adopted leaf's slot.json with its derived refs. Undeclared leaves refuse the plan: they are
 * declared as extensions or upstreamed into the package first.
 */
export function syncPlan(consumerDir: string, agent: SyncAgent, known: ReadonlySet<string>, state: SyncState = syncState(consumerDir, agent)): { writes: [string, string][]; adopted: string[] } | { error: string } {
  if (!state.consumer && !CREATED_BY_SYNC.has(agent)) return { error: `${agent} has no ia.json: adopt the package IA first (clossys ia ${agent} --adopt)` };
  if (state.undeclared.length) return { error: `${agent} places ${state.undeclared.length} leaves that are neither package leaves nor declared extensions: ${state.undeclared.slice(0, 8).join(", ")}${state.undeclared.length > 8 ? ", ..." : ""}` };
  const writes: [string, string][] = [];
  const adopted: string[] = [];
  const iaFile = iaPath(consumerDir, agent);
  const iaBytes = jsonBytes(state.target);
  if (!modelExists(iaFile) || readModelText(iaFile) !== iaBytes) writes.push([iaFile, iaBytes]);
  const feeds = feedsIndex([...(agent === "director" ? state.pkg : directorIa()).slots.values()].map(slot => [slot.id, slot.feeds] as const), known);
  const ctx: RefContext = { known, feeds };
  for (const [id, position] of state.positions) {
    const file = slotFile(slotDir(consumerDir, agent, id));
    const slot = state.pkg.slots.get(id);
    let doc: Doc;
    if (!modelExists(file)) {
      if (!slot) continue;
      doc = adoptedSlotDoc(agent, id, slot, position, ctx).doc;
      adopted.push(id);
    } else {
      const current = readDoc(file);
      doc = { ...current, ia: { ...position }, ...(slot ? packageFields(slot) : {}) };
      if (slot) doc = withBehaviour(doc, packageBehaviour(agent, id, slot, position, ctx));
      if (sameJson(current, doc) && Object.keys(current).join() === Object.keys(doc).join()) continue;
    }
    writes.push([file, jsonBytes(doc)]);
  }
  return { writes, adopted };
}

/** The slot ids every other placed agent IA holds (refs resolve against them). */
export function knownSlots(consumerDir: string, agent: SyncAgent, state: SyncState): Set<string> {
  const known = new Set(state.positions.keys());
  for (const other of SLOT_AGENTS) if (other !== agent && modelExists(iaPath(consumerDir, other))) {
    for (const id of slotPositions(other, readDoc(iaPath(consumerDir, other)) as unknown as IaDoc).keys()) known.add(id);
  }
  return known;
}

export type { IaLeafGroup, IaNode };
