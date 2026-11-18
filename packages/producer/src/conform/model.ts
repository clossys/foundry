/**
 * The conformance model (foundry-build-0048 U1): every fact the conformance assertions judge, read once from
 * disk. An agent's package declares its side in `packages/<agent>/conform.json` (adapter.schema.json): its
 * package trees and freezes, held kinds, recipes and their fixtures, derive modules, edge files and the
 * five loop skills. The placed side is a consumer folder (`agents/<agent>/`), by default the producer's
 * test fixture. Reading is all this file does; assertions.ts judges and run.ts reports.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { AGENT_LOOPS, AGENT_LOOPS_DIR, readAgentLoopPin, type AgentLoopName } from "../loop/agent-loops.js";
import { loopStem } from "../loop/names.js";
import { validateValue, type JsonSchema } from "../pipeline/schema.js";
import { loadStandards, type Standard } from "../records/standards.js";

export const CONFORM_AGENTS = ["director", "designer", "writer", "publisher"] as const;
export type ConformAgent = (typeof CONFORM_AGENTS)[number];
export const LOOPS = ["scope", "slot", "create", "choose", "cascade"] as const;
export type LoopName = (typeof LOOPS)[number];
export const ADAPTER_SCHEMA = "clossys.conform-adapter/1";

export interface Adapter {
  readonly schema: typeof ADAPTER_SCHEMA;
  readonly agent: ConformAgent;
  /** `amendments`: the package's separate amendment files to its freeze (owner-signed additions on the freeze's signed head). */
  readonly trees: readonly { readonly file: string; readonly freeze: string | null; readonly amendments?: readonly string[] }[];
  readonly kinds: readonly string[];
  readonly defaults: readonly string[];
  readonly recipes: readonly { readonly dir: string; readonly fixture?: { readonly output: string; readonly slot: string } }[];
  readonly derive: readonly { readonly module: string }[];
  readonly edgeFiles: readonly EdgeFile[];
  /** The agent's own loop slots it pins (foundry-build-0048 U9a), each extending Producer's standard loop of that name. */
  readonly loops?: readonly string[];
  readonly skill: string;
  readonly skills: Readonly<Record<LoopName, string | null>>;
}

/** A version read as the conformance assertions judge it: its `content`, or why it could not be read. */
export type LoopRead = { readonly ok: true; readonly ref: string; readonly content: unknown } | { readonly ok: false; readonly reason: string };

/**
 * One of the agent's own loops (foundry-build-0048 U9a): whether conform.json declares it, the agent's package
 * candidate (`packages/<agent>/loops/<loop>/<stem>-v1.json`) and, where the consumer holds the loop slot, its pin.
 */
export interface OwnLoop {
  readonly loop: AgentLoopName;
  readonly declared: boolean;
  readonly package: LoopRead;
  /** The consumer holds the loop slot (`agents/<agent>/<loop>/slot.json`). */
  readonly placed: boolean;
  /** The consumer's pinned version, when the slot is placed: an error when it is unpinned or the pin does not resolve. */
  readonly pin?: LoopRead;
}

/** A package file of declared edges (adapter.schema.json edgeFiles). */
export interface EdgeFile { readonly file: string; readonly format: "slots" | "slot-contracts" | "usage-graph"; readonly feedsTo?: ConformAgent }

/**
 * One dependency edge. `target` is the agent a bare `to` resolves against (else the source agent and its
 * upstream agents, never just any agent); `scope` package edges resolve in package trees only, placed edges
 * also in the consumer's placed slots.
 */
export interface Edge { readonly from: string; readonly to: string; readonly target?: string; readonly scope: "package" | "placed" }

export interface TreeL2 { readonly id: string; readonly parked: boolean; readonly leaves: readonly string[] }
export interface TreeL1 { readonly id: string; readonly parked: boolean; readonly l2: readonly TreeL2[] }
export interface PackageTree {
  readonly file: string;
  readonly l1: readonly TreeL1[];
  /** Leaves the tree places and freezes but defines no slot for yet (a Writer `awaiting` row): not leaves to place. */
  readonly awaiting?: readonly string[];
  /** Per-leaf slot data the tree file carries (Writer arrays, Director/Publisher maps). */
  readonly slots: Readonly<Record<string, Record<string, unknown>>>;
  readonly freeze: { readonly file: string; readonly exists: boolean; readonly ids: readonly string[] } | null;
}

