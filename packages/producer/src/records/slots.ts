/**
 * F3: the one slot-model reader. Slots are listed from each agent's ia.json, so
 * empty slots are listed too; candidates, pins and pin history come from the
 * slot folders. `usedBy` is computed across agents, never stored.
 *
 * When no `agents/<agent>/ia.json` exists the consumer is still on the old
 * stores and `hasSlotModel` is false; callers keep the old-store behavior.
 */
import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, statSync, watch, type FSWatcher, type Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DirectorStoreEntry, DirectorStoreError, DirectorStoreFault, DirectorStoreReader } from "@clossys/director";
import { sha256Hex } from "./hash.js";
import {
  CANDIDATE_NAME, MODEL_AGENTS, SEAT_AGENT, SLOT_AGENTS, agentDir, agentsDir, candidatesDir, iaPath, pinFile, retiredSeatFile, seatDir, slotDir, slotFile, slotPositions,
  validateCandidate, validateIa, validatePin, validateSlotDoc,
  type IaDoc, type ModelAgent, type NotNeeded, type PinDoc, type SlotAgent, type SlotDoc, type SlotPosition, type SlotStateResult,
} from "./slot-model/index.js";
import { isAbsent, parseJson } from "../errors.js";

export interface SlotEntry {
  readonly id: string;
  readonly agent: SlotAgent;
  readonly position: SlotPosition;
  /** Absolute slot folder. */
  readonly dir: string;
  /** Candidate file names in version order (empty slot = []). */
  readonly candidates: readonly string[];
  readonly pin: PinDoc | null;
  /** The slot's state as the one loader decides it: pinned, not-needed, or rejected. */
  readonly state: SlotStateResult;
}
export interface Candidate { readonly name: string; readonly bytes: string; readonly sha256: string }
export interface PinEvent extends PinDoc { readonly commit: string }
export type BlockReason = "inputs-undeclared" | "missing" | "unpinned" | "invalid-pin" | "missing-candidate" | "hash-drift" | "invalid-candidate" | "invalid-slot";
export interface Readiness { readonly ready: boolean; readonly blockedBy: readonly { readonly slot: string; readonly reason: BlockReason }[] }

/**
 * A read scope memoises the symlink walk for directories already proven symlink-free, so the
 * many reads of one call (or one Studio request) do not each lstat every ancestor up to `/`.
 * It lives only while its outermost synchronous call runs and at most SCOPE_TTL_MS: a symlink
 * that appears afterwards is rejected on the next read, exactly as without the memo. Leaf
 * files are never memoised; only directories that exist and are not links.
 */
interface ReadScope { readonly started: number; checked: Set<string> }
export const SCOPE_TTL_MS = 1000;
let scope: ReadScope | undefined;
/** Runs `fn` (synchronous) in one slot read scope; nested calls share the outermost scope. */
export function withSlotReadScope<T>(fn: () => T): T {
  if (scope) return fn();
  scope = { started: Date.now(), checked: new Set() };
  try { return fn(); } finally { scope = undefined; }
}
function scopedChecked(): Set<string> | undefined {
  if (!scope) return undefined;
  if (Date.now() - scope.started > SCOPE_TTL_MS) scope = { started: Date.now(), checked: new Set() };
  return scope.checked;
}

