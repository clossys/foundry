/**
 * `clossys migrate requests` (foundry-build-0048 U8, Q1): moves the request stores agents used to keep of their own
 * into Producer's one queue (clossys.queue-entry/2), so nothing but Producer's store holds a request.
 * - A Director request (`requests/REQ-NNNN.json`: raisedBy, kind, cells, detail, status, opened, resolvedBy) becomes one
 *   entry per cell, about `director/<cell>`: a contradiction on a placed cell is a kind fix (check
 *   `director.contradiction`, its detail the finding, the record its cause), any other request on a placed cell a kind
 *   change wanting a candidate, and a request on a cell no slot holds a kind slot.
 * - A Designer need (`needs/NEED-NNN.json`: raisedBy, missing, kind, status, candidate, evidence, createdBy, closedBy)
 *   becomes one entry about `designer/<candidate slot>`, its why `<raisedBy> needs <missing>` (the text Designer
 *   dogfood links a finding by): a placed slot gets a change wanting a candidate, an unplaced one a slot entry. A need
 *   with no candidate slot names no target and is a finding.
 * - The requester (U8 round 2): a raisedBy naming a placed slot (`<agent>/<slot>`, or a Designer slot id) is that slot;
 *   the owner is the owner; any other raiser (a Director step, `agent:<x>`, a Designer file) is the agent whose store
 *   held the record: a change or fix is from its target slot itself, a slot entry from the agent's placed slot that
 *   cites the need (with that ref's rel), and with no such slot the record is a finding. An agent's record is never
 *   filed as the owner's, whatever the slot's placement, so the owner's own feedback on that slot is never taken for it.
 * - Nothing is lost (U8 round 2). Every raise's first `raised` event (or, merged, a later one) carries the legacy
 *   record whole: `<why>` + MIGRATED_RAISE_NOTE (the Director's one shared format) + `<id>, <file>[; check..]; record
 *   <the record's JSON>)`, so evidence, candidate library and reason, need kind, status, opened and resolvedBy stay in
 *   the queue. A raise is idempotent on (kind, target, requester): when an earlier record of the run, or an entry
 *   already open, holds the same work, the plan names it a merge and --apply appends the record as one more raised
 *   event (appendRaise), so a second, identical need still records its id there.
 * - Status, faithfully: a Director request open or drafted, a Designer need open or proposed, is open work. A Director
 *   request resolved, a Designer need built or closed, closes changed (a fix: fixed) and a Director request declined
 *   closes declined, through closeWork as the entry's assignee agent, with its gates (the requester check, a fix's own
 *   check); a record whose close those gates would refuse, a slot entry (it closes only by its signed decision) and a
 *   Designer need the owner approved (the queue takes an owner's approval only as the owner's answer, quoted verbatim)
 *   are findings, never open again. Done records are planned first, so open work never dedupes onto a closing entry.
 * Every raise is Producer's (by producer, source cli, created by code `clossys migrate requests`), so it is routed and
 * validated like any other; the plan validates each entry it would write whole (the schema, a free id, the merged
 * entry), and a refused raise is a finding. Links are not followed: a store or record reached through a symbolic
 * link is a finding, as is a legacy store under --root outside clossys/ (nothing reads it any more). Any finding exits
 * 1 and --apply then writes nothing. --apply removes a legacy file only after re-reading every entry it became from
 * disk, finding the record there (and its close), and syncing the entry, only a regular file at its own real path
 * inside the consumer, then a legacy folder it leaves empty. A rerun after a crash finds each record already carried
 * (its record detail, open or closed) and finishes only what is missing; the legacy files are gone after a whole run,
 * so a second one plans nothing.
 */
import { AGENT_LISTS } from "../agent-lists.generated.js";
import { closeSync, fsyncSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, type Stats } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { MIGRATED_RAISE_NOTE } from "@clossys/director";
import { cliActor } from "../records/pin.js";
import {
  appendRaise, closeWork, createIssues, listRequests, raiseRequest, raiseWork, readRequest, requestIssues, RequestError, requestsDir, slotEdges, withMergedRaise, workQueue, type ContentAgent,
} from "../records/request.js";
import type { SlotRequest } from "../records/types.js";
import { FIX_CHECKS, fixCheck, requesterCheck } from "../queue/requester-check.js";
import { placedSlots, type WorkKind } from "../queue/routing.js";

