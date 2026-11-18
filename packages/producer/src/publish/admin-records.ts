/**
 * The admin records reader (foundry-build-0048 U20b): the one Producer module that reads a consumer's clossys records
 * for the five data-bound admin sections. The Designer section contracts bind each section `host-injected`, read-only,
 * to one port under a route scope (`limits["reads.port"]`, `limits["reads.scope"]`); the bound Next install
 * (install-next-bind.ts) writes this snapshot beside the page modules and fills each data-bound section's port from it
 * at render, keyed by the route parameters of its scope.
 *
 * Ports, each a map from scope key (the scope's parameter values joined by `/`, `""` for workspace scope) to rows:
 * - `slots` (scope `agent`): the agent's placed slots in IA order (id, kind, status, group);
 * - `slot` (scope `agent, slot`): one slot's detail (kind, status, standard, inputs, uses and its pin);
 * - `candidates` (scope `agent, slot`): the slot's candidates by version, the pinned one marked;
 * - `questions` (workspace): the open clossys.queue-entry/1 entries of queue.pick, queue.approve and queue.clarify;
 * - `entries` (workspace): the valid clossys.queue-entry/2 requests, oldest first.
 *
 * Read-only and never throws: a record that is missing, unreadable or not valid is left out (its reason kept in
 * `issues`), so a section whose records are absent renders its own empty state. No write, no clock: the snapshot is a
 * function of the records alone, so a reinstall over unchanged records is byte-identical.
 */
import { join } from "node:path";
import { readAdminSlot, reservedValues } from "../cli/admin-plan.js";
import { listQueueEntryFiles, readQueueEntry } from "../queue/entry.js";
import { listRequests } from "../records/request.js";
import { CANDIDATE_NAME, SLOT_AGENTS } from "../records/slot-model/types.js";
import { iaPath } from "../records/slot-model/layout.js";
import { listSlots, modelExists } from "../records/slots.js";

export const ADMIN_RECORDS_SCHEMA = "clossys.admin-records/1";
/** The ports this reader fills: a data-bound section whose contract names another port has no records to read. */
export const ADMIN_RECORD_PORTS = ["slots", "slot", "candidates", "questions", "entries"] as const;
export type AdminRecordPort = (typeof ADMIN_RECORD_PORTS)[number];
/** The queues whose open entries are owner questions (the question packet's records). */
const QUESTION_QUEUES = new Set(["queue.pick", "queue.approve", "queue.clarify"]);

export interface SlotRow { readonly id: string; readonly kind: string; readonly status: string | null; readonly group: string }
export interface SlotDetailRow {
  readonly id: string; readonly agent: string; readonly kind: string; readonly status: string | null; readonly standard: string | null;
  readonly inputs: readonly string[]; readonly uses: readonly string[];
  readonly pin: { readonly candidate: string; readonly sha256: string; readonly decidedBy: string; readonly at: string } | null;
}
export interface CandidateRow { readonly name: string; readonly version: number; readonly pinned: boolean }
export interface QuestionRow { readonly id: string; readonly queue: string; readonly ask: string; readonly subject: string; readonly default: string | null; readonly options: readonly { readonly id: string; readonly summary: string }[] }
export interface EntryRow { readonly id: string; readonly target: string; readonly status: string; readonly from: string; readonly why: string; readonly createdAt: string }

