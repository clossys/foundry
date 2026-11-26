/**
 * The slot-model writer: a new candidate in a slot's `candidates/`, and the slot's decision —
 * `pin.json` naming one candidate by the sha256 of its bytes, or slot.json `notNeeded`.
 * Candidates are immutable (a change is the next version); a decision is replaced. Decisions are
 * written through `clossys pin` (rule R-DECISIONS-BY-CLI).
 *
 * The one writer of the ledger (records/ledger.ts): every write here appends one event to the
 * slot's `ledger.json` (or the agent tree's) under the same slot lock as the write, naming the
 * verb, action skill (path and sha256 of the installed file), by, model and tier, the op's fields
 * and the sha256 of each record it left. The one exemption is the P0 propagation probe's pin
 * re-point (`repointThemeProbePin`), which `restoreThemeProbePin` undoes byte for byte, so the net
 * byte state it leaves is the one the ledger already records.
 */
import { oldSlotRefusal } from "./store-format.js";
import { CRITIQUES_DIR } from "./critique-record.js";
import { craftRunRecipeIssues, loadRecipes, plumbCraftRunIssue } from "./recipes.js";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, cpSync, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DirectorStore, DirectorStoreChange, DirectorStoreWriter } from "@clossys/director";
import {
  CANDIDATE_NAME, KIND_EXT, SEAT_AGENT, agentDir, candidatesDir, jsonBytes, pinFile, slotFile, validateCandidate, validatePin, validateSlotDoc,
  type ModelAgent, type NotNeeded, type PinBasis, type PinDoc, type SlotAgent, type SlotDoc,
} from "./slot-model/index.js";
import { directorStoreReader, forgetSlotReads, isModelDir, listModelDir, listSlots, readCandidate, readLedger, readSlot, readSlotEntry } from "./slots.js";
import { candidateHeaderOf, candidateIssues, isCurrentSlot, readSlotValue, slotReadIssues } from "./slot-current.js";
import { recutCandidateBytes } from "./candidate-codec.js";
import { SlotFormatError, serializeSlot, validateSlot } from "./slot.js";
import { SeatRefusal, assertActor, assertSeat } from "./seat-owner.js";
import type { Actor, AgentId, CandidateHeader, Iso, Slot } from "./types.js";
import { buildCandidateHeader, CandidateRefusal, candidateHeaderIssues, serializeCandidate } from "./candidate.js";
import { cliActor, confirmableBasis, toIsoZ } from "./pin.js";
import { CODE_ADOPT, codeAdoptRefusal } from "./code-adopt.js";
import {
  LEDGER_FILE, LEDGER_SCHEMA, NONE, RETIRE_EVENT_CODES, actionContractPath, eventIssues, expectedCandidateSha, skillFile, skillPath,
  type LedgerEvent, type LedgerRecordState, type LedgerSkill, type Provenance, type RecordFile, type Verb,
} from "./ledger.js";
import type { GuardOptions, GuardTarget, GuardVerb } from "../constitution/guard.js";
import type { Row } from "../constitution/types.js";
import { validateAgainst } from "../constitution/schema.js";
import { fileState, MIGRATIONS_FILE, MIGRATIONS_SCHEMA, validateMigrations, type FileState, type FormatMigration, type MigratedEvent, type MigrationsDoc } from "./migrations.js";
import { consumerEngineRoot, engineRootOf, inputsOf } from "../engine/chain.js";
import { deferEvents, dropHeldEvents, logEvent, recordEvent } from "../engine/log.js";
import { refuseLegacyState } from "../engine/state-dir.js";

// ---------------------------------------------------------------------------
// Locks and atomic replacement, shared by slot decisions and the Director store.
// ---------------------------------------------------------------------------

/** A lock with no owner record this old was left by a writer that died before recording itself. */
export const OWNERLESS_LOCK_MS = 60_000;
/** A lock held this long by a writer on another host is abandoned: no decision write takes minutes. */
export const FOREIGN_LOCK_MS = 15 * 60_000;
const OWNER_FILE = "owner.json";
interface LockOwner { pid: number; host: string; at: number }

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};
/** True when the lock at `lock` was left by a writer that can no longer release it. */
function staleLock(lock: string, now = Date.now()): boolean {
  let owner: LockOwner | undefined;
  try { owner = JSON.parse(readFileSync(join(lock, OWNER_FILE), "utf8")) as LockOwner; } catch (error) {
    // A writer between mkdir and its owner write leaves no (or a partial) owner file: an ownerless lock, aged below.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    owner = undefined;
  }
  if (!owner || !Number.isInteger(owner.pid) || typeof owner.host !== "string") {
    try { return now - statSync(lock).mtimeMs > OWNERLESS_LOCK_MS; } catch { return false; }
  }
  if (owner.host === hostname()) return !alive(owner.pid);
  return now - owner.at > FOREIGN_LOCK_MS;
}
/**
 * Run `action` holding the directory lock at `lock`. A lock whose owner is gone (a dead process on
 * this host, an ownerless lock past OWNERLESS_LOCK_MS, another host's lock past FOREIGN_LOCK_MS) is
 * taken over by renaming it aside, so of two racing recoveries exactly one wins; a live lock refuses.
 */
export function withDirLock<T>(lock: string, busy: string, action: () => T): T {
  // The write's events would append to a log in STATE_DIR beside a legacy one: refuse before the lock or any record.
  const root = engineRootOf(lock);
  if (root !== undefined) refuseLegacyState(root);
  const acquire = () => { mkdirSync(lock); writeFileSync(join(lock, OWNER_FILE), JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() } satisfies LockOwner), { flag: "wx" }); };
  try { acquire(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !staleLock(lock)) throw new Error(busy);
    const aside = `${lock}.stale-${randomUUID()}`;
    try { renameSync(lock, aside); } catch { throw new Error(busy); }
    rmSync(aside, { recursive: true, force: true });
    try { acquire(); } catch { throw new Error(busy); }
  }
  // A writer in a process whose reader keeps answers (the record memo) never reads its own old answers.
  forgetSlotReads();
  // The write's engine events append when it commits, still under this lock (engine/log.ts deferEvents).
  try { return deferEvents(action); } finally { rmSync(lock, { recursive: true, force: true }); forgetSlotReads(); }
}
/** Replace `path` by renaming a fully written sibling over it: a reader sees the old bytes or the new, never a torn file. */
function replaceFile(path: string, bytes: string): void {
  const staged = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(staged, bytes, { flag: "wx" });
  try { renameSync(staged, path); } catch (error) { rmSync(staged, { force: true }); throw error; }
  finally { forgetSlotReads(); }
}
// ---------------------------------------------------------------------------
// Slot-model file primitives for the verbs whose records span several files (clossys ia, seat,
// retire, the seats-to-slots migration, the Writer declarations): the one place those bytes are
// written (R11.1). The verb appends the write's ledger event through this module as well
// (appendIaEvent, appendSlotDocEvent, appendRetireCandidate, appendRetireSlot, appendSeatEvents).
// ---------------------------------------------------------------------------

/**
 * The Producer-internal writers (foundry-build-0048 U7 r3): they take no actor guard because no CLI verb hands them a
 * caller's `--by` unjudged. Each one is called only from the files listed here (paths under packages/producer/src),
 * and Q9 (conform/requests-model.ts seatGuardIssues) is red when any other file calls it: a new verb that wants one
 * must judge its actor first (records/seat-owner.ts assertActor) and be added here.
 *
 * - writeSlotSeed, rewriteCitationsInPlace: migrations, `by` fixed by the migration;
 * - writeSlotOptions: `clossys options`, takes no `by` at all;
 * - writeSyncedSlot: `clossys ia sync`, takes no `by` (the event is by `producer`);
 * - appendIaEvent, appendSlotDocEvent: the event of a verb that judged its actor already (`clossys ia`, retire after
 *   its actor guard, a request link written by the request writer under its seat check, `clossys loop` adoption
 *   after loop/agent-loop-adopt.ts assertActor; `clossys migrate placement`, `by` fixed to producer by the migration).
 */
export const PRODUCER_INTERNAL_WRITERS: readonly { readonly writer: string; readonly callers: readonly string[] }[] = [
  { writer: "writeSlotSeed", callers: ["migrate/contracts.ts"] },
  { writer: "rewriteCitationsInPlace", callers: ["migrate/citations-to-slots.ts"] },
  { writer: "writeSlotOptions", callers: ["cli/options.ts"] },
  { writer: "appendIaEvent", callers: ["cli/owner.ts", "loop/agent-loop-adopt.ts"] },
  { writer: "appendSlotDocEvent", callers: ["cli/owner.ts", "loop/agent-loop-adopt.ts", "migrate/placement.ts", "records/request.ts"] },
  { writer: "writeSyncedSlot", callers: ["cli/ia-sync.ts"] },
];

/** Replace a slot-model file atomically, creating its parent folder. */
export function replaceModelFile(path: string, bytes: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const staged = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(staged, bytes, { flag: "wx" });
  try { renameSync(staged, path); } catch (error) { rmSync(staged, { force: true }); throw error; }
  finally { forgetSlotReads(); }
}
/** Create a slot-model file that must not exist yet (`wx`), creating its parent folder. */
export function createModelFile(path: string, bytes: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  try { writeFileSync(path, bytes, { flag: "wx" }); } finally { forgetSlotReads(); }
}
/** Remove a slot-model file (absent is fine): a refused write's undo. */
export function removeModelFile(path: string): void {
  try { rmSync(path, { force: true }); } finally { forgetSlotReads(); }
}
/** Move a slot-model file or folder, creating the destination's parent. */
export function moveModelEntry(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try { renameSync(from, to); } finally { forgetSlotReads(); }
}
/** Remove a slot-model folder a write created when an undo left it empty. */
export function dropEmptyModelDir(dir: string): void {
  if (isModelDir(dir) && !listModelDir(dir).length) { rmdirSync(dir); forgetSlotReads(); }
}

/** A record file's bytes before a guarded write, or null when it is absent (`restoreFiles` puts them back). */
type Snapshot = ReadonlyMap<string, Buffer | null>;
function snapshotFiles(paths: readonly string[]): Snapshot {
  return new Map(paths.map(path => [path, existsSync(path) ? readFileSync(path) : null]));
}
function restoreFiles(snapshot: Snapshot): void {
  // The undone write's held engine events name bytes that are gone: they are never appended.
  dropHeldEvents(snapshot.keys());
  for (const [path, bytes] of snapshot) {
    if (bytes === null) rmSync(path, { force: true });
    else { const staged = join(dirname(path), `.${randomUUID()}.tmp`); writeFileSync(staged, bytes, { flag: "wx" }); renameSync(staged, path); }
  }
  forgetSlotReads();
}

/**
 * A write verb's guard (slot-constitution.md section 4): `true` runs the constitution checks whose
 * rules.json `guard` lists the write's verb with the installed defaults; an object passes the
 * context options (tests substitute history, skill hashes and the registry).
 */
export type WriteGuard = true | GuardOptions;
/** Why a guarded write was refused: the guard rows' `<check> <reason> (<path>)` lines. */
export class GuardRefusal extends Error {
  // Plain fields, not parameter properties: this module also loads under Node's strip-only TypeScript.
  readonly verb: GuardVerb;
  readonly findings: readonly string[];
  readonly checks: readonly string[];
  constructor(verb: GuardVerb, findings: readonly string[], checks: readonly string[]) {
    super(`${verb} refused by the constitution guard: ${findings.slice(0, 8).join("; ")}${findings.length > 8 ? ` (+${findings.length - 8} more)` : ""}`);
    this.name = "GuardRefusal";
    this.verb = verb;
    this.findings = findings;
    this.checks = checks;
  }
}
const workspaceOf = (consumer: string) => dirname(resolve(consumer));
const recordPath = (consumer: string, dir: string, file: string) => relative(workspaceOf(consumer), join(dir, file)).split(sep).join("/");
/** Run `verb`'s guard over the tree as the write left it; throw GuardRefusal on any row about `targets`. */
/**
 * The guard's runner, registered by constitution/guard.ts when it loads. The writer holds no value
 * import of the rule registry, so it loads alone (Node's strip-only TypeScript, child writers); a
 * guarded write with no runner loaded is refused, never let through.
 */
export interface GuardRunner {
  readonly run: (consumer: string, verb: GuardVerb, targets: readonly GuardTarget[], options: GuardOptions) => Row[];
  readonly messages: (rows: readonly Row[]) => string[];
}
let guardRunner: GuardRunner | undefined;
export function registerGuardRunner(runner: GuardRunner): void { guardRunner = runner; }
function enforceGuard(consumer: string, verb: GuardVerb, guard: WriteGuard, targets: readonly GuardTarget[]): void {
  if (!guardRunner) throw new GuardRefusal(verb, ["the constitution guard is not loaded (import constitution/guard.js before a guarded write)"], ["guard.unloaded"]);
  const options: GuardOptions = guard === true ? {} : guard;
  forgetSlotReads();
  const rows = guardRunner.run(resolve(consumer), verb, targets, { root: workspaceOf(consumer), ...options });
  if (rows.length) throw new GuardRefusal(verb, guardRunner.messages(rows), [...new Set(rows.map(row => row.check))]);
}
const GUARDED_CANDIDATE_VERBS: readonly GuardVerb[] = ["submit", "reissue", "migrate", "critique"];

