/**
 * `clossys migrate slots` (foundry-build-0048 U13): converts a consumer store to one format, in place.
 * Every slot folder under `<consumer>/agents/<agent>/` (the Producer's seats included) ends holding a
 * `clossys.slot/2` slot.json, a `clossys.pin/2` (or `clossys.pin-map/1`) pin.json and candidates that
 * carry a `clossys.candidate/1` header; then the store-format marker (records/store-format.ts) is
 * written, after which the readers refuse a slot/1 or pin/1 found in the store.
 *
 * - slot.json: slot/1 becomes slot/2 by the slot-1-to-2 mapping (a package base when one ships it); a seat
 *   becomes a slot/2 seat (records/seat-slot.ts).
 * - candidates: a candidate with no header gets one (recut.ts recutCandidateBytes); its content is kept.
 * - pin.json: pin/1 becomes pin/2 by the pin-1-to-2 mapping; a pin whose candidate got a header is
 *   re-pointed to the headered bytes' sha256 only when it pinned exactly the bytes the header was added to.
 *
 * Safety, as `migrate requests` (U8): the plan refuses whole on any finding (a file that does not read,
 * a slot/1 with no slot/2 form, a symbolic link anywhere from the consumer folder down); --apply first
 * writes a journal holding every planned file, then writes each new file beside its old one, syncs it,
 * re-reads it and checks its sha256, and only then renames it over the old one. A stopped run leaves the
 * journal: a rerun resumes it (a file already at its new bytes is skipped; one at neither its old nor its
 * new bytes stops the run), so nothing is lost and nothing is written twice. Every path is checked to stay
 * inside the consumer folder by its real path, never through a link. A second run plans nothing.
 */
