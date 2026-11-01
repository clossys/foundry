/** Initial fill records agent-authored options; it never generates or pins them. */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listSlots, readCandidate, readIa, readSlot, type SlotEntry } from "./slots.js";
import {
  candidatesDir, parseFrontmatter, sameJson, SLOT_AGENTS, validateCandidate, validateIa,
  validatePin, validateSlotDoc, type SlotAgent, type SlotDoc, type SourceDoc,
} from "./slot-model/index.js";

export interface FillInput { readonly slot: string; readonly ref: string; readonly bytes: string }
export interface FillBlock { readonly slot: string; readonly reason: string }
export interface FillRow {
  readonly slot: string;
  readonly state: "existing" | "ready" | "blocked";
  readonly inputs: readonly FillInput[];
  readonly blockedBy: readonly FillBlock[];
}
export interface FillPlan {
  readonly agent: SlotAgent;
  readonly total: number;
  readonly withCandidate: number;
  readonly ready: number;
  readonly blocked: number;
  readonly rows: readonly FillRow[];
}

function checkedSlots(consumer: string, agent: SlotAgent): SlotEntry[] {
  const ia = readIa(consumer, agent);
  if (!ia) throw new Error(`WAITINPUT: ${agent} ia.json is missing`);
  const issues = validateIa(ia);
  if (issues.length) throw new Error(`WAITINPUT: ${agent} IA invalid: ${issues[0]!.message}`);
  return listSlots(consumer, agent);
}

function checkedDoc(consumer: string, entry: SlotEntry): SlotDoc {
  const doc = readSlot(consumer, entry.agent, entry.id);
  const issues = validateSlotDoc(doc);
  if (issues.length || doc.id !== entry.id || doc.agent !== entry.agent || !sameJson(doc.ia, entry.position)) {
    throw new Error(`WAITINPUT: ${entry.id} slot.json does not match its IA`);
  }
  return doc;
}

function inputFor(consumer: string, entry: SlotEntry): FillInput {
  const doc = checkedDoc(consumer, entry), pin = entry.pin;
  if (!pin) throw new Error("unpinned");
  if (validatePin(pin).length) throw new Error("invalid-pin");
  // A migration pin preserves history; it is not an owner's clearance.
  if (!pin.pinnedBy.startsWith("owner:")) throw new Error("owner-clearance-required");
  if (!entry.candidates.includes(pin.candidate)) throw new Error("pin-candidate-missing");
  const candidate = readCandidate(consumer, entry.agent, entry.id, pin.candidate);
  if (candidate.sha256 !== pin.sha256) throw new Error("pin-hash-mismatch");
  if (validateCandidate(doc.kind, doc.id, candidate.name, candidate.bytes).length) throw new Error("invalid-candidate");
  return {
    slot: entry.id,
    ref: `${entry.agent}:${entry.id}/${candidate.name}#sha256:${candidate.sha256}`,
    bytes: candidate.bytes,
  };
}

/** Read-only inventory in current IA order. Counts are measured, never targets. */
export function planSlotFill(consumer: string, agent: SlotAgent): FillPlan {
  const entries = checkedSlots(consumer, agent);
  const index = new Map<string, SlotEntry>();
  for (const upstream of SLOT_AGENTS) {
    if (!readIa(consumer, upstream)) continue;
    for (const entry of checkedSlots(consumer, upstream)) {
      if (index.has(entry.id)) throw new Error(`WAITINPUT: ambiguous slot ${entry.id}`);
      index.set(entry.id, entry);
    }
  }
  const rows: FillRow[] = entries.map(entry => {
    const doc = checkedDoc(consumer, entry);
    const root = candidatesDir(entry.dir);
    // Unknown files are not an empty slot; do not silently write beside them.
    if (entry.candidates.length) {
      return { slot: entry.id, state: "existing", inputs: [], blockedBy: [] };
    }
    const inputs: FillInput[] = [], blockedBy: FillBlock[] = [];
    if (existsSync(root) && readdirSync(root).length) blockedBy.push({ slot: entry.id, reason: "unexpected-candidate-file" });
    if (entry.pin) blockedBy.push({ slot: entry.id, reason: "pin-without-candidate" });
    if (!doc.inputs.length && agent !== "director") blockedBy.push({ slot: entry.id, reason: "inputs-undeclared" });
    for (const id of doc.inputs) {
      const upstream = index.get(id);
      if (!upstream) { blockedBy.push({ slot: id, reason: "missing" }); continue; }
      if (id === entry.id) { blockedBy.push({ slot: id, reason: "self-input" }); continue; }
      try { inputs.push(inputFor(consumer, upstream)); }
      catch (error) { blockedBy.push({ slot: id, reason: error instanceof Error ? error.message : "unreadable" }); }
    }
    return { slot: entry.id, state: blockedBy.length ? "blocked" : "ready", inputs, blockedBy };
  });
  return {
    agent, total: rows.length, withCandidate: rows.filter(row => row.state === "existing").length,
    ready: rows.filter(row => row.state === "ready").length,
    blocked: rows.filter(row => row.state === "blocked").length, rows,
  };
}

/** Record exactly one supplied option, rechecking clearance immediately before writing.
 * Draft is the absence of pin.json, never candidate-side status. */
export function recordInitialCandidate(
  consumer: string, agent: SlotAgent, slot: string, name: string, bytes: string,
): string {
  const row = planSlotFill(consumer, agent).rows.find(item => item.slot === slot);
  if (!row || row.state !== "ready") throw new Error(`WAITINPUT: ${slot} is ${row?.state ?? "outside the IA"}`);
  const entry = checkedSlots(consumer, agent).find(item => item.id === slot)!;
  const doc = checkedDoc(consumer, entry);
  const issues = validateCandidate(doc.kind, slot, name, bytes);
  if (issues.length) throw new Error(`invalid candidate: ${issues.map(issue => issue.message).join("; ")}`);
  const fields = name.endsWith(".md") ? parseFrontmatter(bytes) : null;
  const source: SourceDoc = fields?.ok ? fields.value.fields.source as SourceDoc : JSON.parse(bytes).meta.source;
  const refs = source.ref;
  for (const input of row.inputs) {
    if (!refs.includes(input.ref)) throw new Error(`candidate source must cite cleared input ${input.slot} with its hash`);
  }
  // Director roots need actual owner/evidence refs supplied by the agent, not invented inputs.
  if (agent === "director" && !row.inputs.length && !refs.length) throw new Error("Director root needs owner or evidence references");
  const root = candidatesDir(entry.dir);
  mkdirSync(root, { recursive: true });
  const path = join(root, name);
  writeFileSync(path, bytes, { flag: "wx" });
  return path;
}
