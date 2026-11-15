/**
 * `clossys status --json`: the workspace read model (system.md 12.2, 14.4 step 2, 14.9), built from
 * files alone. It replaces the Studio server's slot census (src/server/slot-census.ts) for chat
 * agents and imports nothing under src/server or src/studio. MECHANICAL: the same files give the
 * same bytes (no clock: `at` is the newest timestamp the files record). It writes nothing.
 *
 * The output type is declared here from the spec shape (system.md 12.2) until the canonical
 * records/types.ts and schemas/status-1.json land (foundry-build-0001); `gaps` and `options` are
 * the folded int2 verbs (14.5), added fields only.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { listCandidateNames, modelPresence, readCandidate, readIa, readPin, readSlot } from "../records/slots.js";
import {
  SLOT_AGENTS, pinFile, pinStatus, slotDir, slotFile, slotPositions, validateCandidate, validateSlotDoc,
  type PinBasis, type PinDoc, type PinStatus, type SlotAgent, type SlotDoc, type SlotPosition,
} from "../records/slot-model/index.js";

export const STATUS_SCHEMA = "clossys.status/1" as const;
export const SLOT_STATES = ["pinned", "confirm", "sample", "unresolved", "failing", "needsRefresh"] as const;
export type SlotState = typeof SLOT_STATES[number];
export type ByState = Record<SlotState, number>;
type Iso = string;

export type QueueKind = "queue.pick" | "queue.approve" | "queue.clarify" | "queue.fix";
export interface StatusQueueItem { id: string; queue: QueueKind; decider: string; subject: string; ask: string; default: string | null; raisedAt: Iso; status: "open" | "answered" | "withdrawn" }
export interface StatusLedgerItem { id: string; loop: string; status: string; outcome: string; at: Iso }
export interface StatusRelease { publication: string; pinned: string | null; stale: boolean; reason?: string }
export interface StatusGap { kind: string; agent: string; code: string; item: string; decider: string; from?: string; held?: string }
export interface StatusOptionShort { agent: SlotAgent; slot: string; options: number; distinct: number; missing: readonly string[] }

/** `clossys.status/1` (system.md 12.2), plus `stateSha256` (14.9) and the folded `slots`, `gaps`, `options` fields. */
export interface StatusView {
  schema: typeof STATUS_SCHEMA;
  at: Iso;
  workspace: string;
  /** Digest of every pin (agent, slot, candidate, sha256, basis) and every open queue id; ignores the filters. */
  stateSha256: string;
  agents: Partial<Record<SlotAgent, { slots: number; byState: ByState; error?: string }>>;
  /** One row per IA slot: its state (the census row reduced to one word). */
  slots: { ref: string; state: SlotState; candidates: number; pinned: string | null }[];
  queue: StatusQueueItem[];
  ledger: StatusLedgerItem[];
  releases: StatusRelease[];
  gaps?: { counts: Record<string, number>; items: StatusGap[] } | { error: string };
  options?: { classes: unknown; short: StatusOptionShort[] } | { error: string };
}

/** The census row: lifted unchanged from the Studio server slot census, so both agree row for row. */
export interface CensusRow {
  id: string;
  agent: SlotAgent;
  folder: "present" | "missing" | "error";
  candidates: string[];
  slot: "valid" | "missing" | "invalid" | "error";
  pin: "valid" | "missing" | "invalid" | "missing-candidate" | "hash-drift" | "invalid-candidate" | "unvalidated-candidate" | "error";
  basis?: PinBasis;
  status?: PinStatus;
  candidatesError?: true;
}
export type AgentCensus =
  | { state: "ready"; total: number; withCandidate: number; pinned: number; confirm: number; rows: CensusRow[]; pins: Map<string, PinDoc> }
  | { state: "error"; message: string };

