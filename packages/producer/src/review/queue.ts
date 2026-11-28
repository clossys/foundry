/**
 * The one run queue of mechanical runs on a machine: every review, re-run and executor install that needs a heavy
 * slot waits here, in one order, for as long as it takes.
 *
 * - Order (QUEUE_ORDER): an install for an active executor first, then reviews, then re-runs; within a kind, the
 *   longer critical path first (the run more downstream work waits on); then first come, first served.
 * - Admission: a queued run starts only when a heavy slot is free and no queued run ahead of it in that order is
 *   waiting for one. Capacity is the machine's heavy-slot count, given by the caller; this module never guesses it.
 * - Waits are real: wait() sleeps between looks and returns only when the run is admitted or cancelled. There is no
 *   try count and no give-up path; a run that cannot start keeps its place.
 * - A newer head supersedes: enqueuing a run for a unit cancels every queued or running run of that unit at another
 *   head (a running one is signalled to stop). A cancelled run never starts.
 *
 * State is one JSON file in the queue folder, changed only under a lock folder (mkdir is atomic), so separate
 * processes share one queue. A lock whose holder process is gone is taken over.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const QUEUE_SCHEMA = "clossys.run-queue/1";

export type RunKind = "install" | "review" | "rerun";
export type RunState = "queued" | "running" | "done" | "cancelled";

export interface QueueRequest {
  /** The unit (packet id) the run is for: a newer head of the same unit supersedes this one. */
  readonly unit: string;
  readonly head: string;
  readonly kind: RunKind;
  /** install only: the executor is active (working now), so its install goes first. */
  readonly activeExecutor?: boolean;
  /** How many units wait downstream of this one; larger goes first within a kind. */
  readonly criticalPath?: number;
  /** false: the run takes no heavy slot and is admitted at once. Default true. */
  readonly heavy?: boolean;
}

export interface QueueEntry extends Required<Omit<QueueRequest, "activeExecutor">> {
  readonly id: string;
  readonly activeExecutor: boolean;
  readonly seq: number;
  readonly state: RunState;
  readonly enqueuedAt: string;
  readonly pid?: number;
  readonly startedAt?: string;
  readonly endedAt?: string;
  /** cancelled: the run that superseded it. */
  readonly supersededBy?: string;
}

export interface QueueFile { readonly schema: typeof QUEUE_SCHEMA; readonly seq: number; readonly entries: readonly QueueEntry[] }

/** The order of QUEUE_ORDER, as text for the doc and the Reviewer skill. */
export const QUEUE_ORDER = "installs for active executors, then reviews, then re-runs; within a kind the longer critical path, then the earlier enqueue";

export interface QueueOptions {
  readonly dir: string;
  /** Heavy slots on this machine (at least 1). */
  readonly capacity: number;
  /** Sleep between looks (ms); the default blocks the thread. */
  readonly sleep?: (ms: number) => void;
  readonly pollMs?: number;
  readonly pid?: number;
  /** How a superseded running run is told to stop; the default sends SIGTERM and ignores a process already gone. */
  readonly kill?: (pid: number) => void;
  /** Whether a process is alive (stale-lock takeover); default process.kill(pid, 0). */
  readonly alive?: (pid: number) => boolean;
  readonly now?: () => Date;
}

const blockingSleep = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const defaultAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } };
const defaultKill = (pid: number) => { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } };

const KIND_RANK = (entry: Pick<QueueEntry, "kind" | "activeExecutor">) => entry.kind === "install" ? (entry.activeExecutor ? 0 : 1) : entry.kind === "review" ? 1 : 2;

/** Entries in queue order (QUEUE_ORDER). */
export function queueOrder<T extends Pick<QueueEntry, "kind" | "activeExecutor" | "criticalPath" | "seq">>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => KIND_RANK(a) - KIND_RANK(b) || b.criticalPath - a.criticalPath || a.seq - b.seq);
}

/** The queued entries to admit now: in order, while heavy slots are free; a light run is admitted at once. */
export function admissible(entries: readonly QueueEntry[], capacity: number): QueueEntry[] {
  let free = capacity - entries.filter(entry => entry.state === "running" && entry.heavy).length;
  const out: QueueEntry[] = [];
  for (const entry of queueOrder(entries.filter(item => item.state === "queued"))) {
    if (!entry.heavy) { out.push(entry); continue; }
    if (free <= 0) continue;
    free--;
    out.push(entry);
  }
  return out;
}

export type WaitResult = { readonly status: "admitted"; readonly entry: QueueEntry } | { readonly status: "cancelled"; readonly entry: QueueEntry };

export class RunQueue {
  private readonly file: string;
  private readonly lock: string;
  private readonly sleep: (ms: number) => void;
  private readonly pollMs: number;
  private readonly pid: number;
  private readonly kill: (pid: number) => void;
  private readonly alive: (pid: number) => boolean;
  private readonly now: () => Date;