/** One decision write per slot at a time. */
export const SLOT_LOCK = ".slot-write.lock";
const slotLocked = <T>(dir: string, action: () => T): T => withDirLock(join(dir, SLOT_LOCK), "Slot is unavailable or another decision write is in progress", action);

function located(consumer: string, agent: ModelAgent, id: string) {
  const doc = readSlot(consumer, agent, id);
  const entry = listSlots(consumer, agent).find(row => row.id === id);
  if (!entry) throw new Error(`${agent} slot ${id} is not in ia.json`);
  return { doc, entry };
}
/**
 * `located` for one slot only: reads this slot's folder and never a sibling's, so a candidate submit (`next --submit`,
 * a release manifest) is not refused by a sibling slot the model reader cannot read; that sibling fails on its own read.
 */
function locatedOne(consumer: string, agent: ModelAgent, id: string) {
  const doc = readSlot(consumer, agent, id);
  const entry = readSlotEntry(consumer, agent, id);
  if (!entry) throw new Error(`${agent} slot ${id} is not in ia.json`);
  return { doc, entry };
}

/** Refuse a candidate directory reached through an alias, or one that leaves its canonical path. */
function canonicalDirectory(directory: string): void {
  for (let cursor = resolve(directory); ; cursor = dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("candidate refused: symbolic link in candidate path"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (dirname(cursor) === cursor) break;
  }
}

/** A slot's retired candidates: files under `<slot>/retired/` (constitution R08.1 counts them). */
const RETIRED_CANDIDATES = "retired";
/**
 * `clossys render --draft`: a temporary copy of the consumer's records (its top-level files and every
 * agent's tree, since a Designer element's dependency pins reach Director and Writer slots) with `item`
 * written as `<agent>/<slot>`'s candidate `candidate`. `use` runs on the copy's consumer root; the copy
 * is removed afterwards. The consumer's own records are never written (R11.1: the one writer owns this).
 */
export async function withDraftOverlay<T>(consumer: string, agent: ModelAgent, slot: string, candidate: string, item: unknown, use: (copy: string) => Promise<T>): Promise<T> {
  const overlay = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "clossys-render-draft-")));
  try {
    const copy = join(overlay, "clossys");
    for (const name of readdirSync(consumer)) if (statSync(join(consumer, name)).isFile()) cpSync(join(consumer, name), join(copy, name));
    cpSync(join(consumer, "agents"), join(copy, "agents"), { recursive: true });
    const dir = candidatesDir(join(agentDir(copy, agent), slot));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, candidate), jsonBytes(item), { flag: "wx" });
    return await use(copy);
  } finally { rmSync(overlay, { recursive: true, force: true }); }
}
/**
 * The next candidate version of a slot: one above the highest version any of its candidates holds,
 * across every stem and including retired candidates, so a version number is never used twice in a
 * slot (constitution R08.1). A new stem continues the slot's numbering; it never restarts at v1.
 */
export function nextVersion(dir: string, candidates: readonly string[]): number {
  const versions = [...candidates, ...listModelDir(join(dir, RETIRED_CANDIDATES))].flatMap(file => {
    const match = CANDIDATE_NAME.exec(file);
    return match ? [Number(match[2])] : [];
  });
  return Math.max(0, ...versions) + 1;
}

// ---------------------------------------------------------------------------
// The ledger: one event per write, appended under the lock that guards the write.
// ---------------------------------------------------------------------------

/** An action skill (or a plumb action's action.json) as an event records it: its path and the sha256 of the installed file (null when the file is missing; R14.2 reports it). */
export function skillState(path: string): LedgerSkill {
  try { return { path, sha256: createHash("sha256").update(readFileSync(skillFile(path))).digest("hex") }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, sha256: null }; throw error; }
}

/**
 * What a caller may say about who wrote and how; the rest defaults per writer. `skill` is a skill
 * path (hashed from the installed file) or the `{path, sha256}` the caller already verified.
 */
export interface WriteProvenance { readonly verb?: Verb; readonly by?: string; readonly skill?: string | LedgerSkill; readonly model?: string; readonly tier?: string }
function provenance(defaults: { verb: Verb; by: string; skill: string }, given: WriteProvenance = {}): Provenance {
  const skill = given.skill ?? defaults.skill;
  return {
    verb: given.verb ?? defaults.verb,
    by: given.by ?? defaults.by,
    skill: typeof skill === "string" ? skillState(skill) : { path: skill.path, sha256: skill.sha256 },
    model: given.model ?? NONE,
    tier: given.tier ?? NONE,
  };
}
const nowIso = () => new Date().toISOString();
const sha256Of = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
/** A record file's state after a write: the sha256 of its bytes, or null when it is absent. */
function recordState(dir: string, file: RecordFile): LedgerRecordState {
  const path = join(dir, file);
  return { file, sha256: existsSync(path) ? sha256Of(readFileSync(path)) : null };
}
function ledgerEvent(op: string, at: string, who: Provenance, fields: Record<string, unknown>, records?: readonly LedgerRecordState[]): LedgerEvent {
  return { op, at, by: who.by, verb: who.verb, skill: who.skill, model: who.model, tier: who.tier, ...fields, ...(records?.length ? { records } : {}) };
}
/**
 * Append `event` to `<dir>/ledger.json`. The caller holds the lock that guards `dir`. The event is
 * validated first and the existing ledger must read clean: an unreadable ledger is never replaced.
 */
function appendEvent(dir: string, scope: "slot" | "agent", event: LedgerEvent): void {
  const issues = eventIssues(event, scope);
  if (issues.length) throw new Error(`ledger event refused: ${issues.join("; ")}`);
  const doc = readLedger(dir, scope);
  replaceFile(join(dir, LEDGER_FILE), jsonBytes({ schema: LEDGER_SCHEMA, events: [...(doc?.events ?? []), event] }));
  logLedgerEvent(dir, scope, event.op, event.by, (event.records ?? []).map(record => record.file));
}
/** A ledger op as the op of an engine event kind (lowercase, dashes). */
export const engineOp = (op: string) => op.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "") || "event";
/**
 * The engine event of a ledger write (engine.md "Writers"), under the lock that guards `dir`: kind `<scope>.<op>`,
 * subject `<agent>[/<slot>]`, inputs the folder's ledger.json and the record files the event names. A folder outside
 * a workspace (no `<root>/clossys/agents/<agent>`) logs nothing.
 */
function logLedgerEvent(dir: string, scope: "slot" | "agent", op: string, by: string, files: readonly string[]): void {
  const root = engineRootOf(join(dir, LEDGER_FILE));
  if (root === undefined) return;
  const subject = relative(join(root, "clossys", "agents"), dir).split(sep).join("/");
  recordEvent([join(dir, LEDGER_FILE), ...files.map(file => join(dir, file))], { actor: by, kind: `${scope}.${engineOp(op)}`, subject });
}
/** One agent-ledger write at a time. */
const AGENT_LOCK = ".agent-write.lock";
const agentLocked = <T>(consumer: string, agent: ModelAgent, action: () => T): T =>
  withDirLock(join(consumer, "agents", agent, AGENT_LOCK), `The ${agent} agent ledger is unavailable or another write is in progress`, action);
/**
 * One event in the writer's shape (key order op, at, by, verb, skill, model, tier, fields, records),
 * for a deterministic verb that builds a whole ledger (`clossys migrate ledger`).
 */
export function buildLedgerEvent(op: string, at: string, who: Provenance, fields: Record<string, unknown>, records?: readonly LedgerRecordState[]): LedgerEvent {
  return ledgerEvent(op, at, who, fields, records);
}

/** What `writeBackfilledLedger` did (or, as a dry run, would do) with a folder's ledger. */
export type BackfillOutcome = "written" | "unchanged" | "kept";
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/**
 * The ledger backfill's one write (`clossys migrate ledger`): `<dir>/ledger.json` becomes exactly
 * `events`, every one validated first, under the slot (or agent) lock. A ledger holding any event
 * without `backfill` (one a verb appended while it ran) is kept untouched; one already equal to the
 * backfill is unchanged; an unreadable ledger throws and is never replaced. `dryRun` reports the
 * outcome without writing (and without the lock).
 */
export function writeBackfilledLedger(dir: string, scope: "slot" | "agent", events: readonly LedgerEvent[], options: { readonly dryRun?: boolean } = {}): BackfillOutcome {
  for (const [index, event] of events.entries()) {
    const issues = eventIssues(event, scope);
    if (issues.length) throw new Error(`ledger backfill refused: events[${index}]: ${issues.join("; ")}`);
    if (!isRecord(event.backfill)) throw new Error(`ledger backfill refused: events[${index}] names no backfill evidence`);
  }
  const bytes = jsonBytes({ schema: LEDGER_SCHEMA, events });
  const decide = (): BackfillOutcome => {
    const doc = readLedger(dir, scope);
    if (doc && doc.events.some(event => !isRecord(event.backfill))) return "kept";
    const path = join(dir, LEDGER_FILE);
    return existsSync(path) && readFileSync(path, "utf8") === bytes ? "unchanged" : "written";
  };
  if (options.dryRun) return decide();
  const lock = join(dir, scope === "slot" ? SLOT_LOCK : AGENT_LOCK);
  return withDirLock(lock, `The ${scope} ledger in ${dir} is unavailable or another write is in progress`, () => {
    const outcome = decide();
    if (outcome === "written") {
      replaceFile(join(dir, LEDGER_FILE), bytes);
      logLedgerEvent(dir, scope, "backfill", "code:migrate-ledger", []);
    }
    return outcome;
  });
}

/** The retire code of a retire reason (`<code>[: <note>]`). */
function retireCode(reason: string): string {
  const code = reason.split(":")[0]!.trim();
  if (!(RETIRE_EVENT_CODES as readonly string[]).includes(code)) throw new Error(`retire reason ${reason} does not start with a retire code (${RETIRE_EVENT_CODES.join(", ")})`);
  return code;
}

/**
 * The owner answer a retire takes (U7 r4): an entry about this slot, answered with its option `retire`; and (U7 r5,
 * blind2 B1) that option names the retired candidate, or no candidate for a whole-slot retire. Without `candidate` the
 * option's candidate is not judged (the verb's first guard, before the candidate resolves).
 */
export const retireBinding = (agent: string, id: string, candidate?: string | null): { readonly bind: { readonly subject: string; readonly answer: string; readonly candidate?: string | null } } =>
  ({ bind: { subject: `${agent}/${id}`, answer: "retire", ...(candidate !== undefined ? { candidate } : {}) } });

/** The `by` of a ledger event or record: one actor or a list. */
const byOf = (value: unknown): readonly string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const readJson = (file: string): unknown => { try { return JSON.parse(readFileSync(file, "utf8")) as unknown; } catch { return undefined; } };

/**
 * Where an owner answer already retired something on `agent` (U7 r5, blind2 B1: a retire answer is single-use): the
 * retire-candidate and retire-slot ledger events (the agent ledger and every slot ledger, live or under _retired/) that
 * cite `by`, and, with `records`, the retire records (each slot's retired/*.json, ia.json `retired`). Empty for a seat:
 * a seat acts on its own slots as often as it likes.
 */
export function retireAnswerUses(consumer: string, agent: SlotAgent, by: string, options: { readonly records?: boolean } = {}): string[] {
  if (!by.startsWith("owner:")) return [];
  const base = join(consumer, "agents", agent);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const ledger = (dir: string, label: string) => {
    const doc = readJson(join(dir, LEDGER_FILE)) as { events?: unknown } | undefined;
    const events = Array.isArray(doc?.events) ? doc!.events as { op?: unknown; by?: unknown }[] : [];
    for (const event of events) if ((event?.op === "retire-candidate" || event?.op === "retire-slot") && byOf(event.by).includes(by)) out.push(`${label} ledger ${String(event.op)}`);
  };
  ledger(base, `${agent}`);
  if (options.records) {
    const ia = readJson(join(base, "ia.json")) as { retired?: unknown } | undefined;
    for (const row of Array.isArray(ia?.retired) ? ia!.retired as { slot?: unknown; by?: unknown }[] : []) if (byOf(row?.by).includes(by)) out.push(`${agent} ia.json retired ${String(row.slot)}`);
  }
  const slotDirs = (dir: string, prefix: string) => existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith(".")).map(entry => ({ dir: join(dir, entry.name), label: `${prefix}${entry.name}` }))
    : [];
  for (const slot of [...slotDirs(base, `${agent}/`), ...slotDirs(join(base, "_retired"), `${agent}/_retired/`)]) {
    ledger(slot.dir, slot.label);
    if (!options.records) continue;
    const retired = join(slot.dir, "retired");
    if (!existsSync(retired)) continue;
    for (const name of readdirSync(retired).filter(file => file.endsWith(".json")).sort()) {
      const record = readJson(join(retired, name)) as { schema?: unknown; by?: unknown } | undefined;
      if (record?.schema === RETIRE_SCHEMA && byOf(record.by).includes(by)) out.push(`${slot.label}/retired/${name}`);
    }
  }
  return out;
}

/** Throws a SeatRefusal when an owner answer already retired something on `agent` (the writers' half: ledger events). */
function assertRetireAnswerUnused(consumer: string, agent: SlotAgent, by: string): void {
  const uses = retireAnswerUses(consumer, agent, by);
  if (uses.length) throw new SeatRefusal(`retire refused: --by ${by} already retired (${uses.slice(0, 3).join("; ")}); an owner's retire answer is used once`);
}

