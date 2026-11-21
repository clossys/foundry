/**
 * R02 Pins and order, over every pin of every agent tree:
 * - R02.1 a pin's `basis` is in PIN_BASES and its `decidedBy` matches DECIDED_BY with the migration
 *   forms (`migrated`, `migration[:<ref>]`) removed: a pin names a real decider. Basis `scorecard` (decidedBy
 *   `code:scorecard`) is code's pin of the scorecard's single top row on a slot with no owner-pick or confirm step
 *   (loop/code-pin.ts, refused at the pin);
 * - R02.2 upstream before downstream: every slot in a live slot's dependency set (`inputs` ∪ `uses`)
 *   is live and has an intact pin (valid, its candidate present, the candidate's bytes matching the
 *   pinned sha256; a Writer pin map when every record is), the same test the slot reader's readiness
 *   applies (records/slots.ts inputBlocker);
 * - R02.3 each pin equals the slot ledger's last decision event (`pin`, `pick` or `verdict`) in
 *   candidate, sha256, decidedBy, basis and at; a later `migrate` event that rewrote the pinned
 *   candidate's bytes carries the sha256 forward (records/ledger.ts).
 * A Writer `clossys.pin-map/1` (one pin record per record key) is judged per record (U13 r3): R02.1 on each record's
 * basis and decidedBy, R02.3 against the last decision event naming that record (`record`, or, for an event written
 * before pin maps carried the key, its candidate's record name).
 * R02.4 (verdict before an agent pin, P1) is not in this unit's rules.json entry.
 */
import { DECIDED_BY, PIN_BASES } from "../../records/slot-model/index.js";
import { DECISION_OPS, ledgerEventsOf } from "../../records/ledger.js";
import { CODE_SCORECARD, pinMapIssues } from "../../records/pin.js";
import { ownerStepRefusal } from "../../loop/code-pin.js";
import type { ConstitutionContext, Row, RuleModule, SlotRecord } from "../types.js";
import { allSlots, dependencySet, isObject, listed, liveSlotRecords, row } from "./shared.js";

const PIN_MAP_SCHEMA = "clossys.pin-map/1";
/** A decidedBy only a migration writes; R02.1 removes these forms from the closed list. */
const MIGRATION_DECIDED = /^(?:migrated|migration(?::.*)?)$/;

/** The pin records of a pin.json value: `[key, record]` per pin-map record, else `[undefined, the pin]` (pin/1 and pin/2). */
export function pinRecordsOf(value: Record<string, unknown>): [string | undefined, Record<string, unknown>][] {
  if (value.schema !== PIN_MAP_SCHEMA) return [[undefined, value]];
  const records = isObject(value.records) ? value.records : {};
  return Object.keys(records).sort().map(key => [key, isObject(records[key]) ? records[key] as Record<string, unknown> : {}]);
}
const recordLabel = (key: string | undefined) => key === undefined ? "" : `record ${key}: `;
/** The record a decision event decided: its `record`, else (an event from before pin maps named it) its candidate's record name. */
const eventRecord = (event: Record<string, unknown>): string | undefined =>
  typeof event.record === "string" ? event.record : typeof event.candidate === "string" ? /^(.+)-v[1-9][0-9]*\.[a-z]+$/.exec(event.candidate)?.[1] : undefined;

export function pinBasis(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) {
    const value = slot.pin?.value;
    if (!slot.pin || slot.pin.error !== undefined || !isObject(value)) continue; // R09 reports unreadable pins
    const issues: string[] = [];
    for (const [key, pin] of pinRecordsOf(value)) {
      const at = recordLabel(key);
      if (!(PIN_BASES as readonly unknown[]).includes(pin.basis)) issues.push(`${at}basis ${JSON.stringify(pin.basis)} is not one of ${PIN_BASES.join(", ")}`);
      const decidedBy = pin.decidedBy;
      if (typeof decidedBy !== "string" || !DECIDED_BY.test(decidedBy)) issues.push(`${at}decidedBy ${JSON.stringify(decidedBy)} does not match DECIDED_BY`);
      else if (MIGRATION_DECIDED.test(decidedBy)) issues.push(`${at}decidedBy ${decidedBy} is a migration form; a pin names its decider (owner, planner, agent:<seat> or code:scorecard)`);
      // Code's pin: basis scorecard and decidedBy code:scorecard go together, on a whole slot with no owner step.
      if ((pin.basis === "scorecard") !== (decidedBy === CODE_SCORECARD)) issues.push(`${at}basis ${JSON.stringify(pin.basis)} with decidedBy ${JSON.stringify(decidedBy)}: basis scorecard is decided by ${CODE_SCORECARD} only, and ${CODE_SCORECARD} decides basis scorecard only`);
      else if (pin.basis === "scorecard") {
        const owner = key !== undefined ? `${slot.agent}/${slot.id} is a pin-map slot; code pins whole slots only` : ownerStepRefusal(ctx.root, slot.agent, slot.id);
        if (owner !== undefined) issues.push(`${at}a code pin (basis scorecard) where code may not pin: ${owner}`);
      }
    }
    if (issues.length) rows.push(row("R02", "R02.1", slot, issues.join("; "), slot.pin.path));
  }
  return rows;
}

