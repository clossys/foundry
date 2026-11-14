/**
 * The ledger (slot-constitution section 1): an append-only `ledger.json` in every slot folder and
 * agent tree. Each write through the one writer (records/slot-write.ts) appends one event naming
 * what was done (`op`), when (`at`), by whom (`by`), through which verb and action skill
 * (`verb`, `skill {path, sha256}`) and with which model and tier (`none` for deterministic verbs),
 * plus the op's own fields. An event that changed a record (pin.json, slot.json, ia.json) carries
 * `records[]`, the record's sha256 after the write (null when the write removed it), so every record
 * byte state is traceable to the event that produced it (constitution R14.1).
 *
 * Pure (no file access): types, the verb and op tables, validation, skill path resolution and the
 * lookups the checks and the writer share.
 * Reads go through records/slots.ts (`readLedger`), writes through records/slot-write.ts.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LEDGER_SCHEMA = "clossys.ledger/1";
export const LEDGER_FILE = "ledger.json";

/** The verb table (slot-constitution section 5): every event names one. */
export const VERBS = ["submit", "options", "verdict", "pick", "pin", "retire", "reissue", "ia", "migrate", "standard", "critique", "request", "task", "triage"] as const;
export type Verb = (typeof VERBS)[number];
/** Verbs whose decision is an LLM's: their events name a model and a tier. */
export const LLM_VERBS: readonly Verb[] = ["verdict", "critique", "triage"];
/** Deterministic verbs: their events record `model: none, tier: none`. */
export const DETERMINISTIC_VERBS: readonly Verb[] = ["options", "pick", "pin", "retire", "reissue", "ia", "migrate", "standard", "request", "task"];
/** `submit` may carry either (an LLM's P2 output, or a deterministic writer's); its pair must still be whole. */
export const TIERS = ["low", "mid", "high"] as const;
export const NONE = "none";

/** Slot-ledger ops. `craft:<stage>` (P2 stages, section 5b) are ops too. */
export const SLOT_OPS = ["submit", "options", "verdict", "pick", "pin", "confirm", "contract", "slot", "not-needed", "migrate", "retire-candidate", "retire-slot"] as const;
/** Agent-ledger ops. */
export const AGENT_OPS = ["ia", "policy", "retire-slot"] as const;
export const CRAFT_OP = /^craft:(brief|diverge|render|critique|refine)$/;
/** Ops whose event is the slot's decision: R02.3 holds pin.json to the last of them. */
export const DECISION_OPS: readonly string[] = ["pin", "pick", "verdict"];
/** The retire codes (constitution R10, schemas/retire.schema.json). */
export const RETIRE_EVENT_CODES = ["uncertified", "superseded", "edited-in-place", "not-needed", "duplicate", "shared-split"] as const;
/** The record files an event may carry the state of. */
export const RECORD_FILES = ["pin.json", "slot.json", "ia.json", "policy.json"] as const;
export type RecordFile = (typeof RECORD_FILES)[number];

/** `packages/<pkg>/actions/<step>/skill.md`: the action skill an event ran under. */
export const SKILL_PATH = /^packages\/([a-z][a-z0-9-]*)\/actions\/([a-z0-9][a-z0-9.-]*)\/skill\.md$/;
const SHA = /^[a-f0-9]{64}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export interface LedgerSkill { readonly path: string; readonly sha256: string | null }
/** A record's bytes after the event's write: sha256, or null when the write removed the file. */
export interface LedgerRecordState { readonly file: RecordFile; readonly sha256: string | null }
/** The fields every event carries. */
export interface Provenance {
  readonly verb: Verb;
  readonly by: string;
  readonly skill: LedgerSkill;
  readonly model: string;
  readonly tier: string;
}
export interface LedgerEvent extends Provenance {
  readonly op: string;
  readonly at: string;
  readonly records?: readonly LedgerRecordState[];
  readonly [field: string]: unknown;
}
export interface LedgerDoc { readonly schema: typeof LEDGER_SCHEMA; readonly events: readonly LedgerEvent[] }

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.length > 0;

