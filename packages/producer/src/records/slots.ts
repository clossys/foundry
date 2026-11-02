/**
 * F3: the one slot-model reader. Slots are listed from each agent's ia.json, so
 * empty slots are listed too; candidates, pins and pin history come from the
 * slot folders. `usedBy` is computed across agents, never stored.
 *
 * When no `agents/<agent>/ia.json` exists the consumer is still on the old
 * stores and `hasSlotModel` is false; callers keep the old-store behavior.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { sha256Hex } from "./hash.js";
import {
  CANDIDATE_NAME, SLOT_AGENTS, candidatesDir, iaPath, pinFile, slotDir, slotFile, slotPositions,
  validateCandidate, validateIa, validatePin, validateSlotDoc,
  type IaDoc, type PinDoc, type SlotAgent, type SlotDoc, type SlotPosition,
} from "./slot-model/index.js";

export interface SlotEntry {
  readonly id: string;
  readonly agent: SlotAgent;
  readonly position: SlotPosition;
  /** Absolute slot folder. */
  readonly dir: string;
  /** Candidate file names in version order (empty slot = []). */
  readonly candidates: readonly string[];
  readonly pin: PinDoc | null;
}
export interface Candidate { readonly name: string; readonly bytes: string; readonly sha256: string }
export interface PinEvent extends PinDoc { readonly commit: string }
export type BlockReason = "inputs-undeclared" | "missing" | "unpinned" | "invalid-pin" | "missing-candidate" | "hash-drift" | "invalid-candidate" | "invalid-slot";
export interface Readiness { readonly ready: boolean; readonly blockedBy: readonly { readonly slot: string; readonly reason: BlockReason }[] }

