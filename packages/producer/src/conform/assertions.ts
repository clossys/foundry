/**
 * The conformance assertions (foundry-build-0048 U1): one pure function per row of assertions.json, judging
 * one agent of a read model (model.ts). Each returns the red rows it found and how many facts it judged.
 * Empty is red: an assertion that judged nothing (`evidence` 0) is red as vacuous, never green.
 */
import { validateValue } from "../pipeline/schema.js";
import { EXEMPLARS_MAX, EXEMPLARS_MIN } from "../records/standards.js";
import type { ProbeFacts } from "./dogfood.js";
import { refsIn, SLOT_REF, slotLeaves, treeLeaves, upstreamOf, type AgentModel, type ConformModel, type Edge, type LiveSlot } from "./model.js";
// U4b: a page recipe fixture is judged by the real Publisher page check (recipe-page.ts).
import { isPageRecord, pageFixtureOf } from "../actions/page-option.js";
import { requirementsVerdictSync } from "../constitution/certify/requirements.js";
import type { JsonSchema } from "../pipeline/schema.js";
import { recipePageKey } from "./recipe-page.js";

export interface Judgement { readonly rows: readonly string[]; readonly evidence: number }
/** `facts` carries what the runner probed by running real verbs on a temporary copy (dogfood.ts readProbeFacts). */
export type Assertion = (agent: AgentModel, model: ConformModel, facts?: ProbeFacts) => Judgement;

/** Each held kind's certifier and contract family. */
export const KIND_FAMILY: Readonly<Record<string, string>> = {
  brief: "brief",
  "element/token": "element", "element/asset": "element", "element/component": "element", "element/section": "element", "element/frame": "element",
  voice: "strings", prose: "strings", copy: "strings",
  page: "page", layout: "page", chrome: "page", publication: "publication", release: "publication",
};

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
/** Above this name similarity two same-kind, same-input leaves overlap (`primary-foreground` vs `sidebar-primary-foreground` is 0.67: token siblings, not overlap). Pinned by conform.test.ts. */
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
/** At this many slot-id literals one module holds a fixed list, not a derivation. */
export const FIXED_LIST_MIN = 5;