export const REQUESTS_MIGRATION_CLI = "clossys migrate requests";
/** The legacy store folders and the record file names each holds. */
const LEGACY_STORES = {
  requests: { agent: "director", file: /^REQ-\d{4}\.json$/ },
  needs: { agent: "designer", file: /^NEED-\d{3,}\.json$/ },
} as const;
/** The agent whose legacy store a record was read from: an agent of LEGACY_STORES. */
export type LegacyAgent = (typeof LEGACY_STORES)[keyof typeof LEGACY_STORES]["agent"];
const LEGACY_DIRS: Readonly<Record<string, { readonly agent: LegacyAgent; readonly file: RegExp }>> = LEGACY_STORES;
/** Folders a scan of --root outside clossys/ never enters (besides dot folders and node_modules). */
const OUTPUT_DIRS = new Set(["dist", "build", "coverage"]);
const REQUEST_KINDS = ["missing", "contradiction", "tripwire", "drift", "reading", "change"];
const REQUEST_STATUSES = ["open", "drafted", "resolved", "declined"];
const NEED_STATUSES = ["open", "proposed", "approved", "built", "closed"];
const SLOT_REF = new RegExp(String.raw`^(${AGENT_LISTS.content.join("|")})\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})$`);
const SLOT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}$/;

export interface MigratedRaise {
  readonly kind: SlotRequest["kind"];
  readonly target: string;
  readonly from: string;
  /** A slot entry from an agent slot that cites the need: the rel of that slot's ref (absent: the record names the requester). */
  readonly rel?: "input" | "uses";
  readonly why: string;
  readonly want?: SlotRequest["want"];
  readonly check?: string;
  readonly findings?: readonly string[];
  readonly cause?: string;
  /** The record's own status. */
  readonly legacy: string;
  /** The close a done record maps to (resolved, built, closed: changed, a fix fixed; declined: declined); absent for open work. */
  readonly close?: "changed" | "fixed" | "declined";
}
export interface PlannedRaise extends MigratedRaise {
  /** The raised event's detail that carries the whole legacy record (recordDetail). */
  readonly detail: string;
  /**
   * A merge: the entry that already holds this work and takes the record as a raised event, `<queue>#<id>` for an
   * entry before the run (also one a crashed run already carried it into), `new entry from <file>` for one an earlier
   * record of the run creates. Absent: a new entry.
   */
  readonly into?: string;
}
export interface LegacyRecord {
  /** Consumer-relative path of the legacy file. */
  readonly file: string;
  readonly agent: LegacyAgent;
  readonly id: string;
  /** The entries it becomes or merges into. */
  readonly raises: readonly PlannedRaise[];
}
export interface PlannedMerge { readonly file: string; readonly kind: SlotRequest["kind"]; readonly target: string; readonly from: string; readonly into: string }
export interface RequestMigrationPlan {
  readonly records: readonly LegacyRecord[];
  /** Every collision, record to record and record to an open entry: each a planned merge. */
  readonly merges: readonly PlannedMerge[];
  /** Files in a legacy folder that are no legacy record: left in place. */
  readonly kept: readonly string[];
  readonly findings: readonly { readonly file: string; readonly message: string }[];
}
export interface AppliedRaise extends PlannedRaise {
  readonly file: string;
  readonly entry: string;
  readonly created: boolean;
  /** The raised event that carries the record. */
  readonly event?: string;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const lstatOf = (path: string): Stats | undefined => { try { return lstatSync(path); } catch { return undefined; } };
const holdsRecords = (dir: string, name: string) => !!LEGACY_DIRS[name] && readdirSync(dir).some(file => LEGACY_DIRS[name]!.file.test(file));
/** A link named like a legacy store that leads to a folder holding legacy records. */
const linkedStore = (path: string, name: string) => { try { return !!LEGACY_DIRS[name] && statSync(path).isDirectory() && holdsRecords(path, name); } catch { return false; } };

/**
 * The legacy store folders below `dir`, never through a symbolic link (dot folders, node_modules and `skip` skipped):
 * `stores` holds the real folders, `links` the links that lead to one.
 */
function scanStores(dir: string, skip: (path: string, name: string) => boolean, out = { stores: [] as string[], links: [] as string[] }) {
  if (!lstatOf(dir)?.isDirectory()) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (name.startsWith(".") || name === "node_modules" || skip(path, name)) continue;
    const stat = lstatOf(path);
    if (stat?.isSymbolicLink()) { if (linkedStore(path, name)) out.links.push(path); continue; }
    if (!stat?.isDirectory()) continue;
    if (holdsRecords(path, name)) out.stores.push(path);
    else scanStores(path, skip, out);
  }
  return out;
}

