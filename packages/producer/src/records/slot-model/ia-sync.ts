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
 * `inputs` from the agent's `@clossys/<agent>/src/catalog/slot-defaults.json`, `options`/`varyOn` from the producer
 * option classes, and every other `inputs` derived from the read graph. A consumer's `uses` stay its
 * own: they follow the candidates it pins.
 *
 * A `clossys.slot/2` slot.json (a recut store, foundry-build-0048 U2) is compared and written in its own terms:
 * its kind family (Writer `copy` is the `strings` family), its contract without the consumer's
 * `contract.notNeeded`, the slot ids of its `input` refs (as a set: refs keep their keys and order), and the
 * slash-path `ia` the package position gives (positionIa: `themes/colors`, the position `themes.colors`). A
 * sync writes a slot/2 file as slot/2 (and adopts a missing leaf of a slot/2 store as slot/2), never as slot/1.
 * The package contract of a Director, Designer or Writer slot/2 file is the CREATE and CHOOSE seed of the
 * package's own contract (migrate/contracts.ts seededContract: its standard's requirement checks, and the copy
 * fixture a Writer contract determines), so a sync keeps that seed and a hand edit of it is drift; an adopted
 * slot/2 leaf also takes its option family.
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { deriveRefs, feedsIndex } from "./derive.js";
import { designerIa, directorIa, producerIa, slotPositions, writerIa, type FoundryIa, type FoundrySlot } from "./foundry-ia.js";
import { iaPath, jsonBytes, slotDir, slotFile } from "./layout.js";
import { resolveIaSource, WORKSPACE_OWNED_SOURCE } from "./ia-source.js";
import { packageStepIds } from "./pipeline-seats.js";
import { FOUNDRY_IA_AGENTS, SEAT_AGENT, SLOT_AGENTS, SLOT_SCHEMA, seatStepOf, type IaDoc, type IaLeafGroup, type IaNode, type SlotAgent, type SlotPosition } from "./types.js";
import { isModelDir, listModelDir, modelExists, readModelBytes, readModelText } from "../slots.js";
import { RETIRE_SCHEMA } from "../slot-write.js";
import { isCurrentSlot, refIds, slotFamily } from "../slot-current.js";
import { positionIa, serializeSlot } from "../slot.js";
import type { AgentId, Iso, Ref, Slot } from "../types.js";
import { slotFromV1, targetKind as v1TargetKind, type SlotV1 } from "../../migrate/slot-1-to-2.js";
import { classify } from "../slot-options.js";
import { OPTION_TABLE } from "./option-classes.js";
import { CONTRACT_AGENTS, familyFor, seededContract } from "../../migrate/contracts.js";
import { readStandard } from "../standards.js";
import { AGENT_LOOPS, holdsAgentLoops, isLoopAgent, withAgentLoopsIa } from "../../loop/agent-loops-ia.js";
import { consumedIds, consumedLeaves, filterFoundryIa, scopedToConsumed } from "./consumed.js";

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
  "seat-pending", "unconsumed-leaf",
] as const;
export type SyncKind = typeof SYNC_KINDS[number];
export interface SyncFinding { readonly agent: SyncAgent; readonly kind: SyncKind; readonly slot?: string; readonly detail: string }

/**
 * The finding kinds that are listed but fail neither `ia sync` nor `ia sync --check` (foundry-build-0048 CONSISTENCY
 * C1): `seat-pending` is a package seat placed in producer ia.json whose slot folder holds nothing yet, a decide step
 * that waits on a seat decision (`clossys seat <step>`), not a record that is missing. A seat folder that holds any
 * record (a pin, a candidate, a ledger) but no slot.json is `slot-missing` and fails both paths.
 */
export const PENDING_SYNC_KINDS: ReadonlySet<SyncKind> = new Set(["seat-pending", "unconsumed-leaf"]);
/**
 * `unconsumed-leaf` (CONSISTENCY D5 option 1) is a package leaf the consumer placed that no declared or seated
 * publication reaches (records/slot-model/consumed.ts). The sync neither adds nor drops it: ia.orphans judges it (it
 * fails there), and the adopt verb's own re-run (`clossys ia <agent> --adopt`) takes it out of the tree.
 */
