/**
 * The admin records reader (foundry-build-0048 U20b): the one Producer module that reads a consumer's clossys records
 * for the five data-bound admin sections. The Designer section contracts bind each section `host-injected`, read-only,
 * to one port under a route scope (`limits["reads.port"]`, `limits["reads.scope"]`); the bound Next install
 * (install-next-bind.ts) writes this snapshot beside the page modules and fills each data-bound section's port from it
 * at render, keyed by the route parameters of its scope.
 *
 * Ports, each a map from scope key (the scope's parameter values joined by `/`, `""` for workspace scope) to rows:
 * - `slots` (scope `agent`): the agent's placed slots in IA order (id, kind, status, group; the IA L1 and L2 ids and
 *   their Writer names; `href`, the slot's detail route when the content map holds one, else null);
 * - `slot` (scope `agent, slot`): one slot's detail (kind, status, standard, inputs, uses, its pin and its contract:
 *   purpose, inputs, uses and the rule ids its standard resolves to);
 * - `candidates` (scope `agent, slot`): the slot's candidates by version, the pinned one marked, each with its header
 *   status, ledger rung, source kind, creator and specimen (the render index's PNG and that PNG's sha256);
 * - `questions` (workspace): the open clossys.queue-entry/1 entries of queue.pick, queue.approve and queue.clarify;
 * - `entries` (workspace): the valid clossys.queue-entry/2 requests, oldest first.
 *
 * `labels` are the section labels (column heads, headings, empty text, status names): the source-locale rows of the
 * pinned Writer strings slot `writer/sections.records.copy`, keyed by row id. The record sections bind no Writer copy
 * (they are data-bound), so their labels travel with the records. An unpinned, drifted or unreadable slot leaves
 * `labels` absent (its reason in `issues`); there is no literal fallback.
 *
 * Read-only and never throws: a record that is missing, unreadable or not valid is left out (its reason kept in
 * `issues`), so a section whose records are absent renders its own empty state. No write, no clock: the snapshot is a
 * function of the records alone, so a reinstall over unchanged records is byte-identical.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseWriterSlotBody } from "@clossys/writer/slot-body";
import { readAdminSlot, reservedValues } from "../cli/admin-plan.js";
import { resolveRequirements } from "../constitution/criteria/core/verdict.js";
import { actorLine } from "../engine/log.js";
import { listQueueEntryFiles, readQueueEntry } from "../queue/entry.js";
import { listRequests } from "../records/request.js";
import { viewSourceKind } from "../records/slot-current.js";
import { iaLabel } from "../records/slot-labels.js";
import { parseFrontmatter } from "../records/slot-model/frontmatter.js";
import { CANDIDATE_NAME, SLOT_AGENTS, type ModelAgent } from "../records/slot-model/types.js";
import { iaPath } from "../records/slot-model/layout.js";
import { listSlots, modelExists, readCandidate, readLedger, readSlotEntry } from "../records/slots.js";
import { readStandard } from "../records/standards.js";
import { RENDERS_DIR } from "../specimen/render.js";

export const ADMIN_RECORDS_SCHEMA = "clossys.admin-records/1";
/** The ports this reader fills: a data-bound section whose contract names another port has no records to read. */
export const ADMIN_RECORD_PORTS = ["slots", "slot", "candidates", "questions", "entries"] as const;
export type AdminRecordPort = (typeof ADMIN_RECORD_PORTS)[number];
/** The queues whose open entries are owner questions (the question packet's records). */
const QUESTION_QUEUES = new Set(["queue.pick", "queue.approve", "queue.clarify"]);
/** The Writer strings slot that holds the record sections' labels (CP1-WREC: a Writer leaf with no Designer unit). */
export const ADMIN_LABELS_SLOT = "sections.records.copy";

export interface SlotRow {
  readonly id: string; readonly kind: string; readonly status: string | null; readonly group: string;
  /** The IA L1 and L2 ids the slot sits under, and their Writer names (null when the Writer has not named one). */
  readonly l1: string; readonly l2: string; readonly l1Label: string | null; readonly l2Label: string | null;
  /** The slot's detail page: the content-map route whose parameters are `<agent>` and `<slot>`, filled; null when there is none. */
  readonly href: string | null;
}
export interface SlotContract {
  /** What the slot is for: its contract's purpose, else its question, else its rule; null when it states none. */
  readonly purpose: string | null;
  readonly inputs: readonly string[]; readonly uses: readonly string[];
  /** The rule ids its standard's requirements resolve to under its contract, in order. */
  readonly rules: readonly string[];
}
export interface SlotDetailRow {
  readonly id: string; readonly agent: string; readonly kind: string; readonly status: string | null; readonly standard: string | null;
  readonly inputs: readonly string[]; readonly uses: readonly string[];
  readonly pin: { readonly candidate: string; readonly sha256: string; readonly decidedBy: string; readonly at: string } | null;
  readonly contract: SlotContract;
}
/** A candidate's specimen: the render index's PNG (root-relative, as the index row's `png`) and the sha256 of its bytes. */
export interface SpecimenRef { readonly sha256: string; readonly path: string }
export interface CandidateRow {
  readonly name: string; readonly version: number; readonly pinned: boolean;
  /** The clossys.candidate/1 header's status, source kind and creator; the rung its ledger submit records. Null when absent. */
  readonly status: string | null; readonly rung: string | null; readonly source: string | null; readonly createdBy: string | null;
  readonly specimen: SpecimenRef | null;
}
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
  /** The record sections' labels by key, from the pinned `writer/sections.records.copy`; absent when it is not pinned and readable. */
  readonly labels?: Readonly<Record<string, string>>;
  /** What was left out, and why. */
  readonly issues: readonly string[];
}
/** How the reader is called: `routes` are the content map's route paths, which place each slot's detail page (`href`). */
export interface AdminRecordsOptions { readonly routes?: readonly string[] }

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const routeParamNames = (path: string) => (path === "/" ? [] : path.slice(1).split("/")).flatMap(part => /^<([a-z][a-z0-9]*)>$/.exec(part)?.[1] ?? []);