/**
 * The retire verb's ledger event for one candidate (`clossys retire <agent>/<slot> <candidate>`):
 * `retire-candidate {name, sha256, code}` in the slot ledger, written after the candidate left
 * `candidates/`. The note after the code stays in the retire record.
 */
export function appendRetireCandidate(consumer: string, agent: SlotAgent, id: string, input: { name: string; sha256: string; reason: string; by: string; at: string }, given?: WriteProvenance): LedgerEvent {
  // The total actor guard (records/seat-owner.ts): the slot's own seat or a resolved owner answer, nothing else.
  assertActor(dirname(consumer), input.by, agent, "retire", retireBinding(agent, id, input.name));
  assertRetireAnswerUnused(consumer, agent, input.by);
  const { entry } = located(consumer, agent, id);
  const event = ledgerEvent("retire-candidate", input.at, provenance({ verb: "retire", by: input.by, skill: skillPath("producer", "retire") }, given), { name: input.name, sha256: input.sha256, code: retireCode(input.reason) });
  slotLocked(entry.dir, () => appendEvent(entry.dir, "slot", event));
  return event;
}

/**
 * The retire verb's ledger events for a whole slot (`clossys retire <agent>/<slot> --slot`), written
 * after ia.json no longer places it and before its folder moves: `retire-slot {code}` in the slot's
 * own ledger (when the folder exists), and `retire-slot {slot, code}` with ia.json's new state in
 * the agent ledger.
 */
export function appendRetireSlot(consumer: string, agent: SlotAgent, id: string, input: { reason: string; by: string; at: string }, given?: WriteProvenance): LedgerEvent[] {
  assertActor(dirname(consumer), input.by, agent, "retire", retireBinding(agent, id, null));
  assertRetireAnswerUnused(consumer, agent, input.by);
  const who = provenance({ verb: "retire", by: input.by, skill: skillPath("producer", "retire") }, given);
  const code = retireCode(input.reason);
  const events: LedgerEvent[] = [];
  const dir = join(consumer, "agents", agent, id);
  canonicalDirectory(dir);
  if (existsSync(dir) && lstatSync(dir).isDirectory()) {
    const event = ledgerEvent("retire-slot", input.at, who, { code });
    slotLocked(dir, () => appendEvent(dir, "slot", event));
    events.push(event);
  }
  const base = join(consumer, "agents", agent);
  const event = ledgerEvent("retire-slot", input.at, who, { slot: id, code }, [recordState(base, "ia.json")]);
  agentLocked(consumer, agent, () => appendEvent(base, "agent", event));
  events.push(event);
  return events;
}

/**
 * The `ia` verb's agent-ledger event (`clossys ia`, one per ia.json it writes): `ia` with ia.json's
 * current bytes, written after the file under the agent lock (R14.1). `fields` carries the event's
 * kind and anything else the verb records.
 */
export function appendIaEvent(consumer: string, agent: ModelAgent, input: { by: string; at: string; fields?: Readonly<Record<string, unknown>> }, given?: WriteProvenance): LedgerEvent {
  const base = join(consumer, "agents", agent);
  const event = ledgerEvent("ia", input.at, provenance({ verb: "ia", by: input.by, skill: skillPath("producer", "ia") }, given), { ...input.fields }, [recordState(base, "ia.json")]);
  agentLocked(consumer, agent, () => appendEvent(base, "agent", event));
  return event;
}

/**
 * A `slot` event recording slot.json's current bytes, for a verb that rewrote slot.json as part of
 * an agent-level change (retire --slot renumbers the positions of the slots after the retired one).
 */
export function appendSlotDocEvent(consumer: string, agent: ModelAgent, id: string, input: { by: string; at: string; verb: Verb; skill: string; fields?: Readonly<Record<string, unknown>> }, given?: WriteProvenance): LedgerEvent {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    const event = ledgerEvent("slot", input.at, provenance({ verb: input.verb, by: input.by, skill: input.skill }, given), { ...input.fields }, [recordState(entry.dir, "slot.json")]);
    appendEvent(entry.dir, "slot", event);
    return event;
  });
}

/**
 * `clossys ia sync`'s one slot.json write (R14.1): the synced clossys.slot/2 doc's canonical bytes at
 * `<consumer>/agents/<agent>/<id>/slot.json` and one `slot` event (verb ia, by producer) recording them,
 * together under the slot lock. The slot need not be placed in an ia.json (sync is what creates it). The
 * event is validated and the ledger read before slot.json is replaced, so a refused event writes nothing.
 * False, with no write and no event, when the bytes are already there.
 */
export function writeSyncedSlot(consumer: string, agent: AgentId, id: string, slot: Slot, input: { readonly at: string; readonly fields?: Readonly<Record<string, unknown>> }, given?: WriteProvenance): boolean {
  const dir = join(consumer, "agents", agent, id);
  const file = slotFile(dir);
  const issues = validateSlot(slot);
  if (issues.length) throw new SlotFormatError(file, issues);
  canonicalDirectory(dir);
  const bytes = serializeSlot(slot);
  if (existsSync(file) && readFileSync(file, "utf8") === bytes) return false;
  mkdirSync(dir, { recursive: true });
  return slotLocked(dir, () => {
    if (existsSync(file) && readFileSync(file, "utf8") === bytes) return false;
    const who = provenance({ verb: "ia", by: "producer", skill: skillPath("producer", "ia") }, given);
    const event = ledgerEvent("slot", input.at, who, { ...input.fields }, [{ file: "slot.json", sha256: sha256Of(bytes) }]);
    const refused = eventIssues(event, "slot");
    if (refused.length) throw new Error(`ledger event refused: ${refused.join("; ")}`);
    readLedger(dir, "slot");
    replaceFile(file, bytes);
    appendEvent(dir, "slot", event);
    return true;
  });
}

// ---------------------------------------------------------------------------
// P2 craft (section 5b): stage events and critique records.
// ---------------------------------------------------------------------------

/** The P2 craft stages, in order (section 5b). */
export const CRAFT_STAGES = ["brief", "diverge", "render", "critique", "refine"] as const;
export type CraftStage = (typeof CRAFT_STAGES)[number];
/** Every prefix of section 5b's order: brief, diverge, render, critique, then at most 2 refine rounds (each re-rendered and re-checked). */
const CRAFT_PREFIX = /^(?:brief(?: diverge(?: render(?: critique(?: refine(?: render)?(?: critique)?){0,2})?)?)?)?$/;
/** The most directions a diverge may carry (section 5b: 3, cap 4). */
export const CRAFT_DIRECTIONS = { min: 3, max: 4 } as const;
/** The craft stages of the slot's open P2 run: the `craft:*` events since its last submit. */
export function openCraftStages(events: readonly Record<string, unknown>[]): CraftStage[] {
  return openCraftEvents(events).map(event => String(event.op).slice("craft:".length) as CraftStage);
}
/** Why `stage` may not come next after `open`, or undefined. */
export function craftOrderIssue(open: readonly CraftStage[], stage: CraftStage, fields: Readonly<Record<string, unknown>> = {}, context: { readonly axes?: readonly string[] } = {}): string | undefined {
  const sequence = [...open, stage].join(" ");
  if (!CRAFT_PREFIX.test(sequence)) {
    const refines = open.filter(each => each === "refine").length;
    if (stage === "refine" && refines >= 2) return `craft:refine refused: at most 2 refine rounds (section 5b); this run has ${refines}`;
    return `craft:${stage} refused: after ${open.length ? open.join(", ") : "nothing"} the next stage is not ${stage} (order brief, diverge, render, critique, then at most 2 refine rounds)`;
  }
  if (stage === "diverge") {
    const directions = Array.isArray(fields.directions) ? fields.directions : [];
    if (directions.length < CRAFT_DIRECTIONS.min || directions.length > CRAFT_DIRECTIONS.max) return `craft:diverge refused: ${directions.length} directions; ${CRAFT_DIRECTIONS.min} to ${CRAFT_DIRECTIONS.max} required (cap ${CRAFT_DIRECTIONS.max})`;
    for (const [index, direction] of directions.entries()) {
      if (!isRecord(direction) || !isRecord(direction.axes) || !Object.keys(direction.axes).length) return `craft:diverge refused: direction ${index + 1} carries no axes`;
    }
    return axesIssue(directions as readonly { axes: Record<string, unknown> }[], context.axes);
  }
  return undefined;
}
/**
 * Section 5b stage 2, R15.7 at write time: every direction carries a value on every axis (the brief's
 * recipe axes, else every axis any direction names; an absent, undefined or empty-string value is no
 * value) and no two directions share a value on any axis, so a cosmetic variant fails at diverge, not
 * at critique. Values compare by canonical JSON.
 */
function axesIssue(directions: readonly { readonly axes: Readonly<Record<string, unknown>> }[], recipeAxes?: readonly string[]): string | undefined {
  const axes = recipeAxes?.length ? [...recipeAxes] : [...new Set(directions.flatMap(direction => Object.keys(direction.axes)))].sort();
  for (const axis of axes) {
    const seen = new Map<string, number>();
    for (const [index, direction] of directions.entries()) {
      if (!Object.hasOwn(direction.axes, axis) || direction.axes[axis] === undefined || direction.axes[axis] === "") return `craft:diverge refused: direction ${index + 1} has no value on axis ${axis}; fix: give every direction a value on every axis${recipeAxes?.length ? ` (the recipe's axes: ${recipeAxes.join(", ")})` : ""} (R15.7)`;
      const value = JSON.stringify(direction.axes[axis]);
      const twin = seen.get(value);
      if (twin !== undefined) return `craft:diverge refused: directions ${twin + 1} and ${index + 1} share ${axis} ${value}; fix: make every direction's value distinct on every axis, so no direction is a cosmetic variant (R15.7)`;
      seen.set(value, index);
    }
  }
  return undefined;
}
/** The open P2 run's craft events: the `craft:*` events since the slot's last submit. */
export function openCraftEvents(events: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const open: Record<string, unknown>[] = [];
  for (const event of events) {
    if (event.op === "submit") open.length = 0;
    else if (typeof event.op === "string" && event.op.startsWith("craft:")) open.push(event);
  }
  return open;
}
/**
 * R15.5 and R15.7 at write time: why a `craft:<stage>` event with `fields` may not join the open run, or undefined.
 * With the slot's `standardId` ("" when it names none) code chooses the run's recipe (the standard's one producing
 * recipe): an event naming another recipe, an unknown one or one not producing the standard is refused
 * (records/recipes.ts craftRunRecipeIssues, the judge's own predicate). Then any stage under a plumb recipe is refused
 * (plumbCraftRunIssue). The recipes are read from the workspace that holds `consumer` (its packages/, else the
 * installed agent packages).
 */
export function plumbCraftRefusal(consumer: string, agent: string, events: readonly Record<string, unknown>[], stage: CraftStage, fields: Readonly<Record<string, unknown>> = {}, standardId?: string): string | undefined {
  const run = [...openCraftEvents(events), { ...fields, op: `craft:${stage}` }];
  const recipes = loadRecipes(dirname(consumer));
  if (standardId !== undefined) {
    const issues = craftRunRecipeIssues(run, recipes, agent, standardId);
    if (issues.length) return `craft:${stage} refused: ${issues.join("; ")}; fix: craft under the recipe code chooses for the slot's standard, naming no other (R15.5)`;
  }
  const issue = plumbCraftRunIssue(run, recipes, agent, standardId);
  return issue && `craft:${stage} refused: ${issue}; fix: run the recipe's clossys verbs and submit at rung plumb, recording no craft stage (R15.7)`;
}
/** The standard a slot names (slot.json `standard`), "" when it names none: the input code chooses a craft run's recipe from. */
const slotStandard = (doc: unknown): string => (isRecord(doc) && typeof doc.standard === "string" ? doc.standard : "");
/** The recipe axes the open run's brief recorded (`assembled.recipe.axes`), if any. */
export function openBriefAxes(events: readonly Record<string, unknown>[]): readonly string[] | undefined {
  let axes: readonly string[] | undefined;
  for (const event of events) {
    if (event.op === "submit") axes = undefined;
    else if (event.op === "craft:brief") {
      const recipe = isRecord(event.assembled) && isRecord(event.assembled.recipe) ? event.assembled.recipe : undefined;
      axes = recipe && Array.isArray(recipe.axes) ? recipe.axes.filter((axis): axis is string => typeof axis === "string") : undefined;
    }
  }
  return axes;
}
/**
 * Append one `craft:<stage>` event to the slot ledger under the slot lock, refusing any stage under a plumb
 * recipe (R15.7, plumbCraftRefusal), a stage out of order, a diverge outside 3-4 directions or one whose directions share an axis value. `fields` are the stage's own record (directions,
 * recipe, renders); verb submit, by the seat, with the step's skill, model and tier.
 */
export function appendCraftEvent(consumer: string, agent: ModelAgent, id: string, stage: CraftStage, fields: Readonly<Record<string, unknown>>, given: WriteProvenance & { readonly at?: string }): LedgerEvent {
  const { doc, entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    // The actor is judged first (a foreign seat is a SeatRefusal whatever the stage's content), then the run's recipe.
    const who = provenance({ verb: "submit", by: "planner", skill: agent === SEAT_AGENT ? skillPath("producer", "seats") : skillPath(agent, `${agent}.candidates`) }, given);
    assertActor(dirname(consumer), who.by, agent, "craft", authorsOf(agent));
    const events = (readLedger(entry.dir, "slot")?.events ?? []) as unknown as Record<string, unknown>[];
    const plumb = plumbCraftRefusal(consumer, agent, events, stage, fields, slotStandard(doc));
    if (plumb) throw new Error(plumb);
    const issue = craftOrderIssue(openCraftStages(events), stage, fields, { axes: openBriefAxes(events) });
    if (issue) throw new Error(issue);
    const { op: _op, at: _at, by: _by, verb: _verb, skill: _skill, model: _model, tier: _tier, records: _records, ...own } = fields as Record<string, unknown>;
    const event = ledgerEvent(`craft:${stage}`, given.at ?? nowIso(), who, own);
    appendEvent(entry.dir, "slot", event);
    return event;
  });
}
/**
 * Who authors candidates, critiques and craft stages besides the slot's own seat (and a resolved owner answer): the
 * owner and the planner (`clossys next --basis owner|planner`). Any other seat, `agent:judge` or free text is refused
 * (foundry-build-0048 U7 r3, defence in depth: today's callers pass the slot's own seat).
 */