export const unconsumedRemedy = (agent: string): string => `clossys ia ${agent} --adopt (its re-run takes unconsumed package leaves out of the tree; clossys request adopts one again)`;
export const failsSync = (finding: Pick<SyncFinding, "kind">): boolean => !PENDING_SYNC_KINDS.has(finding.kind);
/** The remedy a seat-pending finding names: the seat verb, as its usage states it (owner.ts SEAT_USAGE). */
export const seatRemedy = (step: string): string =>
  `clossys seat ${step} --by <who> ((--model <id> --tier low|mid|high | --llm-from <step>) --prompt-file <path> | --no-llm) --decided-by owner:queue.<kind>#<id>|planner[:<ref>]`;

/** Whether a slot folder holds any record file at any depth: empty folders (a refused verb's leftover) hold none. */
export const holdsRecord = (dir: string): boolean =>
  listModelDir(dir).some(name => { const path = `${dir}/${name}`; return isModelDir(path) ? holdsRecord(path) : modelExists(path); });

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
 * added after the package's own), the consumer's `changes[]` and `retired[]` history kept.
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
  // The ids a recut or `clossys retire` took out of the tree stay on record (owner.ts retire reads them).
  const retired = (consumer as { retired?: unknown } | undefined)?.retired;
  if (retired !== undefined) doc.retired = retired;
  // An agent's own loops L1 is Producer-standard, not a package leaf: the consumer that adopted it keeps it (U9a).
  if (isLoopAgent(agent) && holdsAgentLoops(agent, consumer)) return withAgentLoopsIa(agent, doc as unknown as IaDoc);
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

/**
 * The contract a package slot gives a slot/2 file: the package contract with the CREATE and CHOOSE seed
 * (contract agents only), read against the slot's standard from the installed or configured packages.
 */
function seededPackageContract(consumerDir: string, agent: SyncAgent, contract: unknown, standard: unknown): unknown {
  if (!(CONTRACT_AGENTS as readonly string[]).includes(agent) || !contract || typeof contract !== "object" || Array.isArray(contract)) return contract;
  const doc = typeof standard === "string" ? readStandard(dirname(consumerDir), agent as (typeof CONTRACT_AGENTS)[number], standard).doc : undefined;
  return seededContract(agent, contract as Record<string, unknown>, doc);
}
/** A slot/2 contract as the package sees it: without the consumer's `notNeeded` marker. */
const packageContract = (contract: unknown): unknown => {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return contract;
  const { notNeeded: _marker, ...rest } = contract as Doc;
  return rest;
};
/** A clossys.slot/2 file (a recut store), as a plain test: the doc keeps its Doc type. */
const isCurrent = (doc: Doc): boolean => isCurrentSlot(doc);
const sortedSet = (ids: readonly string[]): string[] => [...new Set(ids)].sort();
/** A slot/2 doc's behaviour keys in slot/1 terms: its input-ref slot ids (as a set), options, varyOn, standard. */
function currentBehaviour(doc: Doc): Doc {
  return { inputs: sortedSet(refIds(doc as unknown as Slot, "input")), options: doc.options, varyOn: doc.varyOn, standard: doc.standard };
}
/** The behaviour keys a slot/2 doc is compared on: the package's (inputs as a set); a package with no standard leaves the slot's own. */
function behaviourOff(doc: Doc, behaviour: SlotBehaviour): { key: string; have: unknown; want: unknown }[] {
  if (!isCurrent(doc)) return BEHAVIOUR_KEYS.filter(key => !sameJson(doc[key], behaviour[key])).map(key => ({ key, have: doc[key], want: behaviour[key] }));
  const view = currentBehaviour(doc);
  const want: Doc = { inputs: sortedSet(behaviour.inputs), options: behaviour.options, varyOn: behaviour.varyOn, standard: behaviour.standard ?? doc.standard };
  return BEHAVIOUR_KEYS.filter(key => !sameJson(view[key], want[key])).map(key => ({ key, have: view[key], want: want[key] }));
}

/**
 * Which agent holds each placed slot id in the consumer (every slot agent's ia.json, this agent's target
 * positions first): a slot/2 ref is `<agent>/<id>`.
 */