function assertModelPath(path: string): void {
  const checked = scopedChecked();
  const proven: string[] = [];
  let cursor = resolve(path);
  for (;;) {
    // A proven directory's ancestors were proven with it.
    if (checked?.has(cursor)) break;
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error("Symbolic links are not followed in the slot model");
      if (stat.isDirectory()) proven.push(cursor);
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  // Only a directory whose whole ancestor chain passed is memoised.
  if (checked) for (const dir of proven) checked.add(dir);
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

/**
 * Validated ia.json documents and their slot positions, keyed on the file's exact bytes: every
 * read still walks for symlinks and reads the file as before, and only an unchanged document
 * skips JSON parsing, validation and position resolution. An invalid document is never cached.
 * Cached documents are frozen so no caller can change what the next caller reads.
 */
interface IaCacheEntry { readonly bytes: string; readonly ia: IaDoc; readonly positions: ReadonlyMap<string, SlotPosition> }
const iaCache = new Map<string, IaCacheEntry>();
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function loadIa(consumer: string, agent: ModelAgent): IaCacheEntry | null {
  const path = iaPath(consumer, agent);
  assertModelPath(path);
  if (!existsSync(path)) { iaCache.delete(path); return null; }
  const bytes = readBytes(path);
  const cached = iaCache.get(path);
  if (cached?.bytes === bytes) return cached;
  iaCache.delete(path);
  const value = JSON.parse(bytes);
  if (validateIa(value, path).length) throw new Error(`Invalid ${agent} IA`);
  const ia = deepFreeze(value as IaDoc);
  const positions = slotPositions(agent, ia);
  for (const position of positions.values()) deepFreeze(position);
  const entry: IaCacheEntry = { bytes, ia, positions };
  iaCache.set(path, entry);
  return entry;
}

export function readIa(consumer: string, agent: SlotAgent): IaDoc | null {
  return withSlotReadScope(() => loadIa(consumer, agent)?.ia ?? null);
}

function versionOf(name: string): number { return Number(CANDIDATE_NAME.exec(name)?.[2] ?? 0); }
export function listCandidateNames(dir: string): string[] {
  return withSlotReadScope(() => candidateNamesAt(dir));
}
function candidateNamesAt(dir: string): string[] {
  const root = candidatesDir(dir);
  assertModelPath(root);
  if (!isDir(root)) return [];
  return readdirSync(root).filter(name => CANDIDATE_NAME.test(name))
    .sort((a, b) => versionOf(a) - versionOf(b) || (a < b ? -1 : a > b ? 1 : 0));
}

function locate(consumer: string, agent: SlotAgent, id: string): { position: SlotPosition; dir: string } {
  const position = loadIa(consumer, agent)?.positions.get(id);
  if (!position) throw new Error(`${agent} slot ${id} is not in ia.json`);
  return { position, dir: slotDir(consumer, agent, id) };
}

/** One seat of the Producer tree (the seat kind): a decide step's folder, placed by producer ia.json. */
export interface SeatEntry {
  readonly id: string;
  readonly position: SlotPosition;
  /** Absolute seat folder. */
  readonly dir: string;
  /** The pinned seat candidate's text, or undefined when the placed seat has no pin (an open seat). */
  readonly text: string | undefined;
}

/** Every seat producer ia.json places, in IA order; a seat without a pin is listed with no text. */
export function listSeats(consumer: string): SeatEntry[] {
  return withSlotReadScope(() => {
    const ia = loadIa(consumer, SEAT_AGENT);
    if (!ia) return [];
    return [...ia.positions].map(([id, position]) => ({ id, position, dir: seatDir(consumer, id), text: seatTextAt(consumer, id) }));
  });
}

/**
 * The pinned seat candidate's text of one decide step, read by step id whether or not producer
 * ia.json places it (check:git-cms fails an unplaced seat folder); undefined when the seat has no
 * pin.json. A pin that is malformed, names a missing candidate or drifts from its bytes throws, and
 * so does a retired seat.json: a seat is never read from anything but its pinned candidate.
 */
export function readSeatText(consumer: string, step: string): string | undefined {
  return withSlotReadScope(() => seatTextAt(consumer, step));
}

/** The placed seats' pin state, in IA order: `pinned`, `open` (no pin.json) or `rejected` (why). */
export function seatStates(consumer: string): { id: string; state: "pinned" | "open" | "rejected"; message?: string }[] {
  return withSlotReadScope(() => {
    const ia = loadIa(consumer, SEAT_AGENT);
    if (!ia) return [];
    return [...ia.positions.keys()].map(id => {
      try { return { id, state: seatTextAt(consumer, id) === undefined ? "open" as const : "pinned" as const }; }
      catch (error) { return { id, state: "rejected" as const, message: error instanceof Error ? error.message : String(error) }; }
    });
  });
}
const SEAT_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
function seatTextAt(consumer: string, step: string): string | undefined {
  if (!SEAT_ID.test(step)) throw new Error(`Invalid seat id ${JSON.stringify(step)}`);
  const dir = seatDir(consumer, step);
  const retired = retiredSeatFile(dir);
  assertModelPath(retired);
  if (existsSync(retired)) throw new Error(`Seat ${step}: seat.json is retired; a seat is a candidate file plus pin.json`);
  const path = pinFile(dir);
  assertModelPath(path);
  if (!existsSync(path)) return undefined;
  let value: unknown;
  try { value = JSON.parse(readBytes(path)); } catch { throw new Error(`Seat ${step}: pin.json is not JSON`); }
  const issues = validatePin(value, path);
  if (issues.length) throw new Error(`Seat ${step}: pin.json is invalid (${issues.map(issue => issue.message).join("; ")})`);
  const pin = value as PinDoc;
  const file = join(candidatesDir(dir), pin.candidate);
  assertModelPath(file);
  if (!existsSync(file)) throw new Error(`Seat ${step}: pinned candidate ${pin.candidate} does not exist`);
  const bytes = readBytes(file);
  if (sha256Hex(bytes) !== pin.sha256) throw new Error(`Seat ${step}: pin sha256 differs from ${pin.candidate}`);
  return bytes;
}

/** Every IA slot of one agent, in IA order; empty slots included. */
export function listSlots(consumer: string, agent: SlotAgent): SlotEntry[] {
  return withSlotReadScope(() => {
    const ia = loadIa(consumer, agent);
    if (!ia) return [];
    return [...ia.positions].map(([id, position]) => {
      const dir = slotDir(consumer, agent, id);
      const pin = readPinAt(dir);
      return { id, agent, position, dir, candidates: candidateNamesAt(dir), pin, state: decideSlotState(dir, pin) };
    });
  });
}

/**
 * One IA slot's entry, as `listSlots` would list it, without reading every other slot's folder.
 * Undefined when the id is not in the agent's IA.
 */
export function readSlotEntry(consumer: string, agent: SlotAgent, id: string): SlotEntry | undefined {
  return withSlotReadScope(() => {
    const position = loadIa(consumer, agent)?.positions.get(id);
    if (!position) return undefined;
    const dir = slotDir(consumer, agent, id);
    const pin = readPinAt(dir);
    return { id, agent, position, dir, candidates: candidateNamesAt(dir), pin, state: decideSlotState(dir, pin) };
  });
}

/**
 * The `notNeeded` marker in a slot's slot.json; `invalid` when the marker is present but malformed,
 * `{ unreadable }` when slot.json itself cannot be read or parsed (the slot is then rejected).
 */
function readNotNeeded(dir: string): NotNeeded | "invalid" | { readonly unreadable: string } | undefined {
  const path = slotFile(dir);
  assertModelPath(path);
  if (!existsSync(path)) return undefined;
  let value: unknown;
  try { value = readJson(path); } catch (error) { return { unreadable: error instanceof Error ? error.message : String(error) }; }
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "notNeeded")) return undefined;
  if (validateSlotDoc(value, path).some(issue => issue.message.startsWith("notNeeded"))) return "invalid";
  return (value as SlotDoc).notNeeded;
}