/** The skill path of an action step (`packages/<pkg>/actions/<step>/skill.md`). */
export const skillPath = (pkg: string, step: string) => `packages/${pkg}/actions/${step}/skill.md`;

/** The installed @clossys/producer package root (src/records and dist/records both resolve to it). */
export const PRODUCER_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/**
 * The installed file of an action skill named by its ledger path: the Producer's own under
 * `producerRoot`, any other package's beside it (`<producerRoot>/../<pkg>`). Path arithmetic only.
 */
export function skillFile(path: string, producerRoot = PRODUCER_ROOT): string {
  const match = SKILL_PATH.exec(path);
  if (!match) throw new Error(`not an action skill path (packages/<pkg>/actions/<step>/skill.md): ${path}`);
  const [, pkg, step] = match;
  return pkg === "producer" ? join(producerRoot, "actions", step!, "skill.md") : join(producerRoot, "..", pkg!, "actions", step!, "skill.md");
}

/** Issues with the provenance pair (R14.3): model and tier both `none`, or a model with a tier. */
export function modelTierIssues(event: { readonly verb?: unknown; readonly model?: unknown; readonly tier?: unknown }): string[] {
  const { verb, model, tier } = event;
  if (!text(model) || !text(tier)) return ["names no model and tier (deterministic verbs record model none, tier none)"];
  const none = model === NONE && tier === NONE;
  const llm = model !== NONE && (TIERS as readonly unknown[]).includes(tier);
  if (!none && !llm) return [`model ${String(model)} with tier ${String(tier)} is neither none/none nor a model with tier ${TIERS.join("|")}`];
  if ((LLM_VERBS as readonly unknown[]).includes(verb) && none) return [`verb ${String(verb)} runs an LLM and must name its model and tier`];
  if ((DETERMINISTIC_VERBS as readonly unknown[]).includes(verb) && !none) return [`verb ${String(verb)} is deterministic and records model none, tier none`];
  return [];
}

/** Issues with one event's shape (ledger.schema.json, plus the op fields). `scope` picks the op table. */
export function eventIssues(event: unknown, scope: "slot" | "agent" = "slot"): string[] {
  if (!isObject(event)) return ["event is not an object"];
  const issues: string[] = [];
  const ops: readonly string[] = scope === "slot" ? SLOT_OPS : AGENT_OPS;
  const op = event.op;
  if (typeof op !== "string" || !(ops.includes(op) || (scope === "slot" && CRAFT_OP.test(op)))) issues.push(`op ${String(op)} is not a ${scope} ledger op`);
  if (typeof event.at !== "string" || !AT.test(event.at)) issues.push("at is not an ISO timestamp");
  if (!text(event.by)) issues.push("names no by");
  if (!(VERBS as readonly unknown[]).includes(event.verb)) issues.push(`verb ${String(event.verb)} is not in the verb table`);
  const skill = event.skill;
  if (!isObject(skill) || typeof skill.path !== "string" || !SKILL_PATH.test(skill.path)) issues.push("skill.path is not packages/<pkg>/actions/<step>/skill.md");
  else if (!(skill.sha256 === null || (typeof skill.sha256 === "string" && SHA.test(skill.sha256)))) issues.push("skill.sha256 is not 64 hex or null");
  issues.push(...modelTierIssues(event));
  if (event.records !== undefined) {
    if (!Array.isArray(event.records)) issues.push("records is not a list");
    else for (const record of event.records) {
      if (!isObject(record) || !(RECORD_FILES as readonly unknown[]).includes(record.file) || !(record.sha256 === null || (typeof record.sha256 === "string" && SHA.test(record.sha256)))) issues.push("records[] entries are {file: pin.json|slot.json|ia.json|policy.json, sha256: 64 hex or null}");
    }
  }
  const need = (field: string, ok: (value: unknown) => boolean, what: string) => { if (!ok(event[field])) issues.push(`${String(op)} needs ${field} (${what})`); };
  const sha = (value: unknown) => typeof value === "string" && SHA.test(value);
  switch (op) {
    case "submit": need("name", text, "candidate file name"); need("sha256", sha, "64 hex"); break;
    case "pin": case "pick":
      need("candidate", text, "candidate file name"); need("sha256", sha, "64 hex"); need("decidedBy", text, "pin decidedBy"); need("basis", text, "pin basis"); break;
    case "confirm": need("candidate", text, "candidate file name"); need("sha256", sha, "64 hex"); need("confirmed", isObject, "{by, ref, at}"); break;
    case "not-needed": need("reason", text, "why"); need("decidedBy", text, "who"); break;
    case "migrate":
      need("migration", text, "the codemod");
      need("files", value => Array.isArray(value) && value.every(file => isObject(file) && text(file.name) && sha(file.from) && sha(file.to)), "[{name, from, to}] with 64-hex shas"); break;
    case "retire-candidate": need("name", text, "candidate file name"); need("sha256", sha, "64 hex"); need("code", value => (RETIRE_EVENT_CODES as readonly unknown[]).includes(value), RETIRE_EVENT_CODES.join("|")); break;
    case "retire-slot":
      need("code", value => (RETIRE_EVENT_CODES as readonly unknown[]).includes(value), RETIRE_EVENT_CODES.join("|"));
      if (scope === "agent") need("slot", text, "the retired slot id"); break;
    default: break;
  }
  return issues;
}