function holders(consumerDir: string, agent: SyncAgent, state: Pick<SyncState, "positions">): Map<string, AgentId[]> {
  const out = new Map<string, AgentId[]>();
  const add = (id: string, holder: AgentId) => { const list = out.get(id) ?? []; if (!list.includes(holder)) out.set(id, [...list, holder]); };
  for (const id of state.positions.keys()) add(id, agent);
  for (const other of SLOT_AGENTS) if (other !== agent && modelExists(iaPath(consumerDir, other))) {
    for (const id of slotPositions(other, readDoc(iaPath(consumerDir, other)) as unknown as IaDoc).keys()) add(id, other);
  }
  return out;
}
/**
 * The input refs a slot/2 file takes for the package behaviour's inputs, in that order: the package's own refs to
 * the id (keys kept), else the file's existing refs to it, else a new ref to the agent whose IA holds it.
 */
function inputRefs(id: string, slot: FoundrySlot, behaviour: SlotBehaviour, existing: readonly Ref[], held: ReadonlyMap<string, readonly AgentId[]>, agent: SyncAgent): Ref[] {
  const idOf = (ref: { to: string }) => ref.to.replace(/^[a-z]+\//, "");
  // The package's own input refs keep their order (the P2-1 recut writes them so); other inputs follow.
  const order = [...new Set([...(slot.refs ?? []).filter(ref => ref.rel === "input").map(idOf), ...behaviour.inputs])].filter(input => behaviour.inputs.includes(input));
  return order.flatMap(input => {
    const own = (slot.refs ?? []).filter(ref => ref.rel === "input" && idOf(ref) === input);
    if (own.length) return own.map(ref => ({ to: ref.to as Ref["to"], rel: "input" as const, ...(ref.key !== undefined ? { key: ref.key } : {}) }));
    const kept = existing.filter(ref => ref.rel === "input" && idOf(ref) === input);
    if (kept.length) return kept.map(ref => structuredClone(ref));
    const agents = held.get(input) ?? [];
    const holder = agents.includes(agent as AgentId) ? agent as AgentId : agents[0];
    return holder && input !== id ? [{ to: `${holder}/${input}` as Ref["to"], rel: "input" as const }] : [];
  });
}
/** An existing slot/2 file with the package's structure and behaviour: kind, contract (notNeeded kept), refs, ia, standard, options. */
function syncedCurrent(consumerDir: string, current: Slot, id: string, slot: FoundrySlot, position: SlotPosition, behaviour: SlotBehaviour, held: ReadonlyMap<string, readonly AgentId[]>, agent: SyncAgent): Slot {
  const marker = (current.contract as Doc | undefined)?.notNeeded;
  const seeded = seededPackageContract(consumerDir, agent, structuredClone(slot.contract), behaviour.standard ?? current.standard) as Record<string, unknown>;
  const contract: Record<string, unknown> = { ...seeded, ...(marker !== undefined ? { notNeeded: marker } : {}) };
  const inputs = inputRefs(id, slot, behaviour, current.refs, held, agent);
  const next: Slot = {
    ...current,
    kind: slot.targetKind ?? current.kind,
    ia: positionIa(id, position),
    refs: [...inputs, ...current.refs.filter(ref => ref.rel !== "input")],
    brief: { ...current.brief, inputs: structuredClone(inputs) },
    contract,
    standard: behaviour.standard ?? current.standard,
  };
  delete next.options; delete next.varyOn;
  if (behaviour.options === 1 || behaviour.options === 2 || behaviour.options === 3) next.options = behaviour.options;
  if (behaviour.varyOn !== undefined) next.varyOn = behaviour.varyOn;
  return next;
}
/** The options a slot/2 adoption stamps: when it is written and the CLI version that writes it. */
export interface CurrentSyncOptions {
  readonly at: Iso; readonly version: string; readonly cli?: string;
}
/** A newly adopted package leaf in a slot/2 store: the slot/1 adoption, as slot-1-to-2 maps it, with the package refs and kind. */
function adoptedCurrent(consumerDir: string, agent: SyncAgent, id: string, slot: FoundrySlot, position: SlotPosition, behaviour: SlotBehaviour, held: ReadonlyMap<string, readonly AgentId[]>, options: CurrentSyncOptions): Slot | undefined {
  const v1 = withBehaviour({ schema: SLOT_SCHEMA, id, agent, ia: { ...position }, ...packageFields(slot), inputs: behaviour.inputs, uses: behaviour.uses }, behaviour) as unknown as SlotV1;
  const kind = slot.targetKind ?? v1TargetKind(v1);
  if (!kind) return undefined;
  const inputs = inputRefs(id, slot, behaviour, [], held, agent);
  const uses = behaviour.uses.flatMap(use => {
    const agents = held.get(use) ?? [];
    const holder = agents.includes(agent as AgentId) ? agent as AgentId : agents[0];
    return holder ? [{ to: `${holder}/${use}` as Ref["to"], rel: "uses" as const }] : [];
  });
  const made = slotFromV1(v1, { kind, status: "starter", ia: positionIa(id, position), inputs, uses, createdBy: { actor: "code", cli: options.cli ?? "clossys ia sync", version: options.version }, at: options.at });
  if (!(CONTRACT_AGENTS as readonly string[]).includes(agent)) return made;
  const family = familyFor(agent as (typeof CONTRACT_AGENTS)[number], id, `${position.l1}/${position.l2}`);
  return { ...made, contract: seededPackageContract(consumerDir, agent, made.contract, made.standard) as Slot["contract"], ...(family ? { family } : {}) };
}
/**
 * Every package leaf of an adopted agent IA as a clossys.slot/2 file (`clossys ia <agent> --adopt`, foundry-build-0048
 * U13: the adoption writes slot/2 only). `undefined` slot means the leaf has no slot/2 kind; `dropped` are its
 * declared refs that name no slot (dangling edges the caller refuses).
 */
export function adoptedCurrentSlots(consumerDir: string, agent: SyncAgent, pkg: FoundryIa, ctx: RefContext, options: CurrentSyncOptions): { id: string; slot: Slot | undefined; dropped: string[] }[] {
  const positions = slotPositions(agent, pkg.ia);
  const held = holders(consumerDir, agent, { positions });
  return [...positions].map(([id, position]) => {
    const slot = pkg.slots.get(id)!;
    const behaviour = packageBehaviour(agent, id, slot, position, ctx);
    return { id, slot: adoptedCurrent(consumerDir, agent, id, slot, position, behaviour, held, options), dropped: behaviour.dropped };
  });
}

/** True when any slot.json the agent places is a clossys.slot/2 (a recut store): a sync then adopts as slot/2. */
export function currentStore(consumerDir: string, agent: SyncAgent, positions: ReadonlyMap<string, SlotPosition>): boolean {
  for (const id of positions.keys()) {
    const file = slotFile(slotDir(consumerDir, agent, id));
    if (!modelExists(file)) continue;
    try { if (isCurrentSlot(readDoc(file))) return true; } catch { /* judged by clossys check */ }
  }
  return false;
}

export interface SyncState {
  readonly agent: SyncAgent;
  readonly pkg: FoundryIa;
  readonly consumer?: IaDoc;
  readonly target: IaDoc;
  readonly positions: ReadonlyMap<string, SlotPosition>;
  readonly undeclared: readonly string[];
  /**
   * Placed producer seats whose step the package no longer defines (pipeline/actions.json): the sync retires each, as
   * `clossys retire --slot` does (out of ia.json with a `retired` row, its folder to `_retired/<seat>`), never deleting
   * it. A seat whose step the package still defines is never here: placed but not packaged, it stays undeclared.
   */
  readonly retiring: readonly string[];
  /** Every package leaf id, the ones `pkg` leaves out included. */
  readonly packageIds: ReadonlySet<string>;
  /** Placed package leaves no publication reaches (CONSISTENCY D5 option 1); empty when consumption is not judged. */
  readonly unconsumed: readonly string[];
}

/**
 * The sync state of one agent. With the package IA defaulted, a Designer or Writer package is scoped to the
 * leaves a publication reaches (consumed.ts) plus the package leaves the consumer already places: the sync adopts a
 * newly consumed leaf and never re-adds an unconsumed one; the Director's whole catalog is its target (scopedToConsumed).
 * `consumed` scopes a given package the same way (tests).
 */
export function syncState(consumerDir: string, agent: SyncAgent, pkg?: FoundryIa, consumed?: ReadonlySet<string>): SyncState {
  const full = pkg ?? PACKAGE_IA[agent]();
  const file = iaPath(consumerDir, agent);
  const consumer = modelExists(file) ? readDoc(file) as unknown as IaDoc : undefined;
  const packageIds = new Set(full.slots.keys());
  const packaged = new Set<string>([...packageIds, ...(isLoopAgent(agent) ? AGENT_LOOPS : [])]);
  const declared = new Set(consumer?.extensions ?? []);
  const placedNow = new Set(consumer ? placedIds(consumer) : []);
  const loose = consumer ? [...placedNow].filter(id => !packaged.has(id) && !declared.has(id)) : [];
  const steps = agent === SEAT_AGENT && loose.length ? packageStepIds() : undefined;
  const stepGone = (id: string) => { const step = seatStepOf(id); return steps !== undefined && step !== undefined && !steps.has(step); };
  const retiring = loose.filter(stepGone);
  const undeclared = loose.filter(id => !stepGone(id));
  const reach = consumed ?? (pkg === undefined && scopedToConsumed(agent) ? consumedIds(consumedLeaves(dirname(consumerDir)), agent) : undefined);
  const scoped = reach ? filterFoundryIa(full, new Set([...packageIds].filter(id => reach.has(id) || placedNow.has(id)))) : full;
  const unconsumed = reach ? [...packageIds].filter(id => placedNow.has(id) && !reach.has(id)) : [];
  const target = targetIa(agent, scoped.ia, consumer);
  return { agent, pkg: scoped, consumer, target, positions: slotPositions(agent, target), undeclared, retiring, packageIds, unconsumed };
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
  for (const id of state.retiring) add("undeclared-leaf", `${id} seats step ${seatStepOf(id)}, which the package no longer defines: clossys ia sync retires it to agents/${agent}/${RETIRED_SEATS_DIR}/${id}`, id);
  for (const id of pkg.slots.keys()) if (!placed.has(id)) add("unadopted-leaf", `${id} is a package leaf the consumer has not adopted`, id);
  for (const id of state.unconsumed) add("unconsumed-leaf", `${id} is a package leaf no declared or seated publication reaches: ${unconsumedRemedy(agent)}`, id);
  for (const id of consumer.extensions ?? []) if (state.packageIds.has(id)) add("redefined", `${id} is declared as an extension but is a package leaf`, id);
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
    const slot = pkg.slots.get(id);
    if (!modelExists(file)) {
      if (!placed.has(id)) continue;
      // A package seat whose folder holds nothing waits on its seat decision; a folder with any record lost its slot.json.
      const step = agent === "producer" && slot?.kind === "seat" ? seatStepOf(id) : undefined;
      if (step !== undefined && !holdsRecord(slotDir(consumerDir, agent, id))) add("seat-pending", `${id} waits on a seat decision: ${seatRemedy(step)}`, id);
      else add("slot-missing", `${id} is placed but has no slot.json`, id);
      continue;
    }
    const doc = readDoc(file);
    const current = isCurrent(doc);
    if (slot) {
      // A slot/2 kind is judged by its family (and the package's own slot/2 kind when it names one).
      const family = current ? slotFamily(doc.kind) : doc.kind;
      if (family !== slot.kind || (current && slot.targetKind !== undefined && doc.kind !== slot.targetKind)) add("kind", `${id} is kind ${String(doc.kind)}, the package says ${slot.targetKind && current ? slot.targetKind : slot.kind}`, id);
      const behaviour = packageBehaviour(agent, id, slot, position, ctx!);
      const want = current ? seededPackageContract(consumerDir, agent, slot.contract, behaviour.standard ?? doc.standard) : slot.contract;
      if (!sameJson(current ? packageContract(doc.contract) : doc.contract, want)) add("contract", `${id} contract differs from the package`, id);
      const off = behaviourOff(doc, behaviour);
      if (off.length) add("behaviour", `${id} ${off.map(item => item.key).join(", ")} differ from the package (${off.map(item => `${item.key} ${JSON.stringify(item.have ?? null)} vs ${JSON.stringify(item.want ?? null)}`).join("; ")})`, id);
    }
    const want = current ? positionIa(id, position) : position;
    if (!sameIa(doc.ia, want)) add("position", `${id} slot.json ia ${JSON.stringify(doc.ia)} is not ${JSON.stringify(want)}`, id);
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
/** Where a retired seat's folder goes: the `clossys retire --slot` place, a non-slot (`_`) folder of the agent. */
export const RETIRED_SEATS_DIR = "_retired";
/** Who an ia.json `retired` row of a sync-retired seat names (clossys.retire/1 `by`: migration[:<name>]). */
export const SYNC_RETIRE_BY = "migration:ia-sync";
/** A seat the sync retires: its folder moves from `from` to `to` (agents/producer/_retired/<seat>), whole. */
export interface SeatRetire { readonly id: string; readonly from: string; readonly to: string }

/**
 * The ia.json `retired` rows of the seats the sync retires (one clossys.retire/1 row each, as `clossys retire --slot`
 * writes: the seat, its slot.json sha256 or null, who, a not-needed reason naming the step, and when), and the folder
 * moves. A seat already on record, or whose `_retired/<seat>` place is taken, refuses the plan.
 */
function seatRetires(consumerDir: string, state: SyncState, at: string): { rows: Record<string, unknown>[]; moves: SeatRetire[] } | { error: string } {
  const history = Array.isArray((state.consumer as { retired?: unknown } | undefined)?.retired) ? (state.consumer as unknown as { retired: unknown[] }).retired : [];
  const recorded = new Set(history.flatMap(row => (row && typeof row === "object" && typeof (row as { slot?: unknown }).slot === "string" ? [(row as { slot: string }).slot] : [])));
  const rows: Record<string, unknown>[] = [], moves: SeatRetire[] = [];
  for (const id of state.retiring) {
    const slot = `${state.agent}/${id}`;
    const from = slotDir(consumerDir, state.agent, id), to = join(consumerDir, "agents", state.agent, RETIRED_SEATS_DIR, id);
    if (recorded.has(slot)) return { error: `${slot} is placed again but ia.json already records it retired` };
    if (modelExists(to)) return { error: `agents/${state.agent}/${RETIRED_SEATS_DIR}/${id} exists; ${slot} was retired before` };
    const file = slotFile(from);
    const sha256 = modelExists(file) ? createHash("sha256").update(readModelBytes(file)).digest("hex") : null;
    rows.push({ schema: RETIRE_SCHEMA, slot, sha256, by: SYNC_RETIRE_BY, reason: `not-needed: ia sync, the package defines no step ${seatStepOf(id)}`, at });
    if (isModelDir(from)) moves.push({ id, from, to });
  }
  return { rows, moves };
}

export function syncPlan(consumerDir: string, agent: SyncAgent, known: ReadonlySet<string>, state: SyncState = syncState(consumerDir, agent), options?: CurrentSyncOptions): { writes: [string, string][]; adopted: string[]; retired: SeatRetire[] } | { error: string } {
  if (!state.consumer && !CREATED_BY_SYNC.has(agent)) return { error: `${agent} has no ia.json: adopt the package IA first (clossys ia ${agent} --adopt)` };
  if (state.undeclared.length) return { error: `${agent} places ${state.undeclared.length} leaves that are neither package leaves nor declared extensions: ${state.undeclared.slice(0, 8).join(", ")}${state.undeclared.length > 8 ? ", ..." : ""}` };
  const writes: [string, string][] = [];
  const adopted: string[] = [];
  const iaFile = iaPath(consumerDir, agent);
  // A seat of a step the package no longer defines leaves ia.json with a `retired` row; its folder moves, whole.
  const retires = state.retiring.length ? seatRetires(consumerDir, state, options?.at ?? new Date().toISOString()) : { rows: [], moves: [] };
  if ("error" in retires) return { error: retires.error };
  const target = retires.rows.length ? { ...state.target, retired: [...((state.target as { retired?: unknown[] }).retired ?? []), ...retires.rows] } : state.target;
  const iaBytes = jsonBytes(target);
  if (!modelExists(iaFile) || readModelText(iaFile) !== iaBytes) writes.push([iaFile, iaBytes]);
  const feeds = feedsIndex([...(agent === "director" ? state.pkg : directorIa()).slots.values()].map(slot => [slot.id, slot.feeds] as const), known);
  const ctx: RefContext = { known, feeds };
  let held: Map<string, AgentId[]> | undefined;
  const holderMap = () => held ??= holders(consumerDir, agent, state);
  for (const [id, position] of state.positions) {
    const file = slotFile(slotDir(consumerDir, agent, id));
    const slot = state.pkg.slots.get(id);
    let bytes: string;
    if (!modelExists(file)) {
      if (!slot) continue;
      // A newly adopted leaf whose declared refs name no slot carries a dangling edge: refuse, never leave it out.
      const dropped = packageBehaviour(agent, id, slot, position, ctx).dropped;
      if (dropped.length) return { error: `${agent}/${id}: declared refs name no slot (dangling edges): ${dropped.join(", ")}` };
      // U13 one format: a newly adopted leaf is always written as clossys.slot/2, whatever the store holds.
      const made = adoptedCurrent(consumerDir, agent, id, slot, position, packageBehaviour(agent, id, slot, position, ctx), holderMap(), options ?? { at: new Date().toISOString() as Iso, version: "0.0.0" });
      if (!made) continue;
      bytes = serializeSlot(made);
      adopted.push(id);
    } else {
      const text = readModelText(file);
      const current = JSON.parse(text) as Doc;
      if (isCurrentSlot(current)) {
        const doc = current as unknown as Slot;
        bytes = slot ? serializeSlot(syncedCurrent(consumerDir, doc, id, slot, position, packageBehaviour(agent, id, slot, position, ctx), holderMap(), agent)) : serializeSlot({ ...doc, ia: positionIa(id, position) });
      } else {
        let doc: Doc = { ...current, ia: { ...position }, ...(slot ? packageFields(slot) : {}) };
        if (slot) doc = withBehaviour(doc, packageBehaviour(agent, id, slot, position, ctx));
        if (sameJson(current, doc) && Object.keys(current).join() === Object.keys(doc).join()) continue;
        bytes = jsonBytes(doc);
      }
      if (bytes === text) continue;
    }
    writes.push([file, bytes]);
  }
  return { writes, adopted, retired: retires.moves };
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

/** The agents whose IA the workspace owns (`ia <agent> --start`): every slot agent the sync does not write from a package. */
export const WORKSPACE_IA_AGENTS = SLOT_AGENTS.filter(agent => !(SYNC_AGENTS as readonly string[]).includes(agent));

/**
 * A workspace-owned IA whose `source` does not resolve (SOURCE-MIGRATE step 6: the Publisher's
 * source named its retired tree file, which no longer exists). The sync repoints it to
 * `workspace#owner`; nothing else in the file changes.
 */
export function workspaceSourceRepairs(consumer: string): { agent: SlotAgent; detail: string; path: string; bytes: string }[] {
  const out: { agent: SlotAgent; detail: string; path: string; bytes: string }[] = [];
  for (const agent of WORKSPACE_IA_AGENTS) {
    const path = iaPath(consumer, agent);
    if (!modelExists(path)) continue;
    const doc = readDoc(path);
    const resolution = resolveIaSource(doc.source);
    if (resolution.ok) continue;
    out.push({ agent, path, detail: `source ${JSON.stringify(doc.source)} does not resolve (${resolution.reason}); a workspace-owned IA is ${JSON.stringify(WORKSPACE_OWNED_SOURCE)}`, bytes: jsonBytes({ ...doc, source: WORKSPACE_OWNED_SOURCE }) });
  }
  return out;
}

/** The one verdict `ia sync` and `ia sync --check` give (CONSISTENCY C1): every finding, and the ones that fail. */
export interface SyncVerdict {
  readonly findings: readonly SyncFinding[];
  readonly repairs: readonly { agent: SlotAgent; detail: string; path: string; bytes: string }[];
  /** The findings that fail (every kind but PENDING_SYNC_KINDS); a workspace source repair always fails. */
  readonly failing: readonly SyncFinding[];
  readonly pending: readonly SyncFinding[];
  readonly exitCode: 0 | 1;
}
/**
 * The one finding function both `ia sync` paths call: the drift of each agent (syncDrift), the workspace source repairs
 * when every agent is synced, and one exit code. `--check` reports it as read; the write reports it after its writes.
 */
export function syncVerdict(consumerDir: string, agents: readonly SyncAgent[], workspace: boolean): SyncVerdict {
  const findings = agents.flatMap(agent => syncDrift(consumerDir, agent));
  const repairs = workspace ? workspaceSourceRepairs(consumerDir) : [];
  const failing = findings.filter(failsSync);
  const pending = findings.filter(finding => !failsSync(finding));
  return { findings, repairs, failing, pending, exitCode: failing.length || repairs.length ? 1 : 0 };
}
