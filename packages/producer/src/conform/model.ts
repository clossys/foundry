/**
 * The conformance model (foundry-build-0048 U1): every fact the conformance assertions judge, read once from
 * disk. An agent's package declares its side in `packages/<agent>/conform.json` (adapter.schema.json): its
 * package trees and freezes, held kinds, recipes and their fixtures, derive modules, edge files and the
 * five loop skills. The placed side is a consumer folder (`agents/<agent>/`), by default the producer's
 * test fixture. Reading is all this file does; assertions.ts judges and run.ts reports.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
  readonly trees: readonly { readonly file: string; readonly freeze: string | null }[];
  readonly kinds: readonly string[];
  readonly defaults: readonly string[];
  readonly recipes: readonly { readonly dir: string; readonly fixture?: { readonly output: string; readonly slot: string } }[];
  readonly derive: readonly { readonly module: string }[];
  readonly edgeFiles: readonly string[];
  readonly skill: string;
  readonly skills: Readonly<Record<LoopName, string | null>>;
}

export interface TreeL2 { readonly id: string; readonly parked: boolean; readonly leaves: readonly string[] }
export interface TreeL1 { readonly id: string; readonly parked: boolean; readonly l2: readonly TreeL2[] }
export interface PackageTree {
  readonly file: string;
  readonly l1: readonly TreeL1[];
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
  readonly defaults: ReadonlySet<string>;
  readonly standards: readonly Standard[];
  readonly recipes: readonly { readonly dir: string; readonly exists: boolean; readonly fixture?: { readonly output: string; readonly slot: string; readonly value?: unknown } }[];
  readonly derive: readonly { readonly module: string; readonly text?: string }[];
  readonly hasDeriveDir: boolean;
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  readonly actions: readonly { readonly id: string; readonly reads: readonly string[] }[];
  readonly skillText?: string;
  readonly skills: readonly { readonly loop: LoopName; readonly path: string | null; readonly exists: boolean; readonly registered: boolean }[];
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
  /** Every live id per agent, for edge resolution. */
  readonly liveIds: ReadonlyMap<string, ReadonlySet<string>>;
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
  return { file, l1, slots };
}

/** The non-parked leaves of a tree. */
export const treeLeaves = (tree: Pick<PackageTree, "l1">): string[] =>
  tree.l1.filter(l1 => !l1.parked).flatMap(l1 => l1.l2.filter(l2 => !l2.parked).flatMap(l2 => l2.leaves));

/** Every agent-qualified ref anywhere in a value. */
export function refsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") { if (SLOT_REF.test(value)) out.push(value); }
  else if (Array.isArray(value)) for (const item of value) refsIn(item, out);
  else if (object(value)) for (const item of Object.values(value)) refsIn(item, out);
  return out;
}

function readSkillHashes(repo: string): Set<string> {
  const doc = json(join(repo, "packages/producer/src/constitution/skill-hashes.json"));
  return new Set(object(doc) && object(doc.skills) ? Object.keys(doc.skills) : []);
}

