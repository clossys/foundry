/**
 * `clossys.queue-entry/2` kind `slot` (foundry-build-0048 U5, SLOT-CREATE): a slotless need is a queue entry, never a
 * refusal or a dropped input. Requests and the queue are one queue: who requests (`from`), who executes (`assignee`)
 * and what it is about (`target`) are fields. A requester slot (or the owner) names a slot no agent holds; the
 * assignee agent answers reuse (a placed slot) or create (a new leaf the owner signs and `clossys ia` places); closing
 * links the requester slot-to-slot and notifies it with a ledger event addressed to it.
 *
 * Store: `clossys/agents/producer/queue.slot/entries/<id>.json`, one file per entry. A new entry is created exclusively
 * (a temp file hard-linked to its name, so a taken id is never overwritten); a change is written whole through a temp
 * file and a rename. Every write runs under a lock at `.clossys/locks/queue/queue.slot/<key>.lock` (the queue/entry.ts
 * pattern: an exclusive create, removed after; a held lock is waited on briefly, then refuses): a raise under its
 * target's lock (so parallel raises of one need from one requester file one entry), a change under its entry's. The clossys.queue-entry/1 queues (queue/entry.ts QUEUE_NAMES) do not list queue.slot, so their
 * readers and writers are unchanged. The entry's `events` are its own ledger (ids `<entry id>#<n>`; `opened` and
 * `closed` name the raising and closing events). The slot model itself is read through records/slots.ts and written
 * through records/slot-write.ts only.
 */
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { loadSchema, validateValue } from "../pipeline/schema.js";
import { findQueueEntry, readQueueEntry } from "../queue/entry.js";
import { consumerFacts, placedSlots, readDeclarations, routeEntry, RoutingError, WORK_KINDS, type RoutingFacts, type WorkKind } from "../queue/routing.js";
import { FIX_CHECKS, fixCheck, requesterCheck, requesterPinSets, requesterSlots } from "../queue/requester-check.js";
import { PRODUCER_ROOT, skillPath } from "./ledger.js";
import { resolveOwnerRef } from "./owner-decisions.js";
import { OWNER_QUEUE_ANSWER } from "./pin.js";
import { isRecordSlot } from "./resolve.js";
import { validateAgainst } from "./schema.js";
import { recordSchema, serializeSlot, SLOT_SCHEMA, validateSlot } from "./slot.js";
import { slotDir, slotFile } from "./slot-model/layout.js";
import { AGENT_KIND } from "./slot-model/types.js";
import { listSlots, modelExists, readModelText, readSlot, readSlotEntry } from "./slots.js";
import { appendSlotDocEvent, replaceModelFile } from "./slot-write.js";
import type { Actor, EntryRoute, OptionStep, Overlap, OwnerOption, Proposal, Ref, RequestEvent, RequestOp, Slot, SlotRequest } from "./types.js";

export const REQUEST_SCHEMA = "clossys.queue-entry/2";
/** The decision-entry schema queue.fix still holds runner-raised fixes in (queue/entry.ts). */
const LEGACY_FIX_SCHEMA = "clossys.queue-entry/1";
export const REQUEST_FILE = "queue-entry-2.json";
/** The queue folder kind slot entries live in (one queue: the folder is the kind, `assignee` says who executes). */
export const SLOT_QUEUE = "queue.slot";
export const CONTENT_AGENTS = ["director", "designer", "writer", "publisher"] as const;
export type ContentAgent = (typeof CONTENT_AGENTS)[number];
export const isContentAgent = (value: string): value is ContentAgent => (CONTENT_AGENTS as readonly string[]).includes(value);

export const REQUEST_ID = /^[0-9]{8}T[0-9]{4}Z-[a-z0-9][a-z0-9-]*$/;
const NEED_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/;
const SLOT_TARGET = /^(director|designer|writer|publisher)\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})$/;

export type { OptionStep, Overlap, OwnerOption, Proposal, RequestEvent, RequestOp, SlotRequest } from "./types.js";

/** The agent a request asks and the slot id it names (kind slot, slot-ref target). */
export function targetOf(request: Pick<SlotRequest, "target">): { agent: ContentAgent; need: string } | undefined {
  const match = SLOT_TARGET.exec(request.target);
  return match ? { agent: match[1] as ContentAgent, need: match[2]! } : undefined;
}

/** The queue folder of a work kind: `queue.slot`, `queue.change`, `queue.fix` (one queue; the folder is the kind). */
export const workQueue = (kind: WorkKind): string => `queue.${kind}`;
export const requestsDir = (consumer: string, kind: WorkKind = "slot") => join(consumer, "agents", "producer", workQueue(kind), "entries");
const requestPath = (consumer: string, id: string, kind: WorkKind = "slot") => join(requestsDir(consumer, kind), `${id}.json`);

/**
 * The outcomes each work kind closes with (foundry-build-0048 U7 r3): a fix closes fixed or declined, a change changed
 * or declined; a slot closes by its decision (reused or created, closeRequest). Any other outcome is refused.
 */
export const WORK_OUTCOMES: Readonly<Record<WorkKind, readonly NonNullable<SlotRequest["outcome"]>[]>> = { slot: ["reused", "created"], change: ["changed", "declined"], fix: ["fixed", "declined"] };
export const outcomesFor = (kind: string): readonly NonNullable<SlotRequest["outcome"]>[] => WORK_OUTCOMES[kind as WorkKind] ?? [];

/**
 * The owner's answer to one entry (foundry-build-0048 U7 r4): `owner:queue.<kind>#<id>`, the entry itself. It closes
 * the entry, and decides a pin its `pin` option runs, only right after the owner's `answered` event chose that option.
 */
export const ownerAnswerOf = (request: Pick<SlotRequest, "id" | "kind">): string => `owner:${workQueue(request.kind as WorkKind)}#${request.id}`;

/**
 * The option the owner's answer chose, when the last of `events` (default: the entry's) is that `answered` event by
 * the owner; undefined otherwise. Every step an answer runs reads it, so a later write voids the answer.
 */
export function answeredStep(request: Pick<SlotRequest, "events" | "options">, events: readonly RequestEvent[] = request.events): OwnerOption | undefined {
  const last = events.at(-1);
  if (last?.op !== "answered" || last.by !== "owner" || last.option === undefined) return undefined;
  return request.options?.find(option => option.id === last.option);
}

const lastIndexOf = (events: readonly RequestEvent[], op: RequestOp) => events.map(event => event.op).lastIndexOf(op);
/**
 * Whether the owner answers the entry now: it is open, carries options, and is the owner's (assigned to the owner, or an
 * agent's claim Producer asked the owner about with no answer since).
 */
export function awaitsOwner(request: Pick<SlotRequest, "status" | "assignee" | "options" | "events">): boolean {
  if (request.status !== "open" || !request.options?.length) return false;
  return request.assignee === "owner" || lastIndexOf(request.events, "asked") > lastIndexOf(request.events, "answered");
}

/** The outcome an option's step closes with: `close <outcome>`, and `pin` closes a change changed. */
const stepOutcome = (step: OptionStep): string | undefined => step.verb === "close" ? step.args[0] : step.verb === "pin" ? "changed" : undefined;

/**
 * Why `by` may not close the change or fix entry `request` with `outcome` (empty when it may): the one closure rule
 * (foundry-build-0048 U7 r4) that closeWork enforces, requestIssues states on a stored close and conform Q7 re-reads.
 * - The outcome is one of outcomesFor(kind).
 * - An agent assignee closes a change (changed or declined), and a fix only as fixed (its own check re-run and passing).
 * - Any other close is the owner's typed answer: closer `owner:queue.<kind>#<this id>`, and the last of `events` (the
 *   events before the close's verified event) is the owner's `answered` event whose option's step closes with this
 *   outcome. Free text never closes: the answer is an option id the entry offered.
 * - Bare `owner`, the planner, Producer and every other seat never close a change or fix.
 */
export function closerIssues(request: Pick<SlotRequest, "id" | "kind" | "assignee" | "events" | "options">, by: string | undefined, outcome: string | undefined, events: readonly RequestEvent[] = request.events): string[] {
  if (request.kind === "slot") return [];
  const outcomes = outcomesFor(request.kind);
  if (outcome === undefined || !(outcomes as readonly string[]).includes(outcome)) return [`a ${request.kind} entry closes ${outcomes.join(" or ")}, not ${outcome ?? "with no outcome"}`];
  if (by === undefined) return ["the close names no closer"];
  const answer = `clossys request ${request.id} --answer <option>`;
  if (by === ownerAnswerOf(request)) {
    const step = answeredStep(request, events);
    if (!step) return [`${by} closes it only right after the owner's answer chose one of its options (${answer})`];
    const closes = stepOutcome(step.then);
    return closes === outcome ? [] : [`the owner's answer ${step.id} (${step.then.verb}${step.then.args.length ? ` ${step.then.args.join(" ")}` : ""}) closes ${closes ?? "nothing"}, not ${outcome}`];
  }
  if (by === request.assignee && by !== "owner") return request.kind === "fix" && outcome !== "fixed" ? [`the assignee closes a fix only as fixed (its check re-run and passing); ${outcome} is the owner's answer to the question Producer asks on the claim (${answer})`] : [];
  if (by === "owner") return [`bare owner is no closer: the owner answers one of the entry's options (${answer})`];
  return [`it is assigned to ${request.assignee} (the assignee closes it, or the owner's answer to one of its options: ${answer})`];
}

/**
 * The events a stored close was judged on: those before its verified event (the close's own two events excluded), or,
 * for a decline (which re-runs no requester check, so has no verified event), those before the closed event.
 */
export function closeEventsOf(request: Pick<SlotRequest, "events" | "closed">): readonly RequestEvent[] {
  const at = request.closed !== undefined ? request.events.findIndex(event => event.id === request.closed) : -1;
  if (at <= 0) return request.events;
  return request.events.slice(0, request.events[at - 1]?.op === "verified" ? at - 1 : at);
}

/**
 * The judged inputs of a change or fix close (foundry-build-0048 U7 r3, Q7): sha256 over the sorted root-relative
 * paths of slot.json and pin.json of every slot the requester check judges (requesterSlots: the requester, and a
 * fix's target), each as `path \0 bytes` (a missing file has no bytes), then each judged pin's pinSet now
 * (requesterPinSets: the upstream pins its certification reads). The verified event stores it; conform Q7 re-runs the
 * checks only while it is unchanged, so drift after an honest close, upstream included, is slots.stale's, not Q7's.
 */
export function inputsSha256(consumer: string, request: { readonly kind: string; readonly from: string; readonly target: string }): string {
  const root = dirname(consumer);
  const paths = [...new Set(requesterSlots(request).flatMap(ref => {
    const head = ref.split("#")[0]!, cut = head.indexOf("/");
    const dir = slotDir(consumer, head.slice(0, cut) as ContentAgent, head.slice(cut + 1));
    return [slotFile(dir), join(dir, "pin.json")].map(file => file.slice(root.length + 1));
  }))].sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(`${path}\0`);
    const file = join(root, path);
    if (existsSync(file)) hash.update(readFileSync(file));
  }
  for (const line of requesterPinSets(root, request)) hash.update(`pinSet\0${line}\n`);
  return hash.digest("hex");
}
const SHA256 = /^[0-9a-f]{64}$/;

