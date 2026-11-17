/**
 * R15 Standards and recipes (slot-constitution.md section 2, SC15; sections 3, 5a, 5b). Status
 * `building`: reported, never failing a non-strict run (section 4).
 *
 * Unlike the record rules, R15 reads two trees the context does not carry: the standards and recipes
 * under `packages/<agent>/` (plain files, not the slot model) and the agent taste logs, policy.json
 * and slot critiques (through the slot reader). They are read once per context and cached.
 */
import { join } from "node:path";
import { loadSchema, validateValue } from "../../pipeline/schema.js";
import { loadRecipes, produceIssues, recipesFor, type Recipe } from "../../records/recipes.js";
import type { ModelAgent } from "../../records/slot-model/index.js";
import { modelExists, readModelText } from "../../records/slots.js";
import {
  exemplarIssues, ledgerEvents, loadStandards, readStandardPolicy, requirementIssues, seedIssues, standardFits, standardFor, tasteIssues,
  type Standard, type StandardPolicy,
} from "../../records/standards.js";
import { criterionIds } from "../criteria/core/catalog.js";
import { isObject, liveSlotRecords, slotDoc, stringList } from "../checks/shared.js";
import type { Check, ConstitutionContext, Row, RuleModule, SlotRecord } from "../types.js";

/** Everything R15 and R16 judge beyond the context, read once per context. */
export interface StandardsWorld {
  readonly standards: readonly Standard[];
  readonly recipes: readonly Recipe[];
  readonly registered: ReadonlySet<string>;
  readonly policy: (agent: ModelAgent) => StandardPolicy;
}

const worlds = new WeakMap<ConstitutionContext, StandardsWorld>();
export function standardsWorld(ctx: ConstitutionContext): StandardsWorld {
  let world = worlds.get(ctx);
  if (!world) {
    const policies = new Map<ModelAgent, StandardPolicy>();
    world = {
      standards: loadStandards(ctx.root),
      recipes: loadRecipes(ctx.root),
      registered: criterionIds(),
      policy: agent => {
        if (!policies.has(agent)) policies.set(agent, readStandardPolicy(ctx.consumer, agent));
        return policies.get(agent)!;
      },
    };
    worlds.set(ctx, world);
  }
  return world;
}

/** A row about a standard or recipe folder (no slot): `slot` is `standards/<id>` or `recipes/<id>`. */
const folderRow = (check: string, owner: { agent: string; id: string; dir: string }, what: "standards" | "recipes", reason: string): Row =>
  ({ rule: "R15", check, agent: owner.agent, slot: `${what}/${owner.id}`, reason, path: owner.dir });
const slotRow = (check: string, slot: SlotRecord, reason: string, path = `${slot.dir}/slot.json`, candidate?: string): Row =>
  ({ rule: "R15", check, agent: slot.agent, slot: slot.id, ...(candidate ? { candidate } : {}), reason, path });

/** The slot.json fields R15 reads, when slot.json parsed. */
function slotFields(slot: SlotRecord): { kind?: string; standard?: string; contract?: unknown } | undefined {
  const doc = slotDoc(slot);
  if (!isObject(doc)) return undefined;
  return {
    ...(typeof doc.kind === "string" ? { kind: doc.kind } : {}),
    ...(typeof doc.standard === "string" ? { standard: doc.standard } : {}),
    contract: doc.contract,
  };
}

/** R15.1: each live slot's slot.json names one existing standard of its agent whose kinds include its kind. */
export const r15_1: Check = ctx => {
  const world = standardsWorld(ctx);
  const rows: Row[] = [];
  for (const slot of liveSlotRecords(ctx)) {
    const fields = slotFields(slot);
    if (!fields) continue; // no parseable slot.json: R01 reports it
    if (!fields.standard) { rows.push(slotRow("R15.1", slot, "slot.json names no standard")); continue; }
    const standard = standardFor(world.standards, slot.agent, fields.standard);
    if (!standard) { rows.push(slotRow("R15.1", slot, `standard ${fields.standard} does not exist under packages/${slot.agent}/standards/`)); continue; }
    if (!standard.doc) continue; // invalid standard: R15.2
    if (!fields.kind || !standardFits(standard.doc, fields.kind, fields.contract)) {
      rows.push(slotRow("R15.1", slot, `standard ${fields.standard} serves ${standard.doc.kinds.join(", ")}, not this slot's kind ${fields.kind ?? "(none)"}${isObject(fields.contract) && typeof fields.contract.kind === "string" ? `/${fields.contract.kind}` : ""}`));
    }
  }
  return rows;
};

/** R15.2: every standard has a valid requirements.json, taste.md and exemplars/. */
export const r15_2: Check = ctx => standardsWorld(ctx).standards.flatMap(standard => standard.issues.map(issue => folderRow("R15.2", standard, "standards", issue)));