  constructor(private readonly options: QueueOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) throw new Error(`run queue: capacity must be a whole number of heavy slots, at least 1 (got ${String(options.capacity)})`);
    mkdirSync(options.dir, { recursive: true });
    this.file = join(options.dir, "queue.json");
    this.lock = join(options.dir, "queue.lock");
    this.sleep = options.sleep ?? blockingSleep;
    this.pollMs = options.pollMs ?? 2_000;
    this.pid = options.pid ?? process.pid;
    this.kill = options.kill ?? defaultKill;
    this.alive = options.alive ?? defaultAlive;
    this.now = options.now ?? (() => new Date());
  }

  /** The queue as it is on disk. */
  read(): QueueFile {
    if (!existsSync(this.file)) return { schema: QUEUE_SCHEMA, seq: 0, entries: [] };
    const parsed = JSON.parse(readFileSync(this.file, "utf8")) as QueueFile;
    if (parsed.schema !== QUEUE_SCHEMA || !Array.isArray(parsed.entries)) throw new Error(`${this.file}: not a ${QUEUE_SCHEMA} document`);
    return parsed;
  }

  /** change() applied to the queue under the lock; the lock is waited for (never given up) and a dead holder's is taken. */
  private update<T>(change: (queue: QueueFile) => { queue: QueueFile; value: T }): T {
    for (;;) {
      try { mkdirSync(this.lock); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let holder = NaN;
        try { holder = Number(readFileSync(join(this.lock, "pid"), "utf8")); } catch { /* being written */ }
        if (Number.isInteger(holder) && holder > 0 && holder !== this.pid && !this.alive(holder)) rmSync(this.lock, { recursive: true, force: true });
        else this.sleep(Math.min(this.pollMs, 50));
      }
    }
    try {
      writeFileSync(join(this.lock, "pid"), String(this.pid));
      const { queue, value } = change(this.read());
      const temp = `${this.file}.${this.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(queue, null, 2)}\n`);
      renameSync(temp, this.file);
      return value;
    } finally {
      rmSync(this.lock, { recursive: true, force: true });
    }
  }

  /** Adds a run and cancels every queued or running run of the same unit at another head (a running one is signalled). */
  enqueue(request: QueueRequest): QueueEntry {
    const stop: number[] = [];
    const entry = this.update(queue => {
      const seq = queue.seq + 1;
      const id = `run-${seq}`;
      const added: QueueEntry = {
        id, seq, unit: request.unit, head: request.head, kind: request.kind, activeExecutor: request.activeExecutor === true,
        criticalPath: request.criticalPath ?? 0, heavy: request.heavy !== false, state: "queued", enqueuedAt: this.now().toISOString(),
      };
      const entries = queue.entries.map(item => {
        if (item.unit !== request.unit || item.head === request.head || (item.state !== "queued" && item.state !== "running")) return item;
        if (item.state === "running" && item.pid !== undefined) stop.push(item.pid);
        return { ...item, state: "cancelled" as const, supersededBy: id, endedAt: this.now().toISOString() };
      });
      return { queue: { ...queue, seq, entries: [...entries, added] }, value: added };
    });
    for (const pid of stop) this.kill(pid);
    return entry;
  }

  /** One look: admits id when its turn has come; its state after the look. */
  poll(id: string): QueueEntry {
    return this.update(queue => {
      const entry = queue.entries.find(item => item.id === id);
      if (!entry) throw new Error(`run queue: no run ${id}`);
      if (entry.state !== "queued" || !admissible(queue.entries, this.options.capacity).some(item => item.id === id)) return { queue, value: entry };
      const started: QueueEntry = { ...entry, state: "running", pid: this.pid, startedAt: this.now().toISOString() };
      return { queue: { ...queue, entries: queue.entries.map(item => item.id === id ? started : item) }, value: started };
    });
  }

  /**
   * Waits until id is admitted (returns it running) or cancelled (returns it cancelled). It looks again every pollMs
   * for as long as that takes: there is no try count, no timeout and no give-up path. onWait sees each wait.
   */
  wait(id: string, onWait?: (entry: QueueEntry, looks: number) => void): WaitResult {
    for (let looks = 1; ; looks++) {
      const entry = this.poll(id);
      if (entry.state === "running") return { status: "admitted", entry };
      if (entry.state === "cancelled") return { status: "cancelled", entry };
      if (entry.state === "done") throw new Error(`run queue: ${id} is already done`);
      onWait?.(entry, looks);
      this.sleep(this.pollMs);
    }
  }

  /** Marks a run done, freeing its slot. A cancelled run stays cancelled. */
  finish(id: string): void {
    this.update(queue => ({
      queue: { ...queue, entries: queue.entries.map(item => item.id === id && item.state !== "cancelled" ? { ...item, state: "done" as const, endedAt: this.now().toISOString() } : item) },
      value: undefined,
    }));
  }
}

/**
 * Queue findings for the rule check (scripts/check-review-fail-closed.mjs mirrors these): two live runs of one unit at
 * different heads (the older was not cancelled), more heavy runs running than capacity, or an entry in a state the
 * queue never writes (a give-up state such as "failed" or "gave-up").
 */
export function queueFindings(queue: QueueFile, capacity: number): { rule: string; subject: string; message: string }[] {
  const out: { rule: string; subject: string; message: string }[] = [];
  const live = queue.entries.filter(entry => entry.state === "queued" || entry.state === "running");
  const byUnit = new Map<string, QueueEntry[]>();
  for (const entry of live) byUnit.set(entry.unit, [...(byUnit.get(entry.unit) ?? []), entry]);
  for (const [unit, entries] of byUnit) if (new Set(entries.map(entry => entry.head)).size > 1) out.push({ rule: "superseded-live", subject: unit, message: `${unit} has live runs at ${[...new Set(entries.map(entry => entry.head.slice(0, 12)))].join(" and ")}: the older head was not cancelled` });
  const running = live.filter(entry => entry.state === "running" && entry.heavy).length;
  if (running > capacity) out.push({ rule: "over-capacity", subject: "queue", message: `${running} heavy runs running on ${capacity} slot(s)` });
  for (const entry of queue.entries) if (!["queued", "running", "done", "cancelled"].includes(entry.state)) out.push({ rule: "gave-up", subject: entry.id, message: `${entry.id} is ${String(entry.state)}: a queued run waits until it runs or is cancelled, never gives up` });
  return out;
}
