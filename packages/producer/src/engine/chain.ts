/**
 * The event chain: `<root>/clossys/.state/events.jsonl` (STATE_DIR, the consumer-layout contract's stateDir), one JSON event per line, hash-chained (each line's `prev` is the
 * sha256 of the line before it, each line's `id` the sha256 of its own canonical fields). This module holds the
 * paths, hashing and reading of the log and `verifyChain()`, which names every gap, edit or reorder. The one writer is
 * engine/log.ts `appendEvent()`.
 *
 * A workspace root is the folder holding the consumer folder `clossys/` (cli/root.ts discoverRoot). A record under
 * `<root>/clossys/agents/<agent>/` or `<root>/clossys/library/` belongs to that root's log; a file outside any
 * consumer folder named `clossys` belongs to no workspace and logs no event.
 *
 * Node runs this file with type stripping in child writers (engine/*.test.ts, records/ledger.test.ts (not shipped)).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { STATE_DIR, stateRel } from "./state-dir.js";
import { GENESIS, eventIssues, type EngineEvent, type EventInput } from "./types.js";

/** The engine's files under a workspace root, workspace-relative: all under the contract's state folder. */
export const ENGINE_DIR = STATE_DIR;
export const EVENTS_FILE = stateRel("events.jsonl");
export const LOCK_FILE = stateRel("engine.lock");
export const INDEX_FILE = stateRel("index.json");
/** The consumer folder name a workspace root holds. */
export const CONSUMER_DIR = "clossys";
/** The agent trees whose records log events (records/slot-model MODEL_AGENTS). */
export const RECORD_AGENTS = ["director", "designer", "writer", "publisher", "producer"] as const;

export const enginePaths = (root: string) => ({
  dir: join(root, ENGINE_DIR),
  events: join(root, EVENTS_FILE),
  lock: join(root, LOCK_FILE),
  index: join(root, INDEX_FILE),
});

export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const toPosix = (path: string) => path.split(sep).join("/");

/** The event appendEvent was handed is not a valid draft; nothing was written. */
export class EngineEventError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`engine event refused: ${issues.slice(0, 5).join("; ")}`);
    this.name = "EngineEventError";
    this.issues = issues;
  }
}
/** The log cannot be appended to as it stands (a torn or invalid last line); nothing was written. */
export class EngineLogError extends Error {
  constructor(message: string) { super(message); this.name = "EngineLogError"; }
}

/** The workspace root a record path belongs to: the folder holding the last `clossys/{agents/<agent>|library}` above it. */
export function engineRootOf(path: string): string | undefined {
  const parts = resolve(path).split(sep);
  for (let index = parts.length - 2; index >= 1; index--) {
    if (parts[index] !== CONSUMER_DIR) continue;
    const next = parts[index + 1];
    if (next === "library" || (next === "agents" && (RECORD_AGENTS as readonly string[]).includes(parts[index + 2] ?? ""))) {
      return parts.slice(0, index).join(sep) || sep;
    }
  }
  return undefined;
}
/** The workspace root of a consumer folder: its parent when the folder is named `clossys`. */
export function consumerEngineRoot(consumer: string): string | undefined {
  const at = resolve(consumer);
  return basename(at) === CONSUMER_DIR ? dirname(at) : undefined;
}