/** Every issue of a request record: the schema, then the conditions the validator cannot state. */
export function requestIssues(doc: unknown, root?: string): string[] {
  const issues = validateAgainst(recordSchema(REQUEST_FILE), doc).map(issue => `${issue.path} ${issue.message}`);
  if (issues.length || typeof doc !== "object" || doc === null) return issues;
  const request = doc as SlotRequest;
  const out: string[] = [];
  if (!(WORK_KINDS as readonly string[]).includes(request.kind)) out.push(`$.kind: the work kinds this store holds are ${WORK_KINDS.join(", ")}, got ${String(request.kind)} (decisions are clossys.queue-entry/1)`);
  const target = targetOf(request);
  if (!target) out.push(`$.target: a ${request.kind} entry names <agent>/<slot id> of a content agent`);
  // The router writes the assignee: its route's, else (an entry from before routing) the target's agent.
  const assignee = request.route?.assignee ?? target?.agent;
  if (target && request.assignee !== assignee) {
    out.push(assignee === target.agent ? `$.assignee: a ${request.kind} entry is assigned to the target's agent ${target.agent}` : `$.assignee: the entry is assigned where its route sends it (${assignee})`);
  }
  if (request.kind === "slot" && request.rel === undefined) out.push("$.rel: a slot entry says how the requester cites the slot (input or uses)");
  if (request.kind === "change" && request.want === undefined) out.push("$.want: a change entry says what it wants of the slot (repin, candidate or contract)");
  if (request.kind === "fix") for (const field of ["check", "findings", "cause"] as const) if (request[field] === undefined) out.push(`$.${field}: a kind fix entry names the failing check, its findings and the cause`);
  if (request.kind !== "slot" && (request.decision !== undefined || request.proposal !== undefined || request.reuse !== undefined)) out.push(`a ${request.kind} entry has no reuse or create decision (that is kind slot)`);
  if (request.decision === "reuse" && (request.reuse === undefined || request.overlaps === undefined)) out.push("a reuse decision needs reuse and overlaps");
  if (request.decision === "create" && (request.proposal === undefined || request.overlaps === undefined)) out.push("a create decision needs proposal and overlaps");
  if (request.status === "closed") {
    const fields = request.kind === "slot" ? ["decision", "link", "notified", "closed", "closedAt"] as const : ["outcome", "result", "notified", "closed", "closedAt"] as const;
    for (const field of fields) if (request[field] === undefined) out.push(`a closed request needs ${field}`);
    if (request.notified !== undefined && request.notified.to !== request.from) out.push(`a closed entry notifies its requester ${request.from}, not ${request.notified.to}`);
  }
  const ids = request.events.map(event => event.id);
  const byId = new Map(request.events.map(event => [event.id, event] as const));
  if (!ids.includes(request.opened)) out.push(`opened ${request.opened} is no event of the request`);
  else if (byId.get(request.opened)!.op !== "raised") out.push(`opened ${request.opened} is a ${byId.get(request.opened)!.op} event, not the raised event`);
  if (request.closed !== undefined && !ids.includes(request.closed)) out.push(`closed ${request.closed} is no event of the request`);
  // The stored status agrees with the event log (as openOnlyIssues checks a queue entry): closed iff one closed event,
  // and `closed` names it.
  const closes = request.events.filter(event => event.op === "closed");
  if (closes.length > 1) out.push(`the event log closes the entry ${closes.length} times`);
  if (request.status === "closed") {
    if (!closes.length) out.push("the status is closed and the event log has no closed event");
    else if (request.closed !== undefined && ids.includes(request.closed) && byId.get(request.closed)!.op !== "closed") out.push(`closed ${request.closed} is a ${byId.get(request.closed)!.op} event, not the closed event ${closes[0]!.id}`);
    // A change or fix closes only after the requester check re-ran and passed (queue/requester-check.ts). The verified
    // event has the close's provenance: Producer's, right before the close, at the close's time, naming the slots the
    // check judges (and, for a fix closed fixed, its own check passing). A conform read re-runs both checks (Q7).
    const at = request.closed !== undefined ? ids.indexOf(request.closed) : -1;
    if (request.kind !== "slot" && at >= 0 && request.outcome === "declined") {
      // A decline re-runs no requester check (U7 r5): no verified event right before its close.
      if (request.events[at - 1]?.op === "verified") out.push(`a declined close re-runs no requester check: ${request.events[at - 1]!.id} before the close ${request.closed} is a verified event`);
      out.push(...storedCloseIssues(request, request.events[at]!.by));
    } else if (request.kind !== "slot" && at >= 0) {
      const verified = request.events[at - 1];
      const close = request.events[at]!;
      const note = `${VERIFIED_NOTE}${requesterSlots(request).join(", ")}${request.kind === "fix" && request.outcome === "fixed" ? `; fix check ${String(request.check)} passes on ${request.target}` : ""}`;
      if (!request.events.slice(0, at).some(event => event.op === "verified" && event.by === "producer")) out.push("a closed change or fix entry has no producer verified event (its requester check passing) before its close");
      else if (verified?.op !== "verified" || verified.by !== "producer") out.push(`the event before the close ${close.id} is not Producer's verified event: the requester check passes right before the close`);
      else if (verified.at !== close.at) out.push(`verified ${verified.id} is at ${verified.at}, not the close's ${close.at}: the requester check runs in the close`);
      else if (verified.detail !== note) out.push(`verified ${verified.id} says ${JSON.stringify(verified.detail ?? "")}, not ${JSON.stringify(note)}: it names the slots the requester check judges`);
      if (verified?.op === "verified" && !SHA256.test(String(verified.inputsSha256 ?? ""))) out.push(`verified ${verified.id} carries no inputsSha256 (64 hex): the digest of the inputs the requester check judged`);
      // Who closed it, and with what (foundry-build-0048 U7 r3): the closure rule closeWork enforces (closerIssues).
      out.push(...storedCloseIssues(request, close.by));
    }
  } else if (closes.length || request.closed !== undefined || request.closedAt !== undefined || request.notified !== undefined || request.outcome !== undefined) {
    out.push(`the event log or the closing fields close the entry, but its status is ${request.status}`);
  }
  if (ids.some(id => !id.startsWith(`${request.id}#`))) out.push("every event id is <request id>#<n>");
  out.push(...optionIssues(request));
  return out;
}

/** A stored change or fix close judged by the closure rule on the events before it; a fix closes fixed only on a check Producer re-runs. */
function storedCloseIssues(request: SlotRequest, by: string | undefined): string[] {
  const out = closerIssues(request, by, request.outcome, closeEventsOf(request)).map(issue => `the close by ${by ?? "nobody"}: ${issue}`);
  if (request.kind === "fix" && request.outcome === "fixed" && !FIX_CHECKS.includes(String(request.check))) out.push(`its check ${String(request.check)} is not one Producer re-runs: it never closes fixed (the owner answers the claim, and declines or keeps it open)`);
  return out;
}

/** Why one option's step does not fit its entry (foundry-build-0048 U7 r4): the verbs and the args each takes. */
function stepIssues(request: SlotRequest, option: OwnerOption): string[] {
  const { verb, args } = option.then;
  const at = `$.options ${option.id}`;
  const target = targetOf(request);
  if (verb === "pin") return request.kind === "change" && args.length === 2 && args[0] === request.target && /^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.(md|json|svg)$/.test(args[1] ?? "") ? [] : [`${at}: pin takes [<this target>, <candidate file>] on a change entry`];
  if (verb === "close") return request.kind !== "slot" && args.length === 1 && (outcomesFor(request.kind) as readonly string[]).includes(args[0]!) ? [] : [`${at}: close takes one outcome of a ${request.kind} entry (${outcomesFor(request.kind).join(", ") || "none: a slot closes by its decision"})`];
  if (verb === "handoff") return args.length === 1 && target !== undefined && args[0] === target.agent ? [] : [`${at}: handoff takes [<the target's agent>]`];
  return args.length === 0 ? [] : [`${at}: reject takes no args`];
}

/** The typed-answer rules of an entry (foundry-build-0048 U7 r4): its options, the asked and answered events, a handoff. */
function optionIssues(request: SlotRequest): string[] {
  const out: string[] = [];
  const options = request.options ?? [];
  const ids = options.map(option => option.id);
  if (request.assignee === "owner" && !options.length) out.push("$.options: an entry assigned to the owner carries the options the owner answers (each a Producer step), never a free-text question");
  if (new Set(ids).size !== ids.length) out.push("$.options: option ids are unique");
  for (const option of options) out.push(...stepIssues(request, option));
  const asked = request.events.some(event => event.op === "asked");
  if (options.length && request.assignee !== "owner" && !asked && request.route?.delegated !== true) out.push(`$.options: an entry assigned to ${request.assignee} carries options only from Producer's asked event or the owner's handoff`);
  for (const event of request.events) {
    if (event.option !== undefined && event.op !== "answered") out.push(`${event.id}: only an answered event names an option`);
    if (event.op === "asked" && event.by !== "producer") out.push(`${event.id}: Producer asks the owner, not ${event.by ?? "nobody"}`);
    if (event.op === "answered" && (event.by !== "owner" || event.option === undefined || !ids.includes(event.option))) out.push(`${event.id}: an answer is the owner's choice of one of the entry's options (${ids.join(", ") || "none"}), not ${event.by ?? "nobody"}'s ${event.option ?? "free text"}`);
    // Provenance (U7 r5, blind1 B2): every owner answer names how it came and quotes the owner's words verbatim.
    if (event.op === "answered" && event.via === undefined) out.push(`${event.id}: an owner answer names how it came (via cli, chat or app)`);
    if (event.op === "answered" && !event.quote?.trim()) out.push(`${event.id}: an owner answer quotes the owner's words verbatim (a non-empty quote)`);
  }
  if (request.route?.delegated === true && !request.events.some(event => event.op === "answered" && options.find(option => option.id === event.option)?.then.verb === "handoff")) out.push("$.route.delegated: an entry is delegated only by the owner's answered handoff option");
  return out;
}

/** One entry file read: `request` only when it is valid; `doc` is whatever JSON it holds, so a reader can still report an invalid one. */
export interface ReadRequest { readonly file: string; readonly request?: SlotRequest; readonly doc?: unknown; readonly issues: readonly string[] }

/**
 * Every entry of one work kind under clossys/agents/producer/queue.<kind>/entries, read and judged (an unreadable one
 * is listed with its issue). queue.fix still holds clossys.queue-entry/1 fix entries the runner raises; those (schema
 * exactly clossys.queue-entry/1) are the /1 queue's (queue/entry.ts) and are skipped here (`legacyFixEntries` lists
 * them). Any other file there (no schema, a wrong one) is listed as an entry that does not read, never dropped.
 */
export function listRequests(consumer: string, kind: WorkKind = "slot"): ReadRequest[] {
  const dir = requestsDir(consumer, kind);
  if (!existsSync(dir)) return [];
  // Every .json file, hidden ones included (foundry-build-0048 U7 r3): a hidden entry is an invalid one, never skipped.
  // Writers' temp files end in .tmp and are not entries.
  return readdirSync(dir).filter(name => name.endsWith(".json")).sort().flatMap((name): ReadRequest[] => {
    const file = join(dir, name);
    let doc: unknown;
    try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) { return [{ file, issues: [`not JSON: ${error instanceof Error ? error.message : String(error)}`] }]; }
    if (kind === "fix" && (doc as { schema?: unknown } | null)?.schema === LEGACY_FIX_SCHEMA) return [];
    if (name.startsWith(".")) return [{ file, doc, issues: [`${name} is a hidden file: an entry is <id>.json, and a hidden one is never skipped`] }];
    const issues = requestIssues(doc, dirname(consumer));
    if (!issues.length && (doc as SlotRequest).kind !== kind) return [{ file, doc, issues: [`a ${(doc as SlotRequest).kind} entry is in ${workQueue(kind)}`] }];
    if (!issues.length && (doc as SlotRequest).id !== name.slice(0, -".json".length)) return [{ file, doc, issues: [`id ${(doc as SlotRequest).id} is not the file name`] }];
    return [issues.length ? { file, doc, issues } : { file, request: doc as SlotRequest, doc, issues }];
  });
}

/** Every work entry of every kind (slot, change, fix). */
export const listWorkEntries = (consumer: string): ReadRequest[] => WORK_KINDS.flatMap(kind => listRequests(consumer, kind));