/** Who raised a record: a placed slot it names, the owner, or another raiser (kept by name). */
function raiserOf(consumer: string, raisedBy: string, agent: LegacyAgent): { slot?: string; owner?: true; by?: string } {
  if (raisedBy === "owner") return { owner: true };
  const ref = SLOT_REF.exec(raisedBy) ?? (agent === "designer" && SLOT_ID.test(raisedBy) ? SLOT_REF.exec(`designer/${raisedBy}`) : null);
  if (ref && placedSlots(consumer, ref[1] as ContentAgent).some(slot => slot.id === ref[2])) return { slot: `${ref[1]}/${ref[2]}` };
  return { by: raisedBy };
}
/**
 * The requester of one raise: the raiser's slot, the owner, or (another raiser: the keeping agent's record) the target
 * slot itself for a change or fix, and for a slot entry the agent's first placed slot (by id) whose refs cite the need.
 * Never the owner for an agent's record (U8 round 2); with no citing slot, a finding (the message).
 */
function requesterOf(consumer: string, raiser: ReturnType<typeof raiserOf>, agent: LegacyAgent, kind: SlotRequest["kind"], target: string): { from: string; rel?: "input" | "uses" } | string {
  if (raiser.slot) return { from: raiser.slot };
  if (raiser.owner) return { from: "owner" };
  if (kind !== "slot") return { from: target };
  const need = target.slice(target.indexOf("/") + 1);
  for (const slot of placedSlots(consumer, agent).map(each => each.id).sort()) {
    const edge = (slotEdges(consumer, agent, slot) ?? []).find(each => each.to === target || each.to === need);
    if (edge) return { from: `${agent}/${slot}`, rel: edge.rel };
  }
  // DRAFT copy (not owner-approved).
  return `slot ${target}: no slot holds it and no placed ${agent} slot cites it; the record is ${agent}'s (raised by ${raiser.by}), never the owner's, so it is filed from the ${agent} slot that names the need: cite ${target} from one (an input or uses ref) and run again`;
}
const isPlacedRef = (consumer: string, target: string) => {
  const ref = SLOT_REF.exec(target);
  return !!ref && placedSlots(consumer, ref[1] as ContentAgent).some(slot => slot.id === ref[2]);
};
const agentOf = (target: string) => target.slice(0, target.indexOf("/")) as ContentAgent;

function directorRaises(consumer: string, id: string, doc: Record<string, unknown>): MigratedRaise[] | string {
  const { raisedBy, kind, cells, detail, status, opened } = doc;
  if (!text(raisedBy) || !text(detail) || !text(opened) || !REQUEST_KINDS.includes(String(kind)) || !REQUEST_STATUSES.includes(String(status))) return "no Director request record (raisedBy, kind, detail, status, opened)";
  if (!Array.isArray(cells) || !cells.length || !cells.every(cell => typeof cell === "string" && SLOT_ID.test(cell))) return "its cells name no Director cell ids";
  const raiser = raiserOf(consumer, raisedBy, "director");
  const raised = raiser.by ? `, raised by ${raiser.by}` : "";
  const legacy = String(status);
  const out: MigratedRaise[] = [];
  for (const cell of cells as string[]) {
    const target = `director/${cell}`;
    const why = `${String(kind)}: ${detail} (migrated from ${id}${raised})`;
    const raiseKind: SlotRequest["kind"] = !isPlacedRef(consumer, target) ? "slot" : kind === "contradiction" ? "fix" : "change";
    const requester = requesterOf(consumer, raiser, "director", raiseKind, target);
    if (typeof requester === "string") return requester;
    const close = legacy === "resolved" ? (raiseKind === "fix" ? "fixed" : "changed") : legacy === "declined" ? "declined" : undefined;
    const base = { kind: raiseKind, target, ...requester, why, legacy, ...(close ? { close } as const : {}) };
    if (raiseKind === "slot") out.push(base);
    else if (raiseKind === "fix") out.push({ ...base, check: "director.contradiction", findings: [detail], cause: `${id} (raised by ${raisedBy}, opened ${opened})` });
    else out.push({ ...base, want: "candidate" });
  }
  return out;
}