/** One live slot as the assertions see it: placed (consumer slot.json) or, with nothing placed, the package's tree data. */
export interface LiveSlot {
  readonly id: string;
  readonly source: "placed" | "package";
  readonly schema?: string;
  readonly kind?: string;
  readonly contract: Record<string, unknown>;
  readonly inputs: readonly string[];
  readonly uses: readonly string[];
  readonly standard?: string;
  readonly family?: unknown;
  readonly folder?: string;
  readonly ledger: readonly Record<string, unknown>[];
  readonly pin?: Record<string, unknown>;
  /** U9 (S6): the agent and id the slot record names (a package leaf: its tree's agent and its own id). */
  readonly owner?: string;
  readonly recordId?: string;
  /** U9 (S6): the record lists its inputs (slot/2 `refs`, slot/1 `inputs`, a package leaf `inputs` or `refs`), empty or not. */
  readonly inputsDeclared?: boolean;
}

export interface AgentModel {
  readonly agent: ConformAgent;
  readonly packageDir: string;
  readonly adapter?: Adapter;
  readonly adapterIssues: readonly string[];
  readonly trees: readonly PackageTree[];
  /** The consumer's ia.json tree: L1 > L2 > slot ids. */
  readonly placedTree: readonly { readonly id: string; readonly l2: readonly { readonly id: string; readonly slots: readonly string[] }[] }[];
  /** Slot folders under the consumer's `agents/<agent>/`. */
  readonly folders: readonly string[];
  readonly live: readonly LiveSlot[];
  /** Package-tree leaves the consumer has not placed, from the tree's own slot data (S4 judges both trees together). */
  readonly packageOnly: readonly LiveSlot[];
  /** The L2 each placed or package leaf sits under (`<l1>/<l2>`). */
  readonly l2Of: ReadonlyMap<string, string>;
  readonly defaults: ReadonlySet<string>;
  readonly standards: readonly Standard[];
  readonly recipes: readonly { readonly dir: string; readonly exists: boolean; readonly fixture?: { readonly output: string; readonly slot: string; readonly value?: unknown } }[];
  readonly derive: readonly { readonly module: string; readonly text?: string }[];
  readonly hasDeriveDir: boolean;
  readonly edges: readonly Edge[];
  readonly actions: readonly { readonly id: string; readonly reads: readonly string[] }[];
  readonly skillText?: string;
  readonly skills: readonly { readonly loop: LoopName; readonly path: string | null; readonly exists: boolean; readonly registered: boolean }[];
  /** The agent's own five loops, declared or not; declared ones are judged by W2, not as catalog slots. */
  readonly loops: readonly OwnLoop[];
  readonly requests: readonly Record<string, unknown>[];
}

export interface RuleState { readonly status: string; readonly enforcedFor: readonly string[] }
export interface Machinery {
  readonly rules: ReadonlyMap<string, RuleState>;
  readonly loops: ReadonlyMap<string, { readonly steps: readonly Record<string, unknown>[] } | undefined>;
  readonly slotRequestSchema: boolean;
  readonly certifiers: ReadonlySet<string>;
  readonly contractSchemas: ReadonlyMap<string, JsonSchema | undefined>;
  readonly criteria: ReadonlySet<string>;
}

export interface ConformModel {
  readonly repo: string;
  readonly consumer: string;
  readonly agents: readonly AgentModel[];
  readonly machinery: Machinery;
  /** Every live id per agent (placed, or the package tree when nothing is placed), for placed-edge resolution. */
  readonly liveIds: ReadonlyMap<string, ReadonlySet<string>>;
  /** Every package-tree leaf per agent (the producer: its placed seats), for package-edge resolution. */
  readonly packageIds: ReadonlyMap<string, ReadonlySet<string>>;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Slot-contract input kinds that name another slot. */
const SLOT_INPUT_KINDS = new Set(["theme", "asset", "component", "section", "frame"]);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const dirs = (path: string): string[] => existsSync(path) ? readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()).sort() : [];
function json(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}
const text = (path: string): string | undefined => existsSync(path) ? readFileSync(path, "utf8") : undefined;

