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
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DirectorStore, DirectorStoreChange, DirectorStoreWriter } from "@clossys/director";
import {
  CANDIDATE_NAME, KIND_EXT, candidatesDir, jsonBytes, pinFile, slotFile, validateCandidate, validatePin, validateSlotDoc,
  type NotNeeded, type PinBasis, type PinDoc, type SlotAgent, type SlotDoc,
} from "./slot-model/index.js";
import { directorStoreReader, forgetSlotReads, listSlots, readCandidate, readLedger, readSlot } from "./slots.js";
import {
  LEDGER_FILE, LEDGER_SCHEMA, NONE, RETIRE_EVENT_CODES, eventIssues, skillFile, skillPath,
  type LedgerEvent, type LedgerRecordState, type LedgerSkill, type Provenance, type RecordFile, type Verb,
} from "./ledger.js";
import { fileState, MIGRATIONS_FILE, MIGRATIONS_SCHEMA, validateMigrations, type FileState, type FormatMigration, type MigratedEvent, type MigrationsDoc } from "./migrations.js";

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
  try { return action(); } finally { rmSync(lock, { recursive: true, force: true }); forgetSlotReads(); }
}
/** Replace `path` by renaming a fully written sibling over it: a reader sees the old bytes or the new, never a torn file. */
function replaceFile(path: string, bytes: string): void {
  const staged = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(staged, bytes, { flag: "wx" });
  try { renameSync(staged, path); } catch (error) { rmSync(staged, { force: true }); throw error; }
  finally { forgetSlotReads(); }
}
/** One decision write per slot at a time. */
export const SLOT_LOCK = ".slot-write.lock";
const slotLocked = <T>(dir: string, action: () => T): T => withDirLock(join(dir, SLOT_LOCK), "Slot is unavailable or another decision write is in progress", action);

function located(consumer: string, agent: SlotAgent, id: string) {
  const doc = readSlot(consumer, agent, id);
  const entry = listSlots(consumer, agent).find(row => row.id === id);
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

// ---------------------------------------------------------------------------
// The ledger: one event per write, appended under the lock that guards the write.
// ---------------------------------------------------------------------------

/** An action skill as an event records it: its path and the sha256 of the installed file (null when the file is missing; R14.2 reports it). */
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
}
/** One agent-ledger write at a time. */
const AGENT_LOCK = ".agent-write.lock";
const agentLocked = <T>(consumer: string, agent: SlotAgent, action: () => T): T =>
  withDirLock(join(consumer, "agents", agent, AGENT_LOCK), `The ${agent} agent ledger is unavailable or another write is in progress`, action);
/** The retire code of a retire reason (`<code>[: <note>]`). */
function retireCode(reason: string): string {
  const code = reason.split(":")[0]!.trim();
  if (!(RETIRE_EVENT_CODES as readonly string[]).includes(code)) throw new Error(`retire reason ${reason} does not start with a retire code (${RETIRE_EVENT_CODES.join(", ")})`);
  return code;
}

/**
 * The retire verb's ledger event for one candidate (`clossys retire <agent>/<slot> <candidate>`):
 * `retire-candidate {name, sha256, code}` in the slot ledger, written after the candidate left
 * `candidates/`. The note after the code stays in the retire record.
 */
export function appendRetireCandidate(consumer: string, agent: SlotAgent, id: string, input: { name: string; sha256: string; reason: string; by: string; at: string }, given?: WriteProvenance): LedgerEvent {
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
 * A `slot` event recording slot.json's current bytes, for a verb that rewrote slot.json as part of
 * an agent-level change (retire --slot renumbers the positions of the slots after the retired one).
 */
export function appendSlotDocEvent(consumer: string, agent: SlotAgent, id: string, input: { by: string; at: string; verb: Verb; skill: string; fields?: Readonly<Record<string, unknown>> }, given?: WriteProvenance): LedgerEvent {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
    const event = ledgerEvent("slot", input.at, provenance({ verb: input.verb, by: input.by, skill: input.skill }, given), { ...input.fields }, [recordState(entry.dir, "slot.json")]);
    appendEvent(entry.dir, "slot", event);
    return event;
  });
}