export const ASSERTIONS: Readonly<Record<string, Assertion>> = {
  S1: agent => {
    const pkg = new Set(agent.trees.flatMap(tree => slotLeaves(tree))), placed = new Set(placedIds(agent));
    const rows = [...pkg].filter(id => !placed.has(id)).map(id => `${id}: in the package tree, not placed`)
      .concat([...placed].filter(id => !pkg.has(id)).map(id => `${id}: placed, not in the package tree`));
    if (pkg.size !== placed.size) rows.unshift(`package tree has ${pkg.size} leaves, the placed tree ${placed.size}`);
    return { rows, evidence: Math.min(pkg.size, placed.size) };
  },
  S2: agent => {
    const l1s = agent.trees.flatMap(tree => tree.l1.filter(l1 => !l1.parked).map(l1 => ({ tree: tree.file, l1 })));
    return { rows: l1s.filter(({ l1 }) => l1.l2.filter(l2 => !l2.parked).length < 2).map(({ tree, l1 }) => `${tree} ${l1.id}: ${l1.l2.filter(l2 => !l2.parked).length} L2`), evidence: l1s.length };
  },
  S3: agent => {
    const folders = new Set(agent.folders), placed = new Set(placedIds(agent));
    const l2s = agent.placedTree.flatMap(l1 => l1.l2.map(l2 => ({ l1: l1.id, l2 })));
    const rows = l2s.filter(({ l2 }) => !l2.slots.some(id => folders.has(id))).map(({ l1, l2 }) => `${l1}/${l2.id}: no live L3`)
      .concat([...placed].filter(id => !folders.has(id)).map(id => `${id}: placed with no slot folder`))
      .concat([...folders].filter(id => !placed.has(id)).map(id => `${id}: slot folder not placed in ia.json (orphan)`));
    return { rows, evidence: l2s.length };
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
      // Purpose, whatever the name: both are for the same foreign slot, or one L2 holds both with the same inputs and requirements.
      const shared = [...subjects.get(a.id)!].filter(subject => subjects.get(b.id)!.has(subject));
      if (shared.length) { rows.push(`${a.id} and ${b.id}: both are for ${shared.join(", ")} (same purpose)`); continue; }
      const l2 = agent.l2Of.get(a.id);
      const inA = inputs.get(a)!, inB = inputs.get(b)!;
      if (l2 !== undefined && l2 === agent.l2Of.get(b.id) && sameList(inA, inB) && sameList(requirementsOf(a), requirementsOf(b))) {
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
  L1: (agent, model) => {
    const rows: string[] = [];
    if (!model.machinery.slotRequestSchema) rows.push("no clossys.slot-request/1 schema under packages/producer/schemas/");
    if (!model.machinery.loops.get("loop.slot")) rows.push("no loop.slot version in packages/producer/loops/");
    const filed = new Set(agent.requests.map(request => String(request.need ?? "")));
    for (const edge of dangling(agent, model)) if (!filed.has(edge.to)) rows.push(`${edge.from} needs ${edge.to}: no slot, no slot-request`);
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
    const closed = agent.requests.filter(request => request.status === "closed" || request.placed !== undefined);
    return {
      rows: closed.filter(request => !(typeof request.placed === "string" && SLOT_REF.test(request.placed) && request.notified !== undefined))
        .map(request => `${String(request.id)}: closed without a slot-to-slot link and notify event`),
      evidence: closed.length,
    };
  },
  L5: agent => {
    const rows = agent.derive.flatMap(entry => {
      if (entry.text === undefined) return [`${entry.module}: missing`];
      const ids = new Set([...entry.text.matchAll(ID_LITERAL)].map(match => match[1]!));
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
      const family = KIND_FAMILY[kind];
      if (!family || !model.machinery.certifiers.has(family)) rows.push(`${kind}: no certifier`);
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
    rows: agent.live.filter(slot => !(object(slot.family) && ["options", "varyOn", "values"].every(key => Array.isArray((slot.family as Record<string, unknown>)[key]))))
      .map(slot => `${slot.id}: no family {options, varyOn, values}`),
    evidence: agent.live.length,
  }),
  C2: (agent, model) => ({
    rows: agent.live.flatMap(slot => {
      const requirements = slot.contract.requirements;
      if (!Array.isArray(requirements) || !requirements.length) return [`${slot.id}: contract carries no requirements`];
      const unknown = requirements.map(item => object(item) ? String(item.criterion ?? item.id ?? "") : String(item)).filter(id => !model.machinery.criteria.has(id));
      return unknown.length ? [`${slot.id}: unregistered criteria ${unknown.join(", ")}`] : [];
    }),
    evidence: agent.live.length,
  }),
  C3: (agent, model) => {
    const pinned = pins(agent);
    return {
      rows: [...ruleRow(model, "R05.2", agent.agent), ...pinned.filter(slot => !(object(slot.pin!.verdict) && (slot.pin!.verdict as Record<string, unknown>).pass === true))
        .map(slot => `${slot.id}: pinned without a passing verdict`)],
      evidence: pinned.length,
    };
  },
  C4: agent => {
    const pinned = pins(agent);
    return {
      rows: pinned.filter(slot => !(typeof slot.pin!.basis === "string" && /scorecard/.test(slot.pin!.basis))).map(slot => `${slot.id}: pin basis cites no scorecard`),
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
      const version = model.machinery.loops.get(`loop.${loop}`);
      if (!version) rows.push(`loop.${loop}: no version`);
      else if (!version.steps.some(step => object(step.decider) && step.decider.agent === agent.agent)) rows.push(`loop.${loop}: no step reaches ${agent.agent}`);
    }
    for (const skill of agent.skills) {
      if (skill.path === null) rows.push(`${skill.loop}: names no skill`);
      else if (!skill.exists) rows.push(`${skill.loop}: ${skill.path} is missing`);
      else if (!skill.registered) rows.push(`${skill.loop}: ${skill.path} is not hash-registered`);
    }
    return { rows, evidence: 5 + agent.skills.length };
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