/** The agents upstream of one, in pipeline order: a bare id resolves against the agent itself and these only. */
export const upstreamOf = (agent: string): string[] => {
  const at = (CONFORM_AGENTS as readonly string[]).indexOf(agent);
  return at < 0 ? [] : CONFORM_AGENTS.slice(0, at);
};

/** A package leaf's own slot data as a slot: `inputs` as ids or `{to}` rows, the contract nested or flat. */
function packageSlot(id: string, data: Record<string, unknown>, agent: string): LiveSlot {
  const contract = object(data.contract) ? data.contract : data;
  return {
    id, source: "package", owner: agent, recordId: id, inputsDeclared: Array.isArray(data.inputs) || Array.isArray(data.refs), ...(typeof data.kind === "string" ? { kind: data.kind } : {}), contract,
    inputs: strings(data.inputs).concat((Array.isArray(data.inputs) ? data.inputs : []).filter(object).map(item => String(item.to))),
    uses: strings(data.uses), ...(typeof data.standard === "string" ? { standard: data.standard } : {}),
    ...(data.family !== undefined ? { family: data.family } : {}), ledger: [],
  };
}

/** Every path an adapter declares that does not exist: an adapter naming a missing file is invalid, never an empty set. */
export function missingPaths(adapter: Adapter, repo: string, packageDir: string): string[] {
  const at = (path: string) => existsSync(join(packageDir, path));
  const declared: [string, boolean][] = [
    ...adapter.trees.flatMap(tree => [[tree.file, at(tree.file)], ...(tree.freeze ? [[tree.freeze, at(tree.freeze)] as [string, boolean]] : []), ...(tree.amendments ?? []).map(file => [file, at(file)] as [string, boolean])] as [string, boolean][]),
    ...adapter.defaults.map(dir => [dir, at(dir)] as [string, boolean]),
    ...adapter.recipes.flatMap(recipe => [[recipe.dir, at(recipe.dir)], ...(recipe.fixture ? [[recipe.fixture.output, at(recipe.fixture.output)] as [string, boolean]] : [])] as [string, boolean][]),
    ...adapter.derive.map(entry => [entry.module, at(entry.module)] as [string, boolean]),
    ...adapter.edgeFiles.map(entry => [entry.file, at(entry.file)] as [string, boolean]),
    [adapter.skill, at(adapter.skill)],
    ...Object.values(adapter.skills).filter((path): path is string => path !== null).map(path => [path, existsSync(join(repo, path))] as [string, boolean]),
  ];
  return declared.filter(([, exists]) => !exists).map(([path]) => `conform.json declares ${path}, which does not exist`);
}

/** An agent-qualified slot ref (`designer/sections.hero`, or the `director:focus.segment.core` form). */
export const SLOT_REF = /^(director|designer|writer|publisher|producer)[/:]([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})$/;

const ADAPTER_JSON_SCHEMA = JSON.parse(readFileSync(new URL("../../src/conform/adapter.schema.json", import.meta.url), "utf8")) as JsonSchema;

/** Issues with a conform.json value, against adapter.schema.json and the agent it is read for. */
export function adapterIssues(value: unknown, agent: string): string[] {
  const issues = validateValue(value, ADAPTER_JSON_SCHEMA).map(issue => `conform.json${issue.path === "/" ? "" : issue.path} ${issue.message}`);
  if (object(value) && value.agent !== agent) issues.push(`conform.json agent must be ${agent}`);
  return issues;
}

/** A package tree file in any of the four agents' formats: nodes > children > leaves, `parked` honoured. */
export function readTree(file: string, value: unknown): Omit<PackageTree, "freeze"> {
  const doc = object(value) ? value : {};
  const prefix = typeof doc.layer === "string" ? `${doc.layer}.` : "";
  const l1 = (Array.isArray(doc.nodes) ? doc.nodes : []).filter(object).map(node => ({
    id: `${prefix}${String(node.id)}`,
    parked: node.parked === true,
    l2: (Array.isArray(node.children) ? node.children : []).filter(object).map(child => ({ id: String(child.id), parked: child.parked === true, leaves: strings(child.leaves) })),
  }));
  const slots: Record<string, Record<string, unknown>> = {};
  if (Array.isArray(doc.slots)) for (const slot of doc.slots.filter(object)) if (typeof slot.id === "string") slots[slot.id] = slot;
  if (object(doc.slots)) for (const [id, slot] of Object.entries(doc.slots)) if (object(slot)) slots[id] = slot;
  const awaiting = (Array.isArray(doc.awaiting) ? doc.awaiting : []).filter(object).map(row => row.id).filter((id): id is string => typeof id === "string");
  return { file, l1, slots, awaiting };
}