const AUTHORS = { also: ["owner", "planner"] } as const;
/**
 * The authors of a slot of `agent`: AUTHORS, plus, on a Producer seat slot, the seats step's own seat (`agent:seats`,
 * the `clossys next` seat of the step that crafts seat slots), which is the Producer's seat for its seat slots.
 */
const authorsOf = (agent: string): { readonly also: readonly string[] } => (agent === SEAT_AGENT ? { also: [...AUTHORS.also, "agent:seats"] } : AUTHORS);
/** A slot's critique records (`critiques/<leaf>-v<n>.json`, section 5b stage 4): records/critique-record.ts. */
export { CRITIQUES_DIR };
/**
 * Write a critique record for the candidate the open P2 run will submit (`<leaf>-v<next>.json`
 * unless `candidate` names one) and append its `craft:critique` event (verb critique), refused
 * when the critique stage may not come next or the record exists. `validate` is the record's schema check.
 */
export function writeCritique(consumer: string, agent: ModelAgent, id: string, record: unknown, input: { readonly candidate?: string; readonly at?: string; readonly validate: (value: unknown) => readonly string[] }, given: WriteProvenance): { file: string; event: LedgerEvent } {
  assertActor(dirname(consumer), given.by ?? "planner", agent, "critique", authorsOf(agent));
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    const current = located(consumer, agent, id);
    const { entry: currentEntry } = current;
    const issues = input.validate(record);
    if (issues.length) throw new Error(`critique refused: ${issues.slice(0, 5).join("; ")}`);
    const events = (readLedger(entry.dir, "slot")?.events ?? []) as unknown as Record<string, unknown>[];
    const plumb = plumbCraftRefusal(consumer, agent, events, "critique", {}, slotStandard(current.doc));
    if (plumb) throw new Error(plumb);
    const order = craftOrderIssue(openCraftStages(events), "critique");
    if (order) throw new Error(order);
    const leaf = id.split(".").at(-1)!;
    const name = input.candidate ? input.candidate.replace(/\.[^.]+$/, "") : `${leaf}-v${nextVersion(currentEntry.dir, currentEntry.candidates)}`;
    if (!CANDIDATE_NAME.test(`${name}.json`)) throw new Error(`critique refused: ${name} is not a <leaf>-v<n> candidate name`);
    const directory = join(entry.dir, CRITIQUES_DIR);
    canonicalDirectory(directory);
    mkdirSync(directory, { recursive: true });
    const file = `${name}.json`;
    const path = join(directory, file);
    writeFileSync(path, jsonBytes(record), { flag: "wx" });
    forgetSlotReads();
    try {
      const event = ledgerEvent("craft:critique", input.at ?? nowIso(), provenance({ verb: "critique", by: "planner", skill: skillPath("producer", "critic") }, given), { critique: `${CRITIQUES_DIR}/${file}`, sha256: sha256Of(readFileSync(path)) });
      appendEvent(entry.dir, "slot", event);
      return { file: `${CRITIQUES_DIR}/${file}`, event };
    } catch (error) { unlinkSync(path); forgetSlotReads(); throw error; }
  });
}

/**
 * The bytes `writeCandidate` writes (one format, U13 r4). A clossys.slot/1 slot takes the int2 bytes as they are,
 * judged by the int2 kind rules. A clossys.slot/2 slot takes a clossys.candidate/1 file only: int2 bytes are first
 * judged by the int2 kind rules as they are (a missing source is refused, never derived), then written through the
 * one candidate codec, the source moved into a header created by `clossys submit` (or by `createdBy`: `clossys next
 * --submit` names the submitting agent, skill, model and tier, U37); bytes that already carry a
 * header must name this file and slot. The written bytes are then judged by the reader's rules (candidateIssues).
 * Every refusal of the bytes is a CandidateRefusal (records/candidate.ts), the codec's and the serializer's included;
 * any other error is a fault and is not one.
 */
export function submittedBytes(dir: string, agent: SlotAgent, id: string, kind: SlotDoc["kind"], file: string, given: string, at: string | undefined, createdBy?: Actor): string {
  const refused = (issues: readonly { message: string }[] | readonly string[]) => new CandidateRefusal(`candidate refused: ${issues.map(issue => typeof issue === "string" ? issue : issue.message).join("; ")}`);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(slotFile(dir), "utf8")); } catch { raw = undefined; }
  const slotRead = isCurrentSlot(raw) ? readSlotValue(raw, slotFile(dir)) : undefined;
  if (!slotRead?.current) {
    const issues = validateCandidate(kind, id, file, given);
    if (issues.length) throw refused(issues);
    return given;
  }
  const expect = { agent: agent as AgentId, slotId: id as Slot["id"] };
  let bytes = given;
  if (candidateHeaderOf(file, given)) {
    const header = candidateHeaderIssues(file, given, expect);
    if (header.length) throw refused(header);
  } else {
    const int2 = validateCandidate(kind, id, file, given);
    if (int2.length) throw refused(int2);
    const createdAt = (toIsoZ(at ?? nowIso()) ?? at ?? nowIso()) as Iso;
    bytes = recutCandidateBytes(file, given, { agent: agent as AgentId, slotId: id, at: createdAt, version: cliActor(SUBMIT_CLI).version, sourceRef: `agents/${agent}/${id}/candidates/${file}`, cli: SUBMIT_CLI, ...(createdBy ? { createdBy } : {}) });
  }
  const issues = candidateIssues(slotRead, agent, id, file, bytes);
  if (issues.length) throw refused(issues);
  return bytes;
}

/** The command a candidate header written by submit names as its creator. */
const SUBMIT_CLI = "clossys submit";

/**
 * Write `<name>-v<next>` (`<next>` the slot's `nextVersion`) into the slot's candidates and append its `submit {name, sha256}` event.
 * JSON kinds take the item object (serialized as two-space JSON); Markdown kinds take the file text.
 * Invalid candidates are refused. `canonical` also refuses aliased candidate paths (no ancestor may
 * be a symbolic link). The version is chosen, the file written, `verify` run and the event appended
 * under the slot lock, so two writers never take one version and the ledger names every file; a
 * `verify` issue (or a refused event) removes the file again. `fields` are the submit's own record
 * (`next --submit`: its basis and ladder); `provenance` its verb, by, skill, model and tier.
 * `header` (U37) names who a clossys.candidate/1 header this write creates names as `createdBy` (`submittedBytes`:
 * on a clossys.slot/2 slot only); without it the header names `clossys submit`.
 */
export function writeCandidate(consumer: string, agent: SlotAgent, id: string, name: string, content: unknown, options: {
  readonly canonical?: boolean; readonly provenance?: WriteProvenance; readonly at?: string;
  readonly fields?: Readonly<Record<string, unknown>>; readonly verify?: (file: string) => readonly string[];
  /** Run the write verb's constitution guard on the new file after its event lands; a finding undoes both. */
  readonly guard?: WriteGuard;
  readonly header?: { readonly createdBy: Actor };
} = {}): { name: string; sha256: string } {
  const by = options.provenance?.by ?? "planner";
  // code:adopt authors only the stock item of a byte-exact adopt slot (records/code-adopt.ts); every other author is a seat.
  if (by === CODE_ADOPT) {
    const why = codeAdoptRefusal(dirname(consumer), agent, id, content, options.fields);
    if (why !== undefined) throw new SeatRefusal(`candidate refused: --by ${CODE_ADOPT}: ${why}`);
  } else assertActor(dirname(consumer), by, agent, "candidate", authorsOf(agent));
  const { entry } = locatedOne(consumer, agent, id);
  if (options.canonical) canonicalDirectory(entry.dir);
  return slotLocked(entry.dir, () => {
    const { doc, entry: current } = locatedOne(consumer, agent, id);
    const ext = KIND_EXT[doc.kind];
    const file = `${name}-v${nextVersion(current.dir, current.candidates)}.${ext}`;
    const at = options.at ?? nowIso();
    const bytes = submittedBytes(entry.dir, agent, id, doc.kind, file, ext === "md" ? String(content) : jsonBytes(content), at, options.header?.createdBy);
    readLedger(entry.dir, "slot"); // an unreadable ledger refuses before anything is written
    const directory = candidatesDir(entry.dir);
    if (options.canonical) canonicalDirectory(directory);
    mkdirSync(directory, { recursive: true });
    if (options.canonical && realpathSync(directory) !== resolve(directory)) throw new Error("candidate refused: candidate directory leaves its canonical path");
    const path = join(directory, file);
    const who = provenance({ verb: "submit", by: "planner", skill: skillPath(agent, `${agent}.candidates`) }, options.provenance);
    const guardVerb = who.verb as GuardVerb;
    if (options.guard && !GUARDED_CANDIDATE_VERBS.includes(guardVerb)) throw new Error(`candidate refused: verb ${who.verb} has no candidate guard (${GUARDED_CANDIDATE_VERBS.join(", ")})`);
    const ledger = snapshotFiles([join(entry.dir, LEDGER_FILE)]);
    writeFileSync(path, bytes, { flag: "wx" });
    forgetSlotReads();
    try {
      const sha256 = readCandidate(consumer, agent, id, file).sha256;
      const refused = options.verify?.(file) ?? [];
      if (refused.length) throw new Error(`candidate refused: ${file} fails the slot model check: ${refused.slice(0, 5).join("; ")}`);
      appendEvent(entry.dir, "slot", ledgerEvent("submit", at, who, { ...options.fields, name: file, sha256 }));
      if (options.guard) {
        try { enforceGuard(consumer, guardVerb, options.guard, [{ agent, slot: id, candidate: file }]); }
        catch (error) { restoreFiles(ledger); throw error; }
      }
      return { name: file, sha256 };
    } catch (error) { unlinkSync(path); forgetSlotReads(); throw error; }
  });
}

/**
 * Submit one candidate file whose bytes the caller built and judged (an agent's own loop candidate, `clossys loop`,
 * U9a): the kind has no `KIND_EXT` and is certified by its own certifier at the pin gate, so this writer checks only
 * the file name and the slot ledger. Writes `<slot>/candidates/<name>` (never over an existing file) and appends its
 * `submit` event with the sha256 of the bytes written, under the slot's write lock; a failed append removes the file.
 */
export function writeCandidateBytes(consumer: string, agent: SlotAgent, id: string, name: string, bytes: string, input: { readonly at: string; readonly fields?: Readonly<Record<string, unknown>> }, given?: WriteProvenance): { name: string; sha256: string } {
  if (!CANDIDATE_FILE.test(name)) throw new Error(`candidate refused: ${name} is not a candidate file name (<name>-v<n>.json)`);
  const { entry } = locatedOne(consumer, agent, id);
  canonicalDirectory(entry.dir);
  return slotLocked(entry.dir, () => {
    readLedger(entry.dir, "slot"); // an unreadable ledger refuses before anything is written
    const directory = candidatesDir(entry.dir);
    canonicalDirectory(directory);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, name);
    const who = provenance({ verb: "submit", by: "planner", skill: skillPath(agent, `${agent}.candidates`) }, given);
    writeFileSync(path, bytes, { flag: "wx" });
    forgetSlotReads();
    try {
      const sha256 = sha256Of(readFileSync(path));
      appendEvent(entry.dir, "slot", ledgerEvent("submit", input.at, who, { ...input.fields, name, sha256 }));
      return { name, sha256 };
    } catch (error) { unlinkSync(path); forgetSlotReads(); throw error; }
  });
}
const CANDIDATE_FILE = /^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.json$/;

/**
 * The one CHOOSE choke point (foundry-build-0048 U3): a `clossys.slot/2` slot is pinned only through the pin
 * gate (`clossys pin`, constitution/pin-gate.ts: a submitted, certified candidate, a ranked scorecard the pin
 * cites, a clossys.pin/2 record). Every slot/1 pin writer here (writePin for pin, approve and pick, a verdict
 * pick, a confirmation, a reissue's repin) refuses such a slot and names the gated verb, so no verb writes a
 * pin/1 a later recut could turn into a valid pin.
 */