/**
 * Why a slot's pin is not intact, or undefined when it is. A pin (pin/1, pin/2) is intact when it names a present
 * candidate whose bytes match its sha256. A Writer `clossys.pin-map/1` (N6) is intact when it is a valid pin map of this
 * slot (records/pin.ts pinMapIssues) holding at least one record and every record is intact the same way: the slot
 * reader's readiness rule (records/slots.ts inputBlocker: a pin map clears an input when every record does). A pin map
 * on any other agent's slot, an invalid one or an empty one is an invalid pin.
 */
export function pinBlocker(slot: SlotRecord): string | undefined {
  if (!slot.pin) return "unpinned";
  const value = slot.pin.value;
  if (slot.pin.error !== undefined || !isObject(value)) return "invalid pin";
  if (value.schema !== PIN_MAP_SCHEMA) return recordBlocker(slot, value);
  if (slot.agent !== "writer" || pinMapIssues(value, { agent: "writer", slotId: slot.id }).length) return "invalid pin";
  const records = pinRecordsOf(value);
  if (!records.length) return "invalid pin";
  for (const [key, record] of records) {
    const blocker = recordBlocker(slot, record);
    if (blocker) return `${recordLabel(key)}${blocker}`;
  }
  return undefined;
}

/** Why one pin record is not intact: it names a present candidate whose bytes match its sha256. */
function recordBlocker(slot: SlotRecord, value: Record<string, unknown>): string | undefined {
  if (typeof value.candidate !== "string" || typeof value.sha256 !== "string") return "invalid pin";
  const candidate = slot.candidates.find(each => each.name === value.candidate);
  if (!candidate || candidate.readError !== undefined) return `pinned candidate ${value.candidate} is missing`;
  if (candidate.sha256 !== value.sha256) return `pinned candidate ${value.candidate} bytes do not match the pin`;
  return undefined;
}

export function upstreamPinned(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  const live = new Map<string, SlotRecord | undefined>();
  for (const agent of ctx.agents) for (const id of agent.liveIds) if (!live.has(id) || !live.get(id)) live.set(id, agent.slots.get(id));
  for (const slot of liveSlotRecords(ctx)) {
    const deps = dependencySet(slot);
    if (!deps) continue; // R01.2 reports a missing or unreadable slot.json
    const problems: string[] = [];
    for (const dep of [...deps].sort()) {
      if (dep === slot.id) continue;
      if (!live.has(dep)) { problems.push(`${dep} is not live`); continue; }
      const record = live.get(dep);
      const blocker = record ? pinBlocker(record) : "has no slot folder";
      if (blocker) problems.push(`${dep} ${blocker}`);
    }
    if (problems.length) rows.push(row("R02", "R02.2", slot, `dependency set not pinned upstream: ${listed(problems)}`, slot.slot?.path ?? slot.dir));
  }
  return rows;
}

const PIN_FIELDS = ["candidate", "sha256", "decidedBy", "basis", "at"] as const;

/** The slot's decision by its ledger: the last pin/pick/verdict event, its sha256 carried through later migrate events. */
export function ledgerDecision(events: readonly Record<string, unknown>[]): Record<string, unknown> | undefined {
  let at = -1;
  for (let i = events.length - 1; i >= 0; i--) if (DECISION_OPS.includes(events[i]!.op as string)) { at = i; break; }
  if (at < 0) return undefined;
  const decision = { ...events[at]! };
  for (const event of events.slice(at + 1)) {
    if (event.op !== "migrate" || !Array.isArray(event.files)) continue;
    for (const file of event.files) if (isObject(file) && file.name === decision.candidate && file.from === decision.sha256 && typeof file.to === "string") decision.sha256 = file.to;
  }
  return decision;
}

export function pinMatchesLedger(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) {
    const pin = slot.pin?.value;
    if (!slot.pin || slot.pin.error !== undefined || !isObject(pin)) continue;
    const events = slot.ledger?.error === undefined ? ledgerEventsOf(slot.ledger?.value) : undefined;
    const map = pin.schema === PIN_MAP_SCHEMA;
    for (const [key, record] of pinRecordsOf(pin)) {
      // A pin-map record's decision is the last decision event naming that record; other events (migrate) apply to all.
      const own = events && map ? events.filter(event => !DECISION_OPS.includes(event.op as string) || eventRecord(event) === key) : events;
      const decision = own ? ledgerDecision(own) : undefined;
      if (!decision) {
        rows.push(row("R02", "R02.3", slot, slot.ledger ? (slot.ledger.error !== undefined ? `ledger.json is unreadable (${slot.ledger.error}); the pin has no decision event` : `${recordLabel(key)}the slot ledger has no pin, pick or verdict event for this pin`) : "the slot has no ledger.json; the pin has no decision event", slot.pin.path));
        continue;
      }
      const differ = PIN_FIELDS.filter(field => record[field] !== decision[field]);
      if (differ.length) rows.push(row("R02", "R02.3", slot, `${recordLabel(key)}pin differs from the last ${String(decision.op)} event (${String(decision.at)}) in ${differ.join(", ")}`, slot.pin.path));
    }
  }
  return rows;
}

export const R02: RuleModule = {
  rule: "R02",
  checks: {
    "R02.1": pinBasis,
    "R02.2": upstreamPinned,
    "R02.3": pinMatchesLedger,
  },
};