function designerRaises(consumer: string, doc: Record<string, unknown>): MigratedRaise[] | string {
  const { raisedBy, missing, status, candidate } = doc;
  if (!text(raisedBy) || !text(missing) || !NEED_STATUSES.includes(String(status))) return "no Designer need record (raisedBy, missing, status)";
  // DRAFT copy (not owner-approved).
  if (status === "approved") return "is approved by the owner: an approval never comes back as open work, and the queue takes the owner's approval only as the owner's own answer, quoted verbatim (clossys request <id> --answer <option> --via <channel> --quote \"<words>\"); build and close the need, or file it again with clossys request, and run again";
  const slot = object(candidate) ? candidate.slotId : undefined;
  if (typeof slot !== "string" || !SLOT_ID.test(slot)) return "it names no candidate slot, so no Designer slot to file it about: name one (candidate.slotId) or file it with clossys request";
  const target = `designer/${slot}`;
  const raiser = raiserOf(consumer, raisedBy, "designer");
  // Exactly Designer dogfood's needWhy(raisedBy, missing): the text a finding links to its request by.
  const why = `${raisedBy} needs ${missing}`;
  const kind = isPlacedRef(consumer, target) ? "change" : "slot";
  const requester = requesterOf(consumer, raiser, "designer", kind, target);
  if (typeof requester === "string") return requester;
  const legacy = String(status);
  const close = legacy === "built" || legacy === "closed" ? { close: "changed" as const } : {};
  return [kind === "change" ? { kind, target, ...requester, why, want: "candidate", legacy, ...close } : { kind, target, ...requester, why, legacy, ...close }];
}

const raiseInput = (raise: PlannedRaise, at: string) => ({
  target: raise.target, from: raise.from, why: raise.why, detail: raise.detail, source: "cli" as const, by: "producer", at, createdBy: cliActor(REQUESTS_MIGRATION_CLI),
});
function raiseOne(consumer: string, raise: PlannedRaise, at: string, dry: boolean): { request: SlotRequest; created: boolean } {
  // A requester the record names (a placed slot) stands for its own cite; one found by its ref is checked against it.
  if (raise.kind === "slot") return raiseRequest(consumer, { ...raiseInput(raise, at), ...(raise.rel ? { rel: raise.rel } : {}) }, { dry, cited: !raise.rel });
  return raiseWork(consumer, {
    ...raiseInput(raise, at), kind: raise.kind,
    ...(raise.want !== undefined ? { want: raise.want } : {}), ...(raise.check !== undefined ? { check: raise.check, findings: raise.findings ?? [], cause: raise.cause ?? "" } : {}),
  }, { dry });
}

/** The raised event's detail that carries one record's raise whole: its why, the shared note, its id and file, a fix's fields, the record. */
export const recordDetail = (raise: MigratedRaise, record: Pick<LegacyRecord, "id" | "file">, doc: unknown): string =>
  `${raise.why}${MIGRATED_RAISE_NOTE}${record.id}, ${record.file}${raise.check !== undefined ? `; check ${raise.check}; findings: ${(raise.findings ?? []).join(" | ")}; cause: ${raise.cause ?? ""}` : ""}; record ${JSON.stringify(doc)})`;
/** Whether `entry` carries the record: a raised event with its detail (the first one for an entry it created). */
const holds = (entry: SlotRequest, detail: string): boolean => entry.events.some(event => event.op === "raised" && event.detail === detail);
/** The entry of the raise's kind and target, open or closed, that already carries its record's detail (a run that
 * stopped part-way carried it). A record on two cells is two raises with one detail, so the target tells them apart. */