/** The clossys.queue-entry/1 entries still under queue.fix: breakage raised as a decision entry, not a kind fix. */
export function legacyFixEntries(consumer: string): string[] {
  const dir = requestsDir(consumer, "fix");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith(".json")).sort().filter(name => {
    try { return (JSON.parse(readFileSync(join(dir, name), "utf8")) as { schema?: unknown } | null)?.schema === LEGACY_FIX_SCHEMA; } catch { return false; }
  }).map(name => name.slice(0, -".json".length));
}

export function readRequest(consumer: string, id: string): SlotRequest {
  if (!REQUEST_ID.test(id)) throw new RequestError(`${id} is not a request id`);
  const kind = WORK_KINDS.find(each => existsSync(requestPath(consumer, id, each)) && (each !== "fix" || (JSON.parse(readFileSync(requestPath(consumer, id, each), "utf8")) as { schema?: unknown }).schema === REQUEST_SCHEMA));
  if (!kind) throw new RequestError(`no work entry ${id} under clossys/agents/producer/${WORK_KINDS.map(workQueue).join(", ")}`);
  const file = requestPath(consumer, id, kind);
  const doc = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const issues = requestIssues(doc, dirname(consumer));
  if (issues.length) throw new RequestError(`request ${id} is invalid: ${issues.slice(0, 5).join("; ")}`);
  return doc as SlotRequest;
}

export class RequestError extends Error {
  constructor(message: string) { super(message); this.name = "RequestError"; }
}
/** A close a check refused (foundry-build-0048 U7 r5): the check that refused it, by name, and its findings. */
export class CheckFailure extends RequestError {
  constructor(readonly check: string, readonly findings: readonly string[], message: string) { super(message); this.name = "CheckFailure"; }
}

/** Writes a request whole (temp file, then rename); refuses an invalid one. Call under the entry's lock only. */
export function writeRequest(consumer: string, request: SlotRequest): string {
  const issues = requestIssues(request, dirname(consumer));
  if (issues.length) throw new RequestError(`request ${request.id} would be invalid: ${issues.slice(0, 5).join("; ")}`);
  const dir = requestsDir(consumer, request.kind);
  mkdirSync(dir, { recursive: true });
  const file = requestPath(consumer, request.id, request.kind);
  const temp = join(dir, `.${request.id}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp, `${JSON.stringify(request, null, 2)}\n`);
  renameSync(temp, file);
  return file;
}

/**
 * Creates a new entry exclusively: the draft's id, else `-2`..`-9`, whichever is free. The bytes go to a temp file that
 * is hard-linked to the entry name (an existing name refuses the link), so a reader never sees a torn file and a
 * parallel raise never overwrites another's entry.
 */
/** A draft under the id it is written as: the draft's own, or a `-2`..`-9` suffix of it when that one is taken. */
const addressed = (draft: SlotRequest, id: string): SlotRequest => ({ ...draft, id, opened: `${id}#1`, events: draft.events.map((event, index) => ({ ...event, id: `${id}#${index + 1}` })) });
function createRequest(consumer: string, draft: SlotRequest): SlotRequest {
  const dir = requestsDir(consumer, draft.kind);
  mkdirSync(dir, { recursive: true });
  for (let attempt = 1; attempt <= 9; attempt++) {
    const id = attempt === 1 ? draft.id : `${draft.id}-${attempt}`;
    const doc = addressed(draft, id);
    const issues = requestIssues(doc);
    if (issues.length) throw new RequestError(`request ${id} would be invalid: ${issues.slice(0, 5).join("; ")}`);
    const temp = join(dir, `.${id}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`);
    try { linkSync(temp, requestPath(consumer, id, draft.kind)); return doc; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally { unlinkSync(temp); }
  }
  throw new RequestError(`slot entry ${draft.id}: the id and its suffixes -2..-9 are all taken; nothing was written`);
}

/** The lock a request write holds: `.clossys/locks/queue/queue.slot/<key>.lock` beside the consumer's `clossys/`. */
export const requestLockPath = (consumer: string, key: string): string => join(dirname(consumer), ".clossys", "locks", "queue", SLOT_QUEUE, `${key}.lock`);
const LOCK_WAIT_MS = 5000;
const pause = new Int32Array(new SharedArrayBuffer(4));

/**
 * Runs `body` holding a request lock (the queue/entry.ts withQueueEntryLock pattern: an exclusive create, removed after,
 * never broken automatically). A held lock is waited on for up to five seconds, then refuses with nothing written.
 */
export function withRequestLock<T>(consumer: string, key: string, body: () => T): T {
  const lock = requestLockPath(consumer, key);
  mkdirSync(dirname(lock), { recursive: true });
  const until = Date.now() + LOCK_WAIT_MS;
  let fd: number;
  for (;;) {
    try { fd = openSync(lock, "wx"); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > until) throw new RequestError(`the slot entry is locked by another writer (${lock}); nothing was written. If no writer is running, remove the lock file by hand`);
      Atomics.wait(pause, 0, 0, 5);
    }
  }
  try {
    writeSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
    closeSync(fd);
    return body();
  } finally {
    rmSync(lock, { force: true });
  }
}
const raiseLock = (target: string) => `raise-${target.replace(/\//g, "-")}`;

const withEvent = (request: SlotRequest, op: RequestOp, at: string, by?: string, detail?: string, extra: Pick<RequestEvent, "option" | "via" | "quote"> = {}): { request: SlotRequest; id: string } => {
  const id = `${request.id}#${request.events.length + 1}`;
  return { id, request: { ...request, events: [...request.events, { id, at, op, ...(by ? { by } : {}), ...(detail !== undefined ? { detail } : {}), ...extra }] } };
};

/** The verified event's note: `requester check passed on <slots>` (requesterSlots, in order). */
const VERIFIED_NOTE = "requester check passed on ";

/**
 * Who may act on a slot entry (`by`): a content agent, the owner, the planner or Producer code. Never free text. Bare
 * `owner` raises, checks and decides (foundry-build-0048 U7 r3): those are not closures. Only a close path needs the
 * owner's answer ref (closeWork: owner:queue.<kind>#<id>; closeRequest: --approved or a registered --owner-ref).
 */
export const REQUEST_SEATS = [...CONTENT_AGENTS, "owner", "planner", "producer"] as const;
function checkSeat(by: string): void {
  if (!(REQUEST_SEATS as readonly string[]).includes(by)) throw new RequestError(`--by must be one of ${REQUEST_SEATS.join(", ")}, got ${by}`);
}
const SLOT_REF = /^(director|designer|writer|publisher)\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})$/;
const isPlaced = (consumer: string, agent: ContentAgent, id: string) => placedSlots(consumer, agent).some(entry => entry.id === id);

