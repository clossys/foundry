/**
 * Queue entries on disk (system.md 6.5, 8, 12.6): one file per entry at
 * `clossys/agents/producer/queue.<kind>/entries/<id>.json`.
 *
 * - A new entry is created exclusively (`wx`): an existing file is never overwritten, a colliding id takes the next
 *   free `-2` .. `-9` suffix.
 * - An existing entry changes only under its lock (`.clossys/locks/queue/<queue>/<id>.lock`, created exclusively; a
 *   held lock refuses, it is never broken automatically) and only by a temp-file write plus rename, so a reader sees
 *   the old bytes or the new bytes, never a torn file.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { QueueEntry, QueueName } from "../records/types.js";
import { actorLine, recordEvent } from "../engine/log.js";

export const QUEUE_NAMES: readonly QueueName[] = ["queue.pick", "queue.approve", "queue.clarify", "queue.fix"];
export const ENTRY_ID = /^[0-9]{8}T[0-9]{4}Z-[a-z0-9][a-z0-9-]*$/;

export const isQueueName = (value: string): value is QueueName => (QUEUE_NAMES as readonly string[]).includes(value);

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

export const producerDir = (root: string): string => join(root, "clossys", "agents", "producer");
export const queueEntriesDir = (root: string, queue: QueueName): string => join(producerDir(root), queue, "entries");
export const queueEntryPath = (root: string, queue: QueueName, id: string): string => join(queueEntriesDir(root, queue), `${id}.json`);

/** `clossys feedback` refuses: nothing is written and the CLI exits 1. Defined here so entry creation can raise it. */
export class FeedbackRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackRefused";
  }
}

export interface EntryFile {
  readonly queue: QueueName;
  readonly id: string;
  readonly file: string;
}

/** A clossys.queue-entry/2 fix shares the queue.fix folder (foundry-build-0048 U7); /1 readers leave it to the /2 store. */
function isQueueEntry2(file: string): boolean {
  try { return (JSON.parse(readFileSync(file, "utf8")) as { schema?: unknown }).schema === "clossys.queue-entry/2"; } catch { return false; }
}

/** Every queue entry file under the four queue folders, by queue then id. A /2 fix in queue.fix is not a /1 entry. */
export function listQueueEntryFiles(root: string): EntryFile[] {
  const out: EntryFile[] = [];
  for (const queue of QUEUE_NAMES) {
    const dir = queueEntriesDir(root, queue);
    if (!isDir(dir)) continue;
    for (const name of readdirSync(dir).filter(file => file.endsWith(".json")).sort()) {
      const file = join(dir, name);
      if (queue === "queue.fix" && isQueueEntry2(file)) continue;
      out.push({ queue, id: name.slice(0, -".json".length), file });
    }
  }
  return out;
}

export type EntryRead = { readonly ok: true; readonly entry: QueueEntry; readonly bytes: string } | { readonly ok: false; readonly reason: string };

/**
 * Reads one entry file; the entry's own `id` and `queue` must match its path. It is lax: it does not validate the
 * schema, the answer rules or that the status agrees with the events, so it must never judge closure. Every queue.fix
 * consumer that judges whether an entry is closed goes through queue/legacy-fix.ts (foundry-build-0048 U7 r3).
 */
export function readQueueEntry(at: EntryFile): EntryRead {
  let bytes: string;
  try { bytes = readFileSync(at.file, "utf8"); } catch { return { ok: false, reason: "cannot read the entry file" }; }
  let entry: unknown;
  try { entry = JSON.parse(bytes); } catch { return { ok: false, reason: "the entry file is not JSON" }; }
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false, reason: "the entry file is not a JSON object" };
  const doc = entry as Partial<QueueEntry>;
  if (doc.id !== at.id) return { ok: false, reason: `the entry id ${JSON.stringify(doc.id)} does not match its file name ${at.id}.json` };
  if (doc.queue !== at.queue) return { ok: false, reason: `the entry queue ${JSON.stringify(doc.queue)} does not match its folder ${at.queue}` };
  return { ok: true, entry: entry as QueueEntry, bytes };
}

export type EntryLookup = { readonly ok: true; readonly at: EntryFile } | { readonly ok: false; readonly reason: string };

