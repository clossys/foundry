/**
 * The one writer of `.clossys/events.jsonl` (engine/chain.ts holds the format and verifyChain). `appendEvent()`
 * validates a draft, takes the workspace's engine lock (engine/lock.ts), chains the event to the last line, appends it
 * as one line and keeps the derived index (engine/derived.ts), all under the lock. `recordEvent()` is the call a record
 * writer makes after it left its files; inside `deferEvents()` (every slot-record lock) it holds the event until the
 * write commits, so a write its guard refuses and undoes logs nothing.
 *
 * A record writer's event comes after its files are on disk, so an append that fails then (the engine busy past the
 * wait, a torn log tail) cannot undo the write: it surfaces as RecordCommittedError (code RECORD_COMMITTED), never as
 * the EngineBusyError a caller may retry, so no caller writes the record a second time.
 *
 * Node runs this file with type stripping in child writers (engine/*.test.ts, records/ledger.test.ts (not shipped)).
 */
import { closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CONSUMER_DIR, EngineEventError, EngineLogError, enginePaths, engineRootOf, eventLine, inputsOf, sha256 } from "./chain.js";
import { indexAfterAppend, rebuildIndexUnlocked, type EngineIndex } from "./derived.js";
import { ENGINE_LOCK_WAIT_MS, withEngineLock } from "./lock.js";
import { EVENT_SCHEMA, GENESIS, draftIssues, eventIssues, type EngineEvent, type EventDraft } from "./types.js";

export interface AppendOptions {
  /** How long to wait for a live engine lock (default ENGINE_LOCK_WAIT_MS). */
  readonly waitMs?: number;
}

/** The last line of the log and whether the file ends without a newline; reads only the tail. */
function lastLine(file: string): { line: string | undefined; torn: boolean } {
  let fd: number;
  try { fd = openSync(file, "r"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { line: undefined, torn: false };
    throw error;
  }
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return { line: undefined, torn: false };
    for (let chunk = 4096; ; chunk *= 4) {
      const start = Math.max(0, size - chunk);
      const buffer = Buffer.alloc(size - start);
      readSync(fd, buffer, 0, buffer.length, start);
      const text = buffer.toString("utf8");
      const torn = !text.endsWith("\n");
      const body = torn ? text : text.slice(0, -1);
      const at = body.lastIndexOf("\n");
      if (at >= 0 || start === 0) return { line: body.slice(at + 1), torn };
    }
  } finally { closeSync(fd); }
}

/** Run `action` under the workspace's engine lock. */
function locked<T>(root: string, action: () => T, waitMs = ENGINE_LOCK_WAIT_MS): T {
  const paths = enginePaths(root);
  mkdirSync(paths.dir, { recursive: true });
  return withEngineLock(paths.lock, action, waitMs);
}

/**
 * Append one event to the workspace's log. Validates the draft, takes the engine lock, chains the event to the last
 * line (`seq`, `prev`), writes it as one line (fsync) and keeps the derived index. Refuses, writing nothing, on an
 * invalid draft (EngineEventError), a torn or invalid last line (EngineLogError) or a lock held past the wait
 * (EngineBusyError).
 */