/** The non-parked leaves of a tree. */
export const treeLeaves = (tree: Pick<PackageTree, "l1">): string[] =>
  tree.l1.filter(l1 => !l1.parked).flatMap(l1 => l1.l2.filter(l2 => !l2.parked).flatMap(l2 => l2.leaves));
/** The leaves a consumer places as slots: the non-parked ones but the awaiting ones (placed and frozen in the tree, no slot yet). */
export const slotLeaves = (tree: Pick<PackageTree, "l1"> & { readonly awaiting?: readonly string[] }): string[] => {
  const awaiting = new Set(tree.awaiting ?? []);
  return treeLeaves(tree).filter(id => !awaiting.has(id));
};

/** Every agent-qualified ref anywhere in a value. */
export function refsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") { if (SLOT_REF.test(value)) out.push(value); }
  else if (Array.isArray(value)) for (const item of value) refsIn(item, out);
  else if (object(value)) for (const item of Object.values(value)) refsIn(item, out);
  return out;
}

/**
 * The leaf ids a freeze holds: its `leafIds` (or `leaves`), then its inline amendments in order (a Writer
 * `clossys.leaf-freeze/2`: `remove`, then `add`), then each separate amendment file that is owner-signed on the
 * freeze's own signed head (a Designer `addedLeafIds` file, as its leaf-freeze check reads it). An unsigned or
 * mismatched amendment file adds nothing.
 */
export function frozenIds(freeze: Record<string, unknown>, amendmentFiles: readonly unknown[] = []): string[] {
  const ids = new Set(strings(freeze.leafIds ?? freeze.leaves));
  for (const amendment of Array.isArray(freeze.amendments) ? freeze.amendments.filter(object) : []) {
    for (const id of strings(amendment.remove)) ids.delete(id);
    for (const id of strings(amendment.add)) ids.add(id);
  }
  for (const file of amendmentFiles) {
    if (!object(file) || file.status !== "owner-signed" || typeof freeze.signedHead !== "string" || file.baseSignedHead !== freeze.signedHead || (file.layer !== undefined && file.layer !== freeze.layer)) continue;
    for (const id of strings(file.addedLeafIds)) ids.add(id);
  }
  return [...ids];
}

function readSkillHashes(repo: string): Set<string> {
  const doc = json(join(repo, "packages/producer/src/constitution/skill-hashes.json"));
  return new Set(object(doc) && object(doc.skills) ? Object.keys(doc.skills) : []);
}