function readAgent(repo: string, consumer: string, agent: ConformAgent, standards: readonly Standard[], hashed: ReadonlySet<string>): AgentModel {
  const packageDir = join(repo, "packages", agent);
  const raw = json(join(packageDir, "conform.json"));
  const issues = raw === undefined ? [`packages/${agent}/conform.json is missing or not JSON`] : adapterIssues(raw, agent);
  const adapter = issues.length ? undefined : raw as Adapter;
  const trees: PackageTree[] = (adapter?.trees ?? []).map(entry => {
    const freezeDoc = entry.freeze ? json(join(packageDir, entry.freeze)) : undefined;
    const freezeIds = object(freezeDoc) ? strings(freezeDoc.leafIds ?? freezeDoc.leaves) : [];
    return { ...readTree(entry.file, json(join(packageDir, entry.file))), freeze: entry.freeze ? { file: entry.freeze, exists: freezeDoc !== undefined, ids: freezeIds } : null };
  });
  const agentDir = join(consumer, "agents", agent);
  const ia = json(join(agentDir, "ia.json"));
  const placedTree = (object(ia) && Array.isArray(ia.nodes) ? ia.nodes : []).filter(object).map(node => ({
    id: String(node.id),
    l2: (Array.isArray(node.children) ? node.children : []).filter(object).map(child => ({ id: String(child.id), slots: strings(child.slots) })),
  }));
  const folders = dirs(agentDir).filter(name => existsSync(join(agentDir, name, "slot.json")));
  const placedIds = placedTree.flatMap(l1 => l1.l2.flatMap(l2 => l2.slots));
  let live: LiveSlot[] = placedIds.map(id => {
    const slot = json(join(agentDir, id, "slot.json"));
    const doc = object(slot) ? slot : {};
    const ledger = json(join(agentDir, id, "ledger.json"));
    const pin = json(join(agentDir, id, "pin.json"));
    return {
      id, source: "placed" as const, ...(typeof doc.schema === "string" ? { schema: doc.schema } : {}), ...(typeof doc.kind === "string" ? { kind: doc.kind } : {}),
      contract: object(doc.contract) ? doc.contract : {}, inputs: strings(doc.inputs), uses: strings(doc.uses),
      ...(typeof doc.standard === "string" ? { standard: doc.standard } : {}), ...(doc.family !== undefined ? { family: doc.family } : {}),
      ...(object(slot) ? { folder: `agents/${agent}/${id}` } : {}),
      ledger: object(ledger) && Array.isArray(ledger.events) ? ledger.events.filter(object) : [],
      ...(object(pin) ? { pin } : {}),
    };
  });
  if (!live.length) {
    // Nothing placed: the package tree's own slot data stands in, so the per-slot assertions still judge the package.
    live = trees.flatMap(tree => treeLeaves(tree).map(id => {
      const data = tree.slots[id] ?? {};
      const contract = object(data.contract) ? data.contract : data;
      return {
        id, source: "package" as const, ...(typeof data.kind === "string" ? { kind: data.kind } : {}), contract,
        inputs: strings(data.inputs).concat((Array.isArray(data.inputs) ? data.inputs : []).filter(object).map(item => String(item.to))),
        uses: strings(data.uses), ...(typeof data.standard === "string" ? { standard: data.standard } : {}),
        ...(data.family !== undefined ? { family: data.family } : {}), ledger: [],
      };
    }));
  }
  const defaults = new Set((adapter?.defaults ?? []).flatMap(dir => dirs(join(packageDir, dir))));
  const edges: { from: string; to: string }[] = [];
  for (const slot of live) {
    for (const to of [...slot.inputs, ...slot.uses]) edges.push({ from: slot.id, to });
    for (const to of refsIn(slot.contract)) edges.push({ from: slot.id, to });
  }
  for (const file of adapter?.edgeFiles ?? []) {
    const doc = json(join(packageDir, file));
    // Either `{slots: [{id, inputs, feeds}]}` or a clossys.slot-contract/1 array `[{slot, inputs: [{name, kind}]}]`,
    // whose slot-layer inputs (theme, asset, component, section, frame) are edges; props, data, cells and copy keys are not.
    const rows = (Array.isArray(doc) ? doc : object(doc) && Array.isArray(doc.slots) ? doc.slots : []).filter(object);
    for (const row of rows) {
      const named = (Array.isArray(row.inputs) ? row.inputs : []).filter(object).filter(input => SLOT_INPUT_KINDS.has(String(input.kind))).map(input => input.name).filter((name): name is string => typeof name === "string");
      for (const to of [...strings(row.inputs), ...named, ...strings(row.feeds)]) edges.push({ from: String(row.id ?? row.slot), to });
    }
  }
  const actions = dirs(join(packageDir, "actions")).map(id => {
    const action = json(join(packageDir, "actions", id, "action.json"));
    const inputs = object(action) && Array.isArray(action.inputs) ? action.inputs.filter(object) : [];
    return { id, reads: inputs.map(input => String(input.glob ?? "")) };
  });
  const requestsDir = join(consumer, "requests");
  const requests = existsSync(requestsDir) ? readdirSync(requestsDir).filter(name => name.endsWith(".json")).map(name => json(join(requestsDir, name))).filter(object)
    .filter(request => typeof request.requestedBy === "string" && request.requestedBy.startsWith(`${agent}/`)) : [];
  return {
    agent, packageDir, ...(adapter ? { adapter } : {}), adapterIssues: issues, trees, placedTree, folders, live, defaults,
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
    requests,
  };
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
  for (const dir of dirs(join(producer, "src/constitution/criteria"))) {
    const doc = json(join(producer, "src/constitution/criteria", dir, "index.json"));
    for (const item of object(doc) && Array.isArray(doc.criteria) ? doc.criteria.filter(object) : []) criteria.add(String(item.id));
  }
  return { rules, loops, slotRequestSchema: existsSync(join(producer, "schemas/slot-request.schema.json")), certifiers, contractSchemas, criteria };
}

/** Reads the whole model: the repo's packages and the consumer's placed records. */
export function readConformModel(repo: string, consumer: string, agents: readonly ConformAgent[] = CONFORM_AGENTS): ConformModel {
  const standards = loadStandards(repo);
  const hashed = readSkillHashes(repo);
  const models = agents.map(agent => readAgent(repo, consumer, agent, standards, hashed));
  const liveIds = new Map<string, Set<string>>();
  // Edges resolve against every agent's live set, the producer's seats included (placed folders only).
  for (const agent of [...CONFORM_AGENTS, "producer"] as const) {
    const model = models.find(item => item.agent === agent);
    liveIds.set(agent, new Set(model ? model.live.map(slot => slot.id) : agent === "producer" ? dirs(join(consumer, "agents/producer")) : readAgent(repo, consumer, agent as ConformAgent, standards, hashed).live.map(slot => slot.id)));
  }
  return { repo, consumer, agents: models, machinery: readMachinery(repo), liveIds };
}