let version: string | undefined;
/** This Producer package's version, for an entry's `createdBy` (code actor). */
function producerVersion(): string {
  if (version === undefined) {
    try { version = (JSON.parse(readFileSync(join(PRODUCER_ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0"; } catch { version = "0.0.0"; }
  }
  return version;
}
/** The code verb that files an entry from each source. */
const SOURCE_CLI: Readonly<Record<SlotRequest["source"], string>> = {
  cli: "clossys request", ia: "clossys ia", interview: "clossys interview", feedback: "clossys feedback", scope: "clossys request --scan", check: "clossys check",
};

/** `2026-11-17T12:34:56Z` -> `20261117T1234Z`. */
const stampOf = (at: string) => `${at.slice(0, 4)}${at.slice(5, 7)}${at.slice(8, 10)}T${at.slice(11, 13)}${at.slice(14, 16)}Z`;

/**
 * The agent whose tree would hold `need`: the one content agent holding a placed slot with the same first id segment
 * (`themes.background.default` -> the agent holding `themes.*`). None, or more than one, is undefined.
 */
export function ownerOfNeed(consumer: string, need: string): ContentAgent | undefined {
  const head = need.split(".")[0]!;
  const agents = CONTENT_AGENTS.filter(agent => listSlots(consumer, agent).some(entry => entry.id.split(".")[0] === head));
  return agents.length === 1 ? agents[0] : undefined;
}

export interface RaiseInput {
  readonly target: string;
  readonly from: string;
  readonly rel?: "input" | "uses";
  readonly why: string;
  readonly source: SlotRequest["source"];
  readonly by: string;
  readonly at: string;
  /** As clossys.queue-entry/1: who raised it (default: the code verb of `source`), and how the words came (default cli). */
  readonly createdBy?: Actor;
  readonly via?: RequestEvent["via"];
  readonly quote?: string;
}

/** An open request for the same target from the same requester, if one exists. */
export function openRequestFor(consumer: string, target: string, from: string): SlotRequest | undefined {
  return listRequests(consumer).map(read => read.request).find(request => request?.status === "open" && request.target === target && request.from === from);
}

/** The router's route for an entry (queue/routing.ts): the one function every raise calls. */
function routeOf(consumer: string, entry: { readonly kind: WorkKind; readonly target: string; readonly assignee: SlotRequest["assignee"] }, facts?: RoutingFacts): EntryRoute {
  try { return routeEntry(facts ?? consumerFacts(consumer), entry); } catch (error) {
    if (error instanceof RoutingError) throw new RequestError(`the router refuses ${entry.kind} ${entry.target}: ${error.message}; nothing was written`);
    throw error;
  }
}
const routeDetail = (route: EntryRoute): string =>
  `row ${route.row} -> ${route.assignee}${route.handler ? ` (${route.handler.loop}, ${route.handler.skill})` : ""}${route.packet ? ` (${route.packet.queue}${route.packet.step ? ` from ${route.packet.step}` : ""})` : ""}${route.escalate ? ", escalate package" : ""}${route.delegated ? ", delegated by the owner's handoff" : ""}`;
const routedEvent = (id: string, n: number, at: string, route: EntryRoute): RequestEvent => ({ id: `${id}#${n}`, at, op: "routed", by: "producer", detail: routeDetail(route) });

/** An option id from a verb and a name: `pin-` and the candidate file name, lower-case, every other character a dash. */
const optionId = (verb: string, name: string) => `${verb}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
/**
 * The owner's options on an entry the router assigns to the owner (foundry-build-0048 U7 r4), each a Producer step as
 * data. Labels are DRAFT copy (not owner-approved).
 * - A change that wants a repin of a non-record slot: `pin-<candidate>` per candidate of the target but its pinned one
 *   (`pin <target> <candidate>`, through the pin gate, then closes changed).
 * - `handoff` when the table, the owner reservation set aside, routes the entry to an agent (`handoff <agent>`).
 * - A change or fix: `decline` (`close declined`).
 * None is a raise refused: an owner entry is never a free-text question.
 */
function ownerOptions(consumer: string, entry: { readonly kind: WorkKind; readonly target: string; readonly want?: SlotRequest["want"] }, facts?: RoutingFacts): OwnerOption[] {
  const target = targetOf(entry)!;
  const out: OwnerOption[] = [];
  if (entry.kind === "change" && entry.want === "repin" && !isRecordSlot(dirname(consumer), target.agent, target.need)) {
    const slot = readSlotEntry(consumer, target.agent, target.need);
    for (const name of slot?.candidates ?? []) {
      if (name !== slot?.pin?.candidate) out.push({ id: optionId("pin", name), label: `Pin ${name} on ${entry.target}`, then: { verb: "pin", args: [entry.target, name] } });
    }
  }
  let handoff: EntryRoute | undefined;
  try { handoff = routeEntry(facts ?? consumerFacts(consumer), { kind: entry.kind, target: entry.target, assignee: target.agent }, { delegated: true }); } catch (error) {
    if (!(error instanceof RoutingError)) throw error;
  }
  if (handoff && handoff.assignee !== "owner") out.push({ id: "handoff", label: `Hand it to ${handoff.assignee} to answer by its skill`, then: { verb: "handoff", args: [target.agent] } });
  if (entry.kind !== "slot") out.push({ id: "decline", label: `Decline: close it declined`, then: { verb: "close", args: ["declined"] } });
  if (!out.length) throw new RequestError(`the owner would have no option on ${entry.kind} ${entry.target} (no candidate to pin, no agent to hand it to): nothing was written`);
  return out;
}
/** The options Producer asks the owner on an agent's fix claim it cannot accept itself (DRAFT labels). */
const claimOptions = (request: SlotRequest): OwnerOption[] => [
  { id: "decline", label: `Decline: close it declined`, then: { verb: "close", args: ["declined"] } },
  { id: "keep-open", label: `Keep it open with ${request.assignee}`, then: { verb: "reject", args: [] } },
];

/**
 * A requester agent raises to another agent only along an issuing edge its conform.json declares (`requests.issuing`):
 * an undeclared edge is refused, nothing written. An agent raising for its own tree needs no edge.
 */
function issuingRefusal(from: ContentAgent, to: ContentAgent, kind: WorkKind, facts?: RoutingFacts): void {
  if (from === to) return;
  const declared = (facts ? facts.declarations(from) : readDeclarationsOf(from))?.requests?.issuing ?? [];
  if (!declared.some(edge => edge.to === to && edge.kinds.includes(kind))) {
    throw new RequestError(`${from} declares no issuing edge to ${to} for kind ${kind} (packages/${from}/conform.json requests.issuing): a request follows a declared edge a real inputs/uses edge backs`);
  }
}
const readDeclarationsOf = (agent: string) => readDeclarations(agent);

/**
 * Raises a change or fix entry on a placed slot (foundry-build-0048 U7), routed by the table; idempotent on kind,
 * target and requester (an open one is returned). A change names what it wants (repin, candidate, contract); a fix
 * names the failing check, its findings and the cause. A code-raised fix is from the broken slot itself, so its
 * closure notifies that slot.
 */
export interface RaiseWorkInput {
  readonly kind: "change" | "fix";
  readonly target: string;
  readonly from: string;
  readonly why: string;
  readonly source: SlotRequest["source"];
  readonly by: string;
  readonly at: string;
  readonly want?: SlotRequest["want"];
  readonly check?: string;
  readonly findings?: readonly string[];
  readonly cause?: string;
  readonly createdBy?: Actor;
  readonly via?: RequestEvent["via"];
  readonly quote?: string;
  /** Entries the raise cites (rel cites): a fix raised on a failed owner answer cites the answered entry. */
  readonly cites?: readonly Ref[];
}
export function raiseWork(consumer: string, input: RaiseWorkInput, options: { readonly dry?: boolean; readonly facts?: RoutingFacts } = {}): { request: SlotRequest; created: boolean } {
  const target = targetOf(input);
  if (!target) throw new RequestError(`a ${input.kind} entry names <agent>/<slot id>, got ${input.target}`);
  // Not a closure, so bare owner may act here; only close paths need an owner answer ref (U7 r3).
  checkSeat(input.by);
  if (!isPlaced(consumer, target.agent, target.need)) throw new RequestError(`${input.target} is no placed slot: a ${input.kind} entry is about a placed slot (a slot no agent holds is kind slot)`);
  if (input.from !== "owner") {
    const from = SLOT_REF.exec(input.from);
    if (!from) throw new RequestError(`--from must be owner or <agent>/<slot id> of a content agent, got ${input.from}`);
    const agent = from[1] as ContentAgent;
    if (!isPlaced(consumer, agent, from[2]!)) throw new RequestError(`${input.from} is no placed slot`);
    if (isContentAgent(input.by) && input.by !== agent) throw new RequestError(`${input.by} raises for ${input.from}: a slot's own agent (${agent}) raises its requests`);
    issuingRefusal(agent, target.agent, input.kind, options.facts);
  } else if (isContentAgent(input.by)) throw new RequestError(`${input.by} raises as the owner: an agent raises for its own slot (--from <agent>/<slot>)`);
  return withRequestLock(consumer, raiseLock(`${input.kind}-${input.target}`), () => {
    const existing = listRequests(consumer, input.kind).map(read => read.request).find(request => request?.status === "open" && request.target === input.target && request.from === input.from);
    if (existing) return { request: existing, created: false };
    const id = `${stampOf(input.at)}-${input.kind}-${target.need.replace(/\./g, "-")}`.slice(0, 80).replace(/-+$/, "");
    const route = routeOf(consumer, { kind: input.kind, target: input.target, assignee: target.agent }, options.facts);
    const choices = route.assignee === "owner" ? ownerOptions(consumer, { kind: input.kind, target: input.target, ...(input.want !== undefined ? { want: input.want } : {}) }, options.facts) : undefined;
    const draft: SlotRequest = {
      schema: REQUEST_SCHEMA, id, kind: input.kind, from: input.from, assignee: route.assignee as SlotRequest["assignee"], target: input.target, status: "open", opened: `${id}#1`,
      why: input.why, source: input.source,
      createdBy: input.createdBy ?? { actor: "code", cli: SOURCE_CLI[input.source], version: producerVersion() },
      createdAt: input.at, refs: [...(SLOT_REF.test(input.from) && input.from !== input.target ? [{ to: input.from as Ref["to"], rel: "raisedBy" as const }] : []), ...(input.cites ?? [])], route,
      ...(choices ? { options: choices } : {}),
      ...(input.want !== undefined ? { want: input.want } : {}),
      ...(input.check !== undefined ? { check: input.check } : {}), ...(input.findings !== undefined ? { findings: [...input.findings] } : {}), ...(input.cause !== undefined ? { cause: input.cause } : {}),
      events: [
        { id: `${id}#1`, at: input.at, op: "raised", by: input.by, via: input.via ?? "cli", ...(input.quote !== undefined ? { quote: input.quote } : {}), detail: input.why },
        routedEvent(id, 2, input.at, route),
      ],
    };
    if (options.dry) return { request: draft, created: true };
    return { request: createRequest(consumer, draft), created: true };
  });
}

/**
 * Closes a change or fix entry with its link back to the requester: an outcome, a result ref that resolves (a placed
 * slot, or a queue entry `<queue>#<id>` that exists) and a notify event addressed to `from`. Who closes it, with which
 * outcome, is the closure rule (closerIssues, foundry-build-0048 U7 r4): an agent assignee closes a change, and a fix
 * only as fixed; any other close is the owner's typed answer (answerRequest runs it, closer `owner:queue.<kind>#<id>`).
 * An agent's fix claim Producer cannot accept itself (declined, or fixed on a check it cannot re-run) asks the owner:
 * the entry gains the claim options and an `asked` event, stays open, and is returned with `asked` set. Before it
 * closes, code re-runs the requester's check (queue/requester-check.ts) and, for a fix closing fixed, the fix's own
 * check: a pass records a producer `verified` event (with the digest of the inputs it judged), then the close; a fail
 * records `rejected` and refuses, so the entry stays open.
 */
export interface CloseInput {
  readonly by: string;
  readonly at: string;
  readonly outcome: NonNullable<SlotRequest["outcome"]>;
  readonly result: string;
  /** An owner answer's close: the answered event it runs, which must still be the entry's last event under the lock. */
  readonly answered?: string;
  /** Prefixed to a rejected event's detail (an answer's pin that the gate already applied). */
  readonly note?: string;
}
export function closeWork(consumer: string, id: string, input: CloseInput): SlotRequest & { readonly asked?: true } {
  if (!OWNER_QUEUE_ANSWER.test(input.by)) checkSeat(input.by);
  return withRequestLock(consumer, id, () => {
    const request = readRequest(consumer, id);
    if (request.kind === "slot") throw new RequestError(`request ${id} is kind slot: it closes by its decision (clossys request ${id} --close)`);
    if (request.status !== "open") throw new RequestError(`request ${id} is already closed`);
    if (input.answered !== undefined && request.events.at(-1)?.id !== input.answered) throw new RequestError(`request ${id} changed since the answer ${input.answered} (its last event is ${request.events.at(-1)?.id ?? "none"}); nothing was closed`);
    const note = input.note ? `${input.note}; ` : "";
    const root = dirname(consumer);
    const owner = input.by === ownerAnswerOf(request);
    if (!owner && awaitsOwner(request)) throw new RequestError(`request ${id} awaits the owner's answer (${request.options!.map(option => option.id).join(", ")}): nothing closes it but clossys request ${id} --answer <option>`);
    const why = resultRefusal(consumer, input.result);
    if (why) throw new RequestError(`--result ${input.result}: ${why}`);
    // An agent's fix claim Producer cannot accept itself goes to the owner as a closed question (U7 r4).
    const claim = !owner && request.kind === "fix" && input.by === request.assignee && input.by !== "owner"
      && (input.outcome === "declined" || (input.outcome === "fixed" && !FIX_CHECKS.includes(String(request.check))));
    if (claim) {
      const asked = withEvent({ ...request, options: claimOptions(request) }, "asked", input.at, "producer",
        `${input.by} claims ${input.outcome}${input.outcome === "fixed" ? ` on check ${String(request.check)}, which Producer cannot re-run (${FIX_CHECKS.join(", ")})` : ""}; the owner answers decline or keep-open`).request;
      writeRequest(consumer, asked);
      return { ...asked, asked: true as const };
    }
    const refusal = closerIssues(request, input.by, input.outcome);
    if (refusal.length) throw new RequestError(`${input.by} cannot close ${id}: ${refusal.join("; ")}`);
    // A fix closing as fixed re-runs its own raising check first (queue/requester-check.ts fixCheck): still failing
    // records rejected.
    let fixNote = "";
    if (request.kind === "fix" && input.outcome === "fixed") {
      const fix = fixCheck(root, request);
      if (!fix.ran) throw new RequestError(`request ${id} cannot close fixed: its check ${String(request.check)} is not one Producer can re-run (${FIX_CHECKS.join(", ")})`);
      if (fix.failures.length) {
        writeRequest(consumer, withEvent(request, "rejected", input.at, "producer", `${note}fix check ${request.check} still fails on ${request.target}: ${fix.failures.slice(0, 3).join("; ")}`).request);
        throw new CheckFailure(String(request.check), fix.failures, `request ${id} stays open: its check ${request.check} still fails on ${request.target} (${fix.failures.slice(0, 3).join("; ")}); a rejected event sends it back to ${request.assignee}`);
      }
      fixNote = `; fix check ${request.check} passes on ${request.target}`;
    }
    // A decline serves nothing, so it re-runs no requester check (U7 r5, blind2 s4): it closes right after the decision.
    if (input.outcome === "declined") {
      const declined = withEvent({
        ...request, status: "closed", outcome: input.outcome, result: input.result, notified: { to: request.from, at: input.at }, closedAt: input.at,
      }, "closed", input.at, input.by, `${input.outcome}: ${input.result}; notified ${request.from}`);
      const next: SlotRequest = { ...declined.request, closed: declined.id };
      writeRequest(consumer, next);
      return next;
    }
    // Code re-runs the requester's check: a fail records rejected and the entry stays open.
    const check = requesterCheck(root, request);
    if (!check.ok) {
      writeRequest(consumer, withEvent(request, "rejected", input.at, "producer", `${note}requester check failed on ${check.slots.join(", ")}: ${check.failures.slice(0, 3).join("; ")}`).request);
      throw new CheckFailure("requester.check", check.failures, `request ${id} stays open: the requester check failed (${check.failures.slice(0, 3).join("; ")}); a rejected event sends it back to ${request.assignee}`);
    }
    const judged = withEvent(request, "verified", input.at, "producer", `${VERIFIED_NOTE}${check.slots.join(", ")}${fixNote}`);
    const last = judged.request.events.length - 1;
    const verified: SlotRequest = { ...judged.request, events: judged.request.events.map((event, index) => index === last ? { ...event, inputsSha256: inputsSha256(consumer, request) } : event) };
    const closing = withEvent({
      ...verified, status: "closed", outcome: input.outcome, result: input.result, notified: { to: request.from, at: input.at }, closedAt: input.at,
    }, "closed", input.at, input.by, `${input.outcome}: ${input.result}; notified ${request.from}`);
    const next: SlotRequest = { ...closing.request, closed: closing.id };
    writeRequest(consumer, next);
    return next;
  });
}

/** The owner's answer to one entry: the chosen option id only, with an optional note that changes nothing. */
export interface AnswerInput {
  readonly option: string;
  readonly at: string;
  readonly note?: string;
  readonly via?: RequestEvent["via"];
  readonly quote?: string;
}
/** What an answer did: the entry after it, the step it ran, whether the step passed, and the fix a failed step raised. */
export interface AnswerResult { readonly request: SlotRequest; readonly option: OwnerOption; readonly ok: boolean; readonly message: string; readonly fix?: SlotRequest }

/**
 * Records the owner's answer to an entry awaiting it (foundry-build-0048 U7 r4) and runs the chosen option's step
 * mechanically through the normal verbs and gates. Refused with nothing written: an entry that awaits no answer, an
 * option id it does not offer, an answer that does not name how it came (`via`) or quote the owner's words verbatim
 * (`quote`, U7 r5), or another answer to the same entry still running. The `answered` event names the option, its
 * channel and the quote (a note is stored as its detail and changes nothing). Then:
 * - `close <outcome>`: closeWork, closer `owner:queue.<kind>#<id>`, result the target (fixed) or the entry itself.
 * - `pin <target> <candidate>`: `clossys pin` with `--by owner:queue.change#<id>` (the pin gate; the pin binds to this
 *   answer), then closeWork changed with the target as result.
 * - `handoff <agent>`: the entry is re-routed with the owner reservation set aside (route.delegated) to that agent.
 * - `reject`: a `rejected` event; the entry stays open with its assignee.
 * The whole answer, step included, holds the entry's answer lock, and every step re-checks under the entry lock that
 * the answer is still its last event before it writes (U7 r5). A step that fails, for any reason, leaves the entry open
 * with a `rejected` event naming the check that refused it and, for a change, raises a kind fix on its target (routed
 * by the table) citing the entry; a fix entry is its own fix. A pin the gate applied before a later check refused the
 * close is named in both, and the fix route is proven before the pin runs, so an applied pin never sits on an open
 * entry with no fix routed.
 */
export async function answerRequest(consumer: string, id: string, input: AnswerInput): Promise<AnswerResult> {
  if (input.via === undefined || !input.quote?.trim()) throw new RequestError(`an owner answer names how it came (--via cli|chat|app) and quotes the owner's words verbatim (--quote "<the owner's words>"); nothing was written`);
  return withAnswerLock(consumer, id, () => runAnswer(consumer, id, input));
}

/** The lock one answer holds for its whole run, step included (an async body: a second answer is refused, not waited on). */
async function withAnswerLock<T>(consumer: string, id: string, body: () => Promise<T>): Promise<T> {
  const lock = requestLockPath(consumer, `answer-${id}`);
  mkdirSync(dirname(lock), { recursive: true });
  let fd: number;
  try { fd = openSync(lock, "wx"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new RequestError(`another answer to request ${id} is running (${lock}); nothing was written. If none is, remove the lock file by hand`);
  }
  try {
    writeSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
    closeSync(fd);
    return await body();
  } finally {
    rmSync(lock, { force: true });
  }
}

async function runAnswer(consumer: string, id: string, input: AnswerInput): Promise<AnswerResult> {
  const answered = withRequestLock(consumer, id, () => {
    const request = readRequest(consumer, id);
    if (request.status !== "open") throw new RequestError(`request ${id} is closed; nothing was written`);
    if (!awaitsOwner(request)) throw new RequestError(`request ${id} awaits no owner answer (assigned to ${request.assignee}${request.options?.length ? ", no open question" : ", no options"}); nothing was written`);
    const option = request.options!.find(item => item.id === input.option);
    if (!option) throw new RequestError(`--answer ${input.option} is none of request ${id}'s options (${request.options!.map(item => item.id).join(", ")}); nothing was written`);
    const next = withEvent(request, "answered", input.at, "owner", input.note?.trim() || undefined, { option: option.id, via: input.via, quote: input.quote }).request;
    writeRequest(consumer, next);
    return { request: next, option, event: next.events.at(-1)!.id };
  });
  const { option, event } = answered;
  const self = ownerAnswerOf(answered.request);
  const step = option.then;
  /** The entry under its lock, refused unless this answer is still its last event. */
  const stillAnswered = (request: SlotRequest, what: string) => {
    if (request.events.at(-1)?.id !== event || answeredStep(request)?.id !== option.id) throw new RequestError(`request ${id} changed since the answer ${event}; nothing was ${what}`);
  };
  let applied: string | undefined;
  try {
    if (step.verb === "reject") {
      const kept = withRequestLock(consumer, id, () => {
        const request = readRequest(consumer, id);
        stillAnswered(request, "kept open");
        const next = withEvent(request, "rejected", input.at, "producer", `the owner keeps it open (${option.id}) with ${request.assignee}`).request;
        writeRequest(consumer, next);
        return next;
      });
      return { request: kept, option, ok: true, message: `request ${id} stays open with ${kept.assignee} (the owner's ${option.id})` };
    }
    if (step.verb === "handoff") {
      const handed = withRequestLock(consumer, id, () => {
        const request = readRequest(consumer, id);
        stillAnswered(request, "handed off");
        const target = targetOf(request)!;
        const route = routeEntry(consumerFacts(consumer), { kind: request.kind as WorkKind, target: request.target, assignee: target.agent }, { delegated: true });
        if (route.assignee === "owner" || route.assignee !== step.args[0]) throw new StepFailure("route", [`the table, the owner reservation set aside, routes ${request.target} to ${route.assignee}, not ${step.args[0]}`]);
        const next = withEvent({ ...request, assignee: route.assignee as SlotRequest["assignee"], route }, "routed", input.at, "producer", routeDetail(route)).request;
        writeRequest(consumer, next);
        return next;
      });
      return { request: handed, option, ok: true, message: `request ${id} handed to ${handed.assignee} (${handed.route!.row}, delegated)` };
    }
    if (step.verb === "pin") {
      // The fix a later refusal would raise must route before the pin is applied (U7 r5, blind2 s3).
      try { fixFor(consumer, answered.request, option, new StepFailure("requester.check", []), input.at, { dry: true }); } catch (error) {
        throw new StepFailure("route", [`no fix on ${answered.request.target} would route, so the pin is not applied: ${error instanceof Error ? error.message : String(error)}`]);
      }
      withRequestLock(consumer, id, () => stillAnswered(readRequest(consumer, id), "pinned"));
      const { runPinCli } = await import("../cli/pin.js");
      let pinned: Awaited<ReturnType<typeof runPinCli>>;
      try { pinned = await runPinCli([step.args[0]!, step.args[1]!, "--by", self, "--at", input.at, "--root", dirname(consumer)], dirname(consumer)); } catch (error) {
        throw new StepFailure("pin", [error instanceof Error ? error.message : String(error)]);
      }
      if (pinned.exitCode !== 0) {
        // The pin gate's own refusals (constitution/pin-gate.ts) carry them as data; anything else is the pin verb's rules.
        const gate = (pinned.output as { refusals?: unknown } | undefined)?.refusals;
        throw new StepFailure(Array.isArray(gate) ? "pin.gate" : "pin", (pinned.message ?? "pin refused").split("\n").map(line => line.trim()).filter(Boolean));
      }
      applied = `pin ${step.args[0]} ${step.args[1]} is applied (the pin gate passed)`;
      const closed = closeWork(consumer, id, { by: self, at: input.at, outcome: "changed", result: step.args[0]!, answered: event, note: applied });
      return { request: closed, option, ok: true, message: `${step.args[0]}: pinned ${step.args[1]}; request ${id} closed changed, notified ${closed.from}` };
    }
    const outcome = step.args[0] as NonNullable<SlotRequest["outcome"]>;
    const closed = closeWork(consumer, id, { by: self, at: input.at, outcome, result: outcome === "fixed" ? answered.request.target : `${workQueue(answered.request.kind as WorkKind)}#${id}`, answered: event });
    return { request: closed, option, ok: true, message: `request ${id} closed ${outcome}, notified ${closed.from}` };
  } catch (error) {
    // Every error is a failed step (U7 r5, blind1 s1), labelled by the check that refused it.
    const failure = error instanceof StepFailure ? error
      : error instanceof CheckFailure ? new StepFailure(error.check, error.findings.length ? error.findings : [error.message])
      : new StepFailure(error instanceof RoutingError ? "route" : "closure", [error instanceof Error ? error.message : String(error)]);
    return failedStep(consumer, id, option, applied ? new StepFailure(failure.check, [applied, ...failure.findings]) : failure, input.at);
  }
}

/**
 * A step of an owner answer that did not pass: the check that refused it and its findings. The checks: `pin.gate` (the
 * pin gate's verdict), `pin` (the pin verb's own rules), `requester.check`, a fix's own check, `route` (the router) and
 * `closure` (the closure rule, or the entry changed since the answer).
 */
class StepFailure extends Error {
  constructor(readonly check: string, readonly findings: readonly string[]) { super(findings.join("; ")); this.name = "StepFailure"; }
}

/** The kind fix a change's failed answer raises on its target (dry: what it would raise, nothing written). */
function fixFor(consumer: string, request: SlotRequest, option: OwnerOption, failure: StepFailure, at: string, options: { readonly dry?: boolean } = {}): SlotRequest {
  const findings = failure.findings.length ? [...failure.findings] : [failure.check];
  return raiseWork(consumer, {
    kind: "fix", target: request.target, from: request.target, source: "check", by: "producer", at,
    why: `the owner's answer ${option.id} on ${workQueue("change")}#${request.id} did not pass ${failure.check}`,
    check: failure.check, findings, cause: `the owner's answer ${option.id} (${option.then.verb} ${option.then.args.join(" ")}) on ${workQueue("change")}#${request.id}`,
    cites: [{ to: `producer/${workQueue("change")}` as Ref["to"], record: request.id, rel: "cites" }],
  }, options).request;
}

/**
 * A failed answer step: a rejected event (unless the step wrote one), and for a change a kind fix on its target. When
 * the entry's lock is still held (the step itself timed out on it, U7 r7), the rejected event cannot be written (the
 * lock is never broken): the fix still records the failed step, with a finding that the event is missing, and the
 * entry, read as it stands, stays open.
 */
function failedStep(consumer: string, id: string, option: OwnerOption, failure: StepFailure, at: string): AnswerResult {
  let request: SlotRequest;
  let failed = failure;
  try {
    request = withRequestLock(consumer, id, () => {
      const now = readRequest(consumer, id);
      if (now.events.at(-1)?.op === "rejected" || now.status !== "open") return now;
      const next = withEvent(now, "rejected", at, "producer", `the owner's answer ${option.id} failed (${failure.check}): ${failure.findings.slice(0, 3).join("; ")}`).request;
      writeRequest(consumer, next);
      return next;
    });
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    request = readRequest(consumer, id);
    failed = new StepFailure(failure.check, [...failure.findings, `no rejected event was written on ${workQueue("change")}#${id}: ${error.message}`]);
  }
  const findings = failed.findings.length ? [...failed.findings] : [failed.check];
  let fix: SlotRequest | undefined;
  let unrouted = "";
  if (request.kind === "change" && request.status === "open") {
    try { fix = fixFor(consumer, request, option, failed, at); } catch (error) {
      unrouted = `; no fix could be raised (${error instanceof Error ? error.message : String(error)})`;
    }
  }
  return { request, option, ok: false, ...(fix ? { fix } : {}), message: `request ${id} stays open: the owner's answer ${option.id} failed ${failed.check} (${findings.slice(0, 4).join("; ")})${fix ? `; fix ${fix.id} routed to ${fix.assignee}` : unrouted}` };
}

/** Why a result ref does not resolve: a placed slot ref, or a `<queue>#<id>` entry that exists. Undefined when it does. */
export function resultRefusal(consumer: string, result: string): string | undefined {
  const slot = SLOT_REF.exec(result.split("#")[0]!);
  if (slot && !result.includes("#")) return isPlaced(consumer, slot[1] as ContentAgent, slot[2]!) ? undefined : "is no placed slot";
  const entry = /^(queue\.[a-z]+)#([0-9]{8}T[0-9]{4}Z-[a-z0-9-]+)$/.exec(result);
  if (entry) return existsSync(join(consumer, "agents", "producer", entry[1]!, "entries", `${entry[2]}.json`)) ? undefined : "names no queue entry";
  return "is neither a placed slot ref nor a <queue>#<id> entry";
}

/**
 * Raises a slot request (idempotent on target and requester: an open one is returned, not repeated, also for raises
 * running in parallel). Refused, with nothing written: a target that is placed (cite it), and a requester that is not
 * the owner or a placed slot of a content agent whose edges name the target with this rel, raised by that slot's own
 * agent (or the owner, the planner or Producer code). `cited` is clossys ia's own write: the slot it writes names the
 * need, and the request is raised right after that write.
 */
export function raiseRequest(consumer: string, input: RaiseInput, options: { readonly dry?: boolean; readonly cited?: boolean; readonly facts?: RoutingFacts } = {}): { request: SlotRequest; created: boolean } {
  const checked = slotRaiseChecks(consumer, input, options);
  return withRequestLock(consumer, raiseLock(input.target), () => {
    const existing = openRequestFor(consumer, input.target, input.from);
    if (existing) return { request: existing, created: false };
    const draft = slotRequestDraft(consumer, input, checked, options.facts);
    if (options.dry) return { request: draft, created: true };
    return { request: createRequest(consumer, draft), created: true };
  });
}

/** What a slot raise checks before it writes (raiseRequest): the target, the requester, its issuing edge and its cite. */
function slotRaiseChecks(consumer: string, input: RaiseInput, options: { readonly cited?: boolean; readonly facts?: RoutingFacts }): { target: { agent: ContentAgent; need: string }; rel: "input" | "uses" } {
  const target = targetOf(input);
  if (!target) throw new RequestError(`request target must be <agent>/<slot id>, got ${input.target}`);
  if (!NEED_ID.test(target.need)) throw new RequestError(`${target.need} is not a slot id`);
  // Not a closure, so bare owner may act here; only close paths need an owner answer ref (U7 r3).
  checkSeat(input.by);
  const rel = input.rel ?? "input";
  if (isPlaced(consumer, target.agent, target.need)) throw new RequestError(`${input.target} is placed: cite it (an input or uses ref to ${input.target}); a slot request is for a slot no agent holds`);
  if (input.from === "owner") {
    if (isContentAgent(input.by)) throw new RequestError(`${input.by} raises as the owner: an agent raises for its own slot (--from <agent>/<slot>)`);
  } else {
    const from = SLOT_REF.exec(input.from);
    if (!from) throw new RequestError(`--from must be owner or <agent>/<slot id> of a content agent, got ${input.from}`);
    const [agent, id] = [from[1] as ContentAgent, from[2]!];
    if (!isPlaced(consumer, agent, id)) throw new RequestError(`${input.from} is no placed slot: a request is raised from a slot that cites the need`);
    if (isContentAgent(input.by) && input.by !== agent) throw new RequestError(`${input.by} raises for ${input.from}: a slot's own agent (${agent}) raises its requests`);
    issuingRefusal(agent, target.agent, "slot", options.facts);
    if (!options.cited) {
      const edges = slotEdges(consumer, agent, id) ?? [];
      if (!edges.some(edge => edge.to === input.target || edge.to === target.need)) throw new RequestError(`${input.from} does not cite ${input.target}: its slot names the need (an ${rel} ref) before a request is raised`);
      if (!edges.some(edge => (edge.to === input.target || edge.to === target.need) && edge.rel === rel)) throw new RequestError(`${input.from} does not cite ${input.target} as ${rel}`);
    }
  }
  return { target, rel };
}

/** The entry a fresh slot raise writes: its id, its route, the owner's options when the owner is routed, and its two events. */
function slotRequestDraft(consumer: string, input: RaiseInput, checked: ReturnType<typeof slotRaiseChecks>, facts?: RoutingFacts): SlotRequest {
  const { target, rel } = checked;
  const id = `${stampOf(input.at)}-${target.need.replace(/\./g, "-")}`.slice(0, 80).replace(/-+$/, "");
  const route = routeOf(consumer, { kind: "slot", target: input.target, assignee: target.agent }, facts);
  const choices = route.assignee === "owner" ? ownerOptions(consumer, { kind: "slot", target: input.target }, facts) : undefined;
  return {
    schema: REQUEST_SCHEMA, id, kind: "slot", from: input.from, assignee: route.assignee as SlotRequest["assignee"], target: input.target, status: "open", opened: `${id}#1`,
    rel, why: input.why, source: input.source,
    createdBy: input.createdBy ?? { actor: "code", cli: SOURCE_CLI[input.source], version: producerVersion() },
    createdAt: input.at, refs: SLOT_REF.test(input.from) ? [{ to: input.from as Ref["to"], rel: "raisedBy" }] : [], route,
    ...(choices ? { options: choices } : {}),
    events: [
      { id: `${id}#1`, at: input.at, op: "raised", by: input.by, via: input.via ?? "cli", ...(input.quote !== undefined ? { quote: input.quote } : {}), detail: input.why },
      routedEvent(id, 2, input.at, route),
    ],
  };
}

/**
/**
 * Why an entry an agent step wrote is not a fresh slot request of its own (foundry-build-0048 U7 r5 and U9 fix r1,
 * the runner's create-only guard, loop/runner.ts): a schema-valid entry (requestIssues), then agentRaiseIssues.
 */
export function freshRaiseIssues(consumer: string, doc: unknown, raiser: ContentAgent, options: { readonly facts?: RoutingFacts } = {}): string[] {
  const shape = requestIssues(doc, dirname(consumer));
  if (shape.length) return shape;
  const entry = doc as SlotRequest;
  if (entry.kind !== "slot") return [`${entry.id} is kind ${entry.kind}, not a slot request`];
  return agentRaiseIssues(consumer, entry, raiser, options);
}

/**
 * U9 fix r1 (review-u9-blind1 #1), U7 r5: why a slot request an agent's own loop step wrote is not the entry the
 * request verb itself raises for that agent (`clossys request --target ... --from <agent>/<slot> --by <agent>`, or its
 * `--scan`). The verb's own refusals run on the entry's fields (slotRaiseChecks: the target is not placed; `from` is a
 * placed slot of this agent that cites the target with the entry's rel; the issuing edge), the verb's own draft is
 * rebuilt from them (slotRequestDraft) and must equal the entry exactly: its id from its timestamp, or createRequest's
 * -2..-9 suffix; its raised event by the agent via cli with no quote and the routed event, route and owner options the
 * router derives (the append-only chain the verb writes, and nothing a later step writes); its raisedBy ref; its code
 * actor and version. No other open entry may raise the same target from the same slot (the verb's idempotency).
 * A forged or rewritten chain is refused. Empty when the entry is exactly the verb's.
 */
export function agentRaiseIssues(consumer: string, entry: SlotRequest, agent: ContentAgent, options: { readonly facts?: RoutingFacts } = {}): string[] {
  if (entry.source !== "cli" && entry.source !== "scope") return [`source ${entry.source}: an agent raises through clossys request (cli) or its --scan (scope)`];
  if (entry.from === "owner" || !entry.from.startsWith(`${agent}/`)) return [`from ${entry.from}: ${agent} raises only from its own slot`];
  const input: RaiseInput = { target: entry.target, from: entry.from, ...(entry.rel !== undefined ? { rel: entry.rel } : {}), why: entry.why, source: entry.source, by: agent, at: entry.createdAt };
  let draft: SlotRequest;
  try { draft = slotRequestDraft(consumer, input, slotRaiseChecks(consumer, input, options), options.facts); } catch (error) {
    if (error instanceof RequestError) return [error.message];
    throw error;
  }
  const issues: string[] = [];
  // createRequest's own relabel on an id already taken: the draft's id or its -2..-9 suffix, with opened and events renamed.
  const suffix = entry.id.startsWith(draft.id) ? entry.id.slice(draft.id.length) : undefined;
  if (suffix === undefined || !/^(?:-[2-9])?$/.test(suffix)) issues.push(`id ${entry.id}: clossys request names it ${draft.id} (or its -2..-9 suffix) from its createdAt and target`);
  else {
    const expected = addressed(draft, entry.id);
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(entry)])].sort()
      .filter(key => canonical((expected as unknown as Record<string, unknown>)[key]) !== canonical((entry as unknown as Record<string, unknown>)[key]));
    if (keys.length) issues.push(`not the entry clossys request raises for ${agent} (${entry.id}): ${keys.join(", ")} differ${keys.length === 1 ? "s" : ""}`);
  }
  const duplicate = listRequests(consumer).map(read => read.request).find(other => other !== undefined && other.id !== entry.id && other.status === "open" && other.target === entry.target && other.from === entry.from);
  if (duplicate) issues.push(`${duplicate.id} already raises ${entry.target} from ${entry.from}`);
  return issues;
}

/** One slotless need of a consumer slot: an input or uses edge naming no slot folder. */
export interface SlotlessNeed { readonly from: string; readonly to: string; readonly rel: "input" | "uses"; readonly target?: string }

/**
 * SCOPE's demand diff: every input or uses edge of a consumer slot that names no slot folder, with the slot entry
 * target it is filed under (the edge's own agent, else the one agent holding its first id segment; none is unowned).
 */
export function slotlessNeeds(consumer: string): SlotlessNeed[] {
  const held = new Map<ContentAgent, Set<string>>(CONTENT_AGENTS.map(agent => [agent, new Set(listSlots(consumer, agent).map(entry => entry.id))]));
  const out: SlotlessNeed[] = [];
  for (const agent of CONTENT_AGENTS) for (const id of held.get(agent)!) {
    const edges = slotEdges(consumer, agent, id);
    if (!edges) continue;
    for (const edge of edges) {
      const slash = edge.to.indexOf("/");
      const named = slash > 0 ? edge.to.slice(0, slash) : undefined;
      const need = slash > 0 ? edge.to.slice(slash + 1) : edge.to;
      const owner = named !== undefined ? (isContentAgent(named) ? named : undefined) : CONTENT_AGENTS.find(each => held.get(each)!.has(need)) ?? ownerOfNeed(consumer, need);
      if (owner && held.get(owner)!.has(need)) continue;
      if (!named && CONTENT_AGENTS.some(each => held.get(each)!.has(need))) continue;
      // A non-content agent's ref (producer/...) is no slot need.
      if (named !== undefined && !owner) continue;
      out.push({ from: `${agent}/${id}`, to: edge.to, rel: edge.rel, ...(owner ? { target: `${owner}/${need}` } : {}) });
    }
  }
  return out;
}

/**
 * A slot's input and uses edges as its slot.json names them: a clossys.slot/2 ref keeps its `<agent>/` prefix (the
 * read view drops it, and a bare id whose first segment two agents hold has no owner); a slot/1 doc's bare ids.
 * Undefined when the slot does not read.
 */
export function slotEdges(consumer: string, agent: ContentAgent, id: string): { to: string; rel: "input" | "uses" }[] | undefined {
  const file = slotFile(slotDir(consumer, agent, id));
  try {
    if (modelExists(file)) {
      const raw = JSON.parse(readModelText(file)) as { schema?: unknown; refs?: unknown };
      if (raw.schema === SLOT_SCHEMA && Array.isArray(raw.refs)) {
        const seen = new Set<string>();
        return raw.refs.flatMap(ref => {
          const { to, rel } = (ref ?? {}) as { to?: unknown; rel?: unknown };
          if (typeof to !== "string" || (rel !== "input" && rel !== "uses") || seen.has(`${rel} ${to}`)) return [];
          seen.add(`${rel} ${to}`);
          return [{ to, rel }];
        });
      }
    }
    const doc = readSlot(consumer, agent, id);
    return [...doc.inputs.map(to => ({ to, rel: "input" as const })), ...doc.uses.map(to => ({ to, rel: "uses" as const }))];
  } catch { return undefined; }
}

/** The slotless needs no kind slot entry (open or closed) files for their requester: what `requests.filed` fails on. */
export function unfiledNeeds(consumer: string): SlotlessNeed[] {
  const filed = new Set(listRequests(consumer).flatMap(read => read.request ? [`${read.request.target}<${read.request.from}`] : []));
  return slotlessNeeds(consumer).filter(need => !need.target || !filed.has(`${need.target}<${need.from}`));
}

// ------------------------------------------------------------------------------------------------ overlap check

/** A kind's family (`copy` and the old `strings` are one family), as conform's S4 compares them. */
export const KIND_FAMILY: Readonly<Record<string, string>> = {
  brief: "brief",
  "element/token": "element", "element/asset": "element", "element/component": "element", "element/section": "element", "element/frame": "element",
  voice: "strings", prose: "strings", copy: "strings",
  page: "page", layout: "page", chrome: "page", publication: "publication", release: "publication",
};
export const familyOfKind = (kind: string | undefined): string => KIND_FAMILY[kind ?? ""] ?? kind ?? "";
/** Above this word overlap (Jaccard) two ids of the same kind and inputs name one purpose (conform OVERLAP_MIN). */
export const PLACEMENT_OVERLAP_MIN = 0.7;
/** At or above this input overlap (Jaccard) two leaves of one L2 and kind family read one material: cite, not create. */
export const INPUT_OVERLAP_MIN = 0.8;
const words = (id: string): Set<string> => new Set(id.split(/[^a-z0-9]+/).filter(Boolean));
function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  return union.size ? [...a].filter(word => b.has(word)).length / union.size : 0;
}
const tail = (id: string) => id.split(".").slice(1).join(".");
const sameInputs = (a: readonly string[], b: readonly string[]) => a.length > 0 && [...a].sort().join() === [...b].sort().join();
const bare = (ref: string) => ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref;