function censusRow(consumer: string, agent: SlotAgent, id: string, position: SlotPosition): { row: CensusRow; pin?: PinDoc } {
  const dir = slotDir(consumer, agent, id);
  const row: CensusRow = { id, agent, folder: modelPresence(dir), candidates: [], slot: "missing", pin: "missing" };
  try { row.candidates = listCandidateNames(dir); } catch { row.candidatesError = true; }
  let doc: SlotDoc | undefined;
  const slotPresence = modelPresence(slotFile(dir));
  if (slotPresence === "present") {
    try {
      const value = readSlot(consumer, agent, id);
      if (validateSlotDoc(value).length || value.id !== id || value.agent !== agent ||
          value.ia.l0 !== position.l0 || value.ia.l1 !== position.l1 ||
          value.ia.l2 !== position.l2 || value.ia.order !== position.order) row.slot = "invalid";
      else { row.slot = "valid"; doc = value; }
    } catch (error) {
      const validationError = error instanceof Error && (
        error.message === `Invalid ${agent} slot ${id}` ||
        error.message === `Slot ${agent}/${id} does not match its IA position`
      );
      row.slot = error instanceof SyntaxError || validationError ? "invalid" :
        (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "error";
    }
  } else if (slotPresence === "error") row.slot = "error";

  const pinPresence = modelPresence(pinFile(dir));
  let counted: PinDoc | undefined;
  if (pinPresence === "present") {
    try {
      const pin = readPin(consumer, agent, id);
      if (!pin) row.pin = "invalid";
      else {
        counted = pin;
        row.basis = pin.basis;
        row.status = pinStatus(pin.basis);
        try {
          const candidate = readCandidate(consumer, agent, id, pin.candidate);
          if (candidate.sha256 !== pin.sha256) row.pin = "hash-drift";
          else if (!doc) row.pin = "unvalidated-candidate";
          else if (validateCandidate(doc.kind, id, candidate.name, candidate.bytes).length) row.pin = "invalid-candidate";
          else row.pin = "valid";
        } catch (error) {
          row.pin = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing-candidate" : "error";
        }
      }
    } catch { row.pin = "error"; }
  } else if (pinPresence === "error") row.pin = "error";
  return counted ? { row, pin: counted } : { row };
}

/** One agent's census; `consumer` is the `clossys/` folder. Never returns a private path or message. */
export function agentCensus(consumer: string, agent: SlotAgent): AgentCensus {
  try {
    const ia = readIa(consumer, agent);
    if (!ia) throw new Error("No slot IA");
    const entries = [...slotPositions(agent, ia)].map(([id, position]) => censusRow(consumer, agent, id, position));
    const pins = new Map<string, PinDoc>();
    for (const entry of entries) if (entry.pin) pins.set(entry.row.id, entry.pin);
    return {
      state: "ready", total: entries.length,
      withCandidate: entries.filter(entry => entry.row.candidates.length > 0).length,
      pinned: pins.size,
      confirm: entries.filter(entry => entry.row.status === "confirm").length,
      rows: entries.map(entry => entry.row), pins,
    };
  } catch {
    return { state: "error", message: "The slot census could not load." };
  }
}

// ---------------------------------------------------------------- small file readers
const isDir = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const list = (path: string) => { try { return readdirSync(path).sort(); } catch { return []; } };
function readJson(path: string): Record<string, unknown> | null {
  try { const value = JSON.parse(readFileSync(path, "utf8")) as unknown; return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}
const str = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const max = (values: readonly (string | undefined)[]) => values.filter((v): v is string => !!v).sort().at(-1);

/** Check result of one candidate (`.clossys/checks/<agent>/<slot>/<candidate>.json`, system.md 6.4). */
function checkResult(root: string, agent: SlotAgent, id: string, candidate: string) {
  const doc = readJson(join(root, ".clossys", "checks", agent, id, `${candidate}.json`));
  return doc ? { status: str(doc.status), subjectSha256: str(doc.subjectSha256) } : null;
}

/**
 * One slot's state, in precedence order: failing (the census row or the pinned candidate's check
 * failed), needsRefresh (the check result is for other bytes), confirm, pinned, sample (a package
 * default resolves), unresolved.
 */
export function slotState(row: CensusRow, pin: PinDoc | undefined, check: ReturnType<typeof checkResult>, hasDefault: boolean): SlotState {
  if (row.folder === "error" || row.candidatesError || row.slot === "invalid" || row.slot === "error") return "failing";
  if (row.pin !== "missing" && row.pin !== "valid") return "failing";
  if (row.pin === "valid" && pin) {
    if (check && check.subjectSha256 === pin.sha256 && check.status === "fail") return "failing";
    if (check && check.subjectSha256 !== pin.sha256) return "needsRefresh";
    return row.status === "confirm" ? "confirm" : "pinned";
  }
  return hasDefault ? "sample" : "unresolved";
}

const QUEUES: readonly QueueKind[] = ["queue.pick", "queue.approve", "queue.clarify", "queue.fix"];
function readQueue(consumer: string): StatusQueueItem[] {
  const producer = join(consumer, "agents", "producer");
  const items: StatusQueueItem[] = [];
  for (const folder of list(producer).filter(name => name.startsWith("queue."))) {
    const entries = join(producer, folder, "entries");
    if (!isDir(entries)) continue;
    for (const file of list(entries).filter(name => name.endsWith(".json"))) {
      const doc = readJson(join(entries, file));
      if (!doc) continue;
      const events = Array.isArray(doc.events) ? doc.events as Record<string, unknown>[] : [];
      const queue = (QUEUES as readonly string[]).includes(str(doc.queue) ?? "") ? doc.queue as QueueKind : folder as QueueKind;
      const status = str(doc.status) === "answered" || str(doc.status) === "withdrawn" ? doc.status as "answered" | "withdrawn" : "open";
      items.push({
        id: str(doc.id) ?? basename(file, ".json"), queue, decider: str(doc.decider) ?? "owner",
        subject: str(doc.subject) ?? "", ask: str(doc.ask) ?? "", default: str(doc.default) ?? null,
        raisedAt: str(events.find(event => event?.op === "raised")?.at) ?? str(doc.createdAt) ?? "", status,
      });
    }
  }
  return items.sort((a, b) => a.raisedAt.localeCompare(b.raisedAt) || a.id.localeCompare(b.id));
}

function readLedger(consumer: string): StatusLedgerItem[] {
  const producer = join(consumer, "agents", "producer");
  const items: StatusLedgerItem[] = [];
  for (const folder of list(producer).filter(name => name.startsWith("ledger."))) {
    const entries = join(producer, folder, "entries");
    if (!isDir(entries)) continue;
    for (const file of list(entries).filter(name => name.endsWith(".json"))) {
      const doc = readJson(join(entries, file));
      if (!doc) continue;
      items.push({
        id: str(doc.id) ?? basename(file, ".json"), loop: str(doc.loop) ?? `loop.${folder.slice("ledger.".length)}`,
        status: str(doc.status) ?? "done", outcome: str(doc.outcome) ?? "", at: str(doc.updatedAt) ?? str(doc.createdAt) ?? str(doc.at) ?? "",
      });
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export interface StatusOptions {
  agent?: SlotAgent;
  queue?: "open" | "all";
  ledger?: number;
  /** Whether a package default resolves for a slot (system.md 8 step 2); int2 ships none. */
  hasDefault?: (agent: SlotAgent, id: string) => boolean;
  /** The folded `gaps` and `options` fields (14.5); each is skipped when absent. */
  gaps?: (root: string, agent?: SlotAgent) => { readonly counts: Readonly<Record<string, number>>; readonly gaps: readonly Readonly<StatusGap>[] };
  options?: (consumer: string) => { classes: unknown; slots: readonly { agent: SlotAgent; slot: string; options: number; distinct: number; missing: readonly string[] }[] };
}

const EPOCH = "1970-01-01T00:00:00.000Z";

/** The read model for the workspace at `root` (the directory holding `clossys/`). */
export function statusView(root: string, options: StatusOptions = {}): StatusView {
  const consumer = join(root, "clossys");
  const hasDefault = options.hasDefault ?? (() => false);
  const agents: StatusView["agents"] = {};
  const slots: StatusView["slots"] = [];
  const releases: StatusRelease[] = [];
  const digest: string[] = [];
  const times: (string | undefined)[] = [];
  for (const agent of SLOT_AGENTS) {
    const census = agentCensus(consumer, agent);
    const byState = Object.fromEntries(SLOT_STATES.map(state => [state, 0])) as ByState;
    if (census.state === "error") {
      if (!options.agent || options.agent === agent) agents[agent] = { slots: 0, byState, error: census.message };
      continue;
    }
    for (const row of census.rows) {
      const pin = census.pins.get(row.id);
      if (pin) { digest.push(`pin ${agent}/${row.id} ${pin.candidate} ${pin.sha256} ${pin.basis}`); times.push(pin.at); }
      if (options.agent && options.agent !== agent) continue;
      const state = slotState(row, pin, pin ? checkResult(root, agent, row.id, pin.candidate) : null, hasDefault(agent, row.id));
      byState[state]++;
      slots.push({ ref: `${agent}/${row.id}`, state, candidates: row.candidates.length, pinned: pin && row.pin === "valid" ? pin.candidate : null });
      if (agent === "publisher" && row.id.startsWith("release.")) {
        const pinned = pin && row.pin === "valid" ? pin.candidate : null;
        const stale = state === "failing" || state === "needsRefresh";
        releases.push({ publication: row.id.slice("release.".length), pinned, stale, ...(stale ? { reason: `${agent}/${row.id} is ${state}` } : {}) });
      }
    }
    if (!options.agent || options.agent === agent) agents[agent] = { slots: census.total, byState };
  }
  const allQueue = readQueue(consumer);
  for (const item of allQueue) { times.push(item.raisedAt); if (item.status === "open") digest.push(`queue ${item.id}`); }
  const ledgerAll = readLedger(consumer);
  for (const item of ledgerAll) times.push(item.at);
  const inScope = (subject: string) => !options.agent || subject.startsWith(`${options.agent}/`);
  const queue = allQueue.filter(item => (options.queue === "all" || item.status === "open") && inScope(item.subject));
  const view: StatusView = {
    schema: STATUS_SCHEMA,
    at: max(times) ?? EPOCH,
    workspace: basename(root),
    stateSha256: createHash("sha256").update(digest.sort().join("\n")).digest("hex"),
    agents, slots, queue,
    ledger: ledgerAll.slice(0, Math.max(0, options.ledger ?? 5)),
    releases,
  };
  if (options.gaps) {
    try {
      const gaps = options.gaps(root, options.agent);
      view.gaps = { counts: { ...gaps.counts }, items: gaps.gaps.map(gap => ({
        kind: gap.kind, agent: gap.agent, code: gap.code, item: gap.item, decider: gap.decider,
        ...(gap.from ? { from: gap.from } : {}), ...(gap.held ? { held: gap.held } : {}),
      })) };
    } catch { view.gaps = { error: "The gaps could not load." }; }
  }
  if (options.options) {
    try {
      const held = options.options(consumer);
      view.options = { classes: held.classes, short: held.slots
        .filter(slot => slot.options > 1 && slot.distinct < slot.options && (!options.agent || slot.agent === options.agent))
        .map(slot => ({ agent: slot.agent, slot: slot.slot, options: slot.options, distinct: slot.distinct, missing: slot.missing })) };
    } catch { view.options = { error: "The options could not load." }; }
  }
  return view;
}