/**
 * The one place that decides slot state (closed union: `pinned` or `not-needed`). A slot in
 * neither state, in both, or with a malformed pin or marker is `rejected`; callers render the
 * rejection as an error and `check-slot-state` fails on it.
 */
function decideSlotState(dir: string, pin: PinDoc | null): SlotStateResult {
  const pinPresent = existsSync(pinFile(dir));
  const notNeeded = readNotNeeded(dir);
  if (notNeeded === "invalid") return { state: "rejected", reason: "invalid-slot", message: "slot.json notNeeded must be {reason, since, decidedBy}." };
  if (notNeeded && "unreadable" in notNeeded) return { state: "rejected", reason: "invalid-slot", message: `slot.json is not readable JSON: ${notNeeded.unreadable}` };
  if (pinPresent && notNeeded) return { state: "rejected", reason: "pinned-and-not-needed", message: "Slot is both pinned and marked not needed." };
  if (pinPresent && !pin) return { state: "rejected", reason: "invalid-pin", message: "pin.json is not a valid pin." };
  if (pin) return { state: "pinned", pin };
  if (notNeeded) return { state: "not-needed", notNeeded };
  return { state: "rejected", reason: "no-pin", message: "Slot is neither pinned nor marked not needed." };
}

export function readSlotState(consumer: string, agent: SlotAgent, id: string): SlotStateResult {
  return withSlotReadScope(() => {
    const dir = locate(consumer, agent, id).dir;
    return decideSlotState(dir, readPinAt(dir));
  });
}