export function refuseTargetPin(dir: string, agent: string, id: string, verb: string): void {
  let value: unknown;
  try { value = JSON.parse(readFileSync(slotFile(dir), "utf8")); } catch { return; }
  if (isCurrentSlot(value)) throw new Error(`${verb} refused: ${agent}/${id} is a clossys.slot/2 slot, pinned only through the CHOOSE gate (a submitted candidate with a passing verdict and a scorecard): clossys pin ${agent}/${id} <candidate> --by owner:queue.<kind>#<id> | planner[:<ref>] | agent:${agent}`);
}

/**
 * Pin one existing, valid candidate. `decidedBy` names who decided (owner or planner, optionally
 * `:<message ref>`, `agent:<seat>`, or `migrated`); `basis` how (PIN_BASES). A `notNeeded` marker on
 * the slot is cleared: the pin replaces it.
 */
export function writePin(consumer: string, agent: SlotAgent, id: string, candidate: string, input: { decidedBy: string; basis: PinBasis; at: string }, given?: WriteProvenance, options: {
  /** Run the pin's constitution guard (verb pick for basis agent, else pin) after the event lands; a finding restores pin.json, slot.json and the ledger. */
  readonly guard?: WriteGuard;
  /** Extra fields for the pin event (`reissue: true` on a reissue's repin); pin.json itself never carries them. */
  readonly fields?: Readonly<Record<string, unknown>>;
} = {}): PinDoc {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => pinUnderLock(consumer, agent, id, candidate, input, given, options));
}
/** writePin's body; the caller holds the slot lock (writePin, or writeVerdict for a pick). */
function pinUnderLock(consumer: string, agent: SlotAgent, id: string, candidate: string, input: { decidedBy: string; basis: PinBasis; at: string }, given: WriteProvenance | undefined, options: { readonly guard?: WriteGuard; readonly fields?: Readonly<Record<string, unknown>> }): PinDoc {
  // The shared seat guard (records/seat-owner.ts): an agent seat pins (picks) only its own agent's slots.
  assertSeat(input.decidedBy, agent, input.basis === "agent" ? "pick" : "pin");
  const { doc, entry } = located(consumer, agent, id);
  refuseTargetPin(entry.dir, agent, id, "pin"); // the choke point: every pin/1 writer (pin, pick, approve, verdict pick) passes here
  if (!entry.candidates.includes(candidate)) throw new Error(`${agent} slot ${id} has no candidate ${candidate}`);
  const read = readCandidate(consumer, agent, id, candidate);
  const issues = validateCandidate(doc.kind, id, candidate, read.bytes);
  if (issues.length) throw new Error(`pin refused: ${issues.map(issue => issue.message).join("; ")}`);
  const pin: PinDoc = { candidate, sha256: read.sha256, decidedBy: input.decidedBy, basis: input.basis, at: input.at };
  const pinIssues = validatePin(pin);
  if (pinIssues.length) throw new Error(`pin refused: ${pinIssues.map(issue => issue.message).join("; ")}`);
  // The pin lands first: an interruption leaves a pinned slot still marked notNeeded, which the
  // slot check reports, never a slot whose notNeeded was cleared with no pin to replace it.
  // An agent pick runs `pick.<agent>` (verb pick); every other pin runs the Producer's `pin.<agent>`.
  const pick = input.basis === "agent";
  const who = provenance(pick
    ? { verb: "pick", by: input.decidedBy, skill: skillPath(agent, `pick.${agent}`) }
    : { verb: "pin", by: input.decidedBy, skill: skillPath("producer", `pin.${agent}`) }, given);
  readLedger(entry.dir, "slot"); // an unreadable ledger refuses before anything is written
  const before = snapshotFiles([pinFile(entry.dir), slotFile(entry.dir), join(entry.dir, LEDGER_FILE)]);
  try {
    replaceFile(pinFile(entry.dir), jsonBytes(pin));
    const records = [recordState(entry.dir, "pin.json")];
    if (doc.notNeeded) {
      const { notNeeded: _cleared, ...rest } = doc;
      replaceFile(slotFile(entry.dir), jsonBytes(rest));
      records.push(recordState(entry.dir, "slot.json"));
    }
    appendEvent(entry.dir, "slot", ledgerEvent(pick ? "pick" : "pin", input.at, who, { candidate, sha256: pin.sha256, decidedBy: pin.decidedBy, basis: pin.basis, ...options.fields }, records));
    if (options.guard) enforceGuard(consumer, pick ? "pick" : "pin", options.guard, [{ agent, slot: id, candidate, records: [recordPath(consumer, entry.dir, "pin.json"), recordPath(consumer, entry.dir, "slot.json")] }]);
  } catch (error) { if (options.guard) restoreFiles(before); throw error; }
  return pin;
}

/** The slot folder's slot.json as parsed JSON, or undefined when it is missing or does not parse. */
function readSlotJson(dir: string): unknown {
  try { return JSON.parse(readFileSync(slotFile(dir), "utf8")); } catch { return undefined; }
}

/** A P1 verdict as `clossys verdict --record` validated it (verdict.schema.json plus the slot's standard). */
export type VerdictInput =
  | { readonly verdict: "pick"; readonly pick: string; readonly reason: string; readonly criteria: readonly string[] }
  | { readonly verdict: "create"; readonly reason: string; readonly gaps: readonly { readonly id: string; readonly class?: string }[] };
/**
 * Append a P1 `verdict` event (section 5, P1.4) to the slot ledger under the slot lock, verb verdict
 * with the Producer's `actions/verdict/skill.md`. The event carries the latest `options` event's
 * inputsHash (refused when `inputsHash` is given and differs). A pick names an existing candidate by
 * its sha256 and is pinned in the same lock with basis agent (a `pick` event after the verdict). A
 * create (`create: true`) routes the slot to P2. `guard` runs the verdict guard on the ledger, then
 * the pick guard on the pin; any finding restores ledger.json, pin.json and slot.json.
 */
export function writeVerdict(consumer: string, agent: ModelAgent, id: string, verdict: VerdictInput, input: { readonly by: string; readonly at: string; readonly inputsHash?: string }, given: WriteProvenance, options: { readonly guard?: WriteGuard } = {}): { event: LedgerEvent; pin?: PinDoc } {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    assertSeat(input.by, agent, "verdict"); // a verdict (pick or create) is a decision on the slot: its own agent's seat only
    const { entry: current } = located(consumer, agent, id);
    const events = (readLedger(current.dir, "slot")?.events ?? []) as unknown as Record<string, unknown>[];
    const latest = [...events].reverse().find(event => event.op === "options")?.inputsHash;
    const inputsHash = typeof latest === "string" ? latest : undefined;
    if (input.inputsHash !== undefined && input.inputsHash !== inputsHash) throw new Error(`verdict refused: the record is for inputsHash ${input.inputsHash}, not the latest options packet's ${inputsHash ?? "none"}; re-run clossys options`);
    let fields: Record<string, unknown>;
    if (verdict.verdict === "pick") {
      // One format (U13): a verdict pick on a clossys.slot/1 slot would write a pin/1; it is refused before anything
      // is written (a slot/2 pick moves only through the CHOOSE gate: refuseTargetPin).
      if (!isCurrentSlot(readSlotJson(current.dir))) throw new Error(oldSlotRefusal("verdict", `${agent}/${id}`));
      refuseTargetPin(current.dir, agent, id, "verdict");
      if (agent === SEAT_AGENT) throw new Error(`verdict refused: a Producer seat is pinned by clossys seat ${id.slice("seat.".length)}, not by a verdict pick`);
      if (!current.candidates.includes(verdict.pick)) throw new Error(`verdict refused: ${agent} slot ${id} has no candidate ${verdict.pick}`);
      fields = { verdict: "pick", pick: verdict.pick, sha256: readCandidate(consumer, agent, id, verdict.pick).sha256, reason: verdict.reason, criteria: [...verdict.criteria] };
    } else fields = { verdict: "create", create: true, reason: verdict.reason, gaps: verdict.gaps.map(gap => ({ ...gap })) };
    if (inputsHash !== undefined) fields.inputsHash = inputsHash;
    const event = ledgerEvent("verdict", input.at, provenance({ verb: "verdict", by: input.by, skill: skillPath("producer", "verdict") }, given), fields);
    const before = snapshotFiles([pinFile(current.dir), slotFile(current.dir), join(current.dir, LEDGER_FILE)]);
    try {
      appendEvent(current.dir, "slot", event);
      if (options.guard) enforceGuard(consumer, "verdict", options.guard, [{ agent, slot: id, records: [recordPath(consumer, current.dir, LEDGER_FILE)] }]);
      if (verdict.verdict !== "pick") return { event };
      const pin = pinUnderLock(consumer, agent as SlotAgent, id, verdict.pick, { decidedBy: input.by, basis: "agent", at: input.at }, undefined, options.guard ? { guard: options.guard } : {});
      return { event, pin };
    } catch (error) { restoreFiles(before); throw error; }
  });
}

/** A retire record's schema (`retired/<candidate>.json`, constitution/schemas/retire.schema.json). */
export const RETIRE_SCHEMA = "clossys.retire/1";

/** What `clossys reissue` hands the writer: the old candidate, its reissued content and the ladder record. */
export interface ReissueInput {
  /** The old candidate's file name, and the sha256 the caller transformed (a changed file refuses). */
  readonly old: string;
  readonly oldSha256: string;
  /** The next version's content: a JSON value for a JSON kind, text for an md kind. */
  readonly content: unknown;
  /** slot.json `uses` after the reissue (its registryDependencies moved here); undefined keeps it. */
  readonly uses?: readonly string[];
  /** The ladder rung the submit records (adopt; the Designer's L1 or L2). */
  readonly rung: string;
  readonly by: string;
  readonly at: string;
  /** A Markdown candidate's own front matter fields beside its clossys header, kept on the next version. */
  readonly front?: Readonly<Record<string, unknown>>;
  /** The old candidate's header when its file carries none (a candidate submitted before headers: the recut mapping of it). */
  readonly oldHeader?: { readonly record?: string; readonly refs: readonly unknown[]; readonly source: unknown; readonly rationale: readonly unknown[] };
}
export interface ReissueResult {
  readonly name: string;
  readonly sha256: string;
  readonly seed: string;
  readonly code: "superseded" | "edited-in-place";
  readonly repinned: boolean;
  readonly usesChanged: boolean;
}

/**
 * `clossys reissue` (slot-constitution.md section 5, Reissue): under one slot lock, write the next
 * version `<leaf>-v<n>` of a slot's candidate, record its submit (rung adopt, seed
 * `<slot>/<old>@<sha>`), move the slot's `uses` when the caller moved registryDependencies there,
 * repin a pinned old file with the same basis and decidedBy (pin event `reissue: true`), and retire
 * the old file (`superseded`, or `edited-in-place` when its bytes are not the ones the ledger last
 * recorded) with a retire record that validates against retire.schema.json. Every event is verb
 * reissue with the Producer's reissue skill. With `guard`, the reissue guard runs over the new
 * candidate, pin.json and slot.json once everything is in place; any finding, like any error,
 * restores every file the write touched.
 */
