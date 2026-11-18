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
 * - The requester is the record's raisedBy when that is a placed slot (`<agent>/<slot>`, or a Designer slot id),
 *   otherwise the owner, with the original raiser kept in the why.
 * - A resolved, declined or closed record carries nothing open: it is removed (git keeps its history).
 * Every raise is Producer's (by producer, source cli, created by code `clossys migrate requests`), so it is routed and
 * validated like any other; a refused raise is a finding. Any finding exits 1 and --apply then writes nothing. After
 * the raises, --apply removes each migrated legacy file and a legacy folder it leaves empty. Raises are idempotent and
 * the legacy files are gone, so a second run plans nothing.
 */
import { existsSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { cliActor } from "../records/pin.js";
import { raiseRequest, raiseWork, RequestError, type ContentAgent } from "../records/request.js";
import type { SlotRequest } from "../records/types.js";
import { placedSlots } from "../queue/routing.js";

export const REQUESTS_MIGRATION_CLI = "clossys migrate requests";
/** The legacy store folders and the record file names each holds. */
const LEGACY_DIRS: Readonly<Record<string, { readonly agent: "director" | "designer"; readonly file: RegExp }>> = {
  requests: { agent: "director", file: /^REQ-\d{4}\.json$/ },
  needs: { agent: "designer", file: /^NEED-\d{3,}\.json$/ },
};
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
export interface LegacyRecord {
  /** Consumer-relative path of the legacy file. */
  readonly file: string;
  readonly agent: "director" | "designer";
  readonly id: string;
  /** The entries it becomes (none for a resolved, declined or closed record). */
  readonly raises: readonly MigratedRaise[];
}
export interface RequestMigrationPlan {
  readonly records: readonly LegacyRecord[];
  /** Files in a legacy folder that are no legacy record: left in place. */
  readonly kept: readonly string[];
  readonly findings: readonly { readonly file: string; readonly message: string }[];
}
export interface AppliedRaise extends MigratedRaise { readonly file: string; readonly entry: string; readonly created: boolean }

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isDir = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };

/** Every legacy store folder under the consumer (Producer's own tree, dot folders and node_modules skipped). */
function legacyDirs(consumer: string, dir = consumer, out: string[] = []): string[] {
  if (!isDir(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (name.startsWith(".") || name === "node_modules" || path === join(consumer, "agents", "producer") || !isDir(path)) continue;
    if (LEGACY_DIRS[name] && readdirSync(path).some(file => LEGACY_DIRS[name]!.file.test(file))) out.push(path);
    else legacyDirs(consumer, path, out);
  }
  return out;
}

function requesterOf(consumer: string, raisedBy: string, agent: "director" | "designer"): { from: string; by?: string } {
  if (raisedBy === "owner") return { from: "owner" };
  const ref = SLOT_REF.exec(raisedBy) ?? (agent === "designer" && SLOT_ID.test(raisedBy) ? SLOT_REF.exec(`designer/${raisedBy}`) : null);
  if (ref && placedSlots(consumer, ref[1] as ContentAgent).some(slot => slot.id === ref[2])) return { from: `${ref[1]}/${ref[2]}` };
  return { from: "owner", by: raisedBy };
}
const isPlacedRef = (consumer: string, target: string) => {
  const ref = SLOT_REF.exec(target);
  return !!ref && placedSlots(consumer, ref[1] as ContentAgent).some(slot => slot.id === ref[2]);
};

function directorRaises(consumer: string, id: string, doc: Record<string, unknown>): MigratedRaise[] | string {
  const { raisedBy, kind, cells, detail, status, opened } = doc;
  if (!text(raisedBy) || !text(detail) || !text(opened) || !REQUEST_KINDS.includes(String(kind)) || !REQUEST_STATUSES.includes(String(status))) return "no Director request record (raisedBy, kind, detail, status, opened)";
  if (!Array.isArray(cells) || !cells.length || !cells.every(cell => typeof cell === "string" && SLOT_ID.test(cell))) return "its cells name no Director cell ids";
  if (status === "resolved" || status === "declined") return [];
  const requester = requesterOf(consumer, raisedBy, "director");
  const raised = requester.by ? `, raised by ${requester.by}` : "";
  return (cells as string[]).map(cell => {
    const target = `director/${cell}`;
    const why = `${String(kind)}: ${detail} (migrated from ${id}${raised})`;
    if (!isPlacedRef(consumer, target)) return { kind: "slot", target, from: requester.from, why };
    if (kind === "contradiction") return { kind: "fix", target, from: requester.from, why, check: "director.contradiction", findings: [detail], cause: `${id} (raised by ${raisedBy}, opened ${opened})` };
    return { kind: "change", target, from: requester.from, why, want: "candidate" };
  });
}

function designerRaises(consumer: string, doc: Record<string, unknown>): MigratedRaise[] | string {
  const { raisedBy, missing, status, candidate } = doc;
  if (!text(raisedBy) || !text(missing) || !NEED_STATUSES.includes(String(status))) return "no Designer need record (raisedBy, missing, status)";
  if (status === "closed") return [];
  const slot = object(candidate) ? candidate.slotId : undefined;
  if (typeof slot !== "string" || !SLOT_ID.test(slot)) return "it names no candidate slot, so no Designer slot to file it about: name one (candidate.slotId) or file it with clossys request";
  const target = `designer/${slot}`;
  const requester = requesterOf(consumer, raisedBy, "designer");
  // Exactly Designer dogfood's needWhy(raisedBy, missing): the text a finding links to its request by.
  const why = `${raisedBy} needs ${missing}`;
  return [isPlacedRef(consumer, target) ? { kind: "change", target, from: requester.from, why, want: "candidate" } : { kind: "slot", target, from: requester.from, why }];
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

/** Reads every legacy record and checks each raise it becomes (a dry raise: routed and validated, nothing written). */
export function planRequestMigration(consumer: string, at: string): RequestMigrationPlan {
  const records: LegacyRecord[] = [], kept: string[] = [], findings: { file: string; message: string }[] = [];
  for (const dir of legacyDirs(consumer)) {
    const store = LEGACY_DIRS[basename(dir)]!;
    for (const name of readdirSync(dir).sort()) {
      const file = relative(consumer, join(dir, name));
      if (!store.file.test(name)) { kept.push(file); continue; }
      let doc: unknown;
      try { doc = JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { findings.push({ file, message: "does not parse as JSON" }); continue; }
      const id = name.replace(/\.json$/, "");
      if (!object(doc) || doc.id !== id) { findings.push({ file, message: `its id is not ${id}` }); continue; }
      const raises = store.agent === "director" ? directorRaises(consumer, id, doc) : designerRaises(consumer, doc);
      if (typeof raises === "string") { findings.push({ file, message: raises }); continue; }
      let refused = false;
      for (const raise of raises) {
        try { raiseOne(consumer, raise, at, true); } catch (error) {
          if (!(error instanceof RequestError)) throw error;
          findings.push({ file, message: `${raise.kind} ${raise.target}: ${error.message}` }); refused = true;
        }
      }
      if (!refused) records.push({ file, agent: store.agent, id, raises });
    }
  }
  return { records, kept, findings };
}

/** Raises every planned entry, then removes each migrated legacy file and a legacy folder left empty. Refuses a plan with findings. */
export function applyRequestMigration(consumer: string, plan: RequestMigrationPlan, at: string): { raised: AppliedRaise[]; removed: string[] } {
  if (plan.findings.length) throw new RequestError(`migrate requests: ${plan.findings.length} finding(s); nothing was written`);
  const raised: AppliedRaise[] = [], removed: string[] = [];
  for (const record of plan.records) {
    for (const raise of record.raises) {
      const { request, created } = raiseOne(consumer, raise, at, false);
      raised.push({ ...raise, file: record.file, entry: `queue.${request.kind}#${request.id}`, created });
    }
    unlinkSync(join(consumer, record.file));
    removed.push(record.file);
  }
  for (const dir of [...new Set(plan.records.map(record => dirname(join(consumer, record.file))))]) {
    if (existsSync(dir) && !readdirSync(dir).length) rmdirSync(dir);
  }
  return { raised, removed };
}
