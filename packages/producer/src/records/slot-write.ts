/**
 * The slot-model writer: a new candidate in a slot's `candidates/`, and the slot's decision —
 * `pin.json` naming one candidate by the sha256 of its bytes, or slot.json `notNeeded`.
 * Candidates are immutable (a change is the next version); a decision is replaced, and its
 * history is git. Decisions are written through `clossys pin` (rule R-DECISIONS-BY-CLI).
 */
import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DirectorStore, DirectorStoreChange, DirectorStoreWriter } from "@clossys/director";
import {
  CANDIDATE_NAME, KIND_EXT, candidatesDir, jsonBytes, pinFile, slotFile, validateCandidate, validatePin, validateSlotDoc,
  type NotNeeded, type PinBasis, type PinDoc, type SlotAgent, type SlotDoc,
} from "./slot-model/index.js";
import { directorStoreReader, listSlots, readCandidate, readSlot } from "./slots.js";

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
  const { doc, entry } = located(consumer, agent, id);
  if (!entry.candidates.includes(candidate)) throw new Error(`${agent} slot ${id} has no candidate ${candidate}`);
  const read = readCandidate(consumer, agent, id, candidate);
  const issues = validateCandidate(doc.kind, id, candidate, read.bytes);
  if (issues.length) throw new Error(`pin refused: ${issues.map(issue => issue.message).join("; ")}`);
  const pin: PinDoc = { candidate, sha256: read.sha256, decidedBy: input.decidedBy, basis: input.basis, at: input.at };
  const pinIssues = validatePin(pin);
  if (pinIssues.length) throw new Error(`pin refused: ${pinIssues.map(issue => issue.message).join("; ")}`);
  if (doc.notNeeded) {
    const { notNeeded: _cleared, ...rest } = doc;
    writeFileSync(slotFile(entry.dir), jsonBytes(rest));
  }
  writeFileSync(pinFile(entry.dir), jsonBytes(pin));
  return pin;
}

/** Mark a slot not needed: slot.json `notNeeded {reason, since, decidedBy}`, and any pin.json removed. */
export function writeNotNeeded(consumer: string, agent: SlotAgent, id: string, notNeeded: NotNeeded): SlotDoc {
  const { doc, entry } = located(consumer, agent, id);
  const next: SlotDoc = { ...doc, notNeeded: { reason: notNeeded.reason, since: notNeeded.since, decidedBy: notNeeded.decidedBy } };
  const issues = validateSlotDoc(next);
  if (issues.length) throw new Error(`not-needed refused: ${issues.map(issue => issue.message).join("; ")}`);
  writeFileSync(slotFile(entry.dir), jsonBytes(next));
  if (existsSync(pinFile(entry.dir))) unlinkSync(pinFile(entry.dir));
  return next;
}

/**
 * Set a slot's `options` and `varyOn` from its option class (CANDIDATE-OPTIONS), keeping every
 * other key. options 1 removes both keys (1 is the default). Returns true when slot.json changed.
 */
export function writeSlotOptions(consumer: string, agent: SlotAgent, id: string, input: { options: 1 | 2 | 3; varyOn?: string }): boolean {
  const { doc, entry } = located(consumer, agent, id);
  const { options: _options, varyOn: _varyOn, ...rest } = doc;
  const next: SlotDoc = input.options > 1 ? { ...rest, options: input.options, ...(input.varyOn ? { varyOn: input.varyOn } : {}) } : rest;
  const issues = validateSlotDoc(next);
  if (issues.length) throw new Error(`options refused: ${issues.map(issue => issue.message).join("; ")}`);
  const before = jsonBytes(doc), after = jsonBytes(next);
  if (before === after) return false;
  writeFileSync(slotFile(entry.dir), after);
  return true;
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
    try { mkdirSync(lock); } catch { throw new Error("Strategy root is unavailable or another write is in progress"); }
    try { return action(); } finally { rmSync(lock, { recursive: true, force: true }); }
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