const carrying = (consumer: string, raise: Pick<PlannedRaise, "kind" | "target" | "detail">): SlotRequest | undefined =>
  listRequests(consumer, raise.kind).map(read => read.request).find((entry): entry is SlotRequest => !!entry && entry.kind === raise.kind && entry.target === raise.target && holds(entry, raise.detail));
const mergeOf = (detail: string, at: string) => ({ at, by: "producer", detail, via: "cli" as const });
const keyOf = (raise: MigratedRaise) => `${raise.kind}|${raise.target}|${raise.from}`;
const labelOf = (entry: SlotRequest) => `${workQueue(entry.kind as WorkKind)}#${entry.id}`;

/**
 * Why closeWork would refuse a done record's close on `entry` (as the assignee agent, the result its target), checked
 * before anything is written: undefined when it would close. DRAFT copy (not owner-approved).
 */
function closeRefusal(consumer: string, raise: MigratedRaise, entry: SlotRequest): string | undefined {
  if (!raise.close) return undefined;
  const was = `the record is ${raise.legacy}`;
  if (raise.kind === "slot") return `${was}, but a slot entry closes only by its signed decision (reuse or create), never as migrated work: decide it with clossys request, or remove the cell's need, and run again`;
  if (entry.assignee !== agentOf(raise.target)) return `${was}, but the router assigns it to ${entry.assignee}, so only the owner's own typed answer closes it, and the migration never writes the owner's answer: put the decision to the owner with clossys request, or remove the record from the store (git keeps it), and run again`;
  if (raise.kind === "fix") {
    if (raise.close !== "fixed") return `${was}: a fix the assignee declines is the owner's question, never a migrated close; answer it with clossys request, or reopen the record, and run again`;
    if (!FIX_CHECKS.includes(String(raise.check))) return `${was}, but its check ${String(raise.check)} is none Producer can re-run (${FIX_CHECKS.join(", ")}), so it cannot close fixed: reopen the record or close it by the owner's answer`;
    const fix = fixCheck(dirname(consumer), entry);
    if (fix.failures.length) return `${was}, but its check ${String(raise.check)} still fails on ${raise.target} (${fix.failures.slice(0, 3).join("; ")})`;
  }
  if (raise.close !== "declined") {
    const check = requesterCheck(dirname(consumer), raise);
    if (!check.ok) return `${was}, but the requester check fails now (${check.failures.slice(0, 3).join("; ")}), so it cannot close ${raise.close}: reopen the record and run again`;
  }
  return undefined;
}

interface ReadRecord { readonly file: string; readonly agent: LegacyAgent; readonly id: string; readonly doc: Record<string, unknown>; readonly raises: readonly MigratedRaise[] }

/**
 * Reads every legacy record and checks each raise it becomes, nothing written: a raise a stopped run already carried
 * (its record detail on an entry, open or closed) is found and only its missing close planned; any other gets a dry
 * raise (routed and checked), the entry it would create validated whole at a free id, and a collision (with an earlier
 * record of the run or with an entry already open) planned as a merge whose merged entry is validated too. Done
 * records come first and each closes an entry of its own (closeRefusal checked); one whose work an open entry already
 * holds is a finding. A legacy store outside clossys/ under `root` (default: the consumer's parent) is a finding.
 */