/** An L2 id as its own segment: a workspace IA may spell the child `<l1>.<l2>`. */
const l2Of = (l1: string, l2: string) => l2.startsWith(`${l1}.`) ? l2.slice(l1.length + 1) : l2;
interface OwnerSlot { readonly id: string; readonly kind: string; readonly l1: string; readonly l2: string; readonly inputs: readonly string[]; readonly requirements: ReadonlySet<string> }

/** Canonical JSON (sorted keys), so two requirement entries compare by content. */
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value);
/** A contract's requirement set: each `requirements` entry by content (a clossys.slot-contract/1 names its checkSuite). */
function requirementSet(contract: unknown): ReadonlySet<string> {
  if (!contract || typeof contract !== "object") return new Set();
  const doc = contract as { requirements?: unknown; checkSuite?: unknown };
  if (Array.isArray(doc.requirements)) return new Set(doc.requirements.map(canonical));
  return typeof doc.checkSuite === "string" ? new Set([canonical({ checkSuite: doc.checkSuite })]) : new Set();
}
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every(item => b.has(item));
function ownerSlots(consumer: string, agent: ContentAgent): OwnerSlot[] {
  const out: OwnerSlot[] = [];
  for (const entry of listSlots(consumer, agent)) {
    const l1 = entry.position.l1, l2 = l2Of(entry.position.l1, entry.position.l2);
    try {
      const doc = readSlot(consumer, agent, entry.id);
      out.push({ id: entry.id, kind: String(doc.kind), l1, l2, inputs: doc.inputs.map(bare), requirements: requirementSet(doc.contract) });
    } catch { out.push({ id: entry.id, kind: "", l1, l2, inputs: [], requirements: new Set() }); }
  }
  return out;
}