function assertModelPath(path: string): void {
  let cursor = resolve(path);
  for (;;) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("Symbolic links are not followed in the slot model"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
function readBytes(path: string): string {
  assertModelPath(path);
  if (!lstatSync(path).isFile()) throw new Error("Expected a regular slot-model file");
  return readFileSync(path, "utf8");
}
const readJson = (path: string): any => JSON.parse(readBytes(path));
const isDir = (path: string) => { try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } };

/** True once any agent folder carries an ia.json (the flag-free switch). */
export function hasSlotModel(consumer: string): boolean {
  return SLOT_AGENTS.some(agent => existsSync(iaPath(consumer, agent)));
}

export function readIa(consumer: string, agent: SlotAgent): IaDoc | null {
  const path = iaPath(consumer, agent);
  assertModelPath(path);
  if (!existsSync(path)) return null;
  const value = readJson(path);
  if (validateIa(value, path).length) throw new Error(`Invalid ${agent} IA`);
  return value as IaDoc;
}

function versionOf(name: string): number { return Number(CANDIDATE_NAME.exec(name)?.[2] ?? 0); }
export function listCandidateNames(dir: string): string[] {
  const root = candidatesDir(dir);
  assertModelPath(root);
  if (!isDir(root)) return [];
  return readdirSync(root).filter(name => CANDIDATE_NAME.test(name))
    .sort((a, b) => versionOf(a) - versionOf(b) || (a < b ? -1 : a > b ? 1 : 0));
}

function locate(consumer: string, agent: SlotAgent, id: string): { position: SlotPosition; dir: string } {
  const ia = readIa(consumer, agent);
  const position = ia ? slotPositions(agent, ia).get(id) : undefined;
  if (!position) throw new Error(`${agent} slot ${id} is not in ia.json`);
  return { position, dir: slotDir(consumer, agent, position, id) };
}

/** Every IA slot of one agent, in IA order; empty slots included. */
export function listSlots(consumer: string, agent: SlotAgent): SlotEntry[] {
  const ia = readIa(consumer, agent);
  if (!ia) return [];
  return [...slotPositions(agent, ia)].map(([id, position]) => {
    const dir = slotDir(consumer, agent, position, id);
    return { id, agent, position, dir, candidates: listCandidateNames(dir), pin: readPinAt(dir) };
  });
}

export function readSlot(consumer: string, agent: SlotAgent, id: string): SlotDoc {
  const { position, dir } = locate(consumer, agent, id);
  const path = slotFile(dir);
  const value: unknown = readJson(path);
  if (validateSlotDoc(value, path).length) throw new Error(`Invalid ${agent} slot ${id}`);
  const doc = value as SlotDoc;
  if (doc.id !== id || doc.agent !== agent
    || doc.ia.l0 !== position.l0 || doc.ia.l1 !== position.l1
    || doc.ia.l2 !== position.l2 || doc.ia.order !== position.order) {
    throw new Error(`Slot ${agent}/${id} does not match its IA position`);
  }
  return doc;
}

export function readCandidate(consumer: string, agent: SlotAgent, id: string, name: string): Candidate {
  if (!CANDIDATE_NAME.test(name)) throw new Error(`invalid candidate name ${name}`);
  const bytes = readBytes(join(candidatesDir(locate(consumer, agent, id).dir), name));
  return { name, bytes, sha256: sha256Hex(bytes) };
}

function readPinAt(dir: string): PinDoc | null {
  const path = pinFile(dir);
  assertModelPath(path);
  if (!existsSync(path)) return null;
  const bytes = readBytes(path);
  let value: unknown;
  try { value = JSON.parse(bytes); } catch { return null; }
  // The model check reports malformed pins; they never clear an input or act
  // as an authoring fallback merely because their file is present.
  return validatePin(value, path).length ? null : value as PinDoc;
}
export function readPin(consumer: string, agent: SlotAgent, id: string): PinDoc | null {
  return readPinAt(locate(consumer, agent, id).dir);
}

/** Pin history from git (newest first); outside git, the current pin only. */
export function pinHistory(consumer: string, agent: SlotAgent, id: string): PinEvent[] {
  const dir = locate(consumer, agent, id).dir, path = pinFile(dir);
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: consumer, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const rel = relative(top, path).split(sep).join("/");
    const commits = execFileSync("git", ["log", "--format=%H", "--", rel], { cwd: top, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
    const events: PinEvent[] = [];
    for (const commit of commits) {
      try { events.push({ ...JSON.parse(execFileSync("git", ["show", `${commit}:${rel}`], { cwd: top, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as PinDoc, commit }); }
      catch { /* deleted in this commit: an unpin, not a pin event */ }
    }
    if (events.length) return events;
  } catch { /* not a git checkout */ }
  const current = readPinAt(dir);
  return current ? [{ ...current, commit: "working-tree" }] : [];
}

/** Slots in any agent whose slot.json `uses` names this slot. */
export function usedBy(consumer: string, slot: string): { agent: SlotAgent; id: string }[] {
  const out: { agent: SlotAgent; id: string }[] = [];
  for (const agent of SLOT_AGENTS) for (const entry of listSlots(consumer, agent)) {
    const path = slotFile(entry.dir);
    if (!existsSync(path)) continue;
    if (readSlot(consumer, agent, entry.id).uses.includes(slot)) out.push({ agent, id: entry.id });
  }
  return out;
}

/** Index of slot id -> its agent and entry, across all agents. */
export function slotIndex(consumer: string): Map<string, SlotEntry> {
  const index = new Map<string, SlotEntry>();
  for (const agent of SLOT_AGENTS) for (const entry of listSlots(consumer, agent)) index.set(entry.id, entry);
  return index;
}

/** Only a valid pin over the current, valid candidate bytes clears an input. */
function inputBlocker(entry: SlotEntry): BlockReason | undefined {
  const path = pinFile(entry.dir);
  if (!existsSync(path)) return "unpinned";
  let pin: PinDoc;
  try {
    const value = readJson(path);
    if (validatePin(value, path).length) return "invalid-pin";
    pin = value as PinDoc;
  } catch { return "invalid-pin"; }
  let candidate: Candidate;
  try {
    const bytes = readBytes(join(candidatesDir(entry.dir), pin.candidate));
    candidate = { name: pin.candidate, bytes, sha256: sha256Hex(bytes) };
  }
  catch { return "missing-candidate"; }
  if (candidate.sha256 !== pin.sha256) return "hash-drift";
  let doc: SlotDoc;
  try {
    doc = readJson(slotFile(entry.dir)) as SlotDoc;
    if (validateSlotDoc(doc).length) return "invalid-slot";
    if (doc.id !== entry.id || doc.agent !== entry.agent) return "invalid-slot";
    if (doc.ia.l1 !== entry.position.l1 || doc.ia.l2 !== entry.position.l2 || doc.ia.l0 !== entry.position.l0 || doc.ia.order !== entry.position.order) return "invalid-slot";
  } catch { return "invalid-slot"; }
  if (validateCandidate(doc.kind, entry.id, candidate.name, candidate.bytes).length) return "invalid-candidate";
  return undefined;
}

/** A slot is ready when it declares inputs and every input has an intact pin. */
export function readiness(consumer: string, agent: SlotAgent, id: string, index = slotIndex(consumer)): Readiness {
  const doc = readSlot(consumer, agent, id);
  // Director slots are the roots of the chain: no inputs is their declared state (planner, 2026-10-31).
  if (!doc.inputs.length && agent === "director") return { ready: true, blockedBy: [] };
  if (!doc.inputs.length) return { ready: false, blockedBy: [{ slot: id, reason: "inputs-undeclared" }] };
  const blockedBy: { slot: string; reason: BlockReason }[] = [];
  for (const input of doc.inputs) {
    const entry = index.get(input);
    if (!entry) blockedBy.push({ slot: input, reason: "missing" });
    else {
      const reason = inputBlocker(entry);
      if (reason) blockedBy.push({ slot: input, reason });
    }
  }
  return { ready: blockedBy.length === 0, blockedBy };
}
