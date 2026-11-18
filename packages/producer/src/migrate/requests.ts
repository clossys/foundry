/**
 * `clossys migrate requests` (foundry-build-0048 U8, Q1): moves the request stores agents used to keep of their own
 * into Producer's one queue (clossys.queue-entry/2), so nothing but Producer's store holds a request.
 * - A Director request (`requests/REQ-NNNN.json`: raisedBy, kind, cells, detail, status, opened) still open or drafted
 *   becomes one entry per cell, about `director/<cell>`: a contradiction on a placed cell is a kind fix (check
 *   `director.contradiction`, its detail the finding, the record its cause), any other request on a placed cell a kind
 *   change wanting a candidate, and a request on a cell no slot holds a kind slot.
 * - A Designer need (`needs/NEED-NNN.json`: raisedBy, missing, status, candidate) not yet closed becomes one entry about
 *   `designer/<candidate slot>`, its why `<raisedBy> needs <missing>` (the text Designer dogfood links a finding by):
 *   a placed slot gets a change wanting a candidate, an unplaced one a slot entry. A need with no candidate slot names
 *   no target and is a finding.
 * - The requester: a raisedBy naming a placed slot (`<agent>/<slot>`, or a Designer slot id) is that slot; the owner is
 *   the owner; any other raiser (a Director step, `agent:<x>`, a Designer file) is the agent whose store held the record,
 *   so a change or fix is from its target slot itself (and a slot entry, about a slot no agent holds, from the owner),
 *   the raiser kept in the why. An agent's record is never filed as the owner's, so the owner's own feedback on that
 *   slot is not taken for a change already open.
 * - Nothing is lost on a dedupe. A raise is idempotent on (kind, target, requester): when an earlier record of the run,
 *   or an entry already open, holds the same work, the plan names it a merge, and --apply carries the record's whole
 *   content (its why, and a fix's check, findings and cause, with the record's id and file) into that entry as one
 *   more `raised` event, through the append-only write (appendRaise).
 * - A resolved, declined or closed record carries nothing open: it is removed (git keeps its history).
 * Every raise is Producer's (by producer, source cli, created by code `clossys migrate requests`), so it is routed and
 * validated like any other; the plan validates each entry it would write whole (the schema, a free id, the merged
 * entry), and a refused raise is a finding. Links are not followed: a store or record reached through a symbolic
 * link is a finding, as is a legacy store under --root outside clossys/ (nothing reads it any more). Any finding exits
 * 1 and --apply then writes nothing. --apply removes a legacy file only after re-reading its content from the queue
 * and syncing the entry to disk, only a regular file at its own path inside the consumer, then a legacy folder it
 * leaves empty. Raises are idempotent and the legacy files are gone, so a second run plans nothing.
 */
import { closeSync, fsyncSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, type Stats } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { cliActor } from "../records/pin.js";
import {
  appendRaise, createIssues, raiseRequest, raiseWork, readRequest, requestIssues, RequestError, requestsDir, withMergedRaise, workQueue, type ContentAgent,
} from "../records/request.js";
import type { SlotRequest } from "../records/types.js";
import { placedSlots, type WorkKind } from "../queue/routing.js";

export const REQUESTS_MIGRATION_CLI = "clossys migrate requests";
/** The line a merged raise's detail carries after the record's why: Designer's queue reader strips it to link a finding. */
export const MERGED_NOTE = "\n(merged by clossys migrate requests from ";
/** The legacy store folders and the record file names each holds. */
const LEGACY_DIRS: Readonly<Record<string, { readonly agent: "director" | "designer"; readonly file: RegExp }>> = {
  requests: { agent: "director", file: /^REQ-\d{4}\.json$/ },
  needs: { agent: "designer", file: /^NEED-\d{3,}\.json$/ },
};
/** Folders a scan of --root outside clossys/ never enters (besides dot folders and node_modules). */
const OUTPUT_DIRS = new Set(["dist", "build", "coverage"]);
const REQUEST_KINDS = ["missing", "contradiction", "tripwire", "drift", "reading", "change"];
const REQUEST_STATUSES = ["open", "drafted", "resolved", "declined"];
const NEED_STATUSES = ["open", "proposed", "approved", "built", "closed"];
const SLOT_REF = /^(director|designer|writer|publisher)\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})$/;
const SLOT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}$/;