/**
 * The slot detail route of the content map: the one route whose parameters are exactly `<agent>` and `<slot>`, as a
 * function of a slot to its URL (null where a static sibling reserves the value, as `adminRouteParams` leaves it out).
 * No such route, every href is null; more than one, the detail page is ambiguous, every href is null and it is an issue.
 */
function detailHref(routes: readonly string[], issues: string[]): (agent: string, slot: string) => string | null {
  const found = routes.filter(path => routeParamNames(path).join(",") === "agent,slot");
  if (found.length > 1) issues.push(`routes: ${found.length} content-map routes take <agent> and <slot> (${found.join(", ")}), so no slot has a detail href`);
  if (found.length !== 1) return () => null;
  const path = found[0]!;
  const reserved = reservedValues(path, routes);
  return (agent, slot) => (reserved["agent"] ?? []).includes(agent) || (reserved["slot"] ?? []).includes(slot)
    ? null : path.replace("<agent>", agent).replace("<slot>", slot);
}

/** The labels of the pinned `writer/sections.records.copy` (source locale, by row id), or undefined with its reason in `issues`. */
function readLabels(consumer: string, issues: string[]): Record<string, string> | undefined {
  const where = `writer/${ADMIN_LABELS_SLOT}`;
  try {
    const pin = readSlotEntry(consumer, "writer", ADMIN_LABELS_SLOT)?.pin;
    if (!pin) { issues.push(`${where}: not pinned, so the record sections have no labels`); return undefined; }
    const candidate = readCandidate(consumer, "writer", ADMIN_LABELS_SLOT, pin.candidate);
    if (candidate.sha256 !== pin.sha256) { issues.push(`${where}: ${pin.candidate} does not match its pin, so the record sections have no labels`); return undefined; }
    const parsed = parseFrontmatter(candidate.bytes);
    if (!parsed.ok) { issues.push(`${where}: ${pin.candidate}: ${parsed.message}`); return undefined; }
    const locales = parsed.value.fields.locales as readonly string[];
    const prefix = `${ADMIN_LABELS_SLOT}.`;
    const labels: Record<string, string> = {};
    for (const row of parseWriterSlotBody(parsed.value.body, locales)) {
      if (row.locale !== locales[0] || typeof row.record.text !== "string" || !row.record.text.trim()) continue;
      labels[row.record.id.startsWith(prefix) ? row.record.id.slice(prefix.length) : row.record.id] = row.record.text.trim();
    }
    return labels;
  } catch (error) { issues.push(`${where}: ${message(error)}`); return undefined; }
}

/**
 * The specimen of each candidate of one slot: the first PNG row its render index (`clossys/.state/renders/<agent>/<slot>/<stem>/index.json`)
 * lists for it, with the sha256 of that PNG's bytes. An unrendered candidate has none; an index or PNG that is unreadable,
 * or a PNG path outside the renders folder, is none and an issue.
 */