/** The workspace-relative path of `path`; throws when it is outside the root. */
export function workspacePath(root: string, path: string): string {
  const rel = relative(resolve(root), resolve(path));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new EngineEventError([`${path} is outside the workspace ${root}`]);
  return toPosix(rel);
}
/** The inputs of an event: each file's workspace path and the sha256 of its bytes now (null when absent), sorted and unique. */
export function inputsOf(root: string, paths: readonly string[]): EventInput[] {
  const byPath = new Map<string, EventInput>();
  for (const path of paths) {
    const rel = workspacePath(root, path);
    let digest: string | null = null;
    try { digest = sha256(readFileSync(join(root, rel))); } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    byPath.set(rel, { path: rel, sha256: digest });
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The canonical JSON of an event without its id: fixed key order, no whitespace. */
export function canonical(event: Omit<EngineEvent, "id"> | EngineEvent): string {
  return JSON.stringify({
    schema: event.schema, seq: event.seq, prev: event.prev, actor: event.actor, kind: event.kind, subject: event.subject, at: event.at,
    inputs: event.inputs.map(input => ({ path: input.path, sha256: input.sha256 })),
  });
}
/** The bytes of an event line (no newline): the canonical fields plus the id. */
export function eventLine(event: Omit<EngineEvent, "id">): { line: string; event: EngineEvent } {
  const body = canonical(event);
  const id = sha256(body);
  return { line: `${body.slice(0, -1)},"id":"${id}"}`, event: { ...event, id } };
}

/** The log's lines (no trailing empty line), or none when the file is absent. */
export function readEventLines(root: string): { lines: string[]; torn: boolean } {
  let text: string;
  try { text = readFileSync(enginePaths(root).events, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { lines: [], torn: false };
    throw error;
  }
  if (text === "") return { lines: [], torn: false };
  const torn = !text.endsWith("\n");
  return { lines: (torn ? text : text.slice(0, -1)).split("\n"), torn };
}

export type ChainIssueCode = "malformed" | "torn" | "edit" | "gap" | "reorder";
export interface ChainIssue { readonly line: number; readonly code: ChainIssueCode; readonly message: string }
export interface ChainReport {
  readonly ok: boolean;
  readonly count: number;
  /** sha256 of the last line, or null for an empty log. */
  readonly head: string | null;
  readonly events: readonly EngineEvent[];
  readonly issues: readonly ChainIssue[];
}
/** The issue codes verifyChain reports, as engine.md lists them. */
export const CHAIN_ISSUES: readonly (readonly [ChainIssueCode, string])[] = [
  ["malformed", "a line is not JSON or not an event"],
  ["torn", "the file does not end with a newline (an interrupted append)"],
  ["edit", "a line no longer hashes to its own id, or the next line's prev is not its hash"],
  ["gap", "a seq is higher than the line before it plus one (a line was removed)"],
  ["reorder", "a seq is not higher than the line before it (lines were moved or duplicated)"],
];

/**
 * Verify the chain of `<root>/clossys/.state/events.jsonl` (or the given lines): every line an event, its id the hash of
 * its canonical fields, its seq one more than the line before, its prev the hash of the line before. Removing lines
 * from the end leaves a valid shorter chain; the index head (engine/derived.ts) is what notices that.
 */
export function verifyChain(root: string, given?: { lines: readonly string[]; torn?: boolean }): ChainReport {
  const { lines, torn } = given ? { lines: given.lines, torn: given.torn ?? false } : readEventLines(root);
  const issues: ChainIssue[] = [];
  const events: EngineEvent[] = [];
  let prevLine: string | undefined;
  let prevSeq = -1;
  lines.forEach((text, index) => {
    const at = index + 1;
    let doc: unknown;
    try { doc = JSON.parse(text); } catch { issues.push({ line: at, code: "malformed", message: `line ${at} is not JSON` }); prevLine = text; prevSeq++; return; }
    const shape = eventIssues(doc);
    if (shape.length) { issues.push({ line: at, code: "malformed", message: `line ${at}: ${shape[0]}` }); prevLine = text; prevSeq++; return; }
    const event = doc as EngineEvent;
    events.push(event);
    if (sha256(canonical(event)) !== event.id) issues.push({ line: at, code: "edit", message: `line ${at} (seq ${event.seq}) does not hash to its id: the line was edited` });
    if (event.seq <= prevSeq) issues.push({ line: at, code: "reorder", message: `line ${at} has seq ${event.seq} after seq ${prevSeq}: lines were moved or duplicated` });
    else if (event.seq > prevSeq + 1) issues.push({ line: at, code: "gap", message: `line ${at} has seq ${event.seq} after seq ${prevSeq}: ${event.seq - prevSeq - 1} line(s) missing` });
    const expected = prevLine === undefined ? GENESIS : sha256(prevLine);
    if (event.prev !== expected && !(event.seq !== prevSeq + 1)) issues.push({ line: at, code: "edit", message: `line ${at} (seq ${event.seq}) names prev ${event.prev.slice(0, 12)}, the line before hashes to ${expected.slice(0, 12)}: the line before was edited` });
    prevLine = text;
    prevSeq = event.seq;
  });
  if (torn) issues.push({ line: lines.length, code: "torn", message: `the log does not end with a newline: line ${lines.length} is an interrupted append` });
  return { ok: issues.length === 0, count: lines.length, head: lines.length ? sha256(lines[lines.length - 1]!) : null, events, issues };
}

/** Replace a derived engine file (temp file, then rename). Engine-internal: the index module writes through it under the lock. */
export function replaceEngineFile(root: string, rel: string, bytes: string): void {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, bytes, { flag: "wx" });
  try { renameSync(temp, file); } catch (error) { rmSync(temp, { force: true }); throw error; }
}