export function writeReissue(consumer: string, agent: ModelAgent, id: string, input: ReissueInput, options: { readonly guard?: WriteGuard; readonly provenance?: WriteProvenance } = {}): ReissueResult {
  const { entry } = located(consumer, agent, id);
  canonicalDirectory(entry.dir);
  return slotLocked(entry.dir, () => {
    assertSeat(input.by, agent, "reissue"); // a reissue writes a candidate and repins: its own agent's seat only
    const { doc, entry: current } = located(consumer, agent, id);
    if (!current.candidates.includes(input.old)) throw new Error(`reissue refused: ${agent} slot ${id} has no candidate ${input.old}`);
    const old = readCandidate(consumer, agent, id, input.old);
    if (old.sha256 !== input.oldSha256) throw new Error(`reissue refused: ${input.old} changed while it was reissued (sha256 ${old.sha256.slice(0, 12)} != ${input.oldSha256.slice(0, 12)})`);
    const ext = KIND_EXT[doc.kind];
    const leaf = id.split(".").at(-1)!;
    const file = `${leaf}-v${nextVersion(current.dir, current.candidates)}.${ext}`;
    // One format (foundry-build-0048 U13): a clossys.slot/2 slot takes a headered clossys.candidate/1 file only; the
    // reissue carries the old header's record, refs, source and rationale to a fresh header naming clossys reissue.
    // A slot/1 slot is refused (clossys migrate slots converts it): no reissue writes a slot/1 or a pin/1.
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(slotFile(entry.dir), "utf8")); } catch { raw = undefined; }
    const slotRead = isCurrentSlot(raw) ? readSlotValue(raw, slotFile(entry.dir)) : undefined;
    if (!slotRead?.current) throw new Error(`reissue refused: ${agent}/${id} is not a clossys.slot/2 slot; this verb writes clossys.slot/2 and clossys.pin/2 only: run clossys migrate slots --apply first`);
    // The old file's header as the one candidate reader (records/slots.ts readCandidate, U37c) read it above.
    const oldHeader = (old.header as CandidateHeader | undefined) ?? input.oldHeader as CandidateHeader | undefined;
    if (!oldHeader) throw new Error(`reissue refused: ${input.old} has no clossys.candidate/1 header`);
    const header = buildCandidateHeader({
      agent: agent as AgentId, slotId: id, name: file, status: "submitted",
      createdBy: cliActor("clossys reissue"),
      createdAt: toIsoZ(input.at) ?? (input.at as Iso),
      // The header's content fields (`record`, `briefSha256`) carry over, so the reissue's content digest is its seed's (R03.2, U37c).
      ...(oldHeader.record !== undefined ? { record: oldHeader.record } : {}),
      ...(oldHeader.briefSha256 !== undefined ? { briefSha256: oldHeader.briefSha256 } : {}),
      refs: [...oldHeader.refs], source: oldHeader.source, rationale: [...oldHeader.rationale],
    });
    const bytes = serializeCandidate(file, header, ext === "md" ? String(input.content) : input.content, input.front ?? {});
    // The reader's rules over the bytes written (the header, then the kind's rules over the candidate view, where
    // the header's source stands in for meta.source), so a reissue never leaves a candidate the reader refuses.
    const issues = candidateIssues(slotRead, agent, id, file, bytes);
    if (issues.length) throw new Error(`reissue refused: ${issues.map(issue => issue.message).join("; ")}`);
    const ledger = readLedger(entry.dir, "slot"); // an unreadable ledger refuses before anything is written
    const events = (ledger?.events ?? []) as unknown as Record<string, unknown>[];
    const recorded = expectedCandidateSha(events, input.old).sha256;
    const code = recorded !== undefined && recorded !== old.sha256 ? "edited-in-place" : "superseded";
    const seed = `${id}/${input.old}@${old.sha256}`;
    const retiredDir = join(entry.dir, RETIRED_CANDIDATES);
    const from = join(candidatesDir(entry.dir), input.old), to = join(retiredDir, input.old), recordFile = join(retiredDir, `${input.old}.json`);
    if (existsSync(to) || existsSync(recordFile)) throw new Error(`reissue refused: ${id} already has ${RETIRED_CANDIDATES}/${input.old}`);
    const record = { schema: RETIRE_SCHEMA, slot: id, candidate: input.old, sha256: old.sha256, by: input.by, reason: `${code}: reissued as ${file}`, at: input.at };
    const recordIssues = validateAgainst("retire", record);
    if (recordIssues.length) throw new Error(`reissue refused: the retire record does not validate against retire.schema.json: ${recordIssues.map(issue => `${issue.at || "/"} ${issue.message}`).join("; ")}`);
    // A pinned candidate stays pinned: a slot/2 pin moves only through the CHOOSE gate (refuseTargetPin throws).
    if (current.pin?.candidate === input.old) refuseTargetPin(current.dir, agent, id, "reissue");
    if (current.pin === null && existsSync(pinFile(entry.dir))) throw new Error(`reissue refused: ${id} pin.json does not read as a valid pin; repin first`);
    const uses = input.uses ? [...input.uses] : undefined;
    const usesChanged = uses !== undefined && jsonBytes(uses) !== jsonBytes(doc.uses);
    const who = provenance({ verb: "reissue", by: input.by, skill: skillPath("producer", "reissue") }, options.provenance);
    const path = join(candidatesDir(entry.dir), file);
    const before = snapshotFiles([path, from, to, recordFile, pinFile(entry.dir), slotFile(entry.dir), join(entry.dir, LEDGER_FILE)]);
    try {
      writeFileSync(path, bytes, { flag: "wx" });
      forgetSlotReads();
      const sha256 = readCandidate(consumer, agent, id, file).sha256;
      if (usesChanged) {
        // A slot/2 slot's uses are refs: moving registryDependencies into them is an IA change, not a reissue.
        throw new Error(`reissue refused: ${input.old} moves registryDependencies into uses (${uses!.join(", ")}); a clossys.slot/2 slot changes its refs through clossys ia`);
      }
      // No slot.json or pin.json write: a pinned candidate was refused above (repin through the CHOOSE gate after).
      appendEvent(entry.dir, "slot", ledgerEvent("submit", input.at, who, { rung: input.rung, seed, ladder: { rung: input.rung, seed }, name: file, sha256 }));
      mkdirSync(retiredDir, { recursive: true });
      writeFileSync(recordFile, jsonBytes(record), { flag: "wx" });
      renameSync(from, to);
      forgetSlotReads();
      appendEvent(entry.dir, "slot", ledgerEvent("retire-candidate", input.at, who, { name: input.old, sha256: old.sha256, code }));
      if (options.guard) enforceGuard(consumer, "reissue", options.guard, [{ agent, slot: id, candidate: file, records: [recordPath(consumer, entry.dir, "pin.json"), recordPath(consumer, entry.dir, "slot.json")] }]);
      return { name: file, sha256, seed, code, repinned: false, usesChanged: false };
    } catch (error) {
      restoreFiles(before);
      dropEmptyModelDir(retiredDir);
      throw error;
    }
  });
}

/**
 * The owner confirms an agent pick (owner Foundry Director round 8, "Agent pick + your confirm"): the
 * pin stays the agent's (`decidedBy: agent:<seat>`, basis `agent`, its candidate, hash and time) and
 * gains `confirmed: {by, ref, at}`. Refused unless the slot's current pin is an agent pick of exactly
 * this candidate with matching bytes: a confirmation never changes what is pinned.
 */
export function writeConfirm(consumer: string, agent: SlotAgent, id: string, candidate: string, input: { by: string; ref: string; at: string }, given?: WriteProvenance): PinDoc {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    // A confirmation is the owner's: no seat (an agent's own included) confirms a pick.
    if (!/^owner(?::|$)/.test(input.by)) throw new Error(`confirm refused: --by ${input.by}: a confirmation is the owner's (owner[:<ref>]), never an agent seat's`);
    refuseTargetPin(entry.dir, agent, id, "confirm");
    const path = pinFile(entry.dir);
    if (!existsSync(path)) throw new Error(`confirm refused: ${agent}/${id} has no pin to confirm (an agent picks first with clossys pick)`);
    const current = JSON.parse(readFileSync(path, "utf8")) as PinDoc;
    const currentIssues = validatePin(current);
    if (currentIssues.length) throw new Error(`confirm refused: the current pin is invalid: ${currentIssues.map(issue => issue.message).join("; ")}`);
    if (!confirmableBasis(current.basis)) throw new Error(`confirm refused: ${agent}/${id} is pinned by ${current.decidedBy} (basis ${current.basis}), not an agent or code pick; the owner pins it with --basis picked`);
    if (current.candidate !== candidate) throw new Error(`confirm refused: ${agent}/${id} is picked by ${current.decidedBy} at ${current.candidate}, not ${candidate}`);
    if (readCandidate(consumer, agent, id, candidate).sha256 !== current.sha256) throw new Error(`confirm refused: ${candidate} no longer matches the agent pick's sha256`);
    const pin: PinDoc = { candidate: current.candidate, sha256: current.sha256, decidedBy: current.decidedBy, basis: current.basis, at: current.at, confirmed: { by: input.by, ref: input.ref, at: input.at } };
    const issues = validatePin(pin);
    if (issues.length) throw new Error(`confirm refused: ${issues.map(issue => issue.message).join("; ")}`);
    const who = provenance({ verb: "pin", by: input.by, skill: skillPath("producer", `pin.${agent}`) }, given);
    readLedger(entry.dir, "slot");
    replaceFile(path, jsonBytes(pin));
    appendEvent(entry.dir, "slot", ledgerEvent("confirm", input.at, who, { candidate, sha256: pin.sha256, confirmed: pin.confirmed }, [recordState(entry.dir, "pin.json")]));
    return pin;
  });
}

/**
 * The one guarded decision write on a clossys.slot/2 slot (U13 r4, B1): under the caller's slot lock, `write` writes
 * the decision's records (pin.json, slot.json, and the caller's `also` files such as the CHOOSE scorecard), `event`
 * builds the slot-ledger event from what it wrote, the event is appended, and the guard runs the rules.json checks
 * listed for `verb` on the slot's records and the decided candidate. Any failure, a guard refusal included, restores
 * every snapshotted file byte for byte, so a refused decision leaves no pin, scorecard or ledger tail behind.
 */
function guardedDecision<T>(consumer: string, agent: SlotAgent, id: string, also: readonly string[], write: () => T, event: (written: T) => { readonly verb: GuardVerb; readonly event: LedgerEvent; readonly candidate?: string }, guard: WriteGuard | false): LedgerEvent {
  const dir = join(consumer, "agents", agent, id);
  readLedger(dir, "slot"); // an unreadable ledger refuses before anything is written
  const before = snapshotFiles([pinFile(dir), slotFile(dir), join(dir, LEDGER_FILE), ...also]);
  try {
    const written = write();
    const decided = event(written);
    appendEvent(dir, "slot", decided.event);
    if (guard) enforceGuard(consumer, decided.verb, guard, [{ agent, slot: id, ...(decided.candidate !== undefined ? { candidate: decided.candidate } : {}), records: ["pin.json", "slot.json"].map(file => recordPath(consumer, dir, file)) }]);
    return decided.event;
  } catch (error) { restoreFiles(before); throw error; }
}

/**
 * A clossys.slot/2 pin's decision (U13 r3, r4): `write` replaces pin.json with the gated pin/2 (or one pin-map record)
 * and returns the record it pinned; the decision lands on the slot ledger as R02.3 reads it: `pick` for an agent
 * seat's pick (the agent's `pick.<agent>` skill), else `pin` (the Producer's `pin.<agent>` skill), with candidate,
 * sha256, decidedBy, basis, at and, for a pin-map, the record key. The guard for `pick` or `pin` then runs; a
 * refusal restores pin.json, slot.json, the ledger and `also`.
 */
export function writeTargetDecision(consumer: string, agent: SlotAgent, id: string, input: { readonly record?: string; readonly also?: readonly string[] }, write: () => { readonly candidate: string; readonly sha256: string; readonly decidedBy: string; readonly basis: string; readonly at: string }, guard: WriteGuard = true, given?: WriteProvenance): LedgerEvent {
  const dir = join(consumer, "agents", agent, id);
  return guardedDecision(consumer, agent, id, input.also ?? [], write, pinned => {
    const pick = pinned.basis === "agent";
    const who = provenance(pick
      ? { verb: "pick", by: pinned.decidedBy, skill: skillPath(agent, `pick.${agent}`) }
      : { verb: "pin", by: pinned.decidedBy, skill: skillPath("producer", `pin.${agent}`) }, given);
    const event = ledgerEvent(pick ? "pick" : "pin", pinned.at, who, { candidate: pinned.candidate, sha256: pinned.sha256, decidedBy: pinned.decidedBy, basis: pinned.basis, ...(input.record !== undefined ? { record: input.record } : {}) }, [recordState(dir, "pin.json")]);
    return { verb: pick ? "pick" : "pin", event, candidate: pinned.candidate };
  }, guard);
}

/**
 * A clossys.slot/2 confirmation's record write (U13 r2; `clossys pin --confirm` builds and checks the pin/2 or pin-map
 * it writes): the same guarded decision write, with a `confirm` event (verb pin, the Producer's `pin.<agent>` skill,
 * by the owner's queue answer) and the pin guard on the slot's records and the confirmed candidate.
 */
export function writeTargetConfirm(consumer: string, agent: SlotAgent, id: string, input: { readonly candidate: string; readonly sha256: string; readonly confirmed: { readonly by: string; readonly ref: string; readonly at: string }; readonly by: string; readonly at: string; readonly record?: string }, write: () => void, guard: WriteGuard = true, given?: WriteProvenance): LedgerEvent {
  const dir = join(consumer, "agents", agent, id);
  const who = provenance({ verb: "pin", by: input.by, skill: skillPath("producer", `pin.${agent}`) }, given);
  return guardedDecision(consumer, agent, id, [], write, () => ({
    verb: "pin",
    event: ledgerEvent("confirm", input.at, who, { candidate: input.candidate, sha256: input.sha256, confirmed: { ...input.confirmed }, ...(input.record !== undefined ? { record: input.record } : {}) }, [recordState(dir, "pin.json")]),
    candidate: input.candidate,
  }), guard);
}

/**
 * A seat's candidate and pin as one guarded decision (`clossys seat`, U13 r4 step 5, N1): under the seat slot's lock,
 * the headered candidate is created (never over an existing file) with its `submit` event, pin.json is written, and
 * the `pin` decision event lands as R02.3 reads it; the pin guard then runs. Any failure removes the candidate and
 * restores pin.json, slot.json and the ledger. The seat's slot.json and ia.json are the caller's (written first).
 */
export function writeSeatDecision(consumer: string, slotId: string, input: { readonly name: string; readonly bytes: string; readonly pin: string; readonly at: string; readonly seed: string }, guard: WriteGuard = true, given?: WriteProvenance): LedgerEvent {
  const agent = SEAT_AGENT as unknown as SlotAgent;
  const dir = join(consumer, "agents", SEAT_AGENT, slotId);
  const candidate = join(candidatesDir(dir), input.name);
  return slotLocked(dir, () => guardedDecision(consumer, agent, slotId, [candidate], () => {
    mkdirSync(candidatesDir(dir), { recursive: true });
    writeFileSync(candidate, input.bytes, { flag: "wx" });
    forgetSlotReads();
    const sha256 = sha256Of(readFileSync(candidate));
    const pin = JSON.parse(input.pin) as { candidate: string; sha256: string; decidedBy: string; basis: string; at: string };
    if (pin.candidate !== input.name || pin.sha256 !== sha256) throw new Error(`seat refused: the pin names ${pin.candidate} (${pin.sha256.slice(0, 12)}), not the written ${input.name} (${sha256.slice(0, 12)})`);
    const submitter = provenance({ verb: "submit", by: pin.decidedBy, skill: skillPath("producer", "seats") }, given);
    appendEvent(dir, "slot", // The selection ladder (pipeline/candidate-ladder.ts, R03.1): a seat adapts the package-default seat of its step
    // (pipeline/seats.json) to this consumer, like an adopted agent loop (loop/agent-loop-adopt.ts).
    ledgerEvent("submit", input.at, submitter, { name: input.name, sha256, rung: "adapt", seed: input.seed }));
    replaceFile(pinFile(dir), input.pin);
    forgetSlotReads();
    return pin;
  }, pin => {
    const who = provenance({ verb: "pin", by: pin.decidedBy, skill: skillPath("producer", "seats") }, given);
    return { verb: "pin", candidate: pin.candidate, event: ledgerEvent("pin", pin.at, who, { candidate: pin.candidate, sha256: pin.sha256, decidedBy: pin.decidedBy, basis: pin.basis }, [recordState(dir, "pin.json")]) };
  }, guard));
}

