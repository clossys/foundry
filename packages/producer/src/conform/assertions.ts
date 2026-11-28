/**
 * The conformance assertions (foundry-build-0048 U1): one pure function per row of assertions.json, judging
 * one agent of a read model (model.ts). Each returns the red rows it found and how many facts it judged.
 * Empty is red: an assertion that judged nothing (`evidence` 0) is red as vacuous, never green.
 */
import { validateValue } from "../pipeline/schema.js";
import { SCORECARD_REF_TO } from "../constitution/pin-gate.js";
import { EXEMPLARS_MAX, EXEMPLARS_MIN } from "../records/standards.js";
import type { ProbeFacts } from "./dogfood.js";
import { refsIn, SLOT_REF, slotLeaves, treeLeaves, upstreamOf, type AgentModel, type ConformModel, type Edge, type LiveSlot } from "./model.js";
// U4b: a page recipe fixture is judged by the real Publisher page check (recipe-page.ts).
import { isPageRecord, pageFixtureOf } from "../actions/page-option.js";
import { requirementsVerdictSync } from "../constitution/certify/requirements.js";
import type { JsonSchema } from "../pipeline/schema.js";
import { recipePageKey } from "./recipe-page.js";
import { REQUEST_ASSERTIONS } from "./requests-assertions.js";
import { agentLoopIssues, isLoopAgent } from "../loop/agent-loops.js";
import { dirname } from "node:path";
// S1 (S1-PLACED): the expected set is what `ia sync` places, computed by the functions sync itself uses.
import { consumedIds, consumedLeaves, isConsumedAgent, scopedToConsumed } from "../records/slot-model/consumed.js";
import { studioDesignerSlots } from "../records/slot-model/foundry-ia.js";

/**
 * `rows` are red; `findings` are report-only (listed, never red): a pattern worth a look that a rule cannot call wrong,
 * such as a split with one part (owner, 2026-11-17: groups split by their own rule into any number of parts).
 */
export interface Judgement { readonly rows: readonly string[]; readonly evidence: number; readonly findings?: readonly string[] }
/** `facts` carries what the runner probed by running real verbs on a temporary copy (dogfood.ts readProbeFacts). */
export type Assertion = (agent: AgentModel, model: ConformModel, facts?: ProbeFacts) => Judgement;

/** Each held kind's certifier and contract family. */
export const KIND_FAMILY: Readonly<Record<string, string>> = {
  brief: "brief",
  "element/token": "element", "element/asset": "element", "element/component": "element", "element/section": "element", "element/frame": "element",
  voice: "strings", prose: "strings", copy: "strings",
  page: "page", layout: "page", chrome: "page", publication: "publication", release: "publication",
};

/**
 * Each held kind's certifier (certify/<certifier>.ts), where it is not the kind's family (K3): a release manifest has its
 * own, and a publication is certified by certify/page.ts (certifyPublication).
 */
export const KIND_CERTIFIER: Readonly<Record<string, string>> = { release: "release", publication: "page" };

/** A rule check is enforced for an agent when its status is enforced, or its enforcedFor names the agent. */
export function enforcedFor(model: ConformModel, id: string, agent: string): boolean {
  const rule = model.machinery.rules.get(id);
  return rule !== undefined && (rule.status === "enforced" || rule.enforcedFor.includes(agent));
}
const ruleRow = (model: ConformModel, id: string, agent: string): string[] => {
  const rule = model.machinery.rules.get(id);
  return enforcedFor(model, id, agent) ? [] : [`${id} is ${rule ? `${rule.status}, not enforced for ${agent}` : "not a registered rule check"}`];
};
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const words = (id: string): Set<string> => new Set(id.split(/[^a-z0-9]+/).filter(Boolean));
function jaccard(a: Set<string>, b: Set<string>): number {
  const both = [...a].filter(item => b.has(item)).length;
  return both / (a.size + b.size - both || 1);
}
const placedIds = (agent: AgentModel): string[] => agent.placedTree.flatMap(l1 => l1.l2.flatMap(l2 => l2.slots));
const standardOf = (agent: AgentModel, slot: LiveSlot) => slot.standard === undefined ? undefined : agent.standards.find(standard => standard.id === slot.standard);
const pins = (agent: AgentModel) => agent.live.filter(slot => slot.pin !== undefined);
/**
 * K4 for a clossys.page/1 fixture (U4b): the contract fixture is the record's own route, which the slot contract's
 * schema validates; the record passes the page standard's requirements; and the real Publisher page check (the
 * recipe-page probe) finds nothing, so a section the layout disallows is red.
 */