export interface MigratedRaise {
  readonly kind: SlotRequest["kind"];
  readonly target: string;
  readonly from: string;
  readonly why: string;
  readonly want?: SlotRequest["want"];
  readonly check?: string;
  readonly findings?: readonly string[];
  readonly cause?: string;
}
export interface PlannedRaise extends MigratedRaise {
  /**
   * A merge: the entry that already holds this work and takes the record's content as a raised event, `<queue>#<id>`
   * for an entry open before the run, `new entry from <file>` for one an earlier record of the run creates. Absent: a
   * new entry.
   */
  readonly into?: string;
}
export interface LegacyRecord {
  /** Consumer-relative path of the legacy file. */
  readonly file: string;
  readonly agent: "director" | "designer";
  readonly id: string;
  /** The entries it becomes or merges into (none for a resolved, declined or closed record). */
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
  /** The raised event a merge appended (or found already carrying the record), when the record merged. */
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
function raiserOf(consumer: string, raisedBy: string, agent: "director" | "designer"): { slot?: string; owner?: true; by?: string } {
  if (raisedBy === "owner") return { owner: true };
  const ref = SLOT_REF.exec(raisedBy) ?? (agent === "designer" && SLOT_ID.test(raisedBy) ? SLOT_REF.exec(`designer/${raisedBy}`) : null);
  if (ref && placedSlots(consumer, ref[1] as ContentAgent).some(slot => slot.id === ref[2])) return { slot: `${ref[1]}/${ref[2]}` };
  return { by: raisedBy };
}
/** The requester of one raise: the raiser's slot, the owner, or (another raiser) the target slot itself, a slot entry the owner's. */
const fromOf = (raiser: ReturnType<typeof raiserOf>, kind: SlotRequest["kind"], target: string) => raiser.slot ?? (raiser.owner || kind === "slot" ? "owner" : target);
const isPlacedRef = (consumer: string, target: string) => {
  const ref = SLOT_REF.exec(target);
  return !!ref && placedSlots(consumer, ref[1] as ContentAgent).some(slot => slot.id === ref[2]);
};

function directorRaises(consumer: string, id: string, doc: Record<string, unknown>): MigratedRaise[] | string {
  const { raisedBy, kind, cells, detail, status, opened } = doc;
  if (!text(raisedBy) || !text(detail) || !text(opened) || !REQUEST_KINDS.includes(String(kind)) || !REQUEST_STATUSES.includes(String(status))) return "no Director request record (raisedBy, kind, detail, status, opened)";
  if (!Array.isArray(cells) || !cells.length || !cells.every(cell => typeof cell === "string" && SLOT_ID.test(cell))) return "its cells name no Director cell ids";
  if (status === "resolved" || status === "declined") return [];
  const raiser = raiserOf(consumer, raisedBy, "director");
  const raised = raiser.by ? `, raised by ${raiser.by}` : "";
  return (cells as string[]).map(cell => {
    const target = `director/${cell}`;
    const why = `${String(kind)}: ${detail} (migrated from ${id}${raised})`;
    if (!isPlacedRef(consumer, target)) return { kind: "slot", target, from: fromOf(raiser, "slot", target), why };
    if (kind === "contradiction") return { kind: "fix", target, from: fromOf(raiser, "fix", target), why, check: "director.contradiction", findings: [detail], cause: `${id} (raised by ${raisedBy}, opened ${opened})` };
    return { kind: "change", target, from: fromOf(raiser, "change", target), why, want: "candidate" };
  });
}

function designerRaises(consumer: string, doc: Record<string, unknown>): MigratedRaise[] | string {
  const { raisedBy, missing, status, candidate } = doc;
  if (!text(raisedBy) || !text(missing) || !NEED_STATUSES.includes(String(status))) return "no Designer need record (raisedBy, missing, status)";
  if (status === "closed") return [];
  const slot = object(candidate) ? candidate.slotId : undefined;
  if (typeof slot !== "string" || !SLOT_ID.test(slot)) return "it names no candidate slot, so no Designer slot to file it about: name one (candidate.slotId) or file it with clossys request";
  const target = `designer/${slot}`;
  const raiser = raiserOf(consumer, raisedBy, "designer");
  // Exactly Designer dogfood's needWhy(raisedBy, missing): the text a finding links to its request by.
  const why = `${raisedBy} needs ${missing}`;
  const kind = isPlacedRef(consumer, target) ? "change" : "slot";
  return [kind === "change" ? { kind, target, from: fromOf(raiser, kind, target), why, want: "candidate" } : { kind, target, from: fromOf(raiser, kind, target), why }];
}

const raiseInput = (raise: MigratedRaise, at: string) => ({
  target: raise.target, from: raise.from, why: raise.why, source: "cli" as const, by: "producer", at, createdBy: cliActor(REQUESTS_MIGRATION_CLI),
});
function raiseOne(consumer: string, raise: MigratedRaise, at: string, dry: boolean): { request: SlotRequest; created: boolean } {
  if (raise.kind === "slot") return raiseRequest(consumer, raiseInput(raise, at), { dry, cited: true });
  return raiseWork(consumer, {
    ...raiseInput(raise, at), kind: raise.kind,
    ...(raise.want !== undefined ? { want: raise.want } : {}), ...(raise.check !== undefined ? { check: raise.check, findings: raise.findings ?? [], cause: raise.cause ?? "" } : {}),
  }, { dry });
}

/** The whole content of one record's raise, as the raised event a merge appends carries it. */
export const mergedDetail = (raise: MigratedRaise, record: Pick<LegacyRecord, "id" | "file">): string =>
  `${raise.why}${MERGED_NOTE}${record.id}, ${record.file}${raise.check !== undefined ? `; check ${raise.check}; findings: ${(raise.findings ?? []).join(" | ")}; cause: ${raise.cause ?? ""}` : ""})`;
/** Whether `entry` holds the raise's content: as its own why (and a fix's check, findings and cause), or as a raised event. */
function holds(entry: SlotRequest, raise: MigratedRaise, detail: string): boolean {
  const own = entry.why === raise.why && (raise.check === undefined || (entry.check === raise.check && isDeepStrictEqual(entry.findings, raise.findings) && entry.cause === raise.cause));
  return own || entry.events.some(event => event.op === "raised" && event.detail === detail);
}
const mergeOf = (detail: string, at: string) => ({ at, by: "producer", detail, via: "cli" as const });
const keyOf = (raise: MigratedRaise) => `${raise.kind}|${raise.target}|${raise.from}`;

/**
 * Reads every legacy record and checks each raise it becomes, nothing written: a dry raise (routed and checked), the
 * entry it would create validated whole at a free id, and every collision (with an earlier record of the run or with
 * an entry already open) planned as a merge whose merged entry is validated too. A legacy store outside clossys/
 * under `root` (default: the consumer's parent) is a finding.
 */
export function planRequestMigration(consumer: string, at: string, root: string = dirname(consumer)): RequestMigrationPlan {
  const records: LegacyRecord[] = [], merges: PlannedMerge[] = [], kept: string[] = [], findings: { file: string; message: string }[] = [];
  /** The entry each (kind, target, requester) of the run lands in so far, and how the plan names it. */
  const landed = new Map<string, { entry: SlotRequest; label: string }>();
  const taken = new Map<WorkKind, Set<string>>();
  const scanned = scanStores(consumer, path => path === join(consumer, "agents", "producer"));
  for (const link of scanned.links) findings.push({ file: relative(consumer, link), message: "is a symbolic link to a legacy store: the migration reads and removes nothing through a link; put the folder itself in place and run again" });
  const outside = scanStores(root, (path, name) => path === consumer || OUTPUT_DIRS.has(name));
  for (const dir of [...outside.stores, ...outside.links]) {
    const store = LEGACY_DIRS[basename(dir)]!;
    findings.push({ file: relative(consumer, dir), message: `a ${store.agent} ${basename(dir)}/ store outside clossys/: nothing reads it any more and the migration moves only the stores under clossys/; move it under clossys/ and run again` });
  }
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
      const planned: PlannedRaise[] = [];
      let refused = false;
      const refuse = (raise: MigratedRaise, message: string) => { findings.push({ file, message: `${raise.kind} ${raise.target}: ${message}` }); refused = true; };
      for (const raise of raises) {
        let dry: { request: SlotRequest; created: boolean };
        try { dry = raiseOne(consumer, raise, at, true); } catch (error) {
          if (!(error instanceof RequestError)) throw error;
          refuse(raise, error.message); continue;
        }
        const detail = mergedDetail(raise, { id, file });
        const earlier = landed.get(keyOf(raise)) ?? (dry.created ? undefined : { entry: dry.request, label: `${workQueue(dry.request.kind as WorkKind)}#${dry.request.id}` });
        if (!earlier) {
          const kind = raise.kind as WorkKind;
          const free = createIssues(consumer, dry.request, taken.get(kind));
          if (!free.id) { refuse(raise, free.issues.join("; ")); continue; }
          taken.set(kind, new Set([...(taken.get(kind) ?? []), free.id]));
          landed.set(keyOf(raise), { entry: dry.request, label: `new entry from ${file}` });
          planned.push(raise);
          continue;
        }
        if (!holds(earlier.entry, raise, detail)) {
          const merged = withMergedRaise(earlier.entry, mergeOf(detail, at));
          const issues = requestIssues(merged, dirname(consumer));
          if (issues.length) { refuse(raise, `merged into ${earlier.label} it would be invalid: ${issues.slice(0, 5).join("; ")}`); continue; }
          landed.set(keyOf(raise), { ...earlier, entry: merged });
        } else landed.set(keyOf(raise), earlier);
        planned.push({ ...raise, into: earlier.label });
        merges.push({ file, kind: raise.kind, target: raise.target, from: raise.from, into: earlier.label });
      }
      if (!refused) records.push({ file, agent: store.agent, id, raises: planned });
    }
  }
  return { records, merges, kept, findings };
}