/**
 * How two slots of one L2 and kind family relate, when they read one material; undefined when they do not. Inputs equal,
 * a subset or superset, or past INPUT_OVERLAP_MIN; with no inputs on either side, equal contract requirement sets (two
 * input-less slots checked the same way). One side empty is no overlap by inputs alone.
 */
function inputRelation(leaf: readonly string[], slot: readonly string[], leafRequirements: ReadonlySet<string>, slotRequirements: ReadonlySet<string>): string | undefined {
  if (!leaf.length && !slot.length) return sameSet(leafRequirements, slotRequirements) ? "empty on both sides, requirements equal" : undefined;
  if (!leaf.length || !slot.length) return undefined;
  const a = new Set(leaf), b = new Set(slot);
  const shared = [...a].filter(ref => b.has(ref)).length;
  if (shared === a.size && shared === b.size) return "equal";
  if (shared === a.size) return "a subset";
  if (shared === b.size) return "a superset";
  const score = shared / new Set([...a, ...b]).size;
  return score >= INPUT_OVERLAP_MIN ? `Jaccard ${score.toFixed(2)}` : undefined;
}

/**
 * The placement overlap check: the target agent's placed slots the new leaf would duplicate. The same id; one L1/L2
 * and kind family with inputs equal, a subset or superset, past INPUT_OVERLAP_MIN, or empty on both sides with equal
 * contract requirements; or another
 * L2 with the same kind family and inputs and ids past PLACEMENT_OVERLAP_MIN.
 */