export interface RejectedSlot { readonly agent: SlotAgent; readonly id: string; readonly reason: string; readonly message: string; readonly candidates: number }
/** Every IA slot, across agents, that the loader rejects (neither pinned nor not-needed). */
export function rejectedSlots(consumer: string): RejectedSlot[] {
  return withSlotReadScope(() => {
    const out: RejectedSlot[] = [];
    for (const agent of SLOT_AGENTS) for (const entry of listSlots(consumer, agent)) {
      if (entry.state.state === "rejected") out.push({ agent, id: entry.id, reason: entry.state.reason, message: entry.state.message, candidates: entry.candidates.length });
    }
    return out;
  });
}

/**
 * A schema-valid slot document and whether it is the document its IA position names (same id,
 * agent and position). Malformed documents throw `Invalid <agent> slot <id>`, as in `readSlot`.
 */
export function inspectSlot(consumer: string, agent: SlotAgent, id: string): { doc: SlotDoc; placed: boolean } {
  return withSlotReadScope(() => {
    const { position, dir } = locate(consumer, agent, id);
    const path = slotFile(dir);
    const value: unknown = readJson(path);
    if (validateSlotDoc(value, path).length) throw new Error(`Invalid ${agent} slot ${id}`);
    const doc = value as SlotDoc;
    const placed = doc.id === id && doc.agent === agent
      && doc.ia.l0 === position.l0 && doc.ia.l1 === position.l1
      && doc.ia.l2 === position.l2 && doc.ia.order === position.order;
    return { doc, placed };
  });
}

export function readSlot(consumer: string, agent: SlotAgent, id: string): SlotDoc {
  return withSlotReadScope(() => {
    const { doc, placed } = inspectSlot(consumer, agent, id);
    if (!placed) throw new Error(`Slot ${agent}/${id} does not match its IA position`);
    return doc;
  });
}

/**
 * A candidate file's stamp (inode, size, mtime and ctime in nanoseconds): every write to its bytes
 * changes it, so a reader cache keyed on it re-reads and re-hashes the candidate. A cache key, never
 * a decision (the pin decides by the candidate's sha256).
 */
export function candidateStamp(consumer: string, agent: SlotAgent, id: string, name: string): string {
  return withSlotReadScope(() => {
    if (!CANDIDATE_NAME.test(name)) throw new Error(`invalid candidate name ${name}`);
    const path = join(candidatesDir(locate(consumer, agent, id).dir), name);
    assertModelPath(path);
    const stat = lstatSync(path, { bigint: true });
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  });
}

export function readCandidate(consumer: string, agent: SlotAgent, id: string, name: string): Candidate {
  return withSlotReadScope(() => {
    if (!CANDIDATE_NAME.test(name)) throw new Error(`invalid candidate name ${name}`);
    const bytes = readBytes(join(candidatesDir(locate(consumer, agent, id).dir), name));
    return { name, bytes, sha256: sha256Hex(bytes) };
  });
}

function readPinAt(dir: string): PinDoc | null {
  const path = pinFile(dir);
  assertModelPath(path);
  if (!existsSync(path)) return null;
  const parsed = parseJson(readBytes(path));
  // A present pin.json that does not parse or validate is no pin: decideSlotState rejects the
  // slot as invalid-pin and the model check reports it; it never clears an input or acts as an
  // authoring fallback merely because its file is present.
  if (!parsed.ok) return null;
  return validatePin(parsed.value, path).length ? null : parsed.value as PinDoc;
}
export function readPin(consumer: string, agent: SlotAgent, id: string): PinDoc | null {
  return withSlotReadScope(() => {
    return readPinAt(locate(consumer, agent, id).dir);
  });
}