/** Finds an entry by `<id>`, `queue.<kind>#<id>` or `producer/queue.<kind>#<id>`. */
export function findQueueEntry(root: string, name: string): EntryLookup {
  const match = /^(?:producer\/)?(queue\.[a-z]+)#(.+)$/.exec(name);
  const queue = match?.[1], id = match ? match[2]! : name;
  if (!ENTRY_ID.test(id)) return { ok: false, reason: `${name} is not a queue entry id (<yyyymmdd>T<hhmm>Z-<slug>)` };
  if (queue !== undefined) {
    if (!isQueueName(queue)) return { ok: false, reason: `${queue} is not a queue (${QUEUE_NAMES.join(", ")})` };
    const file = queueEntryPath(root, queue, id);
    return existsSync(file) ? { ok: true, at: { queue, id, file } } : { ok: false, reason: `no such entry: ${queue}#${id}` };
  }
  const found = QUEUE_NAMES.filter(candidate => existsSync(queueEntryPath(root, candidate, id)));
  if (found.length === 0) return { ok: false, reason: `no such entry: ${id}` };
  if (found.length > 1) return { ok: false, reason: `${id} is in ${found.join(" and ")}; name it as <queue>#<id>` };
  return { ok: true, at: { queue: found[0]!, id, file: queueEntryPath(root, found[0]!, id) } };
}

/** `yyyymmddThhmmZ` of an ISO timestamp. */
export function entryStamp(at: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  if (!match) throw new Error(`${at} is not an ISO timestamp`);
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}Z`;
}

/** A slug from free text: lowercase, `[a-z0-9-]`, at most 48 characters. */
export function slugOf(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return slug || "entry";
}

export const serializeEntry = (entry: QueueEntry): string => `${JSON.stringify(entry, null, 2)}\n`;

/**
 * Creates a new entry file exclusively. When `<id>` is taken the id gets the next free suffix (`-2` .. `-9`);
 * the returned entry carries the id it was written under. Never overwrites a file.
 */
export function createQueueEntry(root: string, entry: QueueEntry): QueueEntry {
  mkdirSync(queueEntriesDir(root, entry.queue), { recursive: true });
  for (let attempt = 1; attempt <= 9; attempt++) {
    const id = attempt === 1 ? entry.id : `${entry.id}-${attempt}`;
    const doc: QueueEntry = { ...entry, id };
    let fd: number;
    try { fd = openSync(queueEntryPath(root, entry.queue, id), "wx"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    try { writeSync(fd, serializeEntry(doc)); } finally { closeSync(fd); }
    recordEvent([queueEntryPath(root, entry.queue, id)], { actor: entryActor(doc), kind: "queue.create", subject: `${doc.queue}/${id}` });
    return doc;
  }
  throw new FeedbackRefused(`${entry.queue}#${entry.id}: the id and its suffixes -2..-9 are all taken; nothing was written (pass another --slug)`);
}

/** Replaces an existing entry's bytes by a temp file and a rename in the same folder. Call under its lock only. */
export function replaceQueueEntry(file: string, entry: QueueEntry): void {
  const temp = join(dirname(file), `.${entry.id}.${process.pid}.${Date.now()}.tmp`);
  const fd = openSync(temp, "wx");
  try { writeSync(fd, serializeEntry(entry)); } finally { closeSync(fd); }
  renameSync(temp, file);
  recordEvent([file], { actor: entryActor(entry), kind: "queue.replace", subject: `${entry.queue}/${entry.id}` });
}
/** Who made an entry's last change: its last event's `by`, else who created it. */
const entryActor = (entry: QueueEntry) => actorLine(entry.events.at(-1)?.by, actorLine(entry.createdBy, "code:queue"));

export const queueLockPath = (root: string, queue: QueueName, id: string): string => join(root, ".clossys", "locks", "queue", queue, `${id}.lock`);

export class EntryLockedError extends Error {
  // A plain field, not a parameter property: records/slot-write.ts reaches this module through the actor guard
  // (records/seat-owner.ts), and Node's type stripping runs slot-write.ts in child writers (records/ledger.test.ts (not shipped)).
  readonly lock: string;
  constructor(lock: string) {
    super(`the entry is locked by another writer (${lock}); nothing was written. If no writer is running, remove the lock file by hand`);
    this.name = "EntryLockedError";
    this.lock = lock;
  }
}

/** Runs `body` while holding the entry's lock; a held lock refuses with EntryLockedError. */
export function withQueueEntryLock<T>(root: string, queue: QueueName, id: string, body: () => T): T {
  const lock = queueLockPath(root, queue, id);
  mkdirSync(dirname(lock), { recursive: true });
  let fd: number;
  try { fd = openSync(lock, "wx"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new EntryLockedError(lock);
    throw error;
  }
  try {
    writeSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
    closeSync(fd);
    return body();
  } finally {
    rmSync(lock, { force: true });
  }
}