function readAgent(repo: string, consumer: string, agent: ConformAgent, standards: readonly Standard[], hashed: ReadonlySet<string>): AgentModel {
  const packageDir = join(repo, "packages", agent);
  const raw = json(join(packageDir, "conform.json"));
  const shapeIssues = raw === undefined ? [`packages/${agent}/conform.json is missing or not JSON`] : adapterIssues(raw, agent);
  const issues = shapeIssues.length ? shapeIssues : missingPaths(raw as Adapter, repo, packageDir);
  const adapter = issues.length ? undefined : raw as Adapter;
  const trees: PackageTree[] = (adapter?.trees ?? []).map(entry => {
    const freezeDoc = entry.freeze ? json(join(packageDir, entry.freeze)) : undefined;
    const freezeIds = object(freezeDoc) ? frozenIds(freezeDoc, (entry.amendments ?? []).map(file => json(join(packageDir, file)))) : [];
    return { ...readTree(entry.file, json(join(packageDir, entry.file))), freeze: entry.freeze ? { file: entry.freeze, exists: freezeDoc !== undefined, ids: freezeIds } : null };
  });
  const agentDir = join(consumer, "agents", agent);
  const ia = json(join(agentDir, "ia.json"));
  const placedTree = (object(ia) && Array.isArray(ia.nodes) ? ia.nodes : []).filter(object).map(node => ({
    id: String(node.id),
    l2: (Array.isArray(node.children) ? node.children : []).filter(object).map(child => ({ id: String(child.id), slots: strings(child.slots) })),
  }));
  const folders = dirs(agentDir).filter(name => existsSync(join(agentDir, name, "slot.json")));
  // The agent's declared loop slots are Producer-standard leaves, judged by W2 (agent-loop-standard), not catalog slots.
  const declaredLoops = new Set<string>(adapter?.loops ?? []);
  const placedIds = placedTree.flatMap(l1 => l1.l2.flatMap(l2 => l2.slots)).filter(id => !declaredLoops.has(id));
  let live: LiveSlot[] = placedIds.map(id => {
    const slot = json(join(agentDir, id, "slot.json"));
    const doc = object(slot) ? slot : {};
    // A clossys.slot/2 names its edges as refs (`{to: <agent>/<id>, rel}`); a slot/1 as bare `inputs` and `uses`.
    const refs = Array.isArray(doc.refs) ? doc.refs.filter(object) : [];
    const refsOf = (rel: string) => [...new Set(refs.filter(ref => ref.rel === rel && typeof ref.to === "string").map(ref => ref.to as string))];
    const ledger = json(join(agentDir, id, "ledger.json"));
    const pin = json(join(agentDir, id, "pin.json"));
    return {
      id, source: "placed" as const, ...(typeof doc.schema === "string" ? { schema: doc.schema } : {}), ...(typeof doc.kind === "string" ? { kind: doc.kind } : {}),
      contract: object(doc.contract) ? doc.contract : {},
      inputs: doc.schema === "clossys.slot/2" ? refsOf("input") : strings(doc.inputs), uses: doc.schema === "clossys.slot/2" ? refsOf("uses") : strings(doc.uses),
      ...(typeof doc.standard === "string" ? { standard: doc.standard } : {}), ...(doc.family !== undefined ? { family: doc.family } : {}),
      ...(object(slot) ? { folder: `agents/${agent}/${id}` } : {}),
      ledger: object(ledger) && Array.isArray(ledger.events) ? ledger.events.filter(object) : [],
      ...(object(pin) ? { pin } : {}),
      ...(typeof doc.agent === "string" ? { owner: doc.agent } : {}), ...(typeof doc.id === "string" ? { recordId: doc.id } : {}),
      inputsDeclared: doc.schema === "clossys.slot/2" ? Array.isArray(doc.refs) : Array.isArray(doc.inputs),
    };
  });
  if (!live.length) {
    // Nothing placed: the package tree's own slot data stands in, so the per-slot assertions still judge the package.
    live = trees.flatMap(tree => slotLeaves(tree).map(id => packageSlot(id, tree.slots[id] ?? {}, agent)));
  }
  const defaults = new Set((adapter?.defaults ?? []).flatMap(dir => dirs(join(packageDir, dir))));
  const edges: Edge[] = [];
  for (const slot of live) {
    const scope = slot.source;
    for (const to of [...slot.inputs, ...slot.uses]) edges.push({ from: slot.id, to, scope });
    for (const to of refsIn(slot.contract)) edges.push({ from: slot.id, to, scope });
  }
  // The package trees' own slot data declares edges too, whatever the consumer placed.
  if (live.some(slot => slot.source === "placed")) {
    for (const tree of trees) for (const id of treeLeaves(tree)) {
      const slot = packageSlot(id, tree.slots[id] ?? {}, agent);
      for (const to of [...slot.inputs, ...slot.uses, ...refsIn(slot.contract)]) edges.push({ from: id, to, scope: "package" });
    }
  }
  for (const entry of adapter?.edgeFiles ?? []) {
    const doc = json(join(packageDir, entry.file));
    if (entry.format === "usage-graph") {
      // The package's usage graph: every edge stays within this agent.
      for (const edge of (object(doc) && Array.isArray(doc.edges) ? doc.edges : []).filter(object)) edges.push({ from: String(edge.from), to: String(edge.to), target: agent, scope: "package" });
      continue;
    }
    // slots: `{slots: [{id, inputs, feeds}]}`; slot-contracts: `[{slot, inputs: [{name, kind}]}]`, whose slot-layer
    // inputs (theme, asset, component, section, frame) are edges; props, data, cells and copy keys are not.
    const rows = (Array.isArray(doc) ? doc : object(doc) && Array.isArray(doc.slots) ? doc.slots : []).filter(object);
    for (const row of rows) {
      const from = String(row.id ?? row.slot);
      const named = (Array.isArray(row.inputs) ? row.inputs : []).filter(object).filter(input => SLOT_INPUT_KINDS.has(String(input.kind))).map(input => input.name).filter((name): name is string => typeof name === "string");
      for (const to of [...strings(row.inputs), ...named]) edges.push({ from, to, scope: "package" });
      for (const to of strings(row.feeds)) edges.push({ from, to, target: entry.feedsTo ?? agent, scope: "package" });
    }
  }
  const actions = dirs(join(packageDir, "actions")).map(id => {
    const action = json(join(packageDir, "actions", id, "action.json"));
    const inputs = object(action) && Array.isArray(action.inputs) ? action.inputs.filter(object) : [];
    return { id, reads: inputs.map(input => String(input.glob ?? "")) };
  });
  const requestsDir = join(consumer, "agents", "producer", "queue.slot", "entries");
  const requests = existsSync(requestsDir) ? readdirSync(requestsDir).filter(name => name.endsWith(".json")).map(name => json(join(requestsDir, name))).filter(object)
    .filter(request => typeof request.from === "string" && request.from.startsWith(`${agent}/`)) : [];
  return {
    agent, packageDir, ...(adapter ? { adapter } : {}), adapterIssues: issues, trees, placedTree, folders, live, defaults,
    packageOnly: trees.flatMap(tree => treeLeaves(tree).filter(id => !live.some(slot => slot.id === id)).map(id => packageSlot(id, tree.slots[id] ?? {}, agent))),
    l2Of: new Map([
      ...trees.flatMap(tree => tree.l1.flatMap(l1 => l1.l2.flatMap(l2 => l2.leaves.map(id => [id, `${l1.id}/${l2.id}`] as [string, string])))),
      ...placedTree.flatMap(l1 => l1.l2.flatMap(l2 => l2.slots.map(id => [id, `${l1.id}/${l2.id}`] as [string, string]))),
    ]),
    standards: standards.filter(standard => standard.agent === agent),
    recipes: (adapter?.recipes ?? []).map(recipe => ({
      dir: recipe.dir, exists: existsSync(join(packageDir, recipe.dir, "recipe.json")),
      ...(recipe.fixture ? { fixture: { ...recipe.fixture, value: json(join(packageDir, recipe.fixture.output)) } } : {}),
    })),
    derive: (adapter?.derive ?? []).map(entry => { const body = text(join(packageDir, entry.module)); return { module: entry.module, ...(body === undefined ? {} : { text: body }) }; }),
    hasDeriveDir: existsSync(join(packageDir, "src/derive")),
    edges, actions,
    ...(adapter && text(join(packageDir, adapter.skill)) !== undefined ? { skillText: text(join(packageDir, adapter.skill))! } : {}),
    skills: LOOPS.map(loop => {
      const path = adapter?.skills[loop] ?? null;
      return { loop, path, exists: path !== null && existsSync(join(repo, path)), registered: path !== null && hashed.has(path) };
    }),
    loops: AGENT_LOOPS.map(loop => ownLoop(packageDir, consumer, agent, loop, declaredLoops.has(loop))),
    requests,
  };
}

