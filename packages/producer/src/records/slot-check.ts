/**
 * `clossys check --slots [--readiness]`: the slot model's structure and coverage.
 *
 * check: folder == agents/<agent>/<slot-id> for every IA slot, slot.json ia == ia.json position, one pin, pin hash matches, a single `source`
 * key, no candidate-side status, inputs/uses name real slots, no orphans (ledger.json is a record of
 * the slot folder and the agent tree, records/ledger.ts); a slot's retired/ holds only well-formed retired candidates.
 *
 * Formats (foundry-build-0031): with `current` (what `clossys check` runs) a slot.json is judged in the
 * current format only: `clossys.slot/2` against schemas/slot.json, its candidates by their
 * clossys.candidate/1 header; a `clossys.slot/1` file is one finding naming `clossys migrate recut`. Without
 * it (the int2 verbs that still write slot/1 until their cutover) a slot/1 file is judged by the slot/1 rules
 * and a slot/2 file by the current ones.
 */
import { join } from "node:path";
import { validateAgainst } from "../constitution/schema.js";
import { sha256Hex } from "./hash.js";
import {
  AGENT_FILES, AGENT_KIND, CANDIDATE_NAME, CANDIDATES_DIR, IA_FILE, PIN_FILE, SLOT_AGENTS, SLOT_FILE, agentDir, candidatesDir, iaPath, isNonSlotEntry, slotDir, slotRel,
  slotPositions, validateIa, validatePin, pinRecords,
  type IaDoc, type PinDoc, type SlotAgent, type SlotModelIssue,
} from "./slot-model/index.js";
import { LEDGER_FILE } from "./ledger.js";
import { isModelDir, listModelDir, listSlots, modelExists, readModelBytes, readModelText, readiness, slotIndex, type Readiness } from "./slots.js";
import { isConvertedStore, isPin1, oldFormatRefusal } from "./store-format.js";
import { CURRENT_AGENT_KINDS, OLD_SLOT_FORMAT, candidateIssues, isOldSlot, placedAt, readSlotValue, slotReadIssues, type SlotRead } from "./slot-current.js";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const readJsonFile = (path: string): any => JSON.parse(readModelText(path));

const isDir = isModelDir;
const list = (path: string) => listModelDir(path).sort(cmp);

// ---------------- retired candidates ----------------
/** A slot's retired candidates, as `clossys retire` writes them: `<slot>/retired/<candidate>` beside `<candidate>.json`. */
export const RETIRED_DIR = "retired";
const RETIRE_RECORD = /^(.+-v[1-9][0-9]*\.(?:md|json))\.json$/;

/**
 * The `retired/` folder of slot `id`: every entry is a retired candidate file or its clossys.retire/1 record
 * (constitution schemas/retire.schema.json). A record names this slot and its own file name, its candidate's
 * bytes sit beside it and match its sha256, and the candidate is gone from candidates/; a candidate file has
 * a record. Anything else (a folder, an alias, another file) is an unexpected entry.
 */
function checkRetired(dir: string, rel: string, id: string, live: readonly string[]): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const bad = (name: string, message: string) => issues.push({ code: "retired-invalid", path: `${rel}/${name}`, message });
  const names = list(dir);
  const files = new Set<string>(), records = new Set<string>();
  for (const name of names) {
    const record = RETIRE_RECORD.exec(name)?.[1];
    if (record && CANDIDATE_NAME.test(record)) records.add(name);
    else if (CANDIDATE_NAME.test(name)) files.add(name);
    else issues.push({ code: "orphan", path: `${rel}/${name}`, message: `unexpected entry in retired folder of ${id}` });
  }
  const bytes = new Map<string, Buffer>();
  for (const name of files) {
    try { bytes.set(name, readModelBytes(join(dir, name))); } catch { /* not a regular file */ }
    if (!bytes.has(name)) issues.push({ code: "orphan", path: `${rel}/${name}`, message: `unexpected entry in retired folder of ${id}: not a regular file` });
    else if (!records.has(`${name}.json`)) bad(name, `retired candidate ${name} has no retire record ${name}.json`);
  }
  for (const name of records) {
    const candidate = name.slice(0, -".json".length);
    let value: unknown;
    try { value = readJsonFile(join(dir, name)); } catch { bad(name, "retire record is not a readable JSON file"); continue; }
    const found = validateAgainst("retire", value).map(error => `${error.at || "/"} ${error.message}`);
    const doc = (value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
    if (doc.slot !== id) found.push(`slot ${String(doc.slot)} is not this slot (${id})`);
    if (doc.candidate !== candidate) found.push(`candidate ${String(doc.candidate)} is not ${candidate}, the record's file name`);
    const file = bytes.get(candidate);
    if (!file) found.push(`the retired candidate ${candidate} is not beside its record`);
    else if (typeof doc.sha256 === "string" && sha256Hex(file) !== doc.sha256) found.push(`${candidate} bytes do not match the record sha256`);
    if (live.includes(candidate)) found.push(`${candidate} is still in candidates/`);
    if (found.length) bad(name, `retire record invalid: ${found.slice(0, 3).join("; ")}`);
  }
  return issues;
}