export interface AdminRecords {
  readonly schema: typeof ADMIN_RECORDS_SCHEMA;
  /** The agents the workspace places (a readable `ia.json`): the values `<agent>` takes. */
  readonly agents: readonly string[];
  /** Every readable placed slot, by agent: the values `<agent>/<slot>` takes. */
  readonly slots: readonly { readonly agent: string; readonly slot: string }[];
  readonly ports: {
    readonly slots: Readonly<Record<string, readonly SlotRow[]>>;
    readonly slot: Readonly<Record<string, SlotDetailRow>>;
    readonly candidates: Readonly<Record<string, readonly CandidateRow[]>>;
    readonly questions: Readonly<Record<string, readonly QuestionRow[]>>;
    readonly entries: Readonly<Record<string, readonly EntryRow[]>>;
  };
  /** What was left out, and why. */
  readonly issues: readonly string[];
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** The admin records of the workspace at `root` (its consumer folder `<root>/clossys`). */
export function readAdminRecords(root: string): AdminRecords {
  const consumer = join(root, "clossys");
  const issues: string[] = [];
  const agents: string[] = [];
  const pairs: { agent: string; slot: string }[] = [];
  const slots: Record<string, SlotRow[]> = {};
  const slot: Record<string, SlotDetailRow> = {};
  const candidates: Record<string, CandidateRow[]> = {};
  for (const agent of SLOT_AGENTS) {
    let entries: ReturnType<typeof listSlots>;
    try {
      if (!modelExists(iaPath(consumer, agent))) continue;
      entries = listSlots(consumer, agent);
    } catch (error) { issues.push(`${agent}/ia.json: ${error instanceof Error ? error.message : String(error)}`); continue; }
    agents.push(agent);
    const rows: SlotRow[] = [];
    for (const entry of entries) {
      let read: ReturnType<typeof readAdminSlot>;
      try { read = readAdminSlot(entry.dir); } catch { read = undefined; }
      if (!read || !text(read.doc.kind)) { issues.push(`${agent}/${entry.id}: slot.json is missing or not a valid slot`); continue; }
      const key = `${agent}/${entry.id}`;
      const status = text(read.current?.status) ? read.current!.status : null;
      rows.push({ id: entry.id, kind: read.doc.kind, status, group: [entry.position.l1, entry.position.l2].filter(text).join("/") });
      const pin = entry.pin && text(entry.pin.candidate) && text(entry.pin.sha256)
        ? { candidate: entry.pin.candidate, sha256: entry.pin.sha256, decidedBy: String(entry.pin.decidedBy ?? ""), at: String(entry.pin.at ?? "") } : null;
      slot[key] = {
        id: entry.id, agent, kind: read.doc.kind, status, standard: text(read.doc.standard) ? read.doc.standard : null,
        inputs: strings(read.doc.inputs), uses: strings(read.doc.uses), pin,
      };
      candidates[key] = entry.candidates.map(name => ({ name, version: Number(CANDIDATE_NAME.exec(name)?.[2] ?? 0), pinned: pin?.candidate === name }));
      pairs.push({ agent, slot: entry.id });
    }
    slots[agent] = rows;
  }
  const questions: QuestionRow[] = [];
  let files: ReturnType<typeof listQueueEntryFiles> = [];
  try { files = listQueueEntryFiles(root); } catch (error) { issues.push(`queues: ${error instanceof Error ? error.message : String(error)}`); }
  for (const at of files) {
    if (!QUESTION_QUEUES.has(at.queue)) continue;
    const read = readQueueEntry(at);
    if (!read.ok) { issues.push(`${at.queue}/${at.id}: ${read.reason}`); continue; }
    const entry = read.entry as unknown as Record<string, unknown>;
    if (entry.schema !== "clossys.queue-entry/1" || !text(entry.ask) || !(entry.default === null || typeof entry.default === "string")
      || (entry.options !== undefined && !Array.isArray(entry.options))) { issues.push(`${at.queue}/${at.id}: not a valid clossys.queue-entry/1 entry`); continue; }
    if (entry.status !== "open") continue;
    const options = ((entry.options as unknown[] | undefined) ?? []).flatMap(option => {
      const row = option as Record<string, unknown> | null;
      return row && text(row.id) && typeof row.summary === "string" ? [{ id: row.id, summary: row.summary }] : [];
    });
    questions.push({ id: at.id, queue: at.queue, ask: entry.ask, subject: typeof entry.subject === "string" ? entry.subject : "", default: entry.default as string | null, options });
  }
  const entries: EntryRow[] = [];
  let requests: ReturnType<typeof listRequests> = [];
  try { requests = listRequests(consumer); } catch (error) { issues.push(`requests: ${error instanceof Error ? error.message : String(error)}`); }
  for (const read of requests) {
    if (!read.request || read.issues.length) { issues.push(`${read.file.slice(consumer.length + 1)}: ${read.issues.slice(0, 3).join("; ") || "not a valid request"}`); continue; }
    const request = read.request;
    entries.push({ id: request.id, target: request.target, status: request.status, from: request.from, why: request.why, createdAt: request.createdAt });
  }
  entries.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    schema: ADMIN_RECORDS_SCHEMA, agents, slots: pairs,
    ports: { slots, slot, candidates, questions: { "": questions }, entries: { "": entries } },
    issues,
  };
}

/**
 * The parameter values a dynamic admin route serves, from the records: `<agent>` ranges over the placed agents and
 * `<slot>` over that agent's slots. A value a static sibling route reserves (`/admin/requests` wins over
 * `/admin/<agent>`) is left out, so no URL is claimed twice. A route with any other parameter has no values here.
 */
export function adminRouteParams(records: AdminRecords, path: string, others: readonly string[]): Record<string, string>[] | undefined {
  const params = (path === "/" ? [] : path.slice(1).split("/")).flatMap(part => /^<([a-z][a-z0-9]*)>$/.exec(part)?.[1] ?? []);
  const reserved = reservedValues(path, others);
  const free = (name: string, value: string) => !(reserved[name] ?? []).includes(value);
  if (params.join(",") === "agent") return records.agents.filter(agent => free("agent", agent)).map(agent => ({ agent }));
  if (params.join(",") === "agent,slot") return records.slots.filter(row => free("agent", row.agent) && free("slot", row.slot)).map(row => ({ agent: row.agent, slot: row.slot }));
  return undefined;
}