export function appendEvent(root: string, draft: EventDraft, options: AppendOptions = {}): EngineEvent {
  const at = resolve(root);
  const inputs = [...draft.inputs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const given = { actor: draft.actor, kind: draft.kind, subject: draft.subject, at: draft.at ?? new Date().toISOString(), inputs };
  const issues = draftIssues(given);
  if (issues.length) throw new EngineEventError(issues);
  const paths = enginePaths(at);
  return locked(at, () => {
    const tail = lastLine(paths.events);
    if (tail.torn) throw new EngineLogError(`${paths.events} ends in a torn line (no newline); run clossys check --engine; nothing was written`);
    let seq = 0;
    let prev = GENESIS;
    if (tail.line !== undefined) {
      let last: unknown;
      try { last = JSON.parse(tail.line); } catch { throw new EngineLogError(`${paths.events}: the last line is not JSON; run clossys check --engine; nothing was written`); }
      const lastIssues = eventIssues(last);
      if (lastIssues.length) throw new EngineLogError(`${paths.events}: the last line is not an event (${lastIssues[0]}); nothing was written`);
      seq = (last as EngineEvent).seq + 1;
      prev = sha256(tail.line);
    }
    const { line, event } = eventLine({ schema: EVENT_SCHEMA, seq, prev, ...given });
    const fd = openSync(paths.events, "a");
    try { writeSync(fd, `${line}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    indexAfterAppend(at, event, line, tail.line);
    return event;
  }, options.waitMs);
}

/**
 * A record write is on disk but its engine event was not appended (the cause: the engine busy past the wait, a torn
 * log tail, an invalid draft). The write is done and must not be retried: a retry would write the record again.
 */
export class RecordCommittedError extends Error {
  readonly code = "RECORD_COMMITTED";
  /** The subjects whose events were not appended. */
  readonly subjects: readonly string[];
  constructor(subjects: readonly string[], cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`record committed: the write of ${subjects.join(", ")} is on disk, but its engine event was not appended (${why}). Do not retry the write: it is done, and a retry would write the record a second time`, { cause });
    this.name = "RecordCommittedError";
    this.subjects = subjects;
  }
}

/** Append the event of a write whose files are already on disk: any failure is a RecordCommittedError (not retryable). */
export function commitEvent(root: string, draft: EventDraft, options?: AppendOptions): EngineEvent {
  try { return appendEvent(root, draft, options); } catch (error) { throw new RecordCommittedError([draft.subject], error); }
}

/**
 * Log one event about record files a writer just left: the workspace root comes from the first path
 * (chain.ts engineRootOf), the inputs are every path with the sha256 of its bytes now. A path outside any workspace
 * logs nothing and returns undefined.
 */
export function recordEvent(paths: readonly string[], draft: Omit<EventDraft, "inputs">, options?: AppendOptions): EngineEvent | undefined {
  const root = paths.length ? engineRootOf(paths[0]!) : undefined;
  if (root === undefined) return undefined;
  return logEvent(root, { ...draft, inputs: inputsOf(root, paths) }, options);
}

/** An event a record write holds until it commits (`deferEvents`): its draft is whole (`at` and inputs fixed when it was made). */
interface HeldEvent { readonly root: string; readonly draft: EventDraft; readonly options?: AppendOptions }
let held: HeldEvent[] | undefined;

/**
 * Append `draft` to the log of `root` (the event of a write already on disk: `commitEvent`), or hold it while a
 * `deferEvents` write is open (returns undefined then). A held draft is validated now, with its `at` fixed now, so a
 * bad draft refuses at the call that made it.
 */
export function logEvent(root: string, draft: EventDraft, options?: AppendOptions): EngineEvent | undefined {
  if (held === undefined) return commitEvent(root, draft, options);
  const whole: EventDraft = { ...draft, at: draft.at ?? new Date().toISOString() };
  const issues = draftIssues({ actor: whole.actor, kind: whole.kind, subject: whole.subject, at: whole.at!, inputs: whole.inputs });
  if (issues.length) throw new EngineEventError(issues);
  held.push({ root: resolve(root), draft: whole, ...(options ? { options } : {}) });
  return undefined;
}

/**
 * Run a synchronous record write as one transaction of engine events (engine.md "The one writer"): every event
 * `recordEvent`/`logEvent` makes inside it is held and appended in order when `write` returns. A write its guard
 * refuses puts its files back (records/slot-write.ts restoreFiles) and drops the held events naming them
 * (`dropHeldEvents`), so the log never names bytes that are gone. A write that throws without undoing keeps its
 * events, since what it wrote stays on disk. A scope opened inside another joins the outer one: its events are held
 * past the inner scope (and past any record lock the inner write released) and append when the outermost write
 * returns. A held event that cannot be appended at the commit is a RecordCommittedError: the write is on disk.
 */
export function deferEvents<T>(write: () => T): T {
  if (held !== undefined) return write();
  const mine: HeldEvent[] = [];
  held = mine;
  let out: T;
  try { out = write(); }
  catch (error) {
    held = undefined;
    // The write's own error is the one its caller acts on; events that cannot be appended show as drift (check --engine).
    try { appendHeld(mine); } catch { /* reported by the write's error */ }
    throw error;
  }
  held = undefined;
  appendHeld(mine);
  return out;
}
function appendHeld(events: readonly HeldEvent[]): void {
  for (const [index, event] of events.entries()) {
    try { appendEvent(event.root, event.draft, event.options); }
    catch (error) { throw new RecordCommittedError(events.slice(index).map(rest => rest.draft.subject), error); }
  }
}

/** Drop the held events that name any of `paths` (absolute): the write put those files back as they were. */
export function dropHeldEvents(paths: Iterable<string>): void {
  if (held === undefined) return;
  const absolute = [...paths].map(path => resolve(path));
  const keep = held.filter(event => !event.draft.inputs.some(input => absolute.includes(join(event.root, ...input.path.split("/")))));
  held.splice(0, held.length, ...keep);
}

/** A record's actor as one line (an Actor object, e.g. a pin's or entry's createdBy, by its kind and ref). */
export function actorLine(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim() && !/[\r\n]/.test(value)) return value;
  if (value && typeof value === "object") {
    const actor = value as Record<string, unknown>;
    const kind = typeof actor.actor === "string" ? actor.actor : undefined;
    const ref = [actor.ref, actor.agent, actor.cli, actor.package].find(item => typeof item === "string" && item && !/[\r\n]/.test(item));
    if (kind) return ref ? `${kind}:${ref as string}` : kind;
  }
  return fallback;
}
/** The subject of a record path: its folder under `<root>/clossys/agents/` (`<agent>/<slot>`), or under `<root>/clossys/`. */
export function recordSubject(path: string): string | undefined {
  const root = engineRootOf(path);
  if (root === undefined) return undefined;
  const rel = relative(join(root, CONSUMER_DIR), dirname(resolve(path))).split(sep).join("/");
  return rel.startsWith("agents/") ? rel.slice("agents/".length) : rel;
}

/** `clossys index --rebuild`: the index written from the log plus the records, under the engine lock. */
export function rebuildIndex(root: string, options: AppendOptions = {}): EngineIndex {
  const at = resolve(root);
  return locked(at, () => rebuildIndexUnlocked(at), options.waitMs);
}
