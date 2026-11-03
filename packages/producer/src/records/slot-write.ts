/**
 * The slot-model writer: a new candidate in a slot's `candidates/`, and the slot's
 * `pin.json` naming one candidate by the sha256 of its bytes. Candidates are
 * immutable (a change is the next version); a pin is replaced, and its history is git.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATE_NAME, KIND_EXT, candidatesDir, jsonBytes, pinFile, validateCandidate, validatePin, type PinDoc, type SlotAgent } from "./slot-model/index.js";
import { listSlots, readCandidate, readSlot } from "./slots.js";

function located(consumer: string, agent: SlotAgent, id: string) {
  const doc = readSlot(consumer, agent, id);
  const entry = listSlots(consumer, agent).find(row => row.id === id);
  if (!entry) throw new Error(`${agent} slot ${id} is not in ia.json`);
  return { doc, entry };
}

/**
 * Write `<name>-v<next>` into the slot's candidates. JSON kinds take the item object
 * (serialized as two-space JSON); Markdown kinds take the file text. Invalid candidates are refused.
 */
export function writeCandidate(consumer: string, agent: SlotAgent, id: string, name: string, content: unknown): { name: string; sha256: string } {
  const { doc, entry } = located(consumer, agent, id);
  const ext = KIND_EXT[doc.kind];
  const versions = entry.candidates.map(file => CANDIDATE_NAME.exec(file)).filter(match => match?.[1] === name).map(match => Number(match![2]));
  const file = `${name}-v${Math.max(0, ...versions) + 1}.${ext}`;
  const bytes = ext === "md" ? String(content) : jsonBytes(content);
  const issues = validateCandidate(doc.kind, id, file, bytes);
  if (issues.length) throw new Error(`candidate refused: ${issues.map(issue => issue.message).join("; ")}`);
  mkdirSync(candidatesDir(entry.dir), { recursive: true });
  writeFileSync(join(candidatesDir(entry.dir), file), bytes, { flag: "wx" });
  return { name: file, sha256: readCandidate(consumer, agent, id, file).sha256 };
}

/** Pin one existing, valid candidate. `pinnedBy` is `owner:<message ref>`: the owner's approval. */
export function writePin(consumer: string, agent: SlotAgent, id: string, candidate: string, input: { pinnedBy: string; at: string }): PinDoc {
  const { doc, entry } = located(consumer, agent, id);
  if (!entry.candidates.includes(candidate)) throw new Error(`${agent} slot ${id} has no candidate ${candidate}`);
  const read = readCandidate(consumer, agent, id, candidate);
  const issues = validateCandidate(doc.kind, id, candidate, read.bytes);
  if (issues.length) throw new Error(`pin refused: ${issues.map(issue => issue.message).join("; ")}`);
  const pin: PinDoc = { candidate, sha256: read.sha256, pinnedBy: input.pinnedBy, at: input.at };
  const pinIssues = validatePin(pin);
  if (pinIssues.length) throw new Error(`pin refused: ${pinIssues.map(issue => issue.message).join("; ")}`);
  writeFileSync(pinFile(entry.dir), jsonBytes(pin));
  return pin;
}