/** R15.3: every requirement is a criterion registered under src/constitution/criteria/(*)/index.json. */
export const r15_3: Check = ctx => {
  const world = standardsWorld(ctx);
  return world.standards.flatMap(standard => requirementIssues(standard, world.registered).map(issue => folderRow("R15.3", standard, "standards", issue)));
};

/** R15.4: taste criteria are anchored 1-5 and never decide pass/fail. */
export const r15_4: Check = ctx => {
  const world = standardsWorld(ctx);
  return world.standards.flatMap(standard => tasteIssues(standard, world.registered).map(issue => folderRow("R15.4", standard, "standards", issue)));
};

/** R15.5: every standard has a valid recipe producing for it; every recipe is valid, rubric-free and deterministic. */
export const r15_5: Check = ctx => {
  const world = standardsWorld(ctx);
  const rows: Row[] = [];
  for (const standard of world.standards) if (!recipesFor(world.recipes, standard).length) rows.push(folderRow("R15.5", standard, "standards", `no valid recipe under packages/${standard.agent}/recipes/ produces for ${standard.id}`));
  for (const recipe of world.recipes) {
    for (const issue of recipe.issues) rows.push(folderRow("R15.5", recipe, "recipes", issue));
    for (const issue of produceIssues(recipe, world.standards)) if (!issue.startsWith("adopt recipe")) rows.push(folderRow("R15.5", recipe, "recipes", issue));
  }
  return rows;
};

/** R15.6: 5-12 exemplars keyed to taste criteria; stored files only under an allowlisted license. */
export const r15_6: Check = ctx => {
  const world = standardsWorld(ctx);
  return world.standards.flatMap(standard => exemplarIssues(standard, world.policy(standard.agent)).map(issue => folderRow("R15.6", standard, "standards", issue)));
};

const CRAFT = /^craft:(brief|diverge|render|critique|refine)$/;
/** Section 5b order: brief, diverge, render, critique, then at most 2 refine rounds (each re-rendered and re-checked). */
const CRAFT_ORDER = /^brief diverge render critique(?: refine(?: render)?(?: critique)?){0,2}$/;

/** The issues of one P2 run's craft events (between two submits): order, directions and their axes. */
export function craftIssues(events: readonly Record<string, unknown>[], recipes: readonly Recipe[], agent: string): string[] {
  const issues: string[] = [];
  const stages = events.map(event => String(event.op).slice("craft:".length));
  if (!CRAFT_ORDER.test(stages.join(" "))) issues.push(`craft events ${stages.join(", ") || "(none)"} are not brief, diverge, render, critique, then at most 2 refine rounds`);
  const diverge = events.find(event => event.op === "craft:diverge");
  if (!diverge) return issues;
  const directions = Array.isArray(diverge.directions) ? diverge.directions.filter(isObject) : [];
  if (directions.length < 3 || directions.length > 4) issues.push(`craft:diverge has ${directions.length} directions; 3 to 4 required`);
  const recipeId = [diverge, ...events].map(event => event.recipe).find((value): value is string => typeof value === "string");
  const recipe = recipes.find(item => item.id === recipeId && item.agent === agent) ?? recipes.find(item => item.id === recipeId);
  const axisValues = directions.map(direction => isObject(direction.axes) ? direction.axes : {});
  const axes = recipe?.doc?.axes.length ? [...recipe.doc.axes] : [...new Set(axisValues.flatMap(values => Object.keys(values)))].sort();
  if (!axes.length) issues.push("craft:diverge directions carry no axes");
  for (const axis of axes) {
    const values = axisValues.map(values => values[axis]);
    if (values.some(value => value === undefined || value === "")) { issues.push(`a direction has no value on axis ${axis}`); continue; }
    const keys = values.map(value => JSON.stringify(value));
    if (new Set(keys).size !== keys.length) issues.push(`directions repeat a value on axis ${axis}: cosmetic variants`);
  }
  return issues;
}

/** The critique record name of a candidate: `<leaf>-v<n>.json`. */
export const critiqueName = (candidate: string) => `${candidate.replace(/\.[^.]+$/, "")}.json`;

/**
 * R15.7: every P2 candidate (a submit with rung adapt or create, or any submit preceded by craft
 * events) has the section 5b craft events in order and a critique record. The process, never the scores.
 */
export const r15_7: Check = ctx => {
  const world = standardsWorld(ctx);
  const rows: Row[] = [];
  for (const slot of liveSlotRecords(ctx)) {
    const events = ledgerEvents(slot.ledger?.value);
    let since: Record<string, unknown>[] = [];
    for (const event of events) {
      if (event.op !== "submit") { if (typeof event.op === "string" && CRAFT.test(event.op)) since.push(event); continue; }
      const name = typeof event.name === "string" ? event.name : undefined;
      const p2 = event.rung === "adapt" || event.rung === "create" || since.length > 0;
      if (p2 && name) {
        for (const issue of craftIssues(since, world.recipes, slot.agent)) rows.push(slotRow("R15.7", slot, issue, slot.ledger?.path ?? `${slot.dir}/ledger.json`, name));
        const critique = join(ctx.root, slot.dir, "critiques", critiqueName(name));
        if (!modelExists(critique)) rows.push(slotRow("R15.7", slot, `no critique record critiques/${critiqueName(name)}`, `${slot.dir}/critiques/${critiqueName(name)}`, name));
      }
      since = [];
    }
  }
  return rows;
};

