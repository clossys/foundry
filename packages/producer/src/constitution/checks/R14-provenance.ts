/**
 * R14 Provenance, over every slot ledger and every agent ledger (records/ledger.ts):
 * - R14.1 every candidate, pin.json, slot.json and ia.json byte state matches a ledger event: a
 *   candidate's sha256 is its `submit` event's (carried through later `migrate` events), and a record
 *   file's sha256 is the one the last event that wrote it recorded (null: the event removed it). A
 *   missing, unreadable or malformed ledger proves nothing, so every record it should cover is a row;
 * - R14.2 every event names a verb from the verb table and an action skill whose sha256 is the
 *   installed file's or is listed in src/constitution/skill-hashes.json (ctx.skillShas); an event
 *   whose skill file was missing when it ran (sha256 null) is a row. A plumb action carries no skill
 *   (docs/step-standard.md), so an event may instead cite `packages/<pkg>/actions/<step>/action.json`
 *   with a known sha256, but only when the actions registry has that step as `plumb` (ctx.actionKind);
 *   a decide action's events (and an unregistered step's) still cite its skill.md;
 * - R14.3 events that ran an LLM name the model and tier; deterministic verbs record none/none.
 */
import { ACTION_CONTRACT_PATH, SKILL_PATH, VERBS, eventIssues, expectedCandidateSha, lastRecordState, ledgerEventsOf, modelTierIssues, type RecordFile } from "../../records/ledger.js";
import type { AgentRecord, ConstitutionContext, JsonRecord, Row, RuleModule, SlotRecord } from "../types.js";
import { allSlots, isObject, listed, row } from "./shared.js";

/** The structural issues of a ledger's events, without the verb, skill and model/tier issues R14.2 and R14.3 report. */
function structureIssues(events: readonly Record<string, unknown>[], scope: "slot" | "agent"): string[] {
  const owned = /^(verb |skill\.|names no model and tier|model |verb \S+ (runs an LLM|is deterministic))/;
  const issues: string[] = [];
  events.forEach((event, index) => { for (const issue of eventIssues(event, scope)) if (!owned.test(issue)) issues.push(`events[${index}]: ${issue}`); });
  return issues;
}

/** A ledger as read for R14: its events, or why it proves nothing. */
function readLedgerRecord(ledger: JsonRecord | undefined, scope: "slot" | "agent"): { events?: Record<string, unknown>[]; problem?: string } {
  if (!ledger) return { problem: "has no ledger.json" };
  if (ledger.error !== undefined) return { problem: `ledger.json is unreadable (${ledger.error})` };
  const events = ledgerEventsOf(ledger.value);
  if (!events || !isObject(ledger.value)) return { problem: "ledger.json is not {schema, events}" };
  const issues = structureIssues(events, scope);
  if (issues.length) return { events, problem: `ledger.json is malformed: ${listed(issues, 3)}` };
  return { events };
}

/** A record file's state against the ledger: undefined when it matches the last event that wrote it. */
function recordMismatch(events: readonly Record<string, unknown>[], file: RecordFile, record: JsonRecord | undefined): string | undefined {
  const state = lastRecordState(events, file);
  const actual = record ? record.sha256 ?? "unreadable" : null;
  if (!state) return actual === null ? undefined : `${file} has no ledger event that wrote it`;
  if (state.sha256 === actual) return undefined;
  if (actual === null) return `${file} is absent but its last ledger event recorded ${state.sha256!.slice(0, 12)}`;
  if (state.sha256 === null) return `${file} exists but its last ledger event removed it`;
  return `${file} bytes (${String(actual).slice(0, 12)}) differ from its last ledger event (${state.sha256.slice(0, 12)})`;
}

function slotRows(slot: SlotRecord): Row[] {
  const rows: Row[] = [];
  const read = readLedgerRecord(slot.ledger, "slot");
  const ledgerPath = slot.ledger?.path ?? `${slot.dir}/ledger.json`;
  if (read.problem !== undefined || !read.events) {
    const why = `slot ${read.problem ?? "has no ledger"}`;
    if (slot.ledger) rows.push(row("R14", "R14.1", slot, `${why}; no record of this slot has provenance`, ledgerPath));
    for (const candidate of slot.candidates) rows.push(row("R14", "R14.1", slot, `candidate ${candidate.name} has no provenance: ${why}`, candidate.path, candidate.name));
    if (slot.pin) rows.push(row("R14", "R14.1", slot, `pin.json has no provenance: ${why}`, slot.pin.path));
    if (slot.slot) rows.push(row("R14", "R14.1", slot, `slot.json has no provenance: ${why}`, slot.slot.path));
    return rows;
  }
  for (const candidate of slot.candidates) {
    const expected = expectedCandidateSha(read.events, candidate.name);
    if (!expected.submitted) rows.push(row("R14", "R14.1", slot, `candidate ${candidate.name} has no submit event`, candidate.path, candidate.name));
    else if (expected.sha256 !== candidate.sha256) rows.push(row("R14", "R14.1", slot, `candidate ${candidate.name} bytes (${candidate.sha256.slice(0, 12)}) differ from its submit event (${String(expected.sha256).slice(0, 12)})`, candidate.path, candidate.name));
  }
  const pin = recordMismatch(read.events, "pin.json", slot.pin);
  if (pin) rows.push(row("R14", "R14.1", slot, pin, slot.pin?.path ?? `${slot.dir}/pin.json`));
  const doc = recordMismatch(read.events, "slot.json", slot.slot);
  if (doc) rows.push(row("R14", "R14.1", slot, doc, slot.slot?.path ?? `${slot.dir}/slot.json`));
  return rows;
}

