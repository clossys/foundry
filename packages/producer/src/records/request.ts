/**
 * `clossys.queue-entry/2` kind `slot` (foundry-build-0048 U5, SLOT-CREATE): a slotless need is a queue entry, never a
 * refusal or a dropped input. Requests and the queue are one queue: who requests (`from`), who executes (`assignee`)
 * and what it is about (`target`) are fields. A requester slot (or the owner) names a slot no agent holds; the
 * assignee agent answers reuse (a placed slot) or create (a new leaf the owner signs and `clossys ia` places); closing
 * links the requester slot-to-slot and notifies it with a ledger event addressed to it.
 *
 * Store: `clossys/agents/producer/queue.slot/entries/<id>.json`, one file per entry, written whole through a temp file
 * and a rename. The clossys.queue-entry/1 queues (queue/entry.ts QUEUE_NAMES) do not list queue.slot, so their
 * readers and writers are unchanged. The entry's `events` are its own ledger (ids `<entry id>#<n>`; `opened` and
 * `closed` name the raising and closing events). The slot model itself is read through records/slots.ts and written
 * through records/slot-write.ts only.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSchema, validateValue } from "../pipeline/schema.js";
import { findQueueEntry, readQueueEntry } from "../queue/entry.js";
import { PRODUCER_ROOT, skillPath } from "./ledger.js";
import { validateAgainst } from "./schema.js";
import { recordSchema, serializeSlot, SLOT_SCHEMA, validateSlot } from "./slot.js";
import { slotDir, slotFile } from "./slot-model/layout.js";
import { listSlots, modelExists, readModelText, readSlot } from "./slots.js";
import { appendSlotDocEvent, replaceModelFile } from "./slot-write.js";
import type { Overlap, Proposal, Ref, RequestOp, Slot, SlotRequest } from "./types.js";

export const REQUEST_SCHEMA = "clossys.queue-entry/2";
export const REQUEST_FILE = "queue-entry-2.json";
/** The queue folder kind slot entries live in (one queue: the folder is the kind, `assignee` says who executes). */
export const SLOT_QUEUE = "queue.slot";
export const CONTENT_AGENTS = ["director", "designer", "writer", "publisher"] as const;
export type ContentAgent = (typeof CONTENT_AGENTS)[number];
export const isContentAgent = (value: string): value is ContentAgent => (CONTENT_AGENTS as readonly string[]).includes(value);

export const REQUEST_ID = /^[0-9]{8}T[0-9]{4}Z-[a-z0-9][a-z0-9-]*$/;
const NEED_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/;
const SLOT_TARGET = /^(director|designer|writer|publisher)\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})$/;

export type { Overlap, Proposal, RequestEvent, RequestOp, SlotRequest } from "./types.js";

/** The agent a request asks and the slot id it names (kind slot, slot-ref target). */
export function targetOf(request: Pick<SlotRequest, "target">): { agent: ContentAgent; need: string } | undefined {
  const match = SLOT_TARGET.exec(request.target);
  return match ? { agent: match[1] as ContentAgent, need: match[2]! } : undefined;
}

export const requestsDir = (consumer: string) => join(consumer, "agents", "producer", SLOT_QUEUE, "entries");
const requestPath = (consumer: string, id: string) => join(requestsDir(consumer), `${id}.json`);

/** Every issue of a request record: the schema, then the conditions the validator cannot state. */
export function requestIssues(doc: unknown): string[] {
  const issues = validateAgainst(recordSchema(REQUEST_FILE), doc).map(issue => `${issue.path} ${issue.message}`);
  if (issues.length || typeof doc !== "object" || doc === null) return issues;
  const request = doc as SlotRequest;
  const out: string[] = [];
  if (request.kind !== "slot") out.push(`$.kind: this build writes and reads kind slot only, got ${String(request.kind)}`);
  const target = targetOf(request);
  if (request.kind === "slot" && !target) out.push("$.target: a slot entry names <agent>/<slot id> of a content agent");
  if (request.kind === "slot" && target && request.assignee !== target.agent) out.push(`$.assignee: a slot entry is assigned to the target's agent ${target.agent}`);
  if (request.kind === "slot" && request.rel === undefined) out.push("$.rel: a slot entry says how the requester cites the slot (input or uses)");
  if (request.decision === "reuse" && (request.reuse === undefined || request.overlaps === undefined)) out.push("a reuse decision needs reuse and overlaps");
  if (request.decision === "create" && (request.proposal === undefined || request.overlaps === undefined)) out.push("a create decision needs proposal and overlaps");
  if (request.status === "closed") {
    for (const field of ["decision", "link", "notified", "closed", "closedAt"] as const) if (request[field] === undefined) out.push(`a closed request needs ${field}`);
  }
  const ids = request.events.map(event => event.id);
  if (!ids.includes(request.opened)) out.push(`opened ${request.opened} is no event of the request`);
  if (request.closed !== undefined && !ids.includes(request.closed)) out.push(`closed ${request.closed} is no event of the request`);
  if (ids.some(id => !id.startsWith(`${request.id}#`))) out.push("every event id is <request id>#<n>");
  return out;
}