function pageFixtureRows(agent: AgentModel, slot: LiveSlot, dir: string, output: string, record: Record<string, unknown>, schema: JsonSchema, facts?: ProbeFacts): string[] {
  const rows: string[] = [];
  const fixture = pageFixtureOf(record);
  if (!fixture) rows.push(`${dir}: fixture page names no route path`);
  else rows.push(...validateValue({ ...slot.contract, fixture }, schema).map(issue => `${dir}: fixture ${issue.path} ${issue.message}`));
  const standard = standardOf(agent, slot) ?? agent.standards.find(item => item.doc?.kinds.includes(slot.kind ?? ""));
  if (!standard?.doc) rows.push(`${dir}: no ${slot.kind} standard to certify the fixture under`);
  else {
    const verdict = requirementsVerdictSync({
      candidate: { name: output.split("/").pop()!, bytes: JSON.stringify(record) }, kind: slot.kind ?? "page",
      standard: { id: standard.id, sha256: standard.sha256, requirements: standard.doc.requirements.map(item => ({ check: item.check, params: item.params ?? {} })) },
      contract: slot.contract, pinSet: "",
    });
    for (const result of verdict.results) if (!result.pass) rows.push(`${dir}: fixture fails ${standard.id} ${result.check} (${result.failures.join("; ")})`);
  }
  const checked = facts?.recipePages?.[recipePageKey(agent.agent, dir)];
  if (checked === undefined) rows.push(`${dir}: the Publisher page check did not run on the fixture`);
  else if (typeof checked === "string") rows.push(`${dir}: ${checked}`);
  else rows.push(...checked.map(finding => `${dir}: fixture ${finding}`));
  return rows;
}
/** A slot id literal in source: `"a.b"`-shaped quoted strings. */
const ID_LITERAL = /["'`]([a-z][a-z0-9-]*\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)?)["'`]/g;
/** Above this name similarity two same-kind, same-input leaves overlap (`primary-foreground` vs `sidebar-primary-foreground` is 0.67: token siblings, not overlap). Pinned by conform.test.ts (not shipped). */
export const OVERLAP_MIN = 0.7;
/** Contract fields that name the one slot a leaf is for (Writer's old `passages.*` name their section by `sectionId`). */
const SUBJECT_FIELDS = ["sectionId", "subject", "for"] as const;
/**
 * One ref in one key form, `<agent>/<id>`. A clossys.slot/2 names its inputs agent-qualified and a slot/1 bare, so a
 * store with both (or a placed slot/2 beside a package leaf) compares them only through this. A bare id resolves as
 * dangling() resolves it: the agent itself, then its upstream agents, package or placed. One that resolves nowhere stays bare.
 */
export function qualifiedRef(agent: AgentModel, model: ConformModel, ref: string): string {
  const match = SLOT_REF.exec(ref);
  if (match) return `${match[1]}/${match[2]}`;
  const owner = [agent.agent, ...upstreamOf(agent.agent)].find(name => model.packageIds.get(name)?.has(ref) || model.liveIds.get(name)?.has(ref));
  return owner === undefined ? ref : `${owner}/${ref}`;
}
/** The foreign slots a leaf is for, whatever its name: a subject field, or a foreign ref its own id extends (`sections.hero.copy` is for `designer/sections.hero`). */
function subjectsOf(agent: string, slot: LiveSlot, inputs: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const field of SUBJECT_FIELDS) if (typeof slot.contract[field] === "string") out.add(slot.contract[field] as string);
  for (const ref of refsIn([slot.contract, inputs])) {
    const match = SLOT_REF.exec(ref)!;
    if (match[1] !== agent && slot.id.startsWith(`${match[2]}.`)) out.add(match[2]!);
  }
  return out;
}
/** A kind's family (`copy` and old `strings` are one family), so the two trees compare. */
const familyOf = (slot: LiveSlot) => KIND_FAMILY[slot.kind ?? ""] ?? slot.kind ?? "";
const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length > 0 && JSON.stringify([...a].map(item => JSON.stringify(item)).sort()) === JSON.stringify([...b].map(item => JSON.stringify(item)).sort());
const requirementsOf = (slot: LiveSlot): unknown[] => Array.isArray(slot.contract.requirements) ? slot.contract.requirements : [];
/**
 * The requirements a slot adds to its standard's: `clossys migrate contracts` seeds every check of the slot's
 * standard into its contract as `{check}`, so an inherited check is shared by every sibling of that standard and
 * says nothing about the slot's own purpose (S4 compares only these).
 */