/** The agent's package candidate of one loop and, where the consumer holds the loop slot, the version its pin names. */
function ownLoop(packageDir: string, consumer: string, agent: ConformAgent, loop: AgentLoopName, declared: boolean): OwnLoop {
  const rel = `${AGENT_LOOPS_DIR}/${loop}/${loopStem(loop)}-v1.json`;
  const doc = json(join(packageDir, rel));
  const pkg: LoopRead = !existsSync(join(packageDir, rel)) ? { ok: false, reason: `packages/${agent}/${rel} does not exist` }
    : object(doc) && doc.content !== undefined ? { ok: true, ref: `${agent}/${loop}/package:${loopStem(loop)}-v1.json`, content: doc.content }
    : { ok: false, reason: `packages/${agent}/${rel} is not a loop candidate (JSON with content)` };
  const placed = existsSync(join(consumer, "agents", agent, loop, "slot.json"));
  if (!placed) return { loop, declared, package: pkg, placed };
  // The consumer folder is a workspace's `clossys/` (the pin resolves from the workspace root).
  if (basename(consumer) !== "clossys") return { loop, declared, package: pkg, placed, pin: { ok: false, reason: `${consumer} is not a workspace clossys/ folder; the pin cannot be resolved` } };
  const read = readAgentLoopPin(dirname(consumer), agent, loop);
  const pin: LoopRead = read === undefined ? { ok: false, reason: `${agent}/${loop} is not placed` } : read.ok ? { ok: true, ref: read.ref, content: read.content } : { ok: false, reason: read.reason };
  return { loop, declared, package: pkg, placed, pin };
}