import { closeSync, fsyncSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { join, sep } from "node:path";
import { CANDIDATE_NAME } from "../records/candidate.js";
import { sha256Hex } from "../records/hash.js";
import { fileState, type FileState } from "../records/migrations.js";
import { OWNER_BASES, pinRecordIssues, toIsoZ } from "../records/pin.js";
import { readPinFile } from "../records/pin-map.js";
import { seatSlot } from "../records/seat-slot.js";
import { serializeSlot, SLOT_AGENTS, SLOT_SCHEMA, SLOT_V1_SCHEMA } from "../records/slot.js";
import { candidateHeaderOf } from "../records/slot-current.js";
import { seatStepOf } from "../records/slot-model/types.js";
import { appendMigrationEvents, writeSlotsMigrationFolder, type WriteGuard } from "../records/slot-write.js";
import type { RecordFile } from "../records/ledger.js";
import { isConvertedStore, storeFormatBytes, storeFormatPath } from "../records/store-format.js";
import type { AgentId, Iso, Pin, PinMap, PinRecord, SlotId } from "../records/types.js";
import { migratePinDoc } from "./pin-1-to-2.js";
import { RECUT, recutCandidateBytes } from "./recut.js";
import { planSlot1To2 } from "./slot-1-to-2.js";

export const SLOTS_MIGRATION_CLI = "clossys migrate slots";
export const SLOTS_MIGRATION_BY = `code:${SLOTS_MIGRATION_CLI}`;
/** A started run's plan, under the consumer folder; present only while a run is unfinished. */
export const SLOTS_JOURNAL = ".migrate-slots.journal.json";
const JOURNAL_SCHEMA = "clossys.migrate-slots-journal/1";
const TEMP = ".migrate-slots.tmp";

export type SlotsChangeKind = "candidate" | "pin" | "slot";
export interface SlotsChange {
  /** The file, relative to the consumer folder (`agents/<agent>/<slot>/...`). */
  readonly file: string;
  readonly kind: SlotsChangeKind;
  readonly subject: string;
  readonly from: FileState;
  readonly to: FileState;
  readonly bytes: string;
}
export interface SlotsFinding { readonly subject: string; readonly detail: string }
export interface SlotsPlan {
  readonly consumer: string;
  readonly changes: readonly SlotsChange[];
  readonly findings: readonly SlotsFinding[];
  /** The store carries the store-format marker. */
  readonly converted: boolean;
  /** The changes are a stopped run's journal, not a fresh plan. */
  readonly resumed: boolean;
  /** Owner-basis pins that carry no queue answer ref: converted as they are, still failing pins.resolve. */
  readonly needsOwnerAnswer: readonly string[];
  /** Slot folders read. */
  readonly folders: number;
}

/** What --apply would still write: every change, and the marker when the store has none. */
export const slotsPending = (plan: SlotsPlan): number => plan.changes.length + (plan.converted ? 0 : 1);

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const lstatOf = (path: string): Stats | undefined => { try { return lstatSync(path); } catch { return undefined; } };
const jsonBytes = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
/** A journal or plan path: `agents/<agent>/<folder>/slot.json|pin.json|candidates/<name>`, nothing else. */
const CHANGE_PATH = /^agents\/(director|designer|writer|publisher|producer)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(slot\.json|pin\.json|candidates\/[A-Za-z0-9][A-Za-z0-9._-]*)$/;

/** Every slot folder with a slot.json, by lstat only: a link anywhere on the way is a finding and is never followed. */
function walk(consumer: string, findings: SlotsFinding[]): { agent: AgentId; id: string; dir: string }[] {
  const out: { agent: AgentId; id: string; dir: string }[] = [];
  const top = lstatOf(consumer);
  if (!top) return out;
  if (top.isSymbolicLink()) { findings.push({ subject: "clossys", detail: "the consumer folder is a symbolic link; refused" }); return out; }
  const agents = join(consumer, "agents");
  const agentsStat = lstatOf(agents);
  if (agentsStat?.isSymbolicLink()) { findings.push({ subject: "agents", detail: "is a symbolic link; refused" }); return out; }
  if (!agentsStat?.isDirectory()) return out;
  for (const agent of SLOT_AGENTS) {
    const dir = join(agents, agent);
    const stat = lstatOf(dir);
    if (!stat) continue;
    if (stat.isSymbolicLink()) { findings.push({ subject: agent, detail: "is a symbolic link; refused" }); continue; }
    if (!stat.isDirectory()) continue;
    for (const id of readdirSync(dir).sort()) {
      if (id.startsWith("_") || id.startsWith(".")) continue;
      const folder = join(dir, id);
      const folderStat = lstatOf(folder);
      if (folderStat?.isSymbolicLink()) { findings.push({ subject: `${agent}/${id}`, detail: "is a symbolic link; refused" }); continue; }
      if (!folderStat?.isDirectory()) continue;
      const slot = lstatOf(join(folder, "slot.json"));
      if (!slot) continue;
      if (!slot.isFile()) { findings.push({ subject: `${agent}/${id}`, detail: "slot.json is no regular file (a link or a folder); refused" }); continue; }
      out.push({ agent, id, dir: folder });
    }
  }
  return out;
}

const change = (consumer: string, dir: string, file: string, kind: SlotsChangeKind, subject: string, before: string, bytes: string): SlotsChange => ({
  file: join(dir, file).slice(consumer.length + 1).split(sep).join("/"), kind, subject, from: fileState(before), to: fileState(bytes), bytes,
});

/** The plan of one folder: its candidate, pin and slot.json changes, or findings. */
function planFolder(consumer: string, folder: { agent: AgentId; id: string; dir: string }, v1: ReturnType<typeof planSlot1To2>, options: { at: Iso; version: string }, plan: { changes: SlotsChange[]; findings: SlotsFinding[]; needsOwnerAnswer: string[] }): void {
  const { agent, id, dir } = folder;
  const subject = `${agent}/${id}`;
  const fail = (detail: string) => plan.findings.push({ subject, detail });
  let raw: unknown, slotText: string;
  try { slotText = readFileSync(join(dir, "slot.json"), "utf8"); raw = JSON.parse(slotText); } catch (error) { fail(`slot.json does not read: ${(error as Error).message}`); return; }
  if (!object(raw)) { fail("slot.json is not an object"); return; }
  const pinStat = lstatOf(join(dir, "pin.json"));
  if (pinStat && !pinStat.isFile()) { fail("pin.json is no regular file (a link or a folder); refused"); return; }
  let kind: string, slotBytes: string | undefined;
  if (raw.schema === SLOT_SCHEMA) kind = String(raw.kind);
  else if (raw.schema === SLOT_V1_SCHEMA) {
    if (raw.id !== id || raw.agent !== agent) { fail(`slot.json names ${String(raw.agent)}/${String(raw.id)}, not its folder`); return; }
    if (agent === "producer" && raw.kind === "seat") {
      const step = seatStepOf(id);
      if (step === undefined) { fail(`a seat's slot id must be seat.<step>`); return; }
      try {
        slotBytes = serializeSlot(seatSlot({ slotId: id, step, position: object(raw.ia) ? raw.ia : {}, status: pinStat ? "live" : "starter", createdBy: { actor: "code", cli: SLOTS_MIGRATION_CLI, version: options.version }, at: options.at }));
      } catch (error) { fail((error as Error).message); return; }
      kind = "seat";
    } else {
      const migration = v1.migrations.find(each => each.agent === agent && each.id === id);
      if (!migration) {
        const why = [...v1.findings, ...v1.skipped].find(each => each.subject === subject)?.detail ?? `${SLOT_V1_SCHEMA} kind ${String(raw.kind)} has no ${SLOT_SCHEMA} form`;
        fail(why);
        return;
      }
      slotBytes = migration.text;
      kind = migration.slot.kind;
    }
  } else { fail(`slot.json schema is ${String(raw.schema)}, neither ${SLOT_V1_SCHEMA} nor ${SLOT_SCHEMA}`); return; }

  const headered = new Map<string, SlotsChange>();
  const candidates = join(dir, "candidates");
  const candidatesStat = lstatOf(candidates);
  if (candidatesStat?.isSymbolicLink()) { fail("candidates/ is a symbolic link; refused"); return; }
  if (candidatesStat?.isDirectory()) {
    for (const name of readdirSync(candidates).sort()) {
      if (!CANDIDATE_NAME.test(name)) continue;
      const file = join(candidates, name);
      const stat = lstatOf(file);
      if (!stat?.isFile()) { fail(`candidates/${name} is no regular file (a link or a folder); refused`); return; }
      const bytes = readFileSync(file, "utf8");
      if (candidateHeaderOf(name, bytes)) continue;
      let next: string;
      try {
        next = recutCandidateBytes(name, bytes, { agent, slotId: id, at: options.at, version: options.version, sourceRef: `agents/${agent}/${id}/candidates/${name}`, cli: SLOTS_MIGRATION_CLI });
      } catch (error) { fail(`candidates/${name}: ${(error as Error).message}`); return; }
      if (next !== bytes) headered.set(name, change(consumer, dir, join("candidates", name), "candidate", subject, bytes, next));
    }
  }

  let pinChange: SlotsChange | undefined;
  if (pinStat) {
    const pinText = readFileSync(join(dir, "pin.json"), "utf8");
    const read = readPinFile(join(dir, "pin.json"), { agent, slotId: id as SlotId });
    let doc: Pin | PinMap;
    if (read.kind === "pin/1") {
      const migrated = migratePinDoc(read.doc, { agent, slotId: id as SlotId, kind });
      if (!migrated.ok) { fail(`pin.json: ${migrated.issues.join("; ")}`); return; }
      doc = migrated.doc;
    } else if (read.kind === "pin" || read.kind === "pin-map") doc = structuredClone(read.doc);
    else if (read.kind === "invalid") { fail(read.issues.join("; ")); return; }
    else return;
    const records: PinRecord[] = doc.kind === "pin-map" ? Object.values(doc.records) as PinRecord[] : [doc as unknown as PinRecord];
    for (const record of records) {
      const moved = headered.get(record.candidate);
      // Re-pointed only when the pin held exactly the bytes the header was added to; a drifted pin stays drifted.
      if (moved && record.sha256 === moved.from.sha256) (record as { sha256: string }).sha256 = moved.to.sha256;
    }
    if (records.some(record => OWNER_BASES.includes(record.basis) && pinRecordIssues(record, doc.refs).some(issue => issue.includes("no answers ref")))) plan.needsOwnerAnswer.push(subject);
    const bytes = jsonBytes(doc);
    if (bytes !== pinText) pinChange = change(consumer, dir, "pin.json", "pin", subject, pinText, bytes);
  }
  // Candidates first, then the pin that names them, then slot.json: a rerun of a stopped run resumes the journal in this order.
  plan.changes.push(...headered.values());
  if (pinChange) plan.changes.push(pinChange);
  if (slotBytes !== undefined && slotBytes !== slotText!) plan.changes.push(change(consumer, dir, "slot.json", "slot", subject, slotText!, slotBytes));
}

/** A stopped run's journal: its changes, each path checked to be one a plan writes. */
function readJournal(consumer: string, findings: SlotsFinding[]): SlotsChange[] {
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(join(consumer, SLOTS_JOURNAL), "utf8")); } catch (error) { findings.push({ subject: SLOTS_JOURNAL, detail: `does not read: ${(error as Error).message}` }); return []; }
  if (!object(doc) || doc.schema !== JOURNAL_SCHEMA || !Array.isArray(doc.changes)) { findings.push({ subject: SLOTS_JOURNAL, detail: `is not a ${JOURNAL_SCHEMA}` }); return []; }
  const out: SlotsChange[] = [];
  for (const entry of doc.changes as unknown[]) {
    const item = entry as Partial<SlotsChange>;
    if (!object(entry) || typeof item.file !== "string" || !CHANGE_PATH.test(item.file) || typeof item.bytes !== "string" || !object(item.from) || !object(item.to)) {
      findings.push({ subject: SLOTS_JOURNAL, detail: `holds an entry outside agents/<agent>/<slot>/: ${JSON.stringify(object(entry) ? item.file : entry)}; refused` });
      continue;
    }
    if (sha256Hex(item.bytes) !== item.to.sha256) { findings.push({ subject: SLOTS_JOURNAL, detail: `${item.file}: its bytes are not the sha256 it records; refused` }); continue; }
    out.push(entry as unknown as SlotsChange);
  }
  return out;
}