const ownRequirementsOf = (agent: AgentModel, slot: LiveSlot): unknown[] => {
  const inherited = new Set((standardOf(agent, slot)?.doc?.requirements ?? []).map(item => JSON.stringify({ check: item.check })));
  return requirementsOf(slot).filter(item => !inherited.has(JSON.stringify(item)));
};
/** At this many slot-id literals one module holds a fixed list, not a derivation. */
export const FIXED_LIST_MIN = 5;
/**
 * Every real slot id: a leaf of some agent's tree (parked and awaiting leaves included) or a placed slot. L5 counts
 * only these, so a file name or a rule code in a derive module is not a slot id.
 */
function slotIdsOf(model: ConformModel): Set<string> {
  const ids = new Set<string>();
  for (const set of [...model.packageIds.values(), ...model.liveIds.values()]) for (const id of set) ids.add(id);
  for (const agent of model.agents) for (const tree of agent.trees) for (const l1 of tree.l1) for (const l2 of l1.l2) for (const id of l2.leaves) ids.add(id);
  return ids;
}

/** Why a slot's `family` is not the slot/2 shape {options 1|2|3, varyOn, values}, or undefined when it is. */
export function familyIssue(family: unknown): string | undefined {
  if (!object(family)) return "no family {options, varyOn, values}";
  const { options, varyOn, values } = family;
  if (options !== 1 && options !== 2 && options !== 3) return `family.options ${JSON.stringify(options)} is not 1, 2 or 3`;
  if (!Array.isArray(values) || values.some(value => typeof value !== "string")) return "family.values is not a list of strings";
  if (options === 1) return varyOn === null && values.length === 0 ? undefined : "a one-option family varies on nothing (varyOn null, values [])";
  if (typeof varyOn !== "string" || !varyOn) return `a ${options}-option family names no varyOn`;
  return values.length === options ? undefined : `a ${options}-option family lists ${values.length} values`;
}

/** M1: the Publisher kinds that make up a content map, and the Director cell they plan from (`clossys plan`). */
const CONTENT_MAP_KINDS = new Set(["page", "publication"]);
export const PLAN_RELEASE_REF = "director/execution.roadmap.release";

