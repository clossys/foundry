/**
 * The pinned set of one agent, read through the shared slot reader (`slots.ts`): every IA slot
 * whose pin names intact, valid candidate bytes. This is what the agent verbs (`direct`,
 * `design`, `write`, `publish`) read; nothing here writes into the consumer.
 */
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { listSlots, readCandidate, readSlot } from "./slots.js";
import {
  CANDIDATE_NAME, candidatesDir, parseFrontmatter, pinFile, validateCandidate,
  type PinDoc, type SlotAgent, type SlotDoc,
} from "./slot-model/index.js";

export interface PinnedCandidate {
  readonly id: string;
  readonly agent: SlotAgent;
  readonly doc: SlotDoc;
  readonly pin: PinDoc;
  /** Candidate file name, e.g. `studio-essence-v1.md`. */
  readonly name: string;
  readonly version: number;
  readonly bytes: string;
  readonly sha256: string;
  /** Consumer-root-relative path, e.g. `clossys/agents/director/<id>/candidates/<name>`. */
  readonly path: string;
}
export type PinnedIssueReason = "invalid-pin" | "invalid-slot" | "missing-candidate" | "hash-drift" | "invalid-candidate";
export interface PinnedIssue { readonly agent: SlotAgent; readonly slot: string; readonly reason: PinnedIssueReason; readonly message: string }
export interface PinnedSet {
  readonly agent: SlotAgent;
  readonly pinned: readonly PinnedCandidate[];
  /** IA slots with no pin file (an owner decision still open; never an error here). */
  readonly unpinned: readonly string[];
  /** Pins that do not clear: they vouch for nothing and are reported. */
  readonly issues: readonly PinnedIssue[];
}

/** `<name>-v<n>.<ext>` → n. */
export const candidateVersion = (name: string): number => Number(CANDIDATE_NAME.exec(name)?.[2] ?? 0);

/** Every pinned slot of one agent, in IA order. `consumer` is the `clossys/` folder. */
export function readPinned(consumer: string, agent: SlotAgent): PinnedSet {
  const pinned: PinnedCandidate[] = [], unpinned: string[] = [], issues: PinnedIssue[] = [];
  const issue = (slot: string, reason: PinnedIssueReason, message: string) => { issues.push({ agent, slot, reason, message }); };
  for (const entry of listSlots(consumer, agent)) {
    if (!entry.pin) {
      if (existsSync(pinFile(entry.dir))) issue(entry.id, "invalid-pin", `${agent}/${entry.id}: pin.json is not a valid pin`);
      else unpinned.push(entry.id);
      continue;
    }
    let doc: SlotDoc;
    try { doc = readSlot(consumer, agent, entry.id); }
    catch (error) { issue(entry.id, "invalid-slot", error instanceof Error ? error.message : String(error)); continue; }
    let bytes: string, sha256: string;
    try { ({ bytes, sha256 } = readCandidate(consumer, agent, entry.id, entry.pin.candidate)); }
    catch { issue(entry.id, "missing-candidate", `${agent}/${entry.id}: pinned candidate ${entry.pin.candidate} is missing`); continue; }
    if (sha256 !== entry.pin.sha256) { issue(entry.id, "hash-drift", `${agent}/${entry.id}: ${entry.pin.candidate} bytes differ from the pinned sha256`); continue; }
    const invalid = validateCandidate(doc.kind, entry.id, entry.pin.candidate, bytes);
    if (invalid.length) { issue(entry.id, "invalid-candidate", `${agent}/${entry.id}: ${invalid[0]!.message}`); continue; }
    const name = entry.pin.candidate;
    const root = join(consumer, "..");
    pinned.push({ id: entry.id, agent, doc, pin: entry.pin, name, version: candidateVersion(name), bytes, sha256,
      path: relative(root, join(candidatesDir(entry.dir), name)).split(sep).join("/") });
  }
  return { agent, pinned, unpinned, issues };
}

/** A pinned Markdown candidate's frontmatter and body, with the body's first 1-based line. */
export function candidateDocument(candidate: Pick<PinnedCandidate, "bytes" | "path">): { fields: Readonly<Record<string, unknown>>; body: string; firstLine: number } {
  const parsed = parseFrontmatter(candidate.bytes);
  if (!parsed.ok) throw new Error(`${candidate.path}: ${parsed.message}`);
  const head = candidate.bytes.length - parsed.value.body.length;
  return { fields: parsed.value.fields, body: parsed.value.body, firstLine: candidate.bytes.slice(0, head).split("\n").length };
}

/** `agent:<slot>@<version>` refs a candidate's frontmatter `source.ref` names. */
export function agentRefs(fields: Readonly<Record<string, unknown>>, agent: SlotAgent): { slot: string; version: number; ref: string }[] {
  const source = fields.source as { ref?: unknown } | undefined;
  const refs = Array.isArray(source?.ref) ? source!.ref as unknown[] : [];
  const pattern = new RegExp(`^${agent}:([a-z0-9][a-z0-9.-]*)@([1-9][0-9]*)$`);
  return refs.flatMap(ref => {
    const match = typeof ref === "string" ? pattern.exec(ref) : null;
    return match ? [{ slot: match[1]!, version: Number(match[2]), ref: ref as string }] : [];
  });
}