/** The git top level holding `cwd`, or undefined outside a git checkout (or without git); other git failures surface. */
function gitTopLevel(cwd: string): string | undefined {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || /not a git repository/.test(String((error as { stderr?: unknown }).stderr ?? ""))) return undefined;
    throw error;
  }
}

/** Pin history from git (newest first); outside git, the current pin only. */
export function pinHistory(consumer: string, agent: SlotAgent, id: string): PinEvent[] {
  return withSlotReadScope(() => {
    const dir = locate(consumer, agent, id).dir, path = pinFile(dir);
    const top = gitTopLevel(consumer);
    if (top !== undefined) {
      const rel = relative(top, path).split(sep).join("/");
      // --follow keeps history across slot-folder moves (the flat layout, or any
      // future regroup); each commit is read at the path the file had then.
      const log = execFileSync("git", ["log", "--follow", "--format=%x00%H", "--name-only", "--", rel], { cwd: top, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const commits = log.split("\0").filter(Boolean).map(chunk => {
        const [commit = "", ...paths] = chunk.split("\n").map(line => line.trim()).filter(Boolean);
        return { commit, path: paths[0] ?? rel };
      });
      const read = commits.map(({ commit, path: at }) => {
        try { return { commit, at, bytes: execFileSync("git", ["show", `${commit}:${at}`], { cwd: top, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
        catch (error) {
          // Deleted in this commit: an unpin, not a pin event. Any other git failure surfaces.
          if (/does not exist in|exists on disk, but not in/.test(String((error as { stderr?: unknown }).stderr ?? ""))) return { commit, at, bytes: undefined };
          throw error;
        }
      });
      const events: PinEvent[] = [];
      for (const [index, entry] of read.entries()) {
        if (entry.bytes === undefined) continue;
        const older = read[index + 1];
        // A pure move (new path, same bytes) is not a pin event.
        if (older && older.at !== entry.at && older.bytes === entry.bytes) continue;
        let doc: PinDoc & { pinnedBy?: string };
        try { doc = JSON.parse(entry.bytes) as PinDoc & { pinnedBy?: string }; }
        catch (error) { throw new Error(`${entry.at} at ${entry.commit}: committed pin.json is not JSON (${error instanceof Error ? error.message : String(error)})`); }
        // Pins written before `clossys pin` named the decider `pinnedBy`.
        const { pinnedBy, ...pin } = doc;
        events.push({ ...pin, decidedBy: pin.decidedBy ?? pinnedBy ?? "", commit: entry.commit });
      }
      if (events.length) return events;
    }
    const current = readPinAt(dir);
    return current ? [{ ...current, commit: "working-tree" }] : [];
  });
}

/** Slots in any agent whose slot.json `uses` names this slot. Every present document must be valid and placed. */
export function usedBy(consumer: string, slot: string): { agent: SlotAgent; id: string }[] {
  return withSlotReadScope(() => {
    return scanUsedBy(consumer, slot, (agent, id) => readSlot(consumer, agent, id));
  });
}

/**
 * `usedBy` for a projection of one slot: a present document that is schema-invalid or does not
 * match its IA position vouches for nothing and is skipped (its own detail and its consumers'
 * readiness report it). Unreadable, aliased or irregular files still throw.
 */
export function usedByPlaced(consumer: string, slot: string): { agent: SlotAgent; id: string }[] {
  return withSlotReadScope(() => {
    return scanUsedBy(consumer, slot, (agent, id) => {
      try {
        const { doc, placed } = inspectSlot(consumer, agent, id);
        return placed ? doc : undefined;
      } catch (error) {
        if (error instanceof Error && error.message === `Invalid ${agent} slot ${id}`) return undefined;
        throw error;
      }
    });
  });
}

function scanUsedBy(consumer: string, slot: string, read: (agent: SlotAgent, id: string) => SlotDoc | undefined): { agent: SlotAgent; id: string }[] {
  const out: { agent: SlotAgent; id: string }[] = [];
  for (const agent of SLOT_AGENTS) for (const entry of listSlots(consumer, agent)) {
    const path = slotFile(entry.dir);
    if (!existsSync(path)) continue;
    if (read(agent, entry.id)?.uses.includes(slot)) out.push({ agent, id: entry.id });
  }
  return out;
}

/** Index of slot id -> its agent and entry, across all agents. */
export function slotIndex(consumer: string): Map<string, SlotEntry> {
  return withSlotReadScope(() => {
    const index = new Map<string, SlotEntry>();
    for (const agent of SLOT_AGENTS) for (const entry of listSlots(consumer, agent)) index.set(entry.id, entry);
    return index;
  });
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
  return withSlotReadScope(() => {
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
  });
}

// ---------------- one reader: every other module opens agents/** through these ----------------
// D1 (SLOT-WIRING-LOCK): this file is the only code that opens slot-model paths
// (`check:single-reader` fails on any other opener). The functions below give callers
// with their own semantics (status counts, migrations, the model check, Studio
// presence) the access they need without a second reader.

/**
 * Refuse anything that is not a consumer's `agents/` folder or inside one of its model agents
 * (`agents/<director|designer|writer|publisher|producer>/…`), and any path with a symbolic link in
 * it: the same no-alias rule every other slot-model read keeps.
 */
function modelScoped(path: string): string {
  const target = resolve(path);
  const parts = target.split(sep);
  const at = parts.findIndex((part, i) => part === "agents" && i > 0 && (i === parts.length - 1 || (MODEL_AGENTS as readonly string[]).includes(parts[i + 1]!)));
  if (at < 0) throw new Error(`Not a slot-model path: ${path}`);
  assertModelPath(dirname(target));
  return target;
}
/** A model file read: scoped, no alias anywhere (the file included), a regular file. */
function modelFile(path: string): string {
  const target = modelScoped(path);
  if (!lstatSync(target).isFile()) throw new Error("Expected a regular slot-model file");
  return target;
}

/** True when `<dir>/agents` is a directory (a consumer root, or a workspace's `clossys/`). */
export function hasModelRoot(dir: string): boolean {
  return statSync(agentsDir(dir), { throwIfNoEntry: false })?.isDirectory() === true;
}
/** True when this agent's ia.json exists (the agent is on the slot model). */
export function hasAgentModel(consumer: string, agent: SlotAgent): boolean {
  return existsSync(iaPath(consumer, agent));
}
/** True when the slot folder holds a pin.json entry, valid or not (a dangling alias counts). */
export function hasPinFile(dir: string): boolean {
  try { lstatSync(pinFile(dir)); return true; }
  catch (error) { if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false; throw error; }
}
/** `mtime:size` of a slot's pin.json, or `-` when there is none: a cache key, never a decision. */
export function pinStamp(dir: string): string {
  try { const stat = statSync(pinFile(dir)); return `${stat.mtimeMs}:${stat.size}`; } catch (error) { if (isAbsent(error)) return "-"; throw error; }
}
/** Whether a model path exists, without following its last component. */
export function modelPresence(path: string): "present" | "missing" | "error" {
  try { lstatSync(modelScoped(path)); return "present"; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "error"; }
}
/** Whether a model path exists, without following its last component (an alias counts; reads refuse it). */
export function modelExists(path: string): boolean {
  const target = modelScoped(path);
  try { lstatSync(target); return true; }
  catch (error) { if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false; throw error; }
}
/** A real (non-alias) directory under the model; false for a path outside a model agent. */
export function isModelDir(path: string): boolean {
  let target: string;
  try { target = modelScoped(path); } catch (error) { if ((error as Error).message.startsWith("Not a slot-model path")) return false; throw error; }
  return isDir(target);
}
/** The names in a real model directory (unsorted, as the OS returns them); [] when absent or not a directory. */
export function listModelDir(path: string): string[] { return isModelDir(path) ? readdirSync(path) : []; }
/**
 * The raw text of a model file, unvalidated: for status counts,
 * migrations and the model check, which report malformed files themselves. Never selection authority.
 */
export function readModelText(path: string): string { return readFileSync(modelFile(path), "utf8"); }
/** The raw bytes of a model file (exact hashing), as `readModelText`. */
export function readModelBytes(path: string): Buffer { return readFileSync(modelFile(path)); }

/** The raw text of a slot folder's own record (slot.json or pin.json); aliases refused; undefined when absent. */
export function readSlotRecordText(dir: string, file: "slot.json" | "pin.json"): string | undefined {
  const path = file === "pin.json" ? pinFile(dir) : slotFile(dir);
  assertModelPath(path);
  if (!existsSync(path)) return undefined;
  return readBytes(path);
}
/**
 * An agent-level file (`agents/<agent>/<name>`: Writer `declarations.json`, Designer
 * `globals.css`); aliases refused; undefined when absent.
 */
export function readAgentFile(consumer: string, agent: SlotAgent, name: string): string | undefined {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(name) || name.includes("..")) throw new Error(`invalid agent file ${name}`);
  const path = join(agentDir(consumer, agent), name);
  assertModelPath(path);
  if (!existsSync(path)) return undefined;
  return readBytes(path);
}
/**
 * The regular files of an agent's non-slot folder (`agents/director/_evidence`), name -> text.
 * Aliases refused; other entries skipped; {} when the folder is absent.
 */
export function readAgentFolder(consumer: string, agent: SlotAgent, folder: string): Record<string, string> {
  if (!/^_[a-z0-9-]+$/.test(folder)) throw new Error(`invalid non-slot folder ${folder}`);
  const dir = join(agentDir(consumer, agent), folder);
  assertModelPath(dir);
  const files: Record<string, string> = {};
  let names: string[] = [];
  try { names = readdirSync(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const name of names.sort()) {
    const path = join(dir, name);
    if (lstatSync(path).isSymbolicLink()) throw new Error("Symbolic links are not followed in the slot model");
    if (lstatSync(path).isFile()) files[name] = readFileSync(path, "utf8");
  }
  return files;
}

/** Refuse aliases, secret-like names and irregular entries anywhere under the slot agents' folders. */
export function assertModelTree(consumer: string): void {
  const safe = (path: string) => {
    let cursor = resolve(path);
    for (;;) {
      try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("Symlink input is unsupported."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
    }
    return path;
  };
  const tree = (path: string): void => {
    safe(path);
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isDirectory()) for (const name of readdirSync(path)) {
      if (name === ".env" || name.startsWith(".env.")) throw new Error("Secret-like input is unsupported.");
      tree(join(path, name));
    }
    else if (!stat.isFile()) throw new Error("Model input must be a regular file or directory.");
  };
  safe(consumer);
  for (const agent of SLOT_AGENTS) {
    const base = safe(agentDir(consumer, agent));
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) tree(join(base, name));
  }
}

/**
 * One recursive watcher on `<consumer>/agents`, also when it is absent (the nearest existing
 * ancestor is watched). `onChange` gets the changed path's segments relative to `agents/`.
 */
export async function watchSlotModel(consumer: string, onChange: (segments: string[] | null) => void): Promise<() => void> {
  const target = agentsDir(resolve(consumer));
  let watched = target;
  for (;;) {
    try {
      const stat = await lstat(watched);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Expected a regular agents directory");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(watched); if (parent === watched) throw error; watched = parent;
    }
  }
  let closed = false;
  const watcher: FSWatcher = watch(watched, { recursive: true }, (_type, filename) => {
    if (closed || filename === null) return;
    const rel = relative(target, resolve(watched, String(filename)));
    if (rel === ".." || rel.startsWith(`..${sep}`)) return;
    onChange(rel.split(sep));
  });
  watcher.on("error", () => { if (!closed) onChange(null); });
  return () => { closed = true; watcher.close(); };
}

// ---------------------------------------------------------------------------
// Director's strategy store reader. @clossys/director owns no filesystem access
// to its store; `clossys director …` injects this reader (and slot-write.ts's
// writer). Reads are uncached, root-confined and never follow a symbolic link.
// ---------------------------------------------------------------------------

function storeError(fault: DirectorStoreFault, message: string): DirectorStoreError {
  return Object.assign(new Error(message), { fault });
}
function absentError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
function entryType(stat: Stats): DirectorStoreEntry["type"] {
  return stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
}
/** The real root directory; a symlink root, or a root that is absent or not a directory, refuses. */
function storeAnchor(root: string): string {
  let stat: Stats;
  try { stat = lstatSync(resolve(root)); } catch { throw storeError("root-unreadable", "Strategy root is unreadable or is not a directory"); }
  if (stat.isSymbolicLink()) throw storeError("root-symlink", "Symlink roots are not followed");
  let anchor: string;
  try { anchor = realpathSync(resolve(root)); } catch { throw storeError("root-unreadable", "Strategy root is unreadable or is not a directory"); }
  if (!lstatSync(anchor).isDirectory()) throw storeError("root-unreadable", "Strategy root is unreadable or is not a directory");
  return anchor;
}
/**
 * Confine a root-relative path: no escape, no symbolic link in any component, and a
 * real path inside the root. Undefined when a component is absent. With `finalLink`,
 * a symbolic link as the last component is returned unresolved (stat reports it, never follows it).
 */
function storePath(anchor: string, path: string, finalLink = false): string | undefined {
  const rel = relative(anchor, resolve(anchor, path));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw storeError("outside", "Path resolves outside the strategy root");
  let current = anchor;
  const parts = rel.split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        if (finalLink && index === parts.length - 1) return current;
        throw storeError("symlink", "Symlink paths are not followed");
      }
    } catch (error) {
      if ((error as Partial<DirectorStoreError>).fault) throw error;
      if (absentError(error)) return undefined;
      throw storeError("path-unreadable", "Path could not be read");
    }
  }
  let real: string;
  try { real = realpathSync(current); } catch (error) {
    if (absentError(error)) return undefined;
    throw storeError("path-unreadable", "Path could not be read");
  }
  const inside = relative(anchor, real);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw storeError("outside", "Path resolves outside the strategy root");
  return real;
}

export const directorStoreReader: DirectorStoreReader = {
  stat(root, path) {
    if (path === ".") {
      let stat: Stats;
      try { stat = lstatSync(resolve(root)); } catch (error) {
        if (absentError(error)) return undefined;
        throw storeError("root-unreadable", "Strategy root is unreadable or is not a directory");
      }
      // A symlink root is reported, not used: its real path is where it points (itself when dangling).
      let real = resolve(root);
      try { real = realpathSync(real); } catch (error) { if (!stat.isSymbolicLink()) throw storeError("root-unreadable", "Strategy root is unreadable or is not a directory"); }
      return { type: entryType(stat), links: stat.nlink, dev: stat.dev, ino: stat.ino, real };
    }
    const full = storePath(storeAnchor(root), path, true);
    if (full === undefined) return undefined;
    const stat = lstatSync(full);
    return { type: entryType(stat), links: stat.nlink, dev: stat.dev, ino: stat.ino, real: full };
  },
  list(root, path) {
    const full = storePath(storeAnchor(root), path);
    if (full === undefined) return undefined;
    if (!lstatSync(full).isDirectory()) throw storeError("not-directory", "Expected a directory");
    try { return readdirSync(full).sort(); } catch { throw storeError("io", "Directory could not be listed"); }
  },
  read(root, path) {
    const anchor = storeAnchor(root);
    const full = storePath(anchor, path);
    if (full === undefined) return undefined;
    if (!lstatSync(full).isFile()) throw storeError("not-file", "Expected a regular file");
    let fd: number | undefined;
    try {
      try { fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { if (absentError(error)) return undefined; throw storeError("io", "File could not be read"); }
      const opened = fstatSync(fd);
      if (!opened.isFile()) throw storeError("not-file", "Expected a regular file");
      // Recheck the confined path after open, before reading its bytes.
      const current = storePath(anchor, path);
      if (current === undefined) throw storeError("changed", "File changed during confinement checks");
      const now = lstatSync(current);
      if (opened.dev !== now.dev || opened.ino !== now.ino) throw storeError("changed", "File changed during confinement checks");
      try { return readFileSync(fd, "utf8"); } catch { throw storeError("io", "File could not be read"); }
    } finally { if (fd !== undefined) closeSync(fd); }
  },
};