export const ASSERTIONS: Readonly<Record<string, Assertion>> = {
  S1: (agent, model) => {
    // The agent's declared loop slots are Producer-standard leaves in its loops L1, not package-tree leaves (W2 judges them).
    const loops = new Set(agent.loops.filter(loop => loop.declared).map(loop => loop.loop as string));
    const pkg = new Set(agent.trees.flatMap(tree => slotLeaves(tree))), placed = new Set(placedIds(agent).filter(id => !loops.has(id)));
    // Owner, 2026-11-23 (S1-PLACED): S1 judges the leaves `ia sync` places. For an agent sync scopes to consumed leaves
    // that is exactly its consumed leaves (a Producer Studio slot among them only when a publication reaches it, fix1);
    // for any other agent, the whole package tree. A placed package leaf or Producer slot outside the expected set is
    // allowed; a placed leaf that is neither a package leaf nor a Producer slot is red.
    const producer = agent.agent === "designer" ? studioDesignerSlots().map(slot => slot.id) : [];
    const expected = scopedToConsumed(agent.agent) ? consumedIds(consumedLeaves(dirname(model.consumer)), agent.agent) : pkg;
    const known = new Set([...pkg, ...producer]);
    const rows = [...expected].filter(id => !placed.has(id)).map(id => `${id}: sync places it, not placed`)
      .concat([...placed].filter(id => !known.has(id)).map(id => `${id}: placed, neither a package leaf nor a Producer slot`));
    if (!expected.size) rows.push("nothing to judge: sync places no leaves");
    // Sync manages no Publisher IA (`ia publisher --start` is workspace-owned), so its summary names the package tree.
    const source = isConsumedAgent(agent.agent) ? `sync places ${expected.size} leaves` : `package tree has ${expected.size} leaves`;
    if (rows.length) rows.unshift(`${source}, the placed tree has ${[...expected].filter(id => placed.has(id)).length} of them`);
    return { rows, evidence: expected.size };
  },
  // Report-only (owner, 2026-11-17): a group splits by its own rule into any number of parts, so a one-part split is
  // listed as suspicious, never red, and no tree move is made to satisfy it. Red only when there is no L1 to judge.
  S2: agent => {
    const l1s = agent.trees.flatMap(tree => tree.l1.filter(l1 => !l1.parked).map(l1 => ({ tree: tree.file, l1 })));
    const live = new Set(agent.folders);
    const findings = l1s.filter(({ l1 }) => l1.l2.filter(l2 => !l2.parked).length === 1).map(({ tree, l1 }) => `suspicious split: ${tree} ${l1.id} has one L2 (${l1.l2.find(l2 => !l2.parked)!.id})`)
      .concat(agent.placedTree.flatMap(l1 => l1.l2.map(l2 => ({ l1: l1.id, l2, count: l2.slots.filter(id => live.has(id)).length })))
        .filter(({ count }) => count <= 1).map(({ l1, l2, count }) => `suspicious split: ${l1}/${l2.id} has ${count === 0 ? "no" : "one"} live L3`));
    return { rows: [], evidence: l1s.length, findings };
  },
  // U9 fix r1 (blind2 B3, owner 2026-11-17 "single-child or empty groups reported, not failed"): an L2 that lists no
  // slot is a finding; red is an L2 whose listed slots are none of them placed, and an orphan or unplaced leaf.
  S3: agent => {
    const folders = new Set(agent.folders), placed = new Set(placedIds(agent));
    const l2s = agent.placedTree.flatMap(l1 => l1.l2.map(l2 => ({ l1: l1.id, l2 })));
    const findings = l2s.filter(({ l2 }) => !l2.slots.length).map(({ l1, l2 }) => `empty group: ${l1}/${l2.id} lists no L3`);
    const rows = l2s.filter(({ l2 }) => l2.slots.length && !l2.slots.some(id => folders.has(id))).map(({ l1, l2 }) => `${l1}/${l2.id}: no live L3`)
      .concat([...placed].filter(id => !folders.has(id)).map(id => `${id}: placed with no slot folder`))
      .concat([...folders].filter(id => !placed.has(id)).map(id => `${id}: slot folder not placed in ia.json (orphan)`));
    return { rows, evidence: l2s.length, findings };
  },
  S4: (agent, model) => {
    // Both trees count: the placed leaves and the package leaves the consumer has not placed (a dual tree overlaps across them).
    const judged = [...agent.live, ...agent.packageOnly];
    const inputs = new Map(judged.map(slot => [slot, slot.inputs.map(ref => qualifiedRef(agent, model, ref))]));
    const subjects = new Map(judged.map(slot => [slot.id, subjectsOf(agent.agent, slot, inputs.get(slot)!)]));
    const rows: string[] = [];
    for (let i = 0; i < judged.length; i++) for (let j = i + 1; j < judged.length; j++) {
      const a = judged[i]!, b = judged[j]!;
      if (familyOf(a) !== familyOf(b)) continue;
      // Purpose, whatever the name: both are for the same foreign slot, or one L2 holds both with the same inputs and own requirements.
      const shared = [...subjects.get(a.id)!].filter(subject => subjects.get(b.id)!.has(subject));
      if (shared.length) { rows.push(`${a.id} and ${b.id}: both are for ${shared.join(", ")} (same purpose)`); continue; }
      const l2 = agent.l2Of.get(a.id);
      const inA = inputs.get(a)!, inB = inputs.get(b)!;
      if (l2 !== undefined && l2 === agent.l2Of.get(b.id) && sameList(inA, inB) && sameList(ownRequirementsOf(agent, a), ownRequirementsOf(agent, b))) {
        rows.push(`${a.id} and ${b.id}: one L2 (${l2}), same inputs and requirements (same purpose)`); continue;
      }
      // Name: same kind and inputs, and ids that differ only past the threshold.
      if (`${a.kind}/${String(a.contract.kind ?? "")}` !== `${b.kind}/${String(b.contract.kind ?? "")}` || !inA.length || [...inA].sort().join() !== [...inB].sort().join()) continue;
      const purpose = jaccard(words(a.id.split(".").slice(1).join(".")), words(b.id.split(".").slice(1).join(".")));
      if (purpose > OVERLAP_MIN) rows.push(`${a.id} and ${b.id}: same kind and inputs, similar purpose (${purpose.toFixed(2)})`);
    }
    return { rows, evidence: judged.length };
  },
  S5: agent => ({
    rows: agent.trees.flatMap(tree => {
      if (!tree.freeze) return [`${tree.file}: no leaf freeze`];
      if (!tree.freeze.exists) return [`${tree.file}: freeze ${tree.freeze.file} is missing`];
      const frozen = new Set(tree.freeze.ids);
      const loose = treeLeaves(tree).filter(id => !frozen.has(id));
      return loose.length ? [`${tree.file}: ${loose.length} leaf(s) outside ${tree.freeze.file} (${loose.slice(0, 5).join(", ")})`] : [];
    }),
    evidence: agent.trees.length,
  }),
  // U9 (content-agent coverage map): placed once, owned by the tree's agent, inputs declared. C2 judges the contract.
  // U9 fix r1 (blind2 B1): an agent with an upstream agent reads something, so each of its slots names at least one
  // input (a slot/2 `rel: "input"` ref, a slot/1 or package `inputs` entry); only the root agent's slots may list none.
  S6: agent => {
    const reads = upstreamOf(agent.agent).length > 0;
    const counts = new Map<string, number>();
    for (const id of placedIds(agent)) counts.set(id, (counts.get(id) ?? 0) + 1);
    const packaged = new Map<string, number>();
    for (const tree of agent.trees) for (const id of slotLeaves(tree)) packaged.set(id, (packaged.get(id) ?? 0) + 1);
    const rows = [...counts].filter(([, count]) => count > 1).map(([id, count]) => `${id}: placed ${count} times in ia.json`)
      .concat([...packaged].filter(([, count]) => count > 1).map(([id, count]) => `${id}: ${count} times in the package tree`));
    for (const slot of agent.live) {
      if (slot.owner !== agent.agent) rows.push(`${slot.id}: the record names ${slot.owner === undefined ? "no agent" : `agent ${slot.owner}`}, not ${agent.agent}`);
      if (slot.recordId !== slot.id) rows.push(`${slot.id}: the record names ${slot.recordId === undefined ? "no id" : `id ${slot.recordId}`}, not its folder`);
      if (!slot.inputsDeclared) rows.push(`${slot.id}: declares no inputs list`);
      else if (reads && !slot.inputs.length) rows.push(`${slot.id}: names no input (${agent.agent} has an upstream agent, so only a root agent's slot may read nothing)`);
    }
    return { rows, evidence: agent.live.length };
  },
  L1: (agent, model) => {
    const rows: string[] = [];
    if (!model.machinery.slotRequestSchema) rows.push("no clossys.queue-entry/2 schema under packages/producer/schemas/");
    if (!model.machinery.loops.get("loop.slot")) rows.push("no loop.slot version in packages/producer/loops/");
    // A clossys.queue-entry/2 kind slot names its need as target <agent>/<id>; an edge may name it bare or as a ref.
    const filed = new Set(agent.requests.filter(request => request.kind === "slot").flatMap(request => {
      const target = String(request.target ?? "");
      return [target, target.slice(target.indexOf("/") + 1)];
    }));
    for (const edge of dangling(agent, model)) if (!filed.has(edge.to)) rows.push(`${edge.from} needs ${edge.to}: no slot, no slot request`);
    return { rows, evidence: 1 + agent.edges.length };
  },
  L2: agent => {
    const placed = agent.live.filter(slot => slot.source === "placed");
    return {
      rows: placed.filter(slot => !slot.ledger.some(event => event.op === "slot" && (event.decision === "reuse" || event.decision === "create") && Array.isArray(event.overlaps)))
        .map(slot => `${slot.id}: placement records no reuse-or-create decision with its overlaps`),
      evidence: placed.length,
    };
  },
  L3: (agent, _model, facts) => {
    // The real path: `clossys ia --contract` (validateSlotDoc and contractIssues) run on a temporary consumer copy.
    const probe = facts?.iaContract?.[agent.agent];
    if (probe === undefined) return { rows: ["ia --contract was not probed"], evidence: 0 };
    if (typeof probe === "string") return { rows: [probe], evidence: 0 };
    return { rows: probe.filter(result => result.accepted).map(result => `ia ${result.target} --contract accepted an invalid contract ${result.contract} (exit 0)`), evidence: probe.length };
  },
  L4: agent => {
    const closed = agent.requests.filter(request => request.status === "closed" || request.link !== undefined);
    return {
      rows: closed.filter(request => !(typeof request.link === "string" && SLOT_REF.test(request.link) && request.notified !== undefined && typeof request.closed === "string"))
        .map(request => `${String(request.id)}: closed without a slot-to-slot link and notify event`),
      evidence: closed.length,
    };
  },
  L5: (agent, model) => {
    const slotIds = slotIdsOf(model);
    const rows = agent.derive.flatMap(entry => {
      if (entry.text === undefined) return [`${entry.module}: missing`];
      const ids = new Set([...entry.text.matchAll(ID_LITERAL)].map(match => match[1]!).filter(id => slotIds.has(id)));
      return ids.size >= FIXED_LIST_MIN ? [`${entry.module}: a fixed list of ${ids.size} slot ids, not derived from source data`] : [];
    });
    if (!agent.derive.length && agent.hasDeriveDir) rows.push("src/derive exists but conform.json declares no derive module");
    return { rows, evidence: agent.derive.length };
  },
  K1: (agent, model) => {
    const rows = [...ruleRow(model, "R15.1", agent.agent), ...ruleRow(model, "R15.2", agent.agent)];
    for (const slot of agent.live) {
      if (!slot.standard) { rows.push(`${slot.id}: names no standard`); continue; }
      const standard = standardOf(agent, slot);
      if (!standard) { rows.push(`${slot.id}: standard ${slot.standard} does not exist`); continue; }
      const gaps = [
        ...standard.issues,
        ...(standard.doc?.requirements.length ? [] : ["no requirements"]),
        ...(standard.taste?.criteria.length ? [] : ["no taste criteria"]),
        ...((n => n >= EXEMPLARS_MIN && n <= EXEMPLARS_MAX ? [] : [`${n} exemplars`])(standard.exemplars?.length ?? 0)),
      ];
      if (gaps.length) rows.push(`${slot.id}: standard ${standard.id} incomplete (${gaps.join("; ")})`);
    }
    return { rows, evidence: agent.live.length };
  },
  K2: agent => ({
    rows: agent.live.filter(slot => {
      if (agent.defaults.has(slot.id)) return false;
      const standard = standardOf(agent, slot);
      const raw = object(standard?.raw) ? standard!.raw : {};
      return !(standard?.doc?.seeds.length || (raw.createOnly === true && typeof raw.createOnlyReason === "string" && raw.createOnlyReason.length > 0));
    }).map(slot => `${slot.id}: no package default, no seed, no createOnly reason`),
    evidence: agent.live.length,
  }),
  K3: (agent, model) => {
    const rows = ruleRow(model, "R05.1", agent.agent);
    for (const kind of agent.adapter?.kinds ?? []) {
      const certifier = KIND_CERTIFIER[kind] ?? KIND_FAMILY[kind];
      if (!certifier || !model.machinery.certifiers.has(certifier)) rows.push(`${kind}: no certifier`);
    }
    return { rows, evidence: agent.adapter?.kinds.length ?? 0 };
  },
  K4: (agent, model, facts) => ({
    rows: agent.recipes.flatMap(recipe => {
      if (!recipe.exists) return [`${recipe.dir}: no recipe.json`];
      if (!recipe.fixture) return [`${recipe.dir}: ships no fixture output`];
      if (recipe.fixture.value === undefined) return [`${recipe.dir}: fixture ${recipe.fixture.output} is missing`];
      const slot = agent.live.find(item => item.id === recipe.fixture!.slot);
      const family = slot?.kind && (KIND_FAMILY[slot.kind] ?? slot.kind);
      const schema = family ? model.machinery.contractSchemas.get(family) : undefined;
      if (!slot || !schema) return [`${recipe.dir}: fixture slot ${recipe.fixture.slot} has no contract schema`];
      if (family === "page" && isPageRecord(recipe.fixture.value)) return pageFixtureRows(agent, slot, recipe.dir, recipe.fixture.output, recipe.fixture.value, schema, facts);
      return validateValue({ ...slot.contract, fixture: recipe.fixture.value }, schema).map(issue => `${recipe.dir}: fixture ${issue.path} ${issue.message}`);
    }),
    evidence: agent.recipes.length,
  }),
  C1: agent => ({
    rows: agent.live.flatMap(slot => {
      const issue = familyIssue(slot.family);
      return issue ? [`${slot.id}: ${issue}`] : [];
    }),
    evidence: agent.live.length,
  }),
  C2: (agent, model) => ({
    rows: agent.live.flatMap(slot => {
      const requirements = slot.contract.requirements;
      if (!Array.isArray(requirements) || !requirements.length) return [`${slot.id}: contract carries no requirements`];
      const ids = requirements.map(item => object(item) && typeof item.check === "string" ? item.check : "");
      const unknown = ids.filter(id => !model.machinery.criteria.has(id));
      return unknown.length ? [`${slot.id}: unregistered requirement checks ${unknown.map(id => id || "(no check)").join(", ")}`] : [];
    }),
    evidence: agent.live.length,
  }),
  C3: (agent, model, facts) => {
    // The real path: every pin-writing verb (pin, pick, verdict, the Writer's owner pin) run on a temporary consumer copy with a
    // hand-placed and a submitted, uncertified candidate (dogfood.ts probePinGate). Red on any accepted pin, and on any
    // refusal that is not the CHOOSE gate's: that verb never reached the pin write, so the gate is unproven for it.
    const rows = ruleRow(model, "R05.2", agent.agent);
    const probe = facts?.pinGate?.[agent.agent];
    if (probe === undefined) return { rows: [...rows, "pin was not probed"], evidence: 0 };
    if (typeof probe === "string") return { rows: [...rows, probe], evidence: 0 };
    const verbs = probe.verbs ?? [{ verb: "pin", case: "hand-placed", target: probe.target, candidate: probe.candidate, exit: probe.accepted ? 0 : 1, gated: !probe.accepted, message: probe.message }];
    const what = (run: { case: string }) => run.case === "hand-placed" ? "a hand-placed candidate with no submit record" : "a submitted candidate with no passing verdict";
    return {
      rows: [...rows, ...verbs.flatMap(run => run.exit === 0 ? [`${run.verb} ${run.target} ${run.candidate} accepted ${what(run)} (exit 0)`]
        : run.gated ? [] : [`${run.verb} ${run.target} ${run.candidate} (${run.case}) was refused before the CHOOSE gate (exit ${run.exit}): ${run.message}`])],
      evidence: agent.live.length ? verbs.length : 0,
    };
  },
  C4: agent => {
    const pinned = pins(agent);
    return {
      rows: pinned.filter(slot => !(Array.isArray(slot.pin!.refs) && slot.pin!.refs.some(ref => object(ref) && ref.to === SCORECARD_REF_TO)))
        .map(slot => `${slot.id}: pin cites no scorecard (${SCORECARD_REF_TO})`),
      evidence: pinned.length,
    };
  },
  X1: (agent, model) => ({
    rows: [...ruleRow(model, "R07.5", agent.agent), ...(model.machinery.loops.get("loop.cascade") ? [] : ["no loop.cascade version in packages/producer/loops/"])],
    evidence: 1,
  }),
  X2: (agent, model) => ({ rows: dangling(agent, model).map(edge => `${edge.from} -> ${edge.to}${edge.target && edge.target !== agent.agent ? ` (${edge.target})` : ""}: no such ${edge.scope === "package" ? "package" : "live"} slot`), evidence: agent.edges.length }),
  X3: agent => {
    const other = new RegExp(`agents/(?!${agent.agent}/)[a-z]+/[^ ]*candidates/`);
    const reads = agent.actions.flatMap(action => action.reads.map(glob => ({ action: action.id, glob })));
    return {
      rows: reads.filter(read => other.test(read.glob)).map(read => `${read.action} reads ${read.glob}`)
        .concat(agent.live.flatMap(slot => slot.inputs.filter(input => input.includes("candidates/")).map(input => `${slot.id} input ${input}`))),
      evidence: reads.length + agent.live.length,
    };
  },
  X4: (_agent, model) => {
    const release = model.machinery.loops.get("loop.release");
    if (!release) return { rows: ["no loop.release version"], evidence: 1 };
    const gated = release.steps.some(step => (Array.isArray(step.checks) ? step.checks : []).some(check => /stale|needs-refresh|refresh/.test(String(check))));
    return { rows: gated ? [] : ["loop.release checks no needs-refresh gate"], evidence: release.steps.length };
  },
  W1: (agent, model) => {
    const rows: string[] = [];
    for (const loop of ["scope", "slot", "create", "choose", "cascade"]) {
      // The version that runs for the agent's slots: its own loop where it declares one (the consumer's pin where the
      // slot is placed, else its package candidate; W2 judges that it extends the standard), else Producer's standard.
      const own = agent.loops.find(each => each.loop === `loop.${loop}` && each.declared);
      const read = own === undefined ? undefined : own.placed ? own.pin : own.package;
      if (own !== undefined && !read?.ok) { rows.push(`loop.${loop}: ${agent.agent}'s own version cannot be read`); continue; }
      const steps = read?.ok ? (object(read.content) && Array.isArray(read.content.steps) ? read.content.steps.filter(object) : []) : model.machinery.loops.get(`loop.${loop}`)?.steps;
      if (!steps) rows.push(`loop.${loop}: no version`);
      else if (!steps.some(step => object(step.decider) && step.decider.agent === agent.agent)) rows.push(`loop.${loop}: no step reaches ${agent.agent}`);
    }
    for (const skill of agent.skills) {
      if (skill.path === null) rows.push(`${skill.loop}: names no skill`);
      else if (!skill.exists) rows.push(`${skill.loop}: ${skill.path} is missing`);
      else if (!skill.registered) rows.push(`${skill.loop}: ${skill.path} is not hash-registered`);
    }
    return { rows, evidence: 5 + agent.skills.length };
  },
  // CP1-PLAN: the content map is the agents' decision. Every placed page or publication slot (Publisher's content kinds)
  // reads the Director's next release, which `clossys plan` proposes from; the admin publication and pages are exempt by
  // this rule because `clossys init` hard-wires them in every consumer (admin-plan.ts), read from the admin starter.
  M1: (agent, model) => {
    const admin = model.machinery.adminSlots ?? new Set<string>();
    const judged = agent.live.filter(slot => slot.source === "placed" && CONTENT_MAP_KINDS.has(slot.kind ?? "") && !admin.has(slot.id));
    return {
      rows: judged.filter(slot => !slot.inputs.some(ref => qualifiedRef(agent, model, ref) === PLAN_RELEASE_REF))
        .map(slot => `${slot.id}: a ${slot.kind} slot with no ${PLAN_RELEASE_REF} input: run clossys plan, then apply its ia lines once the owner approves`),
      evidence: agent.live.length,
    };
  },
  ...REQUEST_ASSERTIONS,
  // foundry-build-0048 U9a: the agent owns its five loops, each extending Producer's standard loop of the same name.
  W2: agent => {
    const rows: string[] = [];
    const declared = agent.adapter?.loops ?? [];
    if (!isLoopAgent(agent.agent)) return { rows: [`${agent.agent} owns no loops`], evidence: 0 };
    const owner = agent.agent;
    for (const loop of agent.loops) if (!loop.declared) rows.push(`${loop.loop}: conform.json does not declare ${owner}'s ${loop.loop}`);
    for (const id of new Set(declared)) if (declared.indexOf(id) !== declared.lastIndexOf(id)) rows.push(`${id}: declared twice in conform.json loops`);
    const own = agent.loops.filter(loop => loop.declared);
    // Placed: a consumer that places the agent (its IA) or holds any of its loop slots must hold, pin and run all five;
    // no vacuous pass for a consumer that places the agent but never adopted its loops.
    const holds = own.some(loop => loop.placed);
    const placed = holds || agent.placedTree.length > 0;
    for (const loop of own) {
      if (!loop.package.ok) rows.push(`${loop.loop}: ${loop.package.reason}`);
      else for (const issue of agentLoopIssues(owner, loop.loop, loop.package.content, { packageVersion: true })) rows.push(`package ${issue}`);
      if (!placed) continue;
      if (!loop.placed) { rows.push(`${owner}/${loop.loop}: missing (${holds ? `the consumer holds ${owner}'s other loop slots, not this one` : `the consumer places ${owner} but holds none of its loop slots; run clossys loop ${owner}/${loop.loop}`})`); continue; }
      if (!loop.pin?.ok) { rows.push(`${owner}/${loop.loop}: unpinned: ${loop.pin?.reason ?? "no pin"}`); continue; }
      for (const issue of agentLoopIssues(owner, loop.loop, loop.pin.content)) rows.push(`pinned ${loop.pin.ref}: ${issue}`);
    }
    return { rows, evidence: own.length };
  },
};

/**
 * Edges whose target is no slot: an agent-qualified `to` against that agent, a bare one against the edge's
 * target agent, else against the source agent and its upstream agents only. A package edge resolves in the
 * package trees; a placed edge also in the consumer's placed slots. A trailing `*` matches by prefix.
 */
export function dangling(agent: AgentModel, model: ConformModel): Edge[] {
  const resolves = (ids: ReadonlySet<string> | undefined, id: string) =>
    ids !== undefined && (id.endsWith("*") ? [...ids].some(live => live.startsWith(id.slice(0, -1))) : ids.has(id));
  return agent.edges.filter(edge => {
    const match = SLOT_REF.exec(edge.to);
    const agents = match ? [match[1]!] : edge.target ? [edge.target] : [agent.agent, ...upstreamOf(agent.agent)];
    const id = match ? match[2]! : edge.to;
    return !agents.some(name => resolves(model.packageIds.get(name), id) || (edge.scope === "placed" && resolves(model.liveIds.get(name), id)));
  });
}