// ---------------- check ----------------
export interface SlotModelCheckOptions {
  /** Judge the current format only: a clossys.slot/1 slot.json is one OLD_SLOT_FORMAT finding. */
  readonly current?: boolean;
}
export function checkSlotModel(consumer: string, options: SlotModelCheckOptions = {}): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  // A store the store-format marker says is converted is judged in the current format only (U13): a slot/1
  // slot.json is the OLD_SLOT_FORMAT finding and a pin/1 pin.json a pin-invalid finding, whatever the caller asked.
  const converted = isConvertedStore(consumer);
  const current = options.current || converted;
  const ias = new Map<SlotAgent, IaDoc>();
  for (const agent of SLOT_AGENTS) {
    const path = iaPath(consumer, agent);
    if (!modelExists(path)) continue;
    let ia: unknown;
    try { ia = readJsonFile(path); } catch { issues.push({ code: "ia-invalid", path: `agents/${agent}/${IA_FILE}`, message: "ia.json is not JSON" }); continue; }
    const found = validateIa(ia, `agents/${agent}/${IA_FILE}`);
    issues.push(...found);
    if (!found.length) ias.set(agent, ia as IaDoc);
  }
  if (!ias.size && !issues.length) return [{ code: "ia-invalid", path: "agents", message: "no agents/<agent>/ia.json: the consumer has no slot model" }];
  const known = new Set<string>(), where = new Map<string, SlotAgent>();
  for (const [agent, ia] of ias) for (const id of slotPositions(agent, ia).keys()) { known.add(id); where.set(id, agent); }

  for (const [agent, ia] of ias) {
    const positions = slotPositions(agent, ia);
    const base = agentDir(consumer, agent);
    for (const [id, position] of positions) {
      const rel = `agents/${agent}/${slotRel(id)}`;
      const dir = slotDir(consumer, agent, id);
      if (!isDir(dir)) { issues.push({ code: "slot-missing", path: rel, message: `IA slot ${id} has no folder at agents/${agent}/${id}` }); continue; }
      let read: SlotRead | undefined;
      try {
        const value = readJsonFile(join(dir, SLOT_FILE));
        const path = `${rel}/${SLOT_FILE}`;
        const found = current && isOldSlot(value) ? [{ code: "slot-invalid" as const, path, message: OLD_SLOT_FORMAT }] : slotReadIssues(value, path);
        issues.push(...found);
        if (!found.length) read = readSlotValue(value, path);
      } catch { issues.push({ code: "slot-invalid", path: `${rel}/${SLOT_FILE}`, message: "slot.json is missing or not JSON" }); }
      if (read) {
        const doc = read.doc;
        if (!placedAt(read, id, agent, position)) issues.push({ code: "slot-mismatch", path: `${rel}/${SLOT_FILE}`, message: `slot.json disagrees with ia.json position for ${id}` });
        const kind = read.current?.kind ?? doc.kind;
        if (read.current ? !CURRENT_AGENT_KINDS[agent].includes(read.current.kind) : !AGENT_KIND[agent].includes(doc.kind)) issues.push({ code: "slot-mismatch", path: `${rel}/${SLOT_FILE}`, message: `kind ${kind} does not belong to ${agent}` });
        for (const key of ["inputs", "uses"] as const) for (const ref of doc[key]) if (!known.has(ref)) issues.push({ code: "ref-unknown", path: `${rel}/${SLOT_FILE}`, message: `${key} names ${ref}, which is not an IA slot` });
      }
      const names = list(candidatesDir(dir));
      if (read) for (const name of names) {
        const bytes = readModelText(join(candidatesDir(dir), name));
        issues.push(...candidateIssues(read, agent, id, name, bytes, `${rel}/${CANDIDATES_DIR}/${name}`));
      }
      const pins = list(dir).filter(name => /^pin.*\.json$/.test(name));
      if (pins.some(name => name !== PIN_FILE)) issues.push({ code: "pin-invalid", path: rel, message: `one pin only: pin.json (found ${pins.join(", ")})` });
      if (pins.includes(PIN_FILE)) {
        let pins: PinDoc[] = [];
        try {
          const value = readJsonFile(join(dir, PIN_FILE));
          const found = converted && isPin1(value) ? [{ code: "pin-invalid" as const, path: `${rel}/${PIN_FILE}`, message: oldFormatRefusal("pin.json") }] : validatePin(value, `${rel}/${PIN_FILE}`);
          issues.push(...found);
          if (!found.length) pins = pinRecords(value);
        } catch { issues.push({ code: "pin-invalid", path: `${rel}/${PIN_FILE}`, message: "pin.json is not JSON" }); }
        for (const pin of pins) {
          if (!names.includes(pin.candidate)) issues.push({ code: "pin-candidate", path: `${rel}/${PIN_FILE}`, message: `pinned candidate ${pin.candidate} does not exist` });
          else if (sha256Hex(readModelBytes(join(candidatesDir(dir), pin.candidate))) !== pin.sha256) issues.push({ code: "pin-hash", path: `${rel}/${PIN_FILE}`, message: `${pin.candidate} bytes do not match the pinned sha256` });
        }
      }
      for (const name of list(dir)) {
        if (name === RETIRED_DIR && isDir(join(dir, name))) { issues.push(...checkRetired(join(dir, name), `${rel}/${name}`, id, names)); continue; }
        if (![SLOT_FILE, PIN_FILE, CANDIDATES_DIR, LEDGER_FILE].includes(name) && !/^pin.*\.json$/.test(name)) issues.push({ code: "orphan", path: `${rel}/${name}`, message: `unexpected entry in slot folder ${id}` });
      }
    }
    // Orphans: agent-folder entries that are not an IA slot of this agent. The
    // layout is flat (agents/<agent>/<slot-id>), so grouping never shows up as
    // folders; `_`-prefixed folders (e.g. `_evidence`) are explicitly non-slot.
    for (const name of list(base)) {
      if (name === IA_FILE || name === LEDGER_FILE || AGENT_FILES[agent].includes(name)) continue;
      if (isNonSlotEntry(name) && isDir(join(base, name))) continue;
      if (positions.has(name)) continue;
      const home = where.get(name);
      if (home) issues.push({ code: "ia-path", path: `agents/${agent}/${name}`, message: `${name} belongs at agents/${home}/${name}` });
      else issues.push({ code: "orphan", path: `agents/${agent}/${name}`, message: `${name} is not a slot of the ${agent} IA` });
    }
  }
  return issues.sort((a, b) => cmp(a.path, b.path) || cmp(a.code, b.code));
}