export interface ReadRequest { readonly file: string; readonly request?: SlotRequest; readonly issues: readonly string[] }

/** Every kind slot entry under clossys/agents/producer/queue.slot/entries, read and judged (an unreadable one is listed with its issue). */
export function listRequests(consumer: string): ReadRequest[] {
  const dir = requestsDir(consumer);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith(".json") && !name.startsWith(".")).sort().map(name => {
    const file = join(dir, name);
    let doc: unknown;
    try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) { return { file, issues: [`not JSON: ${error instanceof Error ? error.message : String(error)}`] }; }
    const issues = requestIssues(doc);
    if (!issues.length && (doc as SlotRequest).id !== name.slice(0, -".json".length)) return { file, issues: [`id ${(doc as SlotRequest).id} is not the file name`] };
    return issues.length ? { file, issues } : { file, request: doc as SlotRequest, issues };
  });
}

export function readRequest(consumer: string, id: string): SlotRequest {
  if (!REQUEST_ID.test(id)) throw new RequestError(`${id} is not a request id`);
  const file = requestPath(consumer, id);
  if (!existsSync(file)) throw new RequestError(`no slot entry ${id} under clossys/agents/producer/${SLOT_QUEUE}/entries`);
  const doc = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const issues = requestIssues(doc);
  if (issues.length) throw new RequestError(`request ${id} is invalid: ${issues.slice(0, 5).join("; ")}`);
  return doc as SlotRequest;
}

export class RequestError extends Error {
  constructor(message: string) { super(message); this.name = "RequestError"; }
}

/** Writes a request whole (temp file, then rename); refuses an invalid one. */
export function writeRequest(consumer: string, request: SlotRequest): string {
  const issues = requestIssues(request);
  if (issues.length) throw new RequestError(`request ${request.id} would be invalid: ${issues.slice(0, 5).join("; ")}`);
  const dir = requestsDir(consumer);
  mkdirSync(dir, { recursive: true });
  const file = requestPath(consumer, request.id);
  const temp = join(dir, `.${request.id}.${process.pid}.tmp`);
  writeFileSync(temp, `${JSON.stringify(request, null, 2)}\n`);
  renameSync(temp, file);
  return file;
}

const withEvent = (request: SlotRequest, op: RequestOp, at: string, by?: string, detail?: string): { request: SlotRequest; id: string } => {
  const id = `${request.id}#${request.events.length + 1}`;
  return { id, request: { ...request, events: [...request.events, { id, at, op, ...(by ? { by } : {}), ...(detail !== undefined ? { detail } : {}) }] } };
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
}

/** An open request for the same target from the same requester, if one exists. */
export function openRequestFor(consumer: string, target: string, from: string): SlotRequest | undefined {
  return listRequests(consumer).map(read => read.request).find(request => request?.status === "open" && request.target === target && request.from === from);
}

/** Raises a slot request (idempotent: an open one for the same target and requester is returned, not repeated). */
export function raiseRequest(consumer: string, input: RaiseInput, options: { readonly dry?: boolean } = {}): { request: SlotRequest; created: boolean } {
  const target = targetOf(input);
  if (!target) throw new RequestError(`request target must be <agent>/<slot id>, got ${input.target}`);
  if (!NEED_ID.test(target.need)) throw new RequestError(`${target.need} is not a slot id`);
  const existing = openRequestFor(consumer, input.target, input.from);
  if (existing) return { request: existing, created: false };
  const base = `${stampOf(input.at)}-${target.need.replace(/\./g, "-")}`.slice(0, 80).replace(/-+$/, "");
  let id = base;
  for (let n = 2; existsSync(requestPath(consumer, id)); n++) id = `${base}-${n}`;
  const draft: SlotRequest = {
    schema: REQUEST_SCHEMA, id, kind: "slot", from: input.from, assignee: target.agent, target: input.target, status: "open", opened: `${id}#1`,
    rel: input.rel ?? "input", why: input.why, source: input.source, createdAt: input.at,
    events: [{ id: `${id}#1`, at: input.at, op: "raised", by: input.by, detail: input.why }],
  };
  if (!options.dry) writeRequest(consumer, draft);
  return { request: draft, created: true };
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
const words = (id: string): Set<string> => new Set(id.split(/[^a-z0-9]+/).filter(Boolean));
function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  return union.size ? [...a].filter(word => b.has(word)).length / union.size : 0;
}
const tail = (id: string) => id.split(".").slice(1).join(".");
const sameInputs = (a: readonly string[], b: readonly string[]) => a.length > 0 && [...a].sort().join() === [...b].sort().join();
const bare = (ref: string) => ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref;

interface OwnerSlot { readonly id: string; readonly kind: string; readonly l2: string; readonly inputs: readonly string[] }
function ownerSlots(consumer: string, agent: ContentAgent): OwnerSlot[] {
  const out: OwnerSlot[] = [];
  for (const entry of listSlots(consumer, agent)) {
    try {
      const doc = readSlot(consumer, agent, entry.id);
      out.push({ id: entry.id, kind: String(doc.kind), l2: entry.position.l2, inputs: doc.inputs.map(bare) });
    } catch { out.push({ id: entry.id, kind: "", l2: entry.position.l2, inputs: [] }); }
  }
  return out;
}