export function planRequestMigration(consumer: string, at: string, root: string = dirname(consumer)): RequestMigrationPlan {
  const records: LegacyRecord[] = [], merges: PlannedMerge[] = [], kept: string[] = [], findings: { file: string; message: string }[] = [];
  /** The open entry each (kind, target, requester) of the run lands in so far, and how the plan names it. */
  const landed = new Map<string, { entry: SlotRequest; label: string }>();
  const taken = new Map<WorkKind, Set<string>>();
  const scanned = scanStores(consumer, path => path === join(consumer, "agents", "producer"));
  for (const link of scanned.links) findings.push({ file: relative(consumer, link), message: "is a symbolic link to a legacy store: the migration reads and removes nothing through a link; put the folder itself in place and run again" });
  const outside = scanStores(root, (path, name) => path === consumer || OUTPUT_DIRS.has(name));
  for (const dir of [...outside.stores, ...outside.links]) {
    const store = LEGACY_DIRS[basename(dir)]!;
    findings.push({ file: relative(consumer, dir), message: `a ${store.agent} ${basename(dir)}/ store outside clossys/: nothing reads it any more and the migration moves only the stores under clossys/; move it under clossys/ and run again` });
  }
  const read: ReadRecord[] = [];
  for (const dir of scanned.stores) {
    const store = LEGACY_DIRS[basename(dir)]!;
    for (const name of readdirSync(dir).sort()) {
      const file = relative(consumer, join(dir, name));
      if (!store.file.test(name)) { kept.push(file); continue; }
      if (!lstatOf(join(dir, name))?.isFile()) { findings.push({ file, message: "is no regular file (a link or a folder): the migration reads and removes only a record file itself" }); continue; }
      let doc: unknown;
      try { doc = JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { findings.push({ file, message: "does not parse as JSON" }); continue; }
      const id = name.replace(/\.json$/, "");
      if (!object(doc) || doc.id !== id) { findings.push({ file, message: `its id is not ${id}` }); continue; }
      const raises = store.agent === "director" ? directorRaises(consumer, id, doc) : designerRaises(consumer, doc);
      if (typeof raises === "string") { findings.push({ file, message: raises }); continue; }
      read.push({ file, agent: store.agent, id, doc, raises });
    }
  }
  // Done records first: each closes an entry of its own before open work of the run is raised.
  const done = (record: ReadRecord) => record.raises.some(raise => raise.close);
  for (const record of [...read.filter(done), ...read.filter(each => !done(each))]) {
    const { file, id } = record;
    const planned: PlannedRaise[] = [];
    let refused = false;
    const refuse = (raise: MigratedRaise, message: string) => { findings.push({ file, message: `${raise.kind} ${raise.target}: ${message}` }); refused = true; };
    for (const each of record.raises) {
      const raise: PlannedRaise = { ...each, detail: recordDetail(each, record, record.doc) };
      const carried = carrying(consumer, raise);
      if (carried) {
        const pending = raise.close && carried.status === "open" ? closeRefusal(consumer, raise, carried) : undefined;
        if (pending) { refuse(raise, pending); continue; }
        planned.push({ ...raise, into: labelOf(carried) });
        continue;
      }
      let dry: { request: SlotRequest; created: boolean };
      try { dry = raiseOne(consumer, raise, at, true); } catch (error) {
        if (!(error instanceof RequestError)) throw error;
        refuse(raise, error.message); continue;
      }
      if (raise.close) {
        // DRAFT copy (not owner-approved).
        if (!dry.created) { refuse(raise, `the record is ${raise.legacy}, but ${labelOf(dry.request)} is open on the same work: close or answer it, and run again`); continue; }
        const refusal = closeRefusal(consumer, raise, dry.request);
        if (refusal) { refuse(raise, refusal); continue; }
      }
      const earlier = raise.close ? undefined : landed.get(keyOf(raise)) ?? (dry.created ? undefined : { entry: dry.request, label: labelOf(dry.request) });
      if (!earlier) {
        const kind = raise.kind as WorkKind;
        const free = createIssues(consumer, dry.request, taken.get(kind));
        if (!free.id) { refuse(raise, free.issues.join("; ")); continue; }
        taken.set(kind, new Set([...(taken.get(kind) ?? []), free.id]));
        if (!raise.close) landed.set(keyOf(raise), { entry: dry.request, label: `new entry from ${file}` });
        planned.push(raise);
        continue;
      }
      const merged = withMergedRaise(earlier.entry, mergeOf(raise.detail, at));
      const issues = requestIssues(merged, dirname(consumer));
      if (issues.length) { refuse(raise, `merged into ${earlier.label} it would be invalid: ${issues.slice(0, 5).join("; ")}`); continue; }
      landed.set(keyOf(raise), { ...earlier, entry: merged });
      planned.push({ ...raise, into: earlier.label });
      merges.push({ file, kind: raise.kind, target: raise.target, from: raise.from, into: earlier.label });
    }
    if (!refused) records.push({ file, agent: record.agent, id, raises: planned });
  }
  return { records, merges, kept, findings };
}

/** Syncs a written entry (and its folder) to disk before the legacy file it replaces goes. */
function syncToDisk(file: string): void {
  const fd = openSync(file, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
  try { const dir = openSync(dirname(file), "r"); try { fsyncSync(dir); } finally { closeSync(dir); } } catch { /* a folder fsync is best effort where the platform refuses it */ }
}

/** Removes one legacy file: only a regular file at its own real path inside the consumer (no link on the way), else it is kept and the run stops. */
function removeLegacy(consumer: string, real: string, file: string): void {
  const path = join(consumer, file);
  const stat = lstatOf(path);
  if (!stat?.isFile()) throw new RequestError(`migrate requests: ${file} is no regular file now; it is kept`);
  if (realpathSync(path) !== join(real, file)) throw new RequestError(`migrate requests: ${file} resolves to ${realpathSync(path)}, outside its own path in the consumer; it is kept`);
  unlinkSync(path);
}

/** What --apply does to disk besides the queue writes: syncing an entry and re-reading it (tests stand in for a crash or a lost write). */
export interface ApplyIo {
  readonly sync: (file: string) => void;
  readonly reread: (consumer: string, id: string) => SlotRequest;
}
const DISK: ApplyIo = { sync: syncToDisk, reread: readRequest };

/**
 * Raises every planned entry (its first event carrying the record), merges each collision's record into the entry that
 * holds it (appendRaise), closes each done record's entry through closeWork as its assignee, then removes each legacy
 * file once every entry it became is re-read from disk, found carrying it (and closed, when done) and synced, and a
 * legacy folder left empty. A raise a stopped run already carried is found by its detail and only finished. Refuses a
 * plan with findings.
 */
export function applyRequestMigration(consumer: string, plan: RequestMigrationPlan, at: string, io: Partial<ApplyIo> = {}): { raised: AppliedRaise[]; removed: string[] } {
  if (plan.findings.length) throw new RequestError(`migrate requests: ${plan.findings.length} finding(s); nothing was written`);
  const { sync, reread } = { ...DISK, ...io };
  const real = realpathSync(consumer);
  const raised: AppliedRaise[] = [], removed: string[] = [];
  for (const record of plan.records) {
    for (const raise of record.raises) {
      let request = carrying(consumer, raise);
      let created = false;
      if (!request) {
        const one = raiseOne(consumer, raise, at, false);
        created = one.created;
        if (!created && raise.close) throw new RequestError(`migrate requests: ${record.file} (${raise.kind} ${raise.target}) is ${raise.legacy}, but ${labelOf(one.request)} is open on the same work now; it is kept`);
        // A dedupe: the record goes into the entry that holds the work as one more raised event.
        request = created ? one.request : appendRaise(consumer, one.request.id, mergeOf(raise.detail, at)).request;
      }
      if (raise.close && request.status === "open") {
        const closed = closeWork(consumer, request.id, { by: agentOf(raise.target), at, outcome: raise.close, result: raise.target });
        if (closed.asked) throw new RequestError(`migrate requests: ${record.file} (${raise.kind} ${raise.target}) is ${raise.legacy}, but closing ${labelOf(closed)} asks the owner; it is kept`);
      }
      // Durably present before the source goes: re-read from disk, the record found (and closed when done), the entry synced.
      const stored = reread(consumer, request.id);
      if (!holds(stored, raise.detail) || (raise.close !== undefined && stored.status !== "closed")) throw new RequestError(`migrate requests: ${record.file} (${raise.kind} ${raise.target}) is not in ${labelOf(stored)}${raise.close ? ", closed," : ""} after the write; it is kept`);
      sync(join(requestsDir(consumer, stored.kind as WorkKind), `${stored.id}.json`));
      const event = stored.events.find(each => each.op === "raised" && each.detail === raise.detail)?.id;
      raised.push({ ...raise, file: record.file, entry: labelOf(stored), created, ...(event ? { event } : {}) });
    }
    removeLegacy(consumer, real, record.file);
    removed.push(record.file);
  }
  for (const dir of [...new Set(plan.records.map(record => dirname(join(consumer, record.file))))]) {
    if (lstatOf(dir)?.isDirectory() && !readdirSync(dir).length) rmdirSync(dir);
  }
  return { raised, removed };
}