/**
 * Write `<name>-v<next>` into the slot's candidates and append its `submit {name, sha256}` event.
 * JSON kinds take the item object (serialized as two-space JSON); Markdown kinds take the file text.
 * Invalid candidates are refused. `canonical` also refuses aliased candidate paths (no ancestor may
 * be a symbolic link). The version is chosen, the file written, `verify` run and the event appended
 * under the slot lock, so two writers never take one version and the ledger names every file; a
 * `verify` issue (or a refused event) removes the file again. `fields` are the submit's own record
 * (`next --submit`: its basis and ladder); `provenance` its verb, by, skill, model and tier.
 */
export function writeCandidate(consumer: string, agent: SlotAgent, id: string, name: string, content: unknown, options: {
  readonly canonical?: boolean; readonly provenance?: WriteProvenance; readonly at?: string;
  readonly fields?: Readonly<Record<string, unknown>>; readonly verify?: (file: string) => readonly string[];
} = {}): { name: string; sha256: string } {
  const { entry } = located(consumer, agent, id);
  if (options.canonical) canonicalDirectory(entry.dir);
  return slotLocked(entry.dir, () => {
    const { doc, entry: current } = located(consumer, agent, id);
    const ext = KIND_EXT[doc.kind];
    const versions = current.candidates.map(file => CANDIDATE_NAME.exec(file)).filter(match => match?.[1] === name).map(match => Number(match![2]));
    const file = `${name}-v${Math.max(0, ...versions) + 1}.${ext}`;
    const bytes = ext === "md" ? String(content) : jsonBytes(content);
    const issues = validateCandidate(doc.kind, id, file, bytes);
    if (issues.length) throw new Error(`candidate refused: ${issues.map(issue => issue.message).join("; ")}`);
    readLedger(entry.dir, "slot"); // an unreadable ledger refuses before anything is written
    const directory = candidatesDir(entry.dir);
    if (options.canonical) canonicalDirectory(directory);
    mkdirSync(directory, { recursive: true });
    if (options.canonical && realpathSync(directory) !== resolve(directory)) throw new Error("candidate refused: candidate directory leaves its canonical path");
    const path = join(directory, file);
    writeFileSync(path, bytes, { flag: "wx" });
    forgetSlotReads();
    try {
      const sha256 = readCandidate(consumer, agent, id, file).sha256;
      const refused = options.verify?.(file) ?? [];
      if (refused.length) throw new Error(`candidate refused: ${file} fails the slot model check: ${refused.slice(0, 5).join("; ")}`);
      const who = provenance({ verb: "submit", by: "planner", skill: skillPath(agent, `${agent}.candidates`) }, options.provenance);
      appendEvent(entry.dir, "slot", ledgerEvent("submit", options.at ?? nowIso(), who, { ...options.fields, name: file, sha256 }));
      return { name: file, sha256 };
    } catch (error) { unlinkSync(path); forgetSlotReads(); throw error; }
  });
}

/**
 * Pin one existing, valid candidate. `decidedBy` names who decided (owner or planner, optionally
 * `:<message ref>`, `agent:<seat>`, or `migrated`); `basis` how (PIN_BASES). A `notNeeded` marker on
 * the slot is cleared: the pin replaces it.
 */
