/**
 * The slot-model writer: a new candidate in a slot's `candidates/`, and the slot's decision —
 * `pin.json` naming one candidate by the sha256 of its bytes, or slot.json `notNeeded`.
 * Candidates are immutable (a change is the next version); a decision is replaced, and its
 * history is git. Decisions are written through `clossys pin` (rule R-DECISIONS-BY-CLI).
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
import { directorStoreReader, listSlots, readCandidate, readSlot } from "./slots.js";

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
  try { return action(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
/** Replace `path` by renaming a fully written sibling over it: a reader sees the old bytes or the new, never a torn file. */
function replaceFile(path: string, bytes: string): void {
  const staged = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(staged, bytes, { flag: "wx" });
  try { renameSync(staged, path); } catch (error) { rmSync(staged, { force: true }); throw error; }
}
/** One decision write per slot at a time. */
const SLOT_LOCK = ".slot-write.lock";
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

/**
 * Write `<name>-v<next>` into the slot's candidates. JSON kinds take the item object
 * (serialized as two-space JSON); Markdown kinds take the file text. Invalid candidates are refused.
 * `canonical` also refuses aliased candidate paths (no ancestor may be a symbolic link).
 */
export function writeCandidate(consumer: string, agent: SlotAgent, id: string, name: string, content: unknown, options: { readonly canonical?: boolean } = {}): { name: string; sha256: string } {
  const { doc, entry } = located(consumer, agent, id);
  const ext = KIND_EXT[doc.kind];
  const versions = entry.candidates.map(file => CANDIDATE_NAME.exec(file)).filter(match => match?.[1] === name).map(match => Number(match![2]));
  const file = `${name}-v${Math.max(0, ...versions) + 1}.${ext}`;
  const bytes = ext === "md" ? String(content) : jsonBytes(content);
  const issues = validateCandidate(doc.kind, id, file, bytes);
  if (issues.length) throw new Error(`candidate refused: ${issues.map(issue => issue.message).join("; ")}`);
  const directory = candidatesDir(entry.dir);
  if (options.canonical) canonicalDirectory(directory);
  mkdirSync(directory, { recursive: true });
  if (options.canonical && realpathSync(directory) !== resolve(directory)) throw new Error("candidate refused: candidate directory leaves its canonical path");
  writeFileSync(join(directory, file), bytes, { flag: "wx" });
  return { name: file, sha256: readCandidate(consumer, agent, id, file).sha256 };
}

/**
 * Pin one existing, valid candidate. `decidedBy` names who decided (owner or planner, optionally
 * `:<message ref>`, `agent:<seat>`, or `migrated`); `basis` how (PIN_BASES). A `notNeeded` marker on
 * the slot is cleared: the pin replaces it.
 */
export function writePin(consumer: string, agent: SlotAgent, id: string, candidate: string, input: { decidedBy: string; basis: PinBasis; at: string }): PinDoc {
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
  replaceFile(pinFile(entry.dir), jsonBytes(pin));
  if (doc.notNeeded) {
    const { notNeeded: _cleared, ...rest } = doc;
    replaceFile(slotFile(entry.dir), jsonBytes(rest));
  }
  return pin;
  });
}

/**
 * The owner confirms an agent pick (owner Foundry Director round 8, "Agent pick + your confirm"): the
 * pin stays the agent's (`decidedBy: agent:<seat>`, basis `agent`, its candidate, hash and time) and
 * gains `confirmed: {by, ref, at}`. Refused unless the slot's current pin is an agent pick of exactly
 * this candidate with matching bytes: a confirmation never changes what is pinned.
 */
export function writeConfirm(consumer: string, agent: SlotAgent, id: string, candidate: string, input: { by: string; ref: string; at: string }): PinDoc {
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
    replaceFile(path, jsonBytes(pin));
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

/** Mark a slot not needed: slot.json `notNeeded {reason, since, decidedBy}`, and any pin.json removed. */
export function writeNotNeeded(consumer: string, agent: SlotAgent, id: string, notNeeded: NotNeeded): SlotDoc {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
  const { doc } = located(consumer, agent, id);
  const next: SlotDoc = { ...doc, notNeeded: { reason: notNeeded.reason, since: notNeeded.since, decidedBy: notNeeded.decidedBy } };
  const issues = validateSlotDoc(next);
  if (issues.length) throw new Error(`not-needed refused: ${issues.map(issue => issue.message).join("; ")}`);
  replaceFile(slotFile(entry.dir), jsonBytes(next));
  if (existsSync(pinFile(entry.dir))) unlinkSync(pinFile(entry.dir));
  return next;
  });
}

/**
 * Set a slot's `options` and `varyOn` from its option class (CANDIDATE-OPTIONS), keeping every
 * other key. options 1 removes both keys (1 is the default). Returns true when slot.json changed.
 */
export function writeSlotOptions(consumer: string, agent: SlotAgent, id: string, input: { options: 1 | 2 | 3; varyOn?: string }): boolean {
  const { entry } = located(consumer, agent, id);
  return slotLocked(entry.dir, () => {
  const { doc } = located(consumer, agent, id);
  const { options: _options, varyOn: _varyOn, ...rest } = doc;
  const next: SlotDoc = input.options > 1 ? { ...rest, options: input.options, ...(input.varyOn ? { varyOn: input.varyOn } : {}) } : rest;
  const issues = validateSlotDoc(next);
  if (issues.length) throw new Error(`options refused: ${issues.map(issue => issue.message).join("; ")}`);
  const before = jsonBytes(doc), after = jsonBytes(next);
  if (before === after) return false;
  replaceFile(slotFile(entry.dir), after);
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