/** Syncs a written entry (and its folder) to disk before the legacy file it replaces goes. */
function syncToDisk(file: string): void {
  const fd = openSync(file, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
  try { const dir = openSync(dirname(file), "r"); try { fsyncSync(dir); } finally { closeSync(dir); } } catch { /* a folder fsync is best effort where the platform refuses it */ }
}

/** Removes one legacy file: only a regular file at its own path inside the consumer (no link on the way), else it is kept and the run stops. */
function removeLegacy(consumer: string, real: string, file: string): void {
  const path = join(consumer, file);
  const stat = lstatOf(path);
  if (!stat?.isFile()) throw new RequestError(`migrate requests: ${file} is no regular file now; it is kept`);
  if (realpathSync(path) !== join(real, file)) throw new RequestError(`migrate requests: ${file} resolves to ${realpathSync(path)}, outside its own path in the consumer; it is kept`);
  unlinkSync(path);
}

/**
 * Raises every planned entry, merges each collision's content into the entry that holds it (appendRaise), then
 * removes each migrated legacy file once its content is re-read from the queue and synced, and a legacy folder left
 * empty. Refuses a plan with findings.
 */
export function applyRequestMigration(consumer: string, plan: RequestMigrationPlan, at: string): { raised: AppliedRaise[]; removed: string[] } {
  if (plan.findings.length) throw new RequestError(`migrate requests: ${plan.findings.length} finding(s); nothing was written`);
  const real = realpathSync(consumer);
  const raised: AppliedRaise[] = [], removed: string[] = [];
  for (const record of plan.records) {
    for (const raise of record.raises) {
      const detail = mergedDetail(raise, record);
      const { request, created } = raiseOne(consumer, raise, at, false);
      // A dedupe: the record's content goes into the entry that holds the work, unless it is there already.
      const merged = created || holds(request, raise, detail) ? request : appendRaise(consumer, request.id, mergeOf(detail, at)).request;
      const event = created ? undefined : merged.events.find(each => each.op === "raised" && each.detail === detail)?.id;
      // Durably present before the source goes: re-read from disk, its content found, the entry synced.
      const stored = readRequest(consumer, request.id);
      if (!holds(stored, raise, detail)) throw new RequestError(`migrate requests: ${record.file} (${raise.kind} ${raise.target}) is not in ${workQueue(stored.kind as WorkKind)}#${stored.id} after the write; it is kept`);
      syncToDisk(join(requestsDir(consumer, stored.kind as WorkKind), `${stored.id}.json`));
      raised.push({ ...raise, file: record.file, entry: `${workQueue(stored.kind as WorkKind)}#${stored.id}`, created, ...(event ? { event } : {}) });
    }
    removeLegacy(consumer, real, record.file);
    removed.push(record.file);
  }
  for (const dir of [...new Set(plan.records.map(record => dirname(join(consumer, record.file))))]) {
    if (lstatOf(dir)?.isDirectory() && !readdirSync(dir).length) rmdirSync(dir);
  }
  return { raised, removed };
}
