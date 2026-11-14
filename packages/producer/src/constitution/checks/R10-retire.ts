/**
 * R10 Retire: retire records are well-formed and retired things stay gone. Three record forms are
 * accepted until the ledger form lands (W2-B):
 * - `clossys retire` records, `retired/<candidate>.json` in a slot folder (or `retired/<slot>.json` in an
 *   agent folder) with schema clossys.retire/1 (schemas/retire.schema.json); a retired candidate's
 *   file may sit beside its record in `retired/`;
 * - ledger `retire-candidate {name, sha256, code}` and `retire-slot {code}` events in a slot ledger.json;
 * - a tombstone: a slot folder that is not live and holds only ledger.json whose last event is retire-slot.
 * Checks: R10.1 candidate retires (record valid, file gone from candidates/, bytes match the record);
 * R10.2 slot retires (record or tombstone valid, slot not live); R10.3 a retired slot id or candidate
 * name is never placed or written again.
 */
import { validateAgainst } from "../schema.js";
import type { AgentRecord, ConstitutionContext, RetiredRecord, Row, RuleModule, SlotRecord } from "../types.js";
import { allSlots, isObject, listed, row } from "./shared.js";

export const RETIRE_CODES = ["uncertified", "superseded", "edited-in-place", "not-needed", "duplicate", "shared-split"] as const;
const RECORD_NAME = /\.json$/;
const CANDIDATE_FILE = /-v[1-9][0-9]*\.(?:md|json)$/;

/**
 * A retired/ entry is a record when it is `<candidate>.json` (`hero-v2.md.json`, `hero-v2.json.json`)
 * or any other `.json` that is not itself a candidate file name; a candidate-named file is the
 * retired candidate's bytes.
 */
export function isRecord(entry: Pick<RetiredRecord, "name">): boolean {
  if (/-v[1-9][0-9]*\.(?:md|json)\.json$/.test(entry.name)) return true;
  return RECORD_NAME.test(entry.name) && !CANDIDATE_FILE.test(entry.name);
}

interface LedgerEvent { readonly op?: unknown; readonly name?: unknown; readonly sha256?: unknown; readonly code?: unknown }
function ledgerEvents(slot: SlotRecord): LedgerEvent[] | undefined {
  const value = slot.ledger?.value;
  const events = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.events) ? value.events : undefined;
  return events?.filter(isObject) as LedgerEvent[] | undefined;
}

export function candidateRetires(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) {
    const files = new Map(slot.retired.filter(entry => !isRecord(entry)).map(entry => [entry.name, entry]));
    for (const entry of slot.retired.filter(isRecord)) {
      const issues: string[] = [];
      if (entry.error !== undefined) issues.push(entry.error);
      else {
        issues.push(...validateAgainst("retire", entry.value).map(error => `${error.at} ${error.message}`));
        const value = entry.value as Record<string, unknown>;
        if (isObject(value)) {
          if (value.slot !== undefined && value.slot !== slot.id) issues.push(`slot ${String(value.slot)} is not this slot (${slot.id})`);
          if (value.candidate === undefined) issues.push("a slot-folder retire record names no candidate");
          if (typeof value.candidate === "string") {
            if (entry.name !== `${value.candidate}.json`) issues.push(`record file is not named ${value.candidate}.json`);
            const file = files.get(value.candidate);
            if (file && typeof value.sha256 === "string" && file.sha256 !== value.sha256) issues.push(`retired file bytes do not match the record sha256`);
          }
        }
      }
      if (issues.length) rows.push(row("R10", "R10.1", slot, `retire record invalid: ${listed(issues, 3)}`, entry.path));
    }
    for (const [name, file] of files) {
      const recorded = slot.retired.some(entry => isRecord(entry) && isObject(entry.value) && entry.value.candidate === name);
      if (!recorded) rows.push(row("R10", "R10.1", slot, `retired/${name} has no retire record`, file.path, name));
    }
    for (const event of ledgerEvents(slot) ?? []) {
      if (event.op !== "retire-candidate") continue;
      const issues: string[] = [];
      if (typeof event.name !== "string") issues.push("names no candidate");
      if (typeof event.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(event.sha256)) issues.push("sha256 is not 64 hex");
      if (!(RETIRE_CODES as readonly unknown[]).includes(event.code)) issues.push(`code ${String(event.code)} is not one of ${RETIRE_CODES.join(", ")}`);
      if (issues.length) rows.push(row("R10", "R10.1", slot, `retire-candidate event invalid: ${listed(issues, 3)}`, slot.ledger!.path));
    }
  }
  return rows;
}