/**
 * The P0 propagation probe's only pin write (`studio/checks/p0-propagate.mjs` (not shipped)). The probe mutates a
 * pinned Designer theme candidate for one build and must keep its pin selecting those bytes, so this
 * re-points the pin's `sha256` at `candidateText` and keeps every other field; `restoreThemeProbePin`
 * puts the original pin text back byte for byte. Only a Designer `themes.*` slot is accepted: every
 * other agent's pin (Publisher, Writer, Director, seats) is out of the probe's reach, and the decision
 * itself (candidate, decidedBy, basis, at) is never changed here.
 */
export interface ThemeProbePin { readonly path: string; readonly original: string; readonly repointed: string }
const THEME_SLOT = /^themes\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;
const canonicalJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function themeProbePath(consumer: string, id: string): string {
  if (!THEME_SLOT.test(id)) throw new Error(`theme probe refused: ${id} is not a Designer themes.* slot`);
  const path = pinFile(join(consumer, "agents", "designer", id));
  canonicalDirectory(path);
  return path;
}
/** Read and check the theme slot's pin: canonical JSON that selects `candidate` by the sha256 of `candidateText`. */
export function readThemeProbePin(consumer: string, id: string, candidate: string, candidateText: string): string {
  const path = themeProbePath(consumer, id);
  const original = readFileSync(path, "utf8");
  let pin: PinDoc;
  try { pin = JSON.parse(original) as PinDoc; } catch { throw new Error("The theme slot pin is not JSON."); }
  if (canonicalJson(pin) !== original) throw new Error("The theme slot pin is not canonical JSON (two-space indent, trailing newline); refusing to rewrite it.");
  if (pin.candidate !== candidate) throw new Error(`The theme slot pin selects ${pin.candidate}, not ${candidate}.`);
  if (pin.sha256 !== createHash("sha256").update(candidateText).digest("hex")) throw new Error(`The theme slot pin's sha256 does not match ${candidate}; the candidate is not what Studio serves.`);
  return original;
}
/** The pin text with only its sha256 re-pointed at `candidateText`. */
export function repointedThemePin(original: string, candidateText: string): string {
  const pin = JSON.parse(original) as PinDoc;
  return canonicalJson({ ...pin, sha256: createHash("sha256").update(candidateText).digest("hex") });
}
/** Re-point the theme slot's pin at the probe's mutated candidate bytes. */
export function repointThemeProbePin(consumer: string, id: string, original: string, candidateText: string): ThemeProbePin {
  const path = themeProbePath(consumer, id);
  // Under the slot lock, as every pin write: the check, the write and its engine event are one transaction.
  return slotLocked(dirname(path), () => {
    if (readFileSync(path, "utf8") !== original) throw new Error("theme probe refused: the pin changed since it was read");
    const repointed = repointedThemePin(original, candidateText);
    replaceFile(path, repointed);
    recordEvent([path], { actor: "code:theme-probe", kind: "pin.probe-repoint", subject: `designer/${id}` });
    return { path, original, repointed };
  });
}
/** Put the theme slot's original pin text back; true when the file now holds exactly those bytes. */
export function restoreThemeProbePin(consumer: string, id: string, original: string): boolean {
  const path = themeProbePath(consumer, id);
  return slotLocked(dirname(path), () => {
    replaceFile(path, original);
    recordEvent([path], { actor: "code:theme-probe", kind: "pin.probe-restore", subject: `designer/${id}` });
    return readFileSync(path, "utf8") === original;
  });
}

/** One record a citation codemod rewrites in place: the bytes it read, and the bytes it writes. */
export interface InPlaceRewrite { readonly name: string; readonly before: string; readonly after: string }

/**
 * The one in-place rewrite of a slot's records (`clossys migrate citations-to-slots`, planner D2):
 * candidate bytes whose citations name a version become the same bytes citing the slot id, and the
 * pin drops `recited` and carries its sha256 to the rewritten pinned bytes. The decision itself
 * (candidate, decidedBy, basis, at, confirmed) is never changed. Every record is compared with the
 * bytes the plan read (a concurrent change refuses the slot), the rewritten candidate may add no
 * validation issue, and the rewritten pin must be valid. Candidates otherwise stay immutable: this
 * is the only writer that replaces candidate bytes, and only for a citation-format change.
 */
export function rewriteCitationsInPlace(consumer: string, agent: SlotAgent, id: string, change: { readonly candidates: readonly InPlaceRewrite[]; readonly pin?: { readonly before: string; readonly after: string } }, input: { readonly by?: string; readonly at?: string } = {}, given?: WriteProvenance): RewrittenFile[] {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    const { doc } = located(consumer, agent, id);
    let rawSlot: unknown;
    try { rawSlot = JSON.parse(readFileSync(slotFile(entry.dir), "utf8")); } catch { rawSlot = undefined; }
    const slotRead = readSlotValue(rawSlot, slotFile(entry.dir));
    for (const rewrite of change.candidates) {
      if (!CANDIDATE_NAME.test(rewrite.name) || !entry.candidates.includes(rewrite.name)) throw new Error(`citation rewrite refused: ${agent}/${id} has no candidate ${rewrite.name}`);
      if (readCandidate(consumer, agent, id, rewrite.name).raw !== rewrite.before) throw new Error(`citation rewrite refused: ${agent}/${id}/${rewrite.name} changed since it was read`);
      // The slot's candidate rules (the header, then the kind's rules over the view) on both sides: a headered
      // clossys.slot/2 candidate is judged as the reader judges it, never as raw bytes the int2 rules refuse.
      const judge = (bytes: string) => slotRead ? candidateIssues(slotRead, agent, id, rewrite.name, bytes) : validateCandidate(doc.kind, id, rewrite.name, bytes);
      const known = new Set(judge(rewrite.before).map(issue => issue.message));
      const added = judge(rewrite.after).filter(issue => !known.has(issue.message));
      if (added.length) throw new Error(`citation rewrite refused: ${agent}/${id}/${rewrite.name}: ${added.map(issue => issue.message).join("; ")}`);
    }
    const pinPath = pinFile(entry.dir);
    if (change.pin) {
      if (!existsSync(pinPath) || readFileSync(pinPath, "utf8") !== change.pin.before) throw new Error(`citation rewrite refused: ${agent}/${id} pin.json changed since it was read`);
      const issues = validatePin(JSON.parse(change.pin.after));
      if (issues.length) throw new Error(`citation rewrite refused: ${agent}/${id} pin.json: ${issues.map(issue => issue.message).join("; ")}`);
    }
    // The pin lands first: an interruption leaves a pin already naming the rewritten bytes, which a
    // re-run recognises (the plan carries a sha256 that matches either form) and completes.
    // Each touched file's bytes are read from disk on both sides, so its recorded ids are exactly
    // what git sees for this change (records/migrations.ts).
    // The ledger's `migrate` event carries each rewritten candidate's sha256 from and to (R08.2 follows
    // a submit through it) and the pin's new bytes (R14.1).
    // migrate is a plumb action: its events cite its action.json, not a skill (R14.2).
    const who = provenance({ verb: "migrate", by: input.by ?? "planner", skill: actionContractPath("producer", "migrate") }, given);
    readLedger(entry.dir, "slot");
    const touched: RewrittenFile[] = [];
    const files: { name: string; from: string; to: string }[] = [];
    const rewrite = (path: string, after: string, name?: string) => {
      const was = readFileSync(path);
      const from = fileState(was);
      replaceFile(path, after);
      const now = readFileSync(path);
      const to = fileState(now);
      if (from.blob !== to.blob) {
        touched.push({ file: posixRelative(consumer, path), from, to });
        if (name) files.push({ name, from: sha256Of(was), to: sha256Of(now) });
      }
    };
    if (change.pin) rewrite(pinPath, change.pin.after);
    for (const item of change.candidates) rewrite(join(candidatesDir(entry.dir), item.name), item.after, item.name);
    if (touched.length) {
      appendEvent(entry.dir, "slot", ledgerEvent("migrate", input.at ?? nowIso(), who, { migration: "citations-to-slots", files },
        change.pin && touched.some(file => file.file.endsWith("/pin.json")) ? [recordState(entry.dir, "pin.json")] : undefined));
    }
    return touched;
  });
}

/** One file an in-place rewrite changed: its path under the consumer folder and its bytes' ids before and after. */
export interface RewrittenFile { readonly file: string; readonly from: FileState; readonly to: FileState }

const posixRelative = (from: string, to: string) => relative(from, to).split(sep).join("/");

/**
 * Record format-only rewrites in the migration manifest (`<consumer>/evidence/migrations.json`): one
 * `migrated` event per file, appended in order. An event already recorded (same migration, file and
 * blob ids) is not added again, so a re-run never duplicates. Returns the events added.
 */