interface TasteLog { readonly entries: readonly { slot: string; chosen: string | null; rejected: readonly string[] }[]; readonly error?: string }
/** A standard's taste log (`<consumer>/agents/<agent>/taste/<id>/taste-log.json`), validated. */
export function readTasteLog(consumer: string, agent: string, standard: string): TasteLog | undefined {
  const path = join(consumer, "agents", agent, "taste", standard, "taste-log.json");
  if (!modelExists(path)) return undefined;
  try {
    const value = JSON.parse(readModelText(path)) as { standard?: unknown; entries?: TasteLog["entries"] };
    const issues = validateValue(value, loadSchema("taste-log"));
    if (issues.length) return { entries: [], error: issues.map(issue => `${issue.path} ${issue.message}`).join("; ") };
    if (value.standard !== standard) return { entries: [], error: `standard ${String(value.standard)} is not ${standard}` };
    return { entries: value.entries ?? [] };
  } catch (error) { return { entries: [], error: (error as Error).message }; }
}

/** An owner pick or reject: op `pick` or `reject` decided by the owner (`by` or `decidedBy`). */
function ownerDecision(event: Record<string, unknown>): { kind: "pick" | "reject"; candidate?: string; rejected: string[] } | undefined {
  if (event.op !== "pick" && event.op !== "reject") return undefined;
  if (event.by !== "owner" && event.decidedBy !== "owner") return undefined;
  const candidate = typeof event.candidate === "string" ? event.candidate : typeof event.name === "string" ? event.name : undefined;
  return { kind: event.op, ...(candidate ? { candidate } : {}), rejected: stringList(event.rejected) };
}

/** R15.8: every owner pick or reject on a craftTier high standard's slot has a taste-log entry. */
export const r15_8: Check = ctx => {
  const world = standardsWorld(ctx);
  const rows: Row[] = [];
  const logs = new Map<string, TasteLog | undefined>();
  for (const slot of liveSlotRecords(ctx)) {
    const id = slotFields(slot)?.standard;
    const standard = id ? standardFor(world.standards, slot.agent, id) : undefined;
    if (standard?.doc?.craftTier !== "high") continue;
    const key = `${slot.agent}/${standard.id}`;
    if (!logs.has(key)) logs.set(key, readTasteLog(ctx.consumer, slot.agent, standard.id));
    const log = logs.get(key);
    const logPath = `clossys/agents/${slot.agent}/taste/${standard.id}/taste-log.json`;
    for (const event of ledgerEvents(slot.ledger?.value)) {
      const decision = ownerDecision(event);
      if (!decision) continue;
      if (log?.error) { rows.push(slotRow("R15.8", slot, `taste log is invalid: ${log.error}`, logPath, decision.candidate)); continue; }
      const entries = (log?.entries ?? []).filter(entry => entry.slot === slot.id);
      const logged = decision.kind === "pick"
        ? entries.some(entry => entry.chosen === decision.candidate && decision.rejected.every(name => entry.rejected.includes(name)))
        : entries.some(entry => decision.candidate !== undefined && entry.rejected.includes(decision.candidate));
      if (!logged) rows.push(slotRow("R15.8", slot, `owner ${decision.kind} of ${decision.candidate ?? "(no candidate)"} has no taste-log entry`, logPath, decision.candidate));
    }
  }
  return rows;
};

/** R15.9: only Designer standards list seeds, from policy.json registries; no adopt recipe for a standard without seeds. */
export const r15_9: Check = ctx => {
  const world = standardsWorld(ctx);
  const rows: Row[] = world.standards.flatMap(standard => seedIssues(standard, world.policy("designer")).map(issue => folderRow("R15.9", standard, "standards", issue)));
  for (const recipe of world.recipes) for (const issue of produceIssues(recipe, world.standards)) if (issue.startsWith("adopt recipe")) rows.push(folderRow("R15.9", recipe, "recipes", issue));
  return rows;
};

export const R15_CHECKS = { "R15.1": r15_1, "R15.2": r15_2, "R15.3": r15_3, "R15.4": r15_4, "R15.5": r15_5, "R15.6": r15_6, "R15.7": r15_7, "R15.8": r15_8, "R15.9": r15_9 } as const;
export const R15: RuleModule = { rule: "R15", checks: R15_CHECKS };