function retiredSlotIds(agent: AgentRecord): Map<string, string> {
  const ids = new Map<string, string>();
  for (const entry of agent.retired) if (isObject(entry.value) && typeof entry.value.slot === "string" && entry.value.candidate === undefined) ids.set(entry.value.slot, entry.path);
  for (const slot of agent.slots.values()) {
    const events = ledgerEvents(slot);
    if (events?.length && events[events.length - 1]!.op === "retire-slot") ids.set(slot.id, slot.ledger!.path);
  }
  return ids;
}

export function slotRetires(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const agent of ctx.agents) {
    for (const entry of agent.retired) {
      const issues = entry.error !== undefined ? [entry.error] : validateAgainst("retire", entry.value).map(error => `${error.at} ${error.message}`);
      if (isObject(entry.value) && entry.value.candidate !== undefined) issues.push("an agent-folder retire record names a slot, not a candidate");
      if (isObject(entry.value) && typeof entry.value.slot === "string" && entry.name !== `${entry.value.slot}.json`) issues.push(`record file is not named ${entry.value.slot}.json`);
      const id = isObject(entry.value) && typeof entry.value.slot === "string" ? entry.value.slot : entry.name.replace(/\.json$/, "");
      if (issues.length) rows.push(row("R10", "R10.2", { agent: agent.agent, id }, `slot retire record invalid: ${listed(issues, 3)}`, entry.path));
    }
    for (const slot of agent.slots.values()) {
      const events = ledgerEvents(slot);
      const last = events?.[events.length - 1];
      if (last?.op !== "retire-slot") continue;
      const issues: string[] = [];
      if (!(RETIRE_CODES as readonly unknown[]).includes(last.code)) issues.push(`code ${String(last.code)} is not one of ${RETIRE_CODES.join(", ")}`);
      const extra = slot.entries.filter(name => name !== "ledger.json");
      if (extra.length) issues.push(`a tombstone holds only ledger.json, found ${listed(extra)}`);
      if (issues.length) rows.push(row("R10", "R10.2", slot, `tombstone invalid: ${listed(issues, 3)}`, slot.ledger!.path));
    }
  }
  return rows;
}

export function neverAgain(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const agent of ctx.agents) {
    const live = new Set(agent.liveIds);
    for (const [id, path] of retiredSlotIds(agent)) if (live.has(id)) rows.push(row("R10", "R10.3", { agent: agent.agent, id }, "retired slot id is placed in ia.json again", path));
  }
  for (const slot of allSlots(ctx)) {
    const retiredNames = new Set<string>();
    for (const entry of slot.retired) if (isObject(entry.value) && typeof entry.value.candidate === "string") retiredNames.add(entry.value.candidate);
    for (const event of ledgerEvents(slot) ?? []) if (event.op === "retire-candidate" && typeof event.name === "string") retiredNames.add(event.name);
    for (const candidate of slot.candidates) if (retiredNames.has(candidate.name)) rows.push(row("R10", "R10.3", slot, "retired candidate name is written again", candidate.path, candidate.name));
  }
  return rows;
}

export const R10: RuleModule = { rule: "R10", checks: { "R10.1": candidateRetires, "R10.2": slotRetires, "R10.3": neverAgain } };