// ---------------- coverage + readiness ----------------
export interface AgentCoverage { readonly agent: SlotAgent; readonly slots: number; readonly withCandidate: number; readonly pinned: number; readonly inputsUndeclared: number; readonly blocked: readonly { slot: string; readiness: Readiness }[] }
export function slotCoverage(consumer: string): AgentCoverage[] {
  const index = slotIndex(consumer);
  return SLOT_AGENTS.filter(agent => modelExists(iaPath(consumer, agent))).map(agent => {
    const entries = listSlots(consumer, agent);
    const blocked: { slot: string; readiness: Readiness }[] = [];
    let undeclared = 0;
    for (const entry of entries) {
      if (!modelExists(join(entry.dir, SLOT_FILE))) continue;
      const ready = readiness(consumer, agent, entry.id, index);
      if (ready.blockedBy.some(row => row.reason === "inputs-undeclared")) undeclared++;
      if (!ready.ready) blocked.push({ slot: entry.id, readiness: ready });
    }
    return { agent, slots: entries.length, withCandidate: entries.filter(entry => entry.candidates.length).length, pinned: entries.filter(entry => entry.pin).length, inputsUndeclared: undeclared, blocked };
  });
}

export function formatCoverage(rows: readonly AgentCoverage[], withReadiness: boolean): string {
  const lines = rows.map(row => `${row.agent}: ${row.slots} slots / ${row.withCandidate} with candidate / ${row.pinned} pinned; inputs-undeclared ${row.inputsUndeclared}`);
  if (withReadiness) for (const row of rows) {
    const blockers = new Map<string, number>();
    for (const { readiness: ready } of row.blocked) for (const by of ready.blockedBy) if (by.reason !== "inputs-undeclared") blockers.set(`${by.slot} (${by.reason})`, (blockers.get(`${by.slot} (${by.reason})`) ?? 0) + 1);
    const top = [...blockers].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
    lines.push(`${row.agent} blocked-by: ${top.length ? top.map(([slot, count]) => `${slot} x${count}`).join(", ") : "none"}`);
  }
  return lines.join("\n");
}

// ---------------- Writer candidate records ----------------
/** Writer record inside a cell body: `## locale`, `### key`, `<!-- meta -->`, text. */
export interface WriterRecord { readonly locale: string; readonly key: string; readonly meta: Record<string, unknown>; readonly text: string }
export function writerRecords(body: string): WriterRecord[] {
  const lines = body.split("\n"), out: WriterRecord[] = [];
  let locale = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ")) { locale = line.slice(3).trim(); continue; }
    if (!line.startsWith("### ")) continue;
    const key = line.slice(4).trim();
    const meta = /^<!-- (.+) -->$/.exec(lines[i + 1] ?? "");
    if (!meta) continue;
    i++;
    const text: string[] = [];
    while (i + 1 < lines.length && !lines[i + 1]!.startsWith("### ") && !lines[i + 1]!.startsWith("## ")) text.push(lines[++i]!);
    while (text.length && !text[text.length - 1]!.trim()) text.pop();
    out.push({ locale, key, meta: JSON.parse(meta[1]!) as Record<string, unknown>, text: text.join("\n") });
  }
  return out;
}