export function writePin(consumer: string, agent: SlotAgent, id: string, candidate: string, input: { decidedBy: string; basis: PinBasis; at: string }, given?: WriteProvenance): PinDoc {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
  const { doc } = located(consumer, agent, id);
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
  replaceFile(pinFile(entry.dir), jsonBytes(pin));
  const records = [recordState(entry.dir, "pin.json")];
  if (doc.notNeeded) {
    const { notNeeded: _cleared, ...rest } = doc;
    replaceFile(slotFile(entry.dir), jsonBytes(rest));
    records.push(recordState(entry.dir, "slot.json"));
  }
  appendEvent(entry.dir, "slot", ledgerEvent(pick ? "pick" : "pin", input.at, who, { candidate, sha256: pin.sha256, decidedBy: pin.decidedBy, basis: pin.basis }, records));
  return pin;
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
    const path = pinFile(entry.dir);
    if (!existsSync(path)) throw new Error(`confirm refused: ${agent}/${id} has no pin to confirm (an agent picks first with clossys pick)`);
    const current = JSON.parse(readFileSync(path, "utf8")) as PinDoc;
    const currentIssues = validatePin(current);
    if (currentIssues.length) throw new Error(`confirm refused: the current pin is invalid: ${currentIssues.map(issue => issue.message).join("; ")}`);
    if (current.basis !== "agent") throw new Error(`confirm refused: ${agent}/${id} is pinned by ${current.decidedBy} (basis ${current.basis}), not an agent pick; the owner pins it with --basis picked`);
    if (current.candidate !== candidate) throw new Error(`confirm refused: ${agent}/${id} is agent-picked at ${current.candidate}, not ${candidate}`);
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
 * The P0 propagation probe's only pin write (`studio/checks/p0-propagate.mjs`). The probe mutates a
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
  if (readFileSync(path, "utf8") !== original) throw new Error("theme probe refused: the pin changed since it was read");
  const repointed = repointedThemePin(original, candidateText);
  replaceFile(path, repointed);
  return { path, original, repointed };
}
/** Put the theme slot's original pin text back; true when the file now holds exactly those bytes. */
export function restoreThemeProbePin(consumer: string, id: string, original: string): boolean {
  const path = themeProbePath(consumer, id);
  replaceFile(path, original);
  return readFileSync(path, "utf8") === original;
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
    for (const rewrite of change.candidates) {
      if (!CANDIDATE_NAME.test(rewrite.name) || !entry.candidates.includes(rewrite.name)) throw new Error(`citation rewrite refused: ${agent}/${id} has no candidate ${rewrite.name}`);
      if (readCandidate(consumer, agent, id, rewrite.name).bytes !== rewrite.before) throw new Error(`citation rewrite refused: ${agent}/${id}/${rewrite.name} changed since it was read`);
      const known = new Set(validateCandidate(doc.kind, id, rewrite.name, rewrite.before).map(issue => issue.message));
      const added = validateCandidate(doc.kind, id, rewrite.name, rewrite.after).filter(issue => !known.has(issue.message));
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
    const who = provenance({ verb: "migrate", by: input.by ?? "planner", skill: skillPath("producer", "migrate") }, given);
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
    return added;
  });
}

/** Mark a slot not needed: slot.json `notNeeded {reason, since, decidedBy}`, and any pin.json removed. */
export function writeNotNeeded(consumer: string, agent: SlotAgent, id: string, notNeeded: NotNeeded, given?: WriteProvenance & { readonly at?: string }): SlotDoc {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
  const { doc } = located(consumer, agent, id);
  const next: SlotDoc = { ...doc, notNeeded: { reason: notNeeded.reason, since: notNeeded.since, decidedBy: notNeeded.decidedBy } };
  const issues = validateSlotDoc(next);
  if (issues.length) throw new Error(`not-needed refused: ${issues.map(issue => issue.message).join("; ")}`);
  const who = provenance({ verb: "pin", by: notNeeded.decidedBy, skill: skillPath("producer", `pin.${agent}`) }, given);
  readLedger(entry.dir, "slot");
  replaceFile(slotFile(entry.dir), jsonBytes(next));
  if (existsSync(pinFile(entry.dir))) { unlinkSync(pinFile(entry.dir)); forgetSlotReads(); }
  appendEvent(entry.dir, "slot", ledgerEvent("not-needed", given?.at ?? nowIso(), who, { reason: notNeeded.reason, since: notNeeded.since, decidedBy: notNeeded.decidedBy },
    [recordState(entry.dir, "slot.json"), recordState(entry.dir, "pin.json")]));
  return next;
  });
}

/**
 * Set a slot's `options` and `varyOn` from its option class (CANDIDATE-OPTIONS), keeping every
 * other key. options 1 removes both keys (1 is the default). Returns true when slot.json changed.
 */
export function writeSlotOptions(consumer: string, agent: SlotAgent, id: string, input: { options: 1 | 2 | 3; varyOn?: string; at?: string }, given?: WriteProvenance): boolean {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
  const { doc } = located(consumer, agent, id);
  const { options: _options, varyOn: _varyOn, ...rest } = doc;
  const next: SlotDoc = input.options > 1 ? { ...rest, options: input.options, ...(input.varyOn ? { varyOn: input.varyOn } : {}) } : rest;
  const issues = validateSlotDoc(next);
  if (issues.length) throw new Error(`options refused: ${issues.map(issue => issue.message).join("; ")}`);
  const before = jsonBytes(doc), after = jsonBytes(next);
  if (before === after) return false;
  const who = provenance({ verb: "options", by: "planner", skill: skillPath("producer", "options") }, given);
  readLedger(entry.dir, "slot");
  replaceFile(slotFile(entry.dir), after);
  appendEvent(entry.dir, "slot", ledgerEvent("slot", input.at ?? nowIso(), who, { options: input.options, ...(input.varyOn ? { varyOn: input.varyOn } : {}) }, [recordState(entry.dir, "slot.json")]));
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