/**
 * The placement overlap check: the target agent's placed slots the new leaf would duplicate. The same id; one L2 with
 * the same (non-empty) inputs and kind family; or the same kind family and inputs with ids past PLACEMENT_OVERLAP_MIN.
 */
export function placementOverlaps(consumer: string, agent: ContentAgent, leaf: { readonly slot: string; readonly kind: string; readonly l2: string; readonly inputs: readonly string[] }): Overlap[] {
  const out: Overlap[] = [];
  const family = familyOfKind(leaf.kind), inputs = leaf.inputs.map(bare);
  for (const slot of ownerSlots(consumer, agent)) {
    const ref = `${agent}/${slot.id}`;
    if (slot.id === leaf.slot) { out.push({ slot: ref, why: "same id" }); continue; }
    if (familyOfKind(slot.kind) !== family || !sameInputs(inputs, slot.inputs)) continue;
    if (slot.l2 === leaf.l2) { out.push({ slot: ref, why: `one L2 (${leaf.l2}), same kind family and inputs` }); continue; }
    const purpose = jaccard(words(tail(leaf.slot)), words(tail(slot.id)));
    if (purpose > PLACEMENT_OVERLAP_MIN) out.push({ slot: ref, why: `same kind family and inputs, similar purpose (${purpose.toFixed(2)})` });
  }
  return out;
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
  const request = readRequest(consumer, id);
  if (request.status !== "open") throw new RequestError(`request ${id} is closed`);
  const target = targetOf(request)!;
  const overlaps = needOverlaps(consumer, target.agent, target.need);
  const next = withEvent({ ...request, overlaps }, "checked", input.at, input.by, overlaps.length ? overlaps.map(item => item.slot).join(", ") : "no overlap").request;
  writeRequest(consumer, next);
  return next;
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

export function decideRequest(consumer: string, id: string, input: { readonly decision: "reuse"; readonly slot: string; readonly by: string; readonly at: string } | { readonly decision: "create"; readonly proposal: Proposal; readonly by: string; readonly at: string }): SlotRequest {
  const request = readRequest(consumer, id);
  if (request.status !== "open") throw new RequestError(`request ${id} is closed`);
  const target = targetOf(request)!;
  const overlaps = request.overlaps ?? needOverlaps(consumer, target.agent, target.need);
  let next: SlotRequest;
  if (input.decision === "reuse") {
    const match = SLOT_TARGET.exec(input.slot);
    if (!match) throw new RequestError(`--slot must be <agent>/<slot id>, got ${input.slot}`);
    if (!listSlots(consumer, match[1] as ContentAgent).some(entry => entry.id === match[2])) throw new RequestError(`${input.slot} is no placed slot`);
    const { proposal: _drop, ...rest } = request;
    next = { ...rest, overlaps, decision: "reuse", reuse: input.slot };
  } else {
    const { reuse: _drop, ...rest } = request;
    next = { ...rest, overlaps, decision: "create", proposal: input.proposal };
  }
  next = withEvent(next, "decided", input.at, input.by, input.decision === "reuse" ? `reuse ${input.slot}` : `create ${target.agent}/${input.proposal.slot} under ${input.proposal.under}`).request;
  writeRequest(consumer, next);
  return next;
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
 * to it; a reuse also records the decision on the reused slot. The request gains link, notified, closed and closedAt.
 */
export function closeRequest(consumer: string, id: string, input: { readonly by: string; readonly at: string; readonly approved?: string; readonly ownerRef?: string }): { request: SlotRequest; wrote: string[] } {
  const request = readRequest(consumer, id);
  if (request.status !== "open") throw new RequestError(`request ${id} is already closed`);
  const link = linkOf(request);
  if (!link) throw new RequestError(`request ${id} has no decision: decide reuse or create first`);
  // A created leaf closes only on the owner's signature; a reuse may carry one (loop.slot signs both).
  // A registered owner decision (`clossys ia --owner-ref`, resolved by ia) signs it too.
  let signed: string | undefined = input.ownerRef;
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
  if (request.decision === "reuse") {
    appendSlotDocEvent(consumer, linkAgent, linkId, { by: input.by, at: input.at, verb: "request", skill, fields: { kind: "request", request: request.id, decision: "reuse", overlaps: request.overlaps ?? [], for: request.from } });
    wrote.push(`${link}/ledger.json`);
  }
  const closing = withEvent({ ...request, status: "closed", link, notified: { to: request.from, at: input.at }, closedAt: input.at }, "closed", input.at, input.by, `linked ${request.from} to ${link}${signed ? `, signed ${signed}` : ""}`);
  const next: SlotRequest = { ...closing.request, closed: closing.id };
  writeRequest(consumer, next);
  return { request: next, wrote };
}
