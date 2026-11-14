/**
 * R01 Catalog and contract: every agent has one valid IA, and every live slot has one contract.
 * - R01.1 ia.json is valid (validate.ts validateIa plus pipeline/schemas/ia.schema.json) for all
 *   five agents; Producer ids are `seat.<step-id>` (D5) and no other agent uses the seat namespace.
 * - R01.2 every live slot has a slot.json valid against pipeline/schemas/slot.schema.json and
 *   validateSlotDoc, naming its own id and agent, with `kind` in AGENT_KIND[agent]; its contract is
 *   valid against contract-<kind>.schema.json. A kind with no such schema yet is one agent-level row.
 * - R01.3 every contract carries a fixture of its kind's shape (validate.ts fixtureShapeIssues).
 * - R01.4 an agent tree holds only ia.json, ledger.json, policy.json, live slot folders and
 *   tombstones (a folder holding only a ledger.json whose last event is retire-slot); a live slot
 *   folder holds only slot.json, pin.json, candidates/, ledger.json and retired/. The `retired/`
 *   record folders R10 still accepts until the ledger form (W2-B) are accepted here too.
 * - R01.5 Designer, Director and Writer live slots are Foundry-placed leaves or listed extensions.
 * - R01.6 inside one agent, no two live slots share a contract (sha256 of canonical JSON, fixture left out).
 * - R01.7-R01.15 the IA checks (levels, axes, labels, nav parity, extension facet, fanout) live in
 *   rules/r01-ia.ts; rules.json registers them `building` (R01.15 `warn`) until the IA data units land.
 */
import { createHash } from "node:crypto";
import { hasSchema, loadSchema, validateValue } from "../../pipeline/schema.js";
import { AGENT_KIND, fixtureShapeIssues, SLOT_KINDS, validateIa, validateSlotDoc, type SlotKind } from "../../records/slot-model/index.js";
import type { AgentRecord, ConstitutionContext, FoundryAgent, Row, RuleModule, SlotRecord } from "../types.js";
import { R01_IA_CHECKS } from "../rules/r01-ia.js";
import { isObject, listed, liveSlots, row } from "./shared.js";

const AGENT_FILES = new Set(["ia.json", "ledger.json", "policy.json"]);
const SLOT_ENTRIES = new Set(["slot.json", "pin.json", "candidates", "ledger.json", "retired"]);
/** The agents whose live slots must be Foundry leaves or extensions (R01.5). */
export const FOUNDRY_AGENTS: readonly FoundryAgent[] = ["director", "designer", "writer"];

const agentRow = (check: string, agent: AgentRecord, reason: string, path: string): Row => row("R01", check, { agent: agent.agent, id: "*" }, reason, path);
const schemaIssues = (value: unknown, name: string) => validateValue(value, loadSchema(name)).map(issue => `${issue.path} ${issue.message}`);
/** The parsed slot.json of a live slot, when it is an object. */
const slotDocOf = (record: SlotRecord | undefined): Record<string, unknown> | undefined => (isObject(record?.slot?.value) ? record.slot.value : undefined);
const kindOf = (doc: Record<string, unknown>): SlotKind | undefined => (SLOT_KINDS.includes(doc.kind as SlotKind) ? doc.kind as SlotKind : undefined);

/** R01.1 One valid IA per agent. */
export function iaValid(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const agent of ctx.agents) {
    const path = `${agent.dir}/ia.json`;
    if (!agent.ia) { rows.push(agentRow("R01.1", agent, "agent has no ia.json", path)); continue; }
    if (agent.ia.error !== undefined) { rows.push(agentRow("R01.1", agent, `ia.json is unreadable: ${agent.ia.error}`, path)); continue; }
    const issues = [...new Set([...validateIa(agent.ia.value, path, agent.agent).map(issue => issue.message), ...schemaIssues(agent.ia.value, "ia")])];
    if (issues.length) rows.push(agentRow("R01.1", agent, `ia.json is invalid: ${listed(issues, 5)}`, path));
  }
  return rows;
}

/** R01.2 Every live slot has a valid slot.json and a contract valid against its kind's schema. */
export function slotContract(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const agent of ctx.agents) {
    const missingSchemas = new Map<string, string[]>();
    for (const { id, record } of liveSlots(agent)) {
      const ref = { agent: agent.agent, id };
      const path = record?.slot?.path ?? `${agent.dir}/${id}/slot.json`;
      if (!record) { rows.push(row("R01", "R01.2", ref, "live slot has no folder", `${agent.dir}/${id}`)); continue; }
      if (!record.slot) { rows.push(row("R01", "R01.2", ref, "live slot has no slot.json", path)); continue; }
      if (record.slot.error !== undefined) { rows.push(row("R01", "R01.2", ref, `slot.json is unreadable: ${record.slot.error}`, path)); continue; }
      const doc = record.slot.value;
      const issues = [...validateSlotDoc(doc, path).map(issue => issue.message), ...schemaIssues(doc, "slot")];
      if (isObject(doc)) {
        if (doc.id !== id) issues.push(`id must be ${id}, the folder and IA id`);
        if (doc.agent !== agent.agent) issues.push(`agent must be ${agent.agent}, the tree it sits in`);
        const kind = kindOf(doc);
        if (kind && !AGENT_KIND[agent.agent].includes(kind)) issues.push(`kind ${kind} is not one of ${agent.agent}'s kinds (${AGENT_KIND[agent.agent].join(", ")})`);
        if (kind && isObject(doc.contract)) {
          if (hasSchema(`contract-${kind}`)) issues.push(...schemaIssues(doc.contract, `contract-${kind}`).map(issue => `contract ${issue}`));
          else missingSchemas.set(kind, [...(missingSchemas.get(kind) ?? []), id]);
        }
      }
      const unique = [...new Set(issues)];
      if (unique.length) rows.push(row("R01", "R01.2", ref, `slot.json is invalid: ${listed(unique, 5)}`, path));
    }
    for (const [kind, ids] of [...missingSchemas].sort(([a], [b]) => a.localeCompare(b))) {
      rows.push(agentRow("R01.2", agent, `no contract-${kind}.schema.json: ${ids.length} live ${kind} contract(s) cannot be validated (${listed(ids, 3)})`, `packages/producer/pipeline/schemas/contract-${kind}.schema.json`));
    }
  }
  return rows;
}