export function appendMigrationEvents(consumer: string, migration: FormatMigration, files: readonly RewrittenFile[], input: { by: string; at: string }): MigratedEvent[] {
  const path = join(consumer, MIGRATIONS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  return withDirLock(`${path}.lock`, `migration manifest ${MIGRATIONS_FILE} is being written`, () => {
    let doc: MigrationsDoc = { schema: MIGRATIONS_SCHEMA, events: [] };
    if (existsSync(path)) {
      const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
      const issues = validateMigrations(value);
      if (issues.length) throw new Error(`${MIGRATIONS_FILE} is invalid: ${issues.slice(0, 3).join("; ")}`);
      doc = value as MigrationsDoc;
    }
    const key = (event: Pick<MigratedEvent, "migration" | "file" | "from" | "to">) => `${event.migration} ${event.file} ${event.from.blob} ${event.to.blob}`;
    const seen = new Set(doc.events.map(key));
    const added: MigratedEvent[] = [];
    for (const file of files) {
      const event: MigratedEvent = { type: "migrated", migration, file: file.file, from: file.from, to: file.to, by: input.by, at: input.at };
      if (seen.has(key(event))) continue;
      seen.add(key(event));
      added.push(event);
    }
    if (!added.length) return added;
    const next: MigrationsDoc = { schema: MIGRATIONS_SCHEMA, events: [...doc.events, ...added] };
    const issues = validateMigrations(next);
    if (issues.length) throw new Error(`migration events refused: ${issues.slice(0, 3).join("; ")}`);
    replaceFile(path, jsonBytes(next));
    const root = consumerEngineRoot(consumer);
    if (root !== undefined) logEvent(root, { actor: input.by, kind: "migration.record", subject: `migration:${migration}`, inputs: inputsOf(root, [path]) });
    return added;
  });
}

/** One candidate a store-format migration recut: its name and the sha256 of its bytes before and after. */
export interface RecutFile { readonly name: string; readonly from: string; readonly to: string }

/**
 * One slot folder's `clossys migrate slots` write (U13 r4, B3/N7). Under the slot lock (the lock every decision
 * write takes), `write` replaces the folder's planned files; then exactly one `migrate` event lands on the slot
 * ledger: `migration: "slots"`, `files` the recut candidates' sha256 from and to (R02.3 and R14.1 carry a pinned
 * or submitted sha through it), and `records` the slot.json and pin.json states the run changed. A folder with no
 * ledger.json first gets one `submit` per candidate it holds, at the candidate's sha256 before the recut, so the
 * migrate event carries a recorded submit (R14.1), plus the slot.json and pin.json states. An event the folder's
 * ledger already ends with (a resumed run) is not appended again. The migrate guard (rules.json: R14) then runs on
 * the folder's records and recut candidates; on any refusal or failure the folder's files and ledger are restored.
 */
export function writeSlotsMigrationFolder(consumer: string, agent: AgentId, id: string, input: {
  readonly recuts: readonly RecutFile[];
  readonly records: readonly RecordFile[];
  readonly at: string;
  readonly by: string;
  readonly cli: string;
  readonly write: () => void;
}, guard: WriteGuard = true): { readonly event: boolean } {
  const dir = join(consumer, "agents", agent, id);
  return slotLocked(dir, () => {
    const ledgerPath = join(dir, LEDGER_FILE);
    const hadLedger = existsSync(ledgerPath);
    const prior = readLedger(dir, "slot"); // an unreadable ledger refuses before anything is written
    const cands = candidatesDir(dir);
    const names = existsSync(cands) ? readdirSync(cands).filter(name => CANDIDATE_NAME.test(name)).sort() : [];
    const before = snapshotFiles([...names.map(name => join(cands, name)), slotFile(dir), pinFile(dir), ledgerPath]);
    const preSha = new Map(names.map(name => [name, sha256Of(readFileSync(join(cands, name)))]));
    try {
      input.write();
      const who = provenance({ verb: "migrate", by: input.by, skill: actionContractPath("producer", "migrate") });
      const files = input.recuts.filter(file => file.from !== file.to).map(file => ({ name: file.name, from: file.from, to: file.to }));
      const recutFrom = new Map(input.recuts.map(file => [file.name, file.from]));
      const recorded: RecordFile[] = hadLedger ? [...new Set(input.records)] : ["slot.json", "pin.json"];
      const records = recorded.filter(file => hadLedger || existsSync(join(dir, file))).map(file => recordState(dir, file));
      let appended = false;
      if (!hadLedger) {
        for (const name of names) {
          // The bytes the folder held before this run (the journal's `from` on a resumed run).
          const sha256 = recutFrom.get(name) ?? preSha.get(name)!;
          const text = readFileSync(join(cands, name), "utf8");
          const header = candidateHeaderOf(name, text);
          const source = header?.source as { ref?: unknown } | undefined;
          const refs = Array.isArray(source?.ref) ? source!.ref.filter((ref): ref is string => typeof ref === "string") : [];
          const rung = agent === "designer" ? (refs.some(ref => /^shadcn(?:-aria|@aria)?\//.test(ref)) ? "L1" : "L2") : "adopt";
          appendEvent(dir, "slot", ledgerEvent("submit", input.at, who, { name, sha256, rung, seed: refs[0] ?? `${agent}:${id}/${name}`, createdBy: input.cli }));
        }
      }
      if (files.length || records.length) {
        const last = [...(prior?.events ?? [])].reverse().find(event => event.op === "migrate") as Record<string, unknown> | undefined;
        const same = hadLedger && last?.migration === "slots" && JSON.stringify(last.files) === JSON.stringify(files) && JSON.stringify(last.records ?? []) === JSON.stringify(records);
        if (!same) { appendEvent(dir, "slot", ledgerEvent("migrate", input.at, who, { migration: "slots", files }, records)); appended = true; }
      }
      const targets: GuardTarget[] = [
        { agent, slot: id, records: ["slot.json", "pin.json", LEDGER_FILE].map(file => recordPath(consumer, dir, file)) },
        ...files.map(file => ({ agent, slot: id, candidate: file.name })),
      ];
      enforceGuard(consumer, "migrate", guard, targets);
      return { event: appended };
    } catch (error) { restoreFiles(before); throw error; }
  });
}

/**
 * The next bytes of a `clossys.slot/2` slot.json under `change`, applied to the document as written (the
 * reader's view is never written back), with `updatedAt` stamped when the bytes change and judged as the
 * reader judges it (schemas/slot.json and the notNeeded rule). Undefined for an old-format file, which keeps
 * its slot/1 path. A slot synced from a package base (`base` not null) refuses a change: every field these
 * writes touch is computed from the base (records.computed-match), so it changes in the package.
 */
function currentSlotWrite(file: string, verb: string, at: string, change: (slot: Slot) => Slot): { before: string; after: string; slot: Slot } | undefined {
  const before = readFileSync(file, "utf8");
  const value = JSON.parse(before) as unknown;
  if (!isCurrentSlot(value)) return undefined;
  const slot = value as unknown as Slot;
  const changed = change(structuredClone(slot));
  if (serializeSlot(changed) === serializeSlot(slot)) return { before, after: before, slot };
  if (slot.base !== null) throw new Error(`${verb} refused: ${slot.agent}/${slot.id} is synced from ${slot.base.package}; the field is computed from the package base (change it there, then clossys ia)`);
  const next: Slot = { ...changed, updatedAt: at };
  const issues = slotReadIssues(next, file);
  if (issues.length) throw new Error(`${verb} refused: ${issues.map(issue => issue.message).join("; ")}`);
  return { before, after: serializeSlot(next), slot: next };
}

/**
 * Rewrites one slot/2 slot.json through `change` (`clossys migrate contracts`: family, contract.requirements and
 * contract.fixture seeded from package data) with one `slot` event of verb migrate carrying `fields` (R14.1).
 * False when the change leaves the bytes as they are; refuses a slot/1 doc and a package-synced slot.
 */
export function writeSlotSeed(consumer: string, agent: ModelAgent, id: string, change: (slot: Slot) => Slot, input: { at: string; fields: Readonly<Record<string, unknown>> }, given?: WriteProvenance): boolean {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    const current = currentSlotWrite(slotFile(entry.dir), "migrate contracts", input.at, change);
    if (!current) throw new Error(`migrate contracts refused: ${agent}/${id} slot.json is not a clossys.slot/2`);
    if (current.before === current.after) return false;
    const who = provenance({ verb: "migrate", by: "planner", skill: actionContractPath("producer", "migrate") }, given);
    readLedger(entry.dir, "slot");
    replaceFile(slotFile(entry.dir), current.after);
    appendEvent(entry.dir, "slot", ledgerEvent("slot", input.at, who, { ...input.fields }, [recordState(entry.dir, "slot.json")]));
    return true;
  });
}

/** Mark a slot not needed: slot.json `notNeeded {reason, since, decidedBy}` (slot/2: `contract.notNeeded`, status parked), and any pin.json removed. */
export function writeNotNeeded(consumer: string, agent: SlotAgent, id: string, notNeeded: NotNeeded, given?: WriteProvenance & { readonly at?: string }): SlotDoc {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    const change = notNeededChange(consumer, agent, id, notNeeded, given);
    readLedger(entry.dir, "slot");
    change.write();
    appendEvent(entry.dir, "slot", change.event());
    return change.next;
  });
}

/**
 * The clossys.slot/2 not-needed decision (`clossys pin --not-needed`, U13 r4 step 4c): the same records as
 * writeNotNeeded through the one guarded decision write, so the pin guard runs on slot.json and pin.json and a
 * refusal restores both and the ledger.
 */
export function writeTargetNotNeeded(consumer: string, agent: SlotAgent, id: string, notNeeded: NotNeeded, given: WriteProvenance & { readonly at?: string } = {}, guard: WriteGuard = true): SlotDoc {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    const change = notNeededChange(consumer, agent, id, notNeeded, given);
    guardedDecision(consumer, agent, id, [], change.write, () => ({ verb: "pin", event: change.event() }), guard);
    return change.next;
  });
}

function notNeededChange(consumer: string, agent: SlotAgent, id: string, notNeeded: NotNeeded, given?: WriteProvenance & { readonly at?: string }): { readonly next: SlotDoc; readonly write: () => void; readonly event: () => LedgerEvent } {
  assertSeat(notNeeded.decidedBy, agent, "not-needed"); // dropping the pin is a decision on the slot
  const { entry, doc } = located(consumer, agent, id);
  const marker = { reason: notNeeded.reason, since: notNeeded.since, decidedBy: notNeeded.decidedBy };
  const at = given?.at ?? nowIso();
  const current = currentSlotWrite(slotFile(entry.dir), "not-needed", at, slot => ({ ...slot, status: "parked", contract: { ...slot.contract, notNeeded: marker } }));
  const next: SlotDoc = { ...doc, notNeeded: marker };
  const issues = current ? [] : validateSlotDoc(next);
  if (issues.length) throw new Error(`not-needed refused: ${issues.map(issue => issue.message).join("; ")}`);
  const who = provenance({ verb: "pin", by: notNeeded.decidedBy, skill: skillPath("producer", `pin.${agent}`) }, given);
  return {
    next,
    write: () => {
      replaceFile(slotFile(entry.dir), current ? current.after : jsonBytes(next));
      if (existsSync(pinFile(entry.dir))) { unlinkSync(pinFile(entry.dir)); forgetSlotReads(); }
    },
    event: () => ledgerEvent("not-needed", at, who, { reason: notNeeded.reason, since: notNeeded.since, decidedBy: notNeeded.decidedBy },
      [recordState(entry.dir, "slot.json"), recordState(entry.dir, "pin.json")]),
  };
}

/**
 * Set a slot's `options` and `varyOn` from its option class (CANDIDATE-OPTIONS), keeping every
 * other key. options 1 removes both keys (1 is the default). Returns true when slot.json changed.
 */
export function writeSlotOptions(consumer: string, agent: SlotAgent, id: string, input: { options: 1 | 2 | 3; varyOn?: string; at?: string }, given?: WriteProvenance): boolean {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
  const { doc } = located(consumer, agent, id);
  const classed = <T extends { options?: unknown; varyOn?: unknown }>(value: T): Omit<T, "options" | "varyOn"> & { options?: 2 | 3; varyOn?: string } => {
    const { options: _options, varyOn: _varyOn, ...rest } = value;
    return input.options > 1 ? { ...rest, options: input.options as 2 | 3, ...(input.varyOn ? { varyOn: input.varyOn } : {}) } : rest;
  };
  const at = input.at ?? nowIso();
  const current = currentSlotWrite(slotFile(entry.dir), "options", at, slot => classed(slot) as Slot);
  const next = classed(doc) as SlotDoc;
  const issues = current ? [] : validateSlotDoc(next);
  if (issues.length) throw new Error(`options refused: ${issues.map(issue => issue.message).join("; ")}`);
  const before = current ? current.before : jsonBytes(doc), after = current ? current.after : jsonBytes(next);
  if (before === after) return false;
  if (!current) throw new Error(oldSlotRefusal("options", `${agent}/${id}`)); // U13: an old-format slot.json is never rewritten
  const who = provenance({ verb: "options", by: "planner", skill: skillPath("producer", "options") }, given);
  readLedger(entry.dir, "slot");
  replaceFile(slotFile(entry.dir), after);
  appendEvent(entry.dir, "slot", ledgerEvent("slot", at, who, { options: input.options, ...(input.varyOn ? { varyOn: input.varyOn } : {}) }, [recordState(entry.dir, "slot.json")]));
  return true;
  });
}

// ---------------------------------------------------------------------------
// Director's strategy store writer. `clossys director …` injects this writer and
// slots.ts's reader into @clossys/director, which owns no filesystem writes.
// Writes are root-confined, refuse symbolic links, and commit all-or-nothing.
// ---------------------------------------------------------------------------

/** A root-relative write target: no escape, no "." and no symbolic link in any existing component (root included). */
function storeWritePath(root: string, path: string): string {
  const base = resolve(root), target = resolve(base, path), rel = relative(base, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Write path escapes the strategy root");
  for (const cursor of [base, ...rel.split(sep).map((_, i, parts) => join(base, ...parts.slice(0, i + 1)))]) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("Strategy writes refuse symbolic links"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return target;
}

export const directorStoreWriter: DirectorStoreWriter = {
  locked(root, action) {
    const lock = storeWritePath(root, ".director-write.lock");
    return withDirLock(lock, "Strategy root is unavailable or another write is in progress", action);
  },
  commit(root, changes) {
    if (new Set(changes.map(change => change.path)).size !== changes.length) throw new Error("Duplicate transaction path");
    const stageDir = storeWritePath(root, `.director-write-${randomUUID()}`);
    mkdirSync(stageDir);
    const applied: DirectorStoreChange[] = [];
    const unchanged = (change: DirectorStoreChange) => {
      storeWritePath(root, change.path);
      if (directorStoreReader.read(root, change.path) !== change.before) throw new Error(`Strategy file changed during write: ${change.path}`);
    };
    try {
      changes.forEach((change, i) => { unchanged(change); writeFileSync(join(stageDir, String(i)), change.after, { flag: "wx" }); });
      changes.forEach((change, i) => {
        unchanged(change);
        const target = storeWritePath(root, change.path);
        mkdirSync(dirname(target), { recursive: true });
        renameSync(join(stageDir, String(i)), target);
        applied.push(change);
      });
    } catch (error) {
      for (const change of applied.reverse()) {
        const target = storeWritePath(root, change.path);
        if (change.before === undefined) unlinkSync(target); else writeFileSync(target, change.before);
      }
      throw error;
    } finally { rmSync(stageDir, { recursive: true, force: true }); }
  },
  replace(root, path, text, options = {}) {
    if (lstatSync(root).isSymbolicLink()) throw new Error("Symlink strategy root is not allowed");
    const strategyRoot = realpathSync(root);
    if (!lstatSync(strategyRoot).isDirectory()) throw new Error("Strategy root must be a directory");
    const destinationPath = storeWritePath(strategyRoot, path);
    const directory = dirname(destinationPath);
    if (directory !== strategyRoot) {
      try { mkdirSync(directory, { recursive: true }); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) throw new Error("Generated output must be in a real directory inside the strategy root");
    // O_NOFOLLOW also protects an existing destination from symlink traversal.
    const fd = openSync(destinationPath, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, options.mode ?? 0o666);
    try {
      const destination = fstatSync(fd);
      if (!destination.isFile() || destination.nlink !== 1) throw new Error("Report destination must be a regular file");
      const current = lstatSync(destinationPath);
      if (current.isSymbolicLink() || current.dev !== destination.dev || current.ino !== destination.ino || realpathSync(directory) !== directory) throw new Error("Report destination changed while opening");
      // Truncate only after verifying the opened destination.
      ftruncateSync(fd, 0);
      writeFileSync(fd, text, { encoding: "utf8" });
    } finally { closeSync(fd); }
  },
};

/** The store `clossys director …` injects into @clossys/director. */
export const directorStore: DirectorStore = { reader: directorStoreReader, writer: directorStoreWriter };