function agentRows(agent: AgentRecord): Row[] {
  const at = { agent: agent.agent, id: "*" };
  const read = readLedgerRecord(agent.ledger, "agent");
  const iaPath = agent.ia?.path ?? `${agent.dir}/ia.json`;
  if (read.problem !== undefined || !read.events) {
    const rows: Row[] = [];
    if (agent.ledger) rows.push(row("R14", "R14.1", at, `agent ${read.problem ?? "has no ledger"}`, agent.ledger.path));
    if (agent.ia) rows.push(row("R14", "R14.1", at, `ia.json has no provenance: agent ${read.problem ?? "has no ledger"}`, iaPath));
    return rows;
  }
  const ia = recordMismatch(read.events, "ia.json", agent.ia);
  return ia ? [row("R14", "R14.1", at, ia, iaPath)] : [];
}

export function recordsMatchLedger(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) rows.push(...slotRows(slot));
  for (const agent of ctx.agents) rows.push(...agentRows(agent));
  return rows;
}

/** Every ledger in the workspace with its events and where its rows go. */
function* ledgers(ctx: ConstitutionContext): Generator<{ at: { agent: SlotRecord["agent"]; id: string }; path: string; events: Record<string, unknown>[] }> {
  for (const agent of ctx.agents) {
    const events = agent.ledger?.error === undefined ? ledgerEventsOf(agent.ledger?.value) : undefined;
    if (agent.ledger && events) yield { at: { agent: agent.agent, id: "*" }, path: agent.ledger.path, events };
  }
  for (const slot of allSlots(ctx)) {
    const events = slot.ledger?.error === undefined ? ledgerEventsOf(slot.ledger?.value) : undefined;
    if (slot.ledger && events) yield { at: slot, path: slot.ledger.path, events };
  }
}

export function eventsNameSkill(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const ledger of ledgers(ctx)) {
    const issues: string[] = [];
    ledger.events.forEach((event, index) => {
      const where = `events[${index}] (${String(event.op)})`;
      if (!(VERBS as readonly unknown[]).includes(event.verb)) issues.push(`${where} verb ${JSON.stringify(event.verb)} is not in the verb table`);
      const skill = event.skill;
      const noSkill = `${where} names no action skill (packages/<pkg>/actions/<step>/skill.md)`;
      if (!isObject(skill) || typeof skill.path !== "string") { issues.push(noSkill); return; }
      const contract = ACTION_CONTRACT_PATH.exec(skill.path);
      if (contract) {
        const kind = ctx.actionKind(contract[1]!, contract[2]!);
        if (kind !== "plumb") { issues.push(`${where} cites ${skill.path}, but only a plumb action's events may cite its action.json; ${kind === undefined ? "the actions registry has no such step" : `the registry has it as ${kind}, whose events cite its skill.md`}`); return; }
      } else if (!SKILL_PATH.test(skill.path)) { issues.push(noSkill); return; }
      if (skill.sha256 === null) { issues.push(`${where} ran ${skill.path} while that file was missing (skill.sha256 null)`); return; }
      if (typeof skill.sha256 !== "string" || !ctx.skillShas(skill.path).has(skill.sha256)) issues.push(`${where} skill ${skill.path} sha256 ${String(skill.sha256).slice(0, 12)} is neither the installed file's nor listed in skill-hashes.json`);
    });
    if (issues.length) rows.push(row("R14", "R14.2", ledger.at, listed(issues), ledger.path));
  }
  return rows;
}

export function llmNamesModel(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const ledger of ledgers(ctx)) {
    const issues: string[] = [];
    ledger.events.forEach((event, index) => { for (const issue of modelTierIssues(event)) issues.push(`events[${index}] (${String(event.op)}) ${issue}`); });
    if (issues.length) rows.push(row("R14", "R14.3", ledger.at, listed(issues), ledger.path));
  }
  return rows;
}

export const R14: RuleModule = {
  rule: "R14",
  checks: {
    "R14.1": recordsMatchLedger,
    "R14.2": eventsNameSkill,
    "R14.3": llmNamesModel,
  },
};