/** Issues with a whole ledger document; each issue names the event index. */
export function ledgerIssues(value: unknown, scope: "slot" | "agent" = "slot"): string[] {
  if (!isObject(value)) return ["ledger is not an object"];
  const issues: string[] = [];
  if (value.schema !== LEDGER_SCHEMA) issues.push(`schema is not ${LEDGER_SCHEMA}`);
  if (!Array.isArray(value.events)) return [...issues, "events is not a list"];
  const keys = Object.keys(value).filter(key => key !== "schema" && key !== "events");
  if (keys.length) issues.push(`unknown keys ${keys.join(", ")}`);
  value.events.forEach((event, index) => { for (const issue of eventIssues(event, scope)) issues.push(`events[${index}]: ${issue}`); });
  return issues;
}

/** The events of a parsed ledger (`{events}` or a bare list), objects only; undefined when it holds none. */
export function ledgerEventsOf(value: unknown): Record<string, unknown>[] | undefined {
  const events = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.events) ? value.events : undefined;
  return events?.filter(isObject);
}

/** The last event that recorded `file`'s bytes, or undefined. */
export function lastRecordState(events: readonly Record<string, unknown>[], file: RecordFile): LedgerRecordState | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const records = events[i]!.records;
    if (!Array.isArray(records)) continue;
    const found = records.find(record => isObject(record) && record.file === file) as LedgerRecordState | undefined;
    if (found) return found;
  }
  return undefined;
}

/** The last decision event (pin, pick or verdict) of a slot ledger, or undefined. */
export function lastDecision(events: readonly Record<string, unknown>[]): Record<string, unknown> | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (DECISION_OPS.includes(events[i]!.op as string)) return events[i];
  return undefined;
}

/**
 * The sha256 a candidate's bytes must have by the ledger: its `submit` event's sha256, carried
 * through each later `migrate` event that rewrote exactly those bytes (from = the sha so far).
 * `submitted` is false when the ledger has no submit event for the name (R08.2: that file fails).
 */
export function expectedCandidateSha(events: readonly Record<string, unknown>[], name: string): { submitted: boolean; sha256?: string } {
  let sha: string | undefined;
  let submitted = false;
  for (const event of events) {
    if (event.op === "submit" && event.name === name && typeof event.sha256 === "string") { sha = event.sha256; submitted = true; }
    else if (event.op === "migrate" && submitted && Array.isArray(event.files)) {
      for (const file of event.files) if (isObject(file) && file.name === name && file.from === sha && typeof file.to === "string") sha = file.to;
    }
  }
  return submitted ? { submitted, sha256: sha } : { submitted };
}
