/**
 * The slot-model writer: a new candidate in a slot's `candidates/`, and the slot's decision —
 * `pin.json` naming one candidate by the sha256 of its bytes, or slot.json `notNeeded`.
 * Candidates are immutable (a change is the next version); a decision is replaced, and its
 * history is git. Decisions are written through `clossys pin` (rule R-DECISIONS-BY-CLI).
 */
import { existsSync, lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CANDIDATE_NAME, KIND_EXT, candidatesDir, jsonBytes, pinFile, slotFile, validateCandidate, validatePin, validateSlotDoc,
  type NotNeeded, type PinBasis, type PinDoc, type SlotAgent, type SlotDoc,
} from "./slot-model/index.js";
import { listSlots, readCandidate, readSlot } from "./slots.js";

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
 * `:<message ref>`, or `migrated`); `basis` how (picked, bulk or planner). A `notNeeded` marker on
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