function specimenOf(root: string, agent: string, slot: string, name: string, issues: string[]): SpecimenRef | null {
  const renders = resolve(root, RENDERS_DIR);
  const index = join(renders, agent, slot, name.replace(/\.(md|json)$/, ""), "index.json");
  let body: string;
  try { body = readFileSync(index, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") issues.push(`${agent}/${slot}/${name}: render index: ${message(error)}`); return null; }
  try {
    const rows = (JSON.parse(body) as { specimens?: unknown }).specimens;
    const row = (Array.isArray(rows) ? rows : []).find((item): item is { png: string } => !!item && typeof item === "object" && (item as Record<string, unknown>).candidate === name && text((item as Record<string, unknown>).png));
    if (!row) return null;
    const file = resolve(root, row.png);
    if (!relative(renders, file).split(sep).every(part => part && part !== "..")) { issues.push(`${agent}/${slot}/${name}: render index png ${row.png} is outside ${RENDERS_DIR}`); return null; }
    return { sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), path: row.png };
  } catch (error) { issues.push(`${agent}/${slot}/${name}: specimen: ${message(error)}`); return null; }
}

/** The admin records of the workspace at `root` (its consumer folder `<root>/clossys`). */
export function readAdminRecords(root: string, options: AdminRecordsOptions = {}): AdminRecords {
  const consumer = join(root, "clossys");
  const issues: string[] = [];
  const href = detailHref(options.routes ?? [], issues);
  const named = new Map<string, string | null>();
  const nameOf = (agent: string, id: string): string | null => {
    const key = `${agent}.ia.${id}`;
    if (!named.has(key)) {
      try { named.set(key, iaLabel(consumer, agent, id)); } catch (error) { named.set(key, null); issues.push(`${agent}/ia ${id}: ${message(error)}`); }
    }
    return named.get(key)!;
  };
  const rules = new Map<string, string[]>();
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
      const { l1, l2 } = entry.position;
      rows.push({
        id: entry.id, kind: read.doc.kind, status, group: [l1, l2].filter(text).join("/"),
        l1, l2, l1Label: text(l1) ? nameOf(agent, l1) : null, l2Label: text(l2) ? nameOf(agent, l2) : null, href: href(agent, entry.id),
      });
      const pin = entry.pin && text(entry.pin.candidate) && text(entry.pin.sha256)
        ? { candidate: entry.pin.candidate, sha256: entry.pin.sha256, decidedBy: String(entry.pin.decidedBy ?? ""), at: String(entry.pin.at ?? "") } : null;
      const standard = text(read.doc.standard) ? read.doc.standard : null;
      const inputs = strings(read.doc.inputs), uses = strings(read.doc.uses);
      const contract = (read.doc.contract ?? {}) as Record<string, unknown>;
      slot[key] = {
        id: entry.id, agent, kind: read.doc.kind, status, standard, inputs, uses, pin,
        contract: {
          purpose: [contract.purpose, contract.question, contract.rule].find(text) ?? null, inputs, uses,
          rules: standard === null ? [] : rulesOf(root, agent, standard, contract, rules, issues),
        },
      };
      let submits: readonly Record<string, unknown>[] = [];
      try { submits = (readLedger(entry.dir)?.events ?? []).filter(event => event.op === "submit"); } catch (error) { issues.push(`${key}: ${message(error)}`); }
      candidates[key] = entry.candidates.map(name => {
        let header: Readonly<Record<string, unknown>> | undefined, source: string | undefined;
        try {
          const view = readCandidate(consumer, agent, entry.id, name);
          header = view.header;
          source = viewSourceKind(name, view.bytes);
        } catch (error) { issues.push(`${key}/${name}: ${message(error)}`); }
        const rung = submits.filter(event => event.name === name).map(event => event.rung).filter(text).at(-1);
        const createdBy = header?.createdBy === undefined ? "" : actorLine(header.createdBy, "");
        return {
          name, version: Number(CANDIDATE_NAME.exec(name)?.[2] ?? 0), pinned: pin?.candidate === name,
          status: text(header?.status) ? header.status : null, rung: rung ?? null, source: source ?? null, createdBy: createdBy || null,
          specimen: specimenOf(root, agent, entry.id, name, issues),
        };
      });
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
  const labels = readLabels(consumer, issues);
  return {
    schema: ADMIN_RECORDS_SCHEMA, agents, slots: pairs,
    ports: { slots, slot, candidates, questions: { "": questions }, entries: { "": entries } },
    ...(labels ? { labels } : {}),
    issues,
  };
}

/** The rule ids a slot's standard resolves to under its contract (read once per agent and standard); [] and an issue when it is unreadable. */
function rulesOf(root: string, agent: string, standard: string, contract: unknown, cache: Map<string, string[]>, issues: string[]): string[] {
  const at = `${agent}/${standard}`;
  let base = cache.get(at);
  if (!base) {
    try {
      const read = readStandard(root, agent as ModelAgent, standard);
      if (!read.doc) { issues.push(`standard ${at}: ${read.issues?.slice(0, 3).join("; ") || "not readable"}`); base = []; }
      else base = read.doc.requirements.map(item => item.check);
    } catch (error) { issues.push(`standard ${at}: ${message(error)}`); base = []; }
    cache.set(at, base);
  }
  return resolveRequirements(base.map(check => ({ check, params: {} })), contract).map(item => item.check);
}

/**
 * The parameter values a dynamic admin route serves, from the records: `<agent>` ranges over the placed agents and
 * `<slot>` over that agent's slots. A value a static sibling route reserves (`/admin/requests` wins over
 * `/admin/<agent>`) is left out, so no URL is claimed twice. A route with any other parameter has no values here.
 */
export function adminRouteParams(records: AdminRecords, path: string, others: readonly string[]): Record<string, string>[] | undefined {
  const params = routeParamNames(path);
  const reserved = reservedValues(path, others);
  const free = (name: string, value: string) => !(reserved[name] ?? []).includes(value);
  if (params.join(",") === "agent") return records.agents.filter(agent => free("agent", agent)).map(agent => ({ agent }));
  if (params.join(",") === "agent,slot") return records.slots.filter(row => free("agent", row.agent) && free("slot", row.slot)).map(row => ({ agent: row.agent, slot: row.slot }));
  return undefined;
}