function readMachinery(repo: string): Machinery {
  const producer = join(repo, "packages/producer");
  const rulesDoc = json(join(producer, "src/constitution/rules.json"));
  const rules = new Map<string, RuleState>();
  for (const rule of Array.isArray(rulesDoc) ? rulesDoc.filter(object) : []) {
    for (const check of Array.isArray(rule.checks) ? rule.checks.filter(object) : []) rules.set(String(check.id), { status: String(check.status), enforcedFor: strings(check.enforcedFor) });
  }
  const loops = new Map<string, { steps: Record<string, unknown>[] } | undefined>();
  for (const loop of dirs(join(producer, "loops"))) {
    const file = readdirSync(join(producer, "loops", loop)).filter(name => name.endsWith(".json")).sort().pop();
    const doc = file ? json(join(producer, "loops", loop, file)) : undefined;
    const content = object(doc) && object(doc.content) ? doc.content : undefined;
    loops.set(loop, content ? { steps: Array.isArray(content.steps) ? content.steps.filter(object) : [] } : undefined);
  }
  const certifyDir = join(producer, "src/constitution/certify");
  const certifiers = new Set(["element", "brief", "strings", "page", "publication", "seat"].filter(family => existsSync(join(certifyDir, `${family}.ts`))));
  const contractSchemas = new Map<string, JsonSchema | undefined>();
  for (const family of ["brief", "element", "strings", "page", "publication", "seat"]) contractSchemas.set(family, json(join(producer, `pipeline/schemas/contract-${family}.schema.json`)) as JsonSchema | undefined);
  const criteria = new Set<string>();
  // Core criteria sit at criteria/core/index.json, each agent's at criteria/<agent>/<group>/index.json.
  const criteriaRoot = join(producer, "src/constitution/criteria");
  const indexes = dirs(criteriaRoot).flatMap(dir => [join(criteriaRoot, dir), ...dirs(join(criteriaRoot, dir)).filter(sub => sub !== "__fixtures__").map(sub => join(criteriaRoot, dir, sub))]);
  for (const dir of indexes) {
    const doc = json(join(dir, "index.json"));
    for (const item of object(doc) && Array.isArray(doc.criteria) ? doc.criteria.filter(object) : []) criteria.add(String(item.id));
  }
  return { rules, loops, slotRequestSchema: existsSync(join(producer, "schemas/queue-entry-2.json")), certifiers, contractSchemas, criteria };
}

/** Reads the whole model: the repo's packages and the consumer's placed records. */
export function readConformModel(repo: string, consumer: string, agents: readonly ConformAgent[] = CONFORM_AGENTS): ConformModel {
  const standards = loadStandards(repo);
  const hashed = readSkillHashes(repo);
  const models = agents.map(agent => readAgent(repo, consumer, agent, standards, hashed));
  const liveIds = new Map<string, Set<string>>(), packageIds = new Map<string, Set<string>>();
  for (const agent of [...CONFORM_AGENTS, "producer"] as const) {
    if (agent === "producer") {
      // The producer has no package tree: its seats are the placed folders.
      const seats = new Set(dirs(join(consumer, "agents/producer")));
      liveIds.set(agent, seats); packageIds.set(agent, seats);
      continue;
    }
    const model = models.find(item => item.agent === agent) ?? readAgent(repo, consumer, agent, standards, hashed);
    liveIds.set(agent, new Set(model.live.map(slot => slot.id)));
    packageIds.set(agent, new Set(model.trees.flatMap(treeLeaves)));
  }
  return { repo, consumer, agents: models, machinery: readMachinery(repo), liveIds, packageIds };
}