/** What `migrate slots` would write under `root` (the directory holding `clossys/`), without writing it. */
export function planSlotsMigration(root: string, options: { at: string; version: string }): SlotsPlan {
  const consumer = join(root, "clossys");
  const findings: SlotsFinding[] = [];
  const converted = isConvertedStore(consumer);
  if (lstatOf(join(consumer, SLOTS_JOURNAL))) {
    const changes = readJournal(consumer, findings);
    return { consumer, changes, findings, converted, resumed: true, needsOwnerAnswer: [], folders: 0 };
  }
  const at = toIsoZ(options.at);
  if (!at) throw new Error(`--at ${options.at} is not a timestamp`);
  const folders = walk(consumer, findings);
  const plan = { changes: [] as SlotsChange[], findings, needsOwnerAnswer: [] as string[] };
  if (!findings.length && folders.length) {
    const v1 = planSlot1To2(root, { at, version: options.version });
    for (const folder of folders) planFolder(consumer, folder, v1, { at, version: options.version }, plan);
  }
  return { consumer, changes: plan.changes, findings: plan.findings, converted, resumed: false, needsOwnerAnswer: plan.needsOwnerAnswer, folders: folders.length };
}

/** Syncs a file (and its folder) to disk. */
function syncToDisk(file: string): void {
  const fd = openSync(file, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
  try { const dir = openSync(join(file, ".."), "r"); try { fsyncSync(dir); } finally { closeSync(dir); } } catch { /* a folder fsync is best effort where the platform refuses it */ }
}

/** What --apply does to disk around each write (tests stand in for a crash, a lost write or a corrupted read). */
export interface SlotsApplyIo {
  readonly sync: (file: string) => void;
  readonly reread: (file: string) => string;
  readonly rename: (from: string, to: string) => void;
}
const DISK: SlotsApplyIo = { sync: syncToDisk, reread: file => readFileSync(file, "utf8"), rename: renameSync };

/**
 * The absolute path of a plan path, only when it stays inside the consumer by its real path: the folder it
 * lands in resolves to exactly `<real consumer>/<its own path>` (no link on the way), and the file itself is
 * a regular file (never a link). Throws otherwise.
 */
export function guardedPath(consumer: string, real: string, file: string): string {
  if (!CHANGE_PATH.test(file)) throw new Error(`migrate slots: ${file} is outside agents/<agent>/<slot>/; refused`);
  const path = join(consumer, ...file.split("/"));
  const folder = join(path, "..");
  let resolved: string;
  try { resolved = realpathSync(folder); } catch { throw new Error(`migrate slots: ${file}: its folder is gone; refused`); }
  if (resolved !== join(real, ...file.split("/").slice(0, -1))) throw new Error(`migrate slots: ${file} resolves to ${resolved}, outside its own path in the consumer; refused`);
  const stat = lstatOf(path);
  if (stat && !stat.isFile()) throw new Error(`migrate slots: ${file} is no regular file (a link or a folder); refused`);
  return path;
}

/** Writes `bytes` beside `path`, syncs and re-reads it, and renames it over `path` only when the re-read matches. */
function replaceVerified(path: string, bytes: string, io: SlotsApplyIo, label: string): void {
  const temp = `${path}${TEMP}`;
  writeFileSync(temp, bytes);
  io.sync(temp);
  if (sha256Hex(io.reread(temp)) !== sha256Hex(bytes)) {
    try { unlinkSync(temp); } catch { /* the temp file is the run's own */ }
    throw new Error(`migrate slots: ${label} did not read back as written; the old file is kept`);
  }
  io.rename(temp, path);
  io.sync(path);
}

export interface SlotsApplied { readonly written: string[]; readonly skipped: string[]; readonly events: number; readonly ledgerEvents: number; readonly marker: boolean }

/**
 * Applies a plan: refuses whole on a finding; journals the changes; replaces each file only after its new bytes
 * are verified on disk; records the candidate rewrites as format-only migration events (the recut's header
 * codemod); removes the journal; and writes the store-format marker only when a fresh plan of the store then
 * finds nothing left to convert.
 */
export function applySlotsMigration(root: string, plan: SlotsPlan, options: { at: string; version: string; guard?: WriteGuard }, io: Partial<SlotsApplyIo> = {}): SlotsApplied {
  if (plan.findings.length) throw new Error(`migrate slots: ${plan.findings.length} finding(s); nothing was written`);
  const disk: SlotsApplyIo = { ...DISK, ...io };
  const consumer = plan.consumer;
  const real = realpathSync(consumer);
  const journal = join(consumer, SLOTS_JOURNAL);
  if (!plan.resumed && plan.changes.length) {
    const stat = lstatOf(journal);
    if (stat) throw new Error(`migrate slots: ${SLOTS_JOURNAL} appeared after the plan; nothing was written`);
    replaceVerified(journal, jsonBytes({ schema: JOURNAL_SCHEMA, startedAt: options.at, changes: plan.changes }), disk, SLOTS_JOURNAL);
  }
  const written: string[] = [], skipped: string[] = [];
  const at = toIsoZ(options.at) ?? options.at;
  // One folder at a time, in sorted order, under its slot lock: its files, then its one ledger migrate event (U13 r4).
  const folders = new Map<string, SlotsChange[]>();
  for (const each of plan.changes) {
    const key = each.file.split("/").slice(0, 3).join("/");
    folders.set(key, [...(folders.get(key) ?? []), each]);
  }
  let ledgerEvents = 0;
  for (const key of [...folders.keys()].sort()) {
    const changes = folders.get(key)!;
    const [, agent, id] = key.split("/") as [string, AgentId, SlotId];
    const recuts = changes.filter(each => each.kind === "candidate").map(each => ({ name: each.file.slice(key.length + "/candidates/".length), from: each.from.sha256, to: each.to.sha256 }));
    const records = changes.filter(each => each.kind !== "candidate").map(each => (each.kind === "pin" ? "pin.json" : "slot.json") as RecordFile);
    const done = writeSlotsMigrationFolder(consumer, agent, id, { recuts, records, at, by: SLOTS_MIGRATION_BY, cli: SLOTS_MIGRATION_CLI, write: () => {
      for (const each of changes) {
        const path = guardedPath(consumer, real, each.file);
        let now: string;
        try { now = sha256Hex(readFileSync(path)); } catch { throw new Error(`migrate slots: ${each.file} is gone; the journal is kept`); }
        if (now === each.to.sha256) { skipped.push(each.file); continue; }
        if (now !== each.from.sha256) throw new Error(`migrate slots: ${each.file} changed since the plan; the journal is kept and nothing more is written`);
        replaceVerified(path, each.bytes, disk, each.file);
        written.push(each.file);
      }
    } }, options.guard ?? true);
    if (done.event) ledgerEvents++;
  }
  const rewrites = plan.changes.filter(each => each.kind === "candidate").map(each => ({ file: each.file, from: each.from, to: each.to }));
  const events = rewrites.length ? appendMigrationEvents(consumer, RECUT, rewrites, { by: SLOTS_MIGRATION_BY, at }).length : 0;
  if (lstatOf(journal)) unlinkSync(journal);
  const after = planSlotsMigration(root, options);
  if (after.findings.length || after.changes.length) throw new Error(`migrate slots: the store still holds ${after.changes.length} file(s) to convert and ${after.findings.length} finding(s) after the run; no marker written`);
  let marker = false;
  if (!after.converted) {
    const path = storeFormatPath(consumer);
    replaceVerified(path, storeFormatBytes({ convertedAt: toIsoZ(options.at) ?? options.at, createdBy: { actor: "code", cli: SLOTS_MIGRATION_CLI, version: options.version } }), disk, "store-format.json");
    marker = true;
  }
  return { written, skipped, events, ledgerEvents, marker };
}

/**
 * The store-format marker for a store a verb just made current (U13 r2, review N4): `config --init` and `ia --adopt`
 * write clossys.slot/2 only, so a store with no marker that a fresh plan finds nothing to convert or report (no slot/1,
 * no pin/1, no unheadered candidate, no stopped run) gets the marker at once, and its readers fail closed on a later
 * slot/1 or pin/1. A store holding any old-format file is left for `clossys migrate slots`. True when it was written.
 */
export function markCurrentStore(root: string, options: { at: string; version: string; cli: string }): boolean {
  const consumer = join(root, "clossys");
  if (isConvertedStore(consumer)) return false;
  let plan: SlotsPlan;
  try { plan = planSlotsMigration(root, options); } catch { return false; }
  if (plan.resumed || plan.findings.length || plan.changes.length) return false;
  replaceVerified(storeFormatPath(consumer), storeFormatBytes({ convertedAt: toIsoZ(options.at) ?? options.at, createdBy: { actor: "code", cli: options.cli, version: options.version } }), DISK, "store-format.json");
  return true;
}