export function placementOverlaps(consumer: string, agent: ContentAgent, leaf: { readonly slot: string; readonly kind: string; readonly l1: string; readonly l2: string; readonly inputs: readonly string[]; readonly contract: unknown }): Overlap[] {
  const out: Overlap[] = [];
  const family = familyOfKind(leaf.kind), inputs = leaf.inputs.map(bare), l2 = l2Of(leaf.l1, leaf.l2), requirements = requirementSet(leaf.contract);
  for (const slot of ownerSlots(consumer, agent)) {
    const ref = `${agent}/${slot.id}`;
    if (slot.id === leaf.slot) { out.push({ slot: ref, why: "same id" }); continue; }
    if (familyOfKind(slot.kind) !== family) continue;
    if (slot.l1 === leaf.l1 && slot.l2 === l2) {
      const relation = inputRelation(inputs, slot.inputs, requirements, slot.requirements);
      if (relation) out.push({ slot: ref, why: `one L2 (${leaf.l1}/${l2}) and kind family, inputs ${relation}` });
      continue;
    }
    if (!sameInputs(inputs, slot.inputs)) continue;
    const purpose = jaccard(words(tail(leaf.slot)), words(tail(slot.id)));
    if (purpose > PLACEMENT_OVERLAP_MIN) out.push({ slot: ref, why: `same kind family and inputs, similar purpose (${purpose.toFixed(2)})` });
  }
  return out;
}

/** The overlap refusal both placing paths give (decide create, clossys ia): cite the placed slot instead. */
export function overlapRefusal(leaf: string, overlaps: readonly Overlap[], how: string): string {
  return `${leaf} overlaps ${overlaps.map(item => `${item.slot} (${item.why})`).join(", ")}: cite it instead (${how}), or give --overlap-reason with why the material differs, for the owner's sign`;
}

/** The request check: the target agent's placed slots a need may already be (a prefix of it, or past the threshold). */
export function needOverlaps(consumer: string, agent: ContentAgent, need: string): Overlap[] {
  const out: Overlap[] = [];
  for (const slot of ownerSlots(consumer, agent)) {
    const ref = `${agent}/${slot.id}`;
    if (need.startsWith(`${slot.id}.`)) out.push({ slot: ref, why: `${need} names a part of ${slot.id}` });
    else if (slot.id.startsWith(`${need}.`)) out.push({ slot: ref, why: `${slot.id} is a part of ${need}` });
    else {
      const score = jaccard(words(need), words(slot.id));
      if (score > PLACEMENT_OVERLAP_MIN) out.push({ slot: ref, why: `similar purpose (${score.toFixed(2)})` });
    }
  }
  return out;
}

/** Records the overlap check on an open request. */
export function checkRequest(consumer: string, id: string, input: { readonly by: string; readonly at: string }): SlotRequest {
  // Not a closure, so bare owner may act here; only close paths need an owner answer ref (U7 r3).
  checkSeat(input.by);
  return withRequestLock(consumer, id, () => {
    const request = readRequest(consumer, id);
    if (request.status !== "open") throw new RequestError(`request ${id} is closed`);
    const target = targetOf(request)!;
    const overlaps = needOverlaps(consumer, target.agent, target.need);
    const next = withEvent({ ...request, overlaps }, "checked", input.at, input.by, overlaps.length ? overlaps.map(item => item.slot).join(", ") : "no overlap").request;
    writeRequest(consumer, next);
    return next;
  });
}

// ------------------------------------------------------------------------------------------------ contract gate

let criteriaIds: Set<string> | undefined;
/** The registered criterion ids (criteria/core/index.json and criteria/<agent>/<group>/index.json). */
export function registeredCriteria(): ReadonlySet<string> {
  if (criteriaIds) return criteriaIds;
  const ids = new Set<string>();
  const root = join(PRODUCER_ROOT, "src", "constitution", "criteria");
  const subdirs = (dir: string) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== "__fixtures__").map(entry => join(dir, entry.name)) : [];
  for (const dir of subdirs(root).flatMap(dir => [dir, ...subdirs(dir)])) {
    const file = join(dir, "index.json");
    if (!existsSync(file)) continue;
    try {
      const doc = JSON.parse(readFileSync(file, "utf8")) as { criteria?: { id?: unknown }[] };
      for (const item of doc.criteria ?? []) if (typeof item.id === "string") ids.add(item.id);
    } catch { /* judged by the criteria checks */ }
  }
  criteriaIds = ids;
  return ids;
}

const SLOT_CONTRACT_ID = "clossys.slot-contract/1";
const CONTRACT_FAMILIES = new Set(["brief", "element", "strings", "page", "publication", "seat"]);

/**
 * The SLOT-CREATE gate on a new leaf's contract (spec L3): valid against its kind family's contract schema
 * (`pipeline/schemas/contract-<family>.schema.json`), with `requirements` naming registered criteria (a closed
 * clossys.slot-contract/1 contract names its checkSuite instead). Messages are
 * `contract $<path> <why> (contract-<family>)`, the form `ia` refusals and the conform probe read.
 */