/** R01.3 Every contract carries a fixture of its kind's shape. */
export function contractFixture(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const agent of ctx.agents) for (const { id, record } of liveSlots(agent)) {
    const doc = slotDocOf(record);
    const kind = doc && kindOf(doc);
    if (!doc || !kind || !isObject(doc.contract)) continue; // R01.2 reports a slot.json with no kind or contract.
    const issues = fixtureShapeIssues(kind, doc.contract);
    if (issues.length) rows.push(row("R01", "R01.3", { agent: agent.agent, id }, `contract.fixture ${listed(issues, 3)} (${kind})`, record!.slot!.path));
  }
  return rows;
}

/** A tombstone: a folder that holds only ledger.json whose last event is retire-slot. */
export function isTombstone(record: SlotRecord): boolean {
  if (record.entries.length !== 1 || record.entries[0] !== "ledger.json") return false;
  const value = record.ledger?.value;
  const events = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.events) ? value.events : [];
  const last: unknown = events[events.length - 1];
  return isObject(last) && last.op === "retire-slot";
}

/** R01.4 An agent tree holds only live slots, tombstones, ledger.json and policy.json (plus ia.json). */
export function treeShape(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const agent of ctx.agents) {
    const live = new Set(agent.liveIds);
    for (const name of agent.entries) {
      const path = `${agent.dir}/${name}`;
      if (name === "retired") continue; // R10's agent-level retire records, until the ledger form (W2-B).
      const record = agent.slots.get(name);
      if (!record) {
        if (!AGENT_FILES.has(name)) rows.push(agentRow("R01.4", agent, `${name} is not ia.json, ledger.json, policy.json or a slot folder`, path));
        continue;
      }
      const ref = { agent: agent.agent, id: name };
      if (!live.has(name)) {
        if (isTombstone(record)) continue;
        const why = name === "requests" ? "the old requests/ queue is retired (handoff requests, R19)" : "a folder ia.json does not place must be a tombstone (only ledger.json, last event retire-slot)";
        rows.push(row("R01", "R01.4", ref, why, record.dir));
        continue;
      }
      const stray = record.entries.filter(entry => !SLOT_ENTRIES.has(entry));
      if (stray.length) rows.push(row("R01", "R01.4", ref, `a live slot folder holds only slot.json, pin.json, candidates/, ledger.json and retired/; found ${listed(stray)}${stray.includes("seat.json") ? " (seat.json is retired)" : ""}`, record.dir));
    }
  }
  return rows;
}

/** R01.5 Designer, Director and Writer live slots are Foundry-placed leaves or listed extensions. */
export function foundryPlaced(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const agent of ctx.agents) {
    if (!(FOUNDRY_AGENTS as readonly string[]).includes(agent.agent)) continue;
    const extensions = new Set(isObject(agent.ia?.value) && Array.isArray(agent.ia.value.extensions) ? agent.ia.value.extensions.filter((id): id is string => typeof id === "string") : []);
    const outside = liveSlots(agent).filter(({ id }) => !extensions.has(id));
    if (!outside.length) continue; // every live slot is a listed extension: the Foundry IA is not read.
    let leaves: ReadonlySet<string>;
    try { leaves = ctx.foundryLeaves(agent.agent as FoundryAgent); }
    catch (error) { rows.push(agentRow("R01.5", agent, `the Foundry ${agent.agent} IA is unreadable: ${error instanceof Error ? error.message : String(error)}`, `${agent.dir}/ia.json`)); continue; }
    for (const { id, record } of outside) {
      if (leaves.has(id)) continue;
      rows.push(row("R01", "R01.5", { agent: agent.agent, id }, "live slot is neither a Foundry-placed leaf nor listed in ia.json extensions", record?.dir ?? `${agent.dir}/ia.json`));
    }
  }
  return rows;
}

/** Canonical JSON: object keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** The contract hash R01.6 dedupes on: sha256 of the canonical contract with `fixture` left out. */
export function contractHash(contract: Record<string, unknown>): string {
  const { fixture: _fixture, ...rest } = contract;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

/** R01.6 Pairwise leaf dedupe: inside one agent, no two live slots have the same contract. */
export function contractDedupe(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const agent of ctx.agents) {
    const first = new Map<string, string>();
    for (const { id, record } of liveSlots(agent)) {
      const doc = slotDocOf(record);
      if (!doc || !isObject(doc.contract)) continue;
      const hash = contractHash(doc.contract);
      const owner = first.get(hash);
      if (owner === undefined) { first.set(hash, id); continue; }
      rows.push(row("R01", "R01.6", { agent: agent.agent, id }, `contract equals ${owner}'s (fixture left out): two live slots, one contract`, record!.slot!.path));
    }
  }
  return rows;
}

export const R01: RuleModule = {
  rule: "R01",
  checks: {
    "R01.1": iaValid,
    "R01.2": slotContract,
    "R01.3": contractFixture,
    "R01.4": treeShape,
    "R01.5": foundryPlaced,
    "R01.6": contractDedupe,
    ...R01_IA_CHECKS,
  },
};