export function placementContractIssues(kind: string, contract: unknown): string[] {
  const family = familyOfKind(kind);
  const label = `contract-${family}`;
  if (typeof contract !== "object" || contract === null || Array.isArray(contract)) return [`contract $ must be an object (${label})`];
  const out: string[] = [];
  if (CONTRACT_FAMILIES.has(family)) {
    for (const issue of validateValue(contract, loadSchema(label))) out.push(`contract $${issue.path === "/" ? "" : issue.path.replace(/\//g, ".")} ${issue.message} (${label})`);
  } else out.push(`contract $ has no contract schema for kind ${kind} (${label})`);
  const requirements = (contract as Record<string, unknown>).requirements;
  // A clossys.slot-contract/1 contract is closed (no requirements key): it names its checks as checkSuite, which the slot
  // contract schema ia validates it against requires.
  if ((contract as Record<string, unknown>).schema === SLOT_CONTRACT_ID) { /* requirements: its checkSuite */ }
  else if (!Array.isArray(requirements) || !requirements.length) out.push(`contract $.requirements must be a non-empty list of {check} naming registered criteria (${label})`);
  else {
    const known = registeredCriteria();
    requirements.forEach((item, index) => {
      const check = typeof item === "object" && item !== null ? (item as Record<string, unknown>).check : undefined;
      if (typeof check !== "string" || !known.has(check)) out.push(`contract $.requirements[${index}].check ${JSON.stringify(check ?? null)} is not a registered criterion (${label})`);
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ decide and close

/** The `<l1>/<l2>` a create proposal names, split (the L1 may itself hold dots). */
export function underOf(under: string): { l1: string; l2: string } | undefined {
  const cut = under.lastIndexOf("/");
  return cut > 0 && cut < under.length - 1 ? { l1: under.slice(0, cut), l2: under.slice(cut + 1) } : undefined;
}

/**
 * Records the assignee's answer (its `<agent>.slot` skill; the owner may decide too). A reuse names a placed slot of the
 * assignee. A create names a kind the assignee holds and the new leaf's inputs; a placed slot it overlaps (the need
 * check and the placement check) refuses it, unless an overlap reason is given: the overlap ids and the reason are then
 * on the entry and its event, and go to the owner's sign.
 */
export function decideRequest(consumer: string, id: string, input: ({ readonly decision: "reuse"; readonly slot: string } | { readonly decision: "create"; readonly proposal: Proposal; readonly overlapReason?: string }) & { readonly by: string; readonly at: string }): SlotRequest {
  // Not a closure, so bare owner may act here; only close paths need an owner answer ref (U7 r3).
  checkSeat(input.by);
  return withRequestLock(consumer, id, () => {
    const request = readRequest(consumer, id);
    if (request.status !== "open") throw new RequestError(`request ${id} is closed`);
    const target = targetOf(request)!;
    if (request.assignee === "owner") throw new RequestError(`request ${id} is assigned to the owner: the owner answers one of its options (clossys request ${id} --answer <option>; handoff sends it to ${target.agent}), nothing is decided by --by ${input.by}`);
    if (input.by !== target.agent && input.by !== "owner") throw new RequestError(`request ${id} is decided by its assignee ${target.agent} (or the owner), not ${input.by}`);
    const needs = request.overlaps ?? needOverlaps(consumer, target.agent, target.need);
    let next: SlotRequest;
    let detail: string;
    if (input.decision === "reuse") {
      const match = SLOT_TARGET.exec(input.slot);
      if (!match) throw new RequestError(`--slot must be <agent>/<slot id>, got ${input.slot}`);
      if (match[1] !== target.agent) throw new RequestError(`a reuse names a placed slot of ${target.agent}, the assignee (${input.slot} is not one); a slot of another agent is cited by the requester, not reused`);
      if (!isPlaced(consumer, target.agent, match[2]!)) throw new RequestError(`${input.slot} is no placed slot`);
      const { proposal: _drop, overlapReason: _reason, ...rest } = request;
      next = { ...rest, overlaps: needs, decision: "reuse", reuse: input.slot };
      detail = `reuse ${input.slot}`;
    } else {
      const proposal = input.proposal;
      const kinds = AGENT_KIND[target.agent] as readonly string[];
      if (proposal.kind !== undefined && !kinds.includes(proposal.kind)) throw new RequestError(`kind ${proposal.kind} is not a ${target.agent} slot kind (${kinds.join(", ")})`);
      if (!NEED_ID.test(proposal.slot)) throw new RequestError(`--propose ${proposal.slot} is not a slot id`);
      const under = underOf(proposal.under);
      if (!under) throw new RequestError(`--under must be <l1>/<l2>, got ${proposal.under}`);
      if (!proposal.inputs?.length) throw new RequestError("a create proposal names the new leaf's inputs (--inputs <ref,...>): the placement overlap check compares them with the placed slots");
      const leaf = `${target.agent}/${proposal.slot}`;
      const placed = placementOverlaps(consumer, target.agent, { slot: proposal.slot, kind: proposal.kind ?? kinds[0]!, l1: under.l1, l2: under.l2, inputs: proposal.inputs, contract: proposal.contract });
      const overlaps = [...needs, ...placed.filter(item => !needs.some(need => need.slot === item.slot))];
      const reason = input.overlapReason?.trim();
      if (overlaps.length && !reason) throw new RequestError(`create ${overlapRefusal(leaf, overlaps, `clossys request ${id} --decide reuse --slot <ref>`)}`);
      const { reuse: _drop, overlapReason: _reason, ...rest } = request;
      next = { ...rest, overlaps, decision: "create", proposal, ...(overlaps.length && reason ? { overlapReason: reason } : {}) };
      detail = `create ${leaf} under ${proposal.under}${overlaps.length ? `; overlaps ${overlaps.map(item => item.slot).join(", ")}: ${reason}` : ""}`;
    }
    next = withEvent(next, "decided", input.at, input.by, detail).request;
    writeRequest(consumer, next);
    return next;
  });
}

/** The slot a decided request links the requester to. */
export function linkOf(request: SlotRequest): string | undefined {
  if (request.decision === "reuse") return request.reuse;
  if (request.decision === "create" && request.proposal) return `${targetOf(request)!.agent}/${request.proposal.slot}`;
  return undefined;
}

/**
 * The owner's signature on a decided request (loop.slot step sign): a queue.approve entry about the slot the request
 * links, answered approve by the owner (with the owner's quoted words when answered in chat). The entry ref to record,
 * or why it does not sign this request.
 */
export function signedApproval(consumer: string, ref: string, request: SlotRequest): { readonly entry: string } | { readonly error: string } {
  const link = linkOf(request);
  if (!link) return { error: `request ${request.id} has no decision to sign` };
  const found = findQueueEntry(dirname(consumer), ref);
  if (!found.ok) return { error: `--approved ${ref}: ${found.reason}` };
  if (found.at.queue !== "queue.approve") return { error: `--approved ${ref} is a ${found.at.queue} entry, not a queue.approve entry` };
  const read = readQueueEntry(found.at);
  if (!read.ok) return { error: `--approved ${ref}: ${read.reason}` };
  const entry = read.entry;
  const name = `queue.approve#${entry.id}`;
  if (entry.subject?.to !== link) return { error: `${name} is about ${entry.subject?.to ?? "nothing"}, not ${link} (request ${request.id})` };
  const answer = [...entry.events].reverse().find(event => event.op === "answered");
  if (entry.status !== "answered" || !answer) return { error: `${name} is ${entry.status}; the owner has not signed it` };
  if (answer.answer !== "approve") return { error: `${name} was answered ${answer.answer ?? "with no answer"}, not approve` };
  if (answer.by !== "owner") return { error: `${name} was answered by ${answer.by}, not the owner` };
  if (answer.via === "chat" && !answer.quote?.trim()) return { error: `${name} was answered in chat with no quote of the owner's words` };
  return { entry: name };
}

/** The skill the target agent answers a slot request with (`packages/<agent>/actions/<agent>.slot/skill.md`). */
export const slotSkill = (agent: ContentAgent) => skillPath(agent, `${agent}.slot`);

/**
 * Closes a decided request whose slot is placed: the requester's slot/2 gains the slot-to-slot edge (a ref of the
 * request's rel, and `brief.inputs` for an input) in place of any ref to the need, with a slot ledger event addressed
 * to it. Nothing else is written: a reused slot (another leaf's files) is only read. The request gains link, notified,
 * closed and closedAt.
 */
export function closeRequest(consumer: string, id: string, input: { readonly by: string; readonly at: string; readonly approved?: string; readonly ownerRef?: string }): { request: SlotRequest; wrote: string[] } {
  checkSeat(input.by);
  return withRequestLock(consumer, id, () => closeLocked(consumer, id, input));
}
function closeLocked(consumer: string, id: string, input: { readonly by: string; readonly at: string; readonly approved?: string; readonly ownerRef?: string }): { request: SlotRequest; wrote: string[] } {
  const request = readRequest(consumer, id);
  if (request.status !== "open") throw new RequestError(`request ${id} is already closed`);
  const link = linkOf(request);
  if (!link) throw new RequestError(`request ${id} has no decision: decide reuse or create first`);
  // A created leaf closes only on the owner's signature; a reuse may carry one (loop.slot signs both).
  // A registered owner decision (`clossys ia --owner-ref`, resolved by ia) signs it too.
  // The ownerRef is resolved here, not only by the CLI (foundry-build-0048 U7 r3): a registered owner decision of scope
  // ia (records/owner-decisions.ts), else the close is refused with nothing written.
  let signed: string | undefined;
  if (input.ownerRef !== undefined) {
    const resolved = resolveOwnerRef(consumer, input.ownerRef, "ia");
    if ("error" in resolved) throw new RequestError(`request ${id}: ${resolved.error}`);
    signed = input.ownerRef;
  }
  if (input.approved !== undefined) {
    const approval = signedApproval(consumer, input.approved, request);
    if ("error" in approval) throw new RequestError(approval.error);
    signed = approval.entry;
  } else if (request.decision === "create" && signed === undefined) throw new RequestError(`request ${id} creates ${link}: closing it takes the owner's signature (--approved queue.approve#<id> from loop.slot step sign, or a registered --owner-ref)`);
  const [linkAgent, linkId] = [link.slice(0, link.indexOf("/")) as ContentAgent, link.slice(link.indexOf("/") + 1)];
  if (!listSlots(consumer, linkAgent).some(entry => entry.id === linkId)) throw new RequestError(`${link} is not placed yet: clossys ia ${link} --under <l1>/<l2> --contract <file> places it`);
  const target = targetOf(request)!;
  const wrote: string[] = [];
  const skill = slotSkill(target.agent);
  const requester = /^(director|designer|writer|publisher)\/(.+)$/.exec(request.from);
  if (requester && isContentAgent(input.by) && input.by !== requester[1]) throw new RequestError(`${input.by} cannot write ${request.from}: a close writes the requester's own slot, by its agent (${requester[1]}), the owner, the planner or Producer code`);
  if (requester) {
    const agent = requester[1] as ContentAgent, slotId = requester[2]!;
    const file = slotFile(slotDir(consumer, agent, slotId));
    if (!modelExists(file)) throw new RequestError(`the requester ${request.from} has no slot.json`);
    const doc = JSON.parse(readModelText(file)) as Slot;
    if (doc.schema !== SLOT_SCHEMA) throw new RequestError(`the requester ${request.from} is not a ${SLOT_SCHEMA}`);
    const rel = request.rel;
    const stale = (ref: Ref) => ref.rel === rel && (ref.to === `${target.agent}/${target.need}` || ref.to === link);
    const edge = { to: link as Ref["to"], rel } as Ref;
    const next: Slot = {
      ...doc, updatedAt: input.at as Slot["updatedAt"],
      refs: [...doc.refs.filter(ref => !stale(ref)), edge],
      ...(rel === "input" ? { brief: { ...doc.brief, inputs: [...(doc.brief.inputs ?? []).filter(ref => !stale(ref)), { to: link as Ref["to"], rel: "input" } as Ref] } } : {}),
    };
    const issues = validateSlot(next);
    if (issues.length) throw new RequestError(`the requester's slot.json would be invalid: ${issues.slice(0, 5).map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
    replaceModelFile(file, serializeSlot(next));
    appendSlotDocEvent(consumer, agent, slotId, { by: input.by, at: input.at, verb: "request", skill, fields: { kind: "request", request: request.id, link, rel, to: request.from } });
    wrote.push(`${request.from}/slot.json`);
  }
  const closing = withEvent({ ...request, status: "closed", link, outcome: request.decision === "reuse" ? "reused" : "created", result: link, notified: { to: request.from, at: input.at }, closedAt: input.at }, "closed", input.at, input.by, `linked ${request.from} to ${link}${signed ? `, signed ${signed}` : ""}`);
  const next: SlotRequest = { ...closing.request, closed: closing.id };
  writeRequest(consumer, next);
  return { request: next, wrote };
}
