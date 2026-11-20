/**
 * The engine lock: one writer of a workspace's event log at a time. `.clossys/engine.lock` is created with O_EXCL
 * (`wx`) and holds its owner, `{ pid, host, at, token }`. A lock whose owner is gone is taken over:
 *   - same host, owner pid no longer alive;
 *   - another host, held longer than FOREIGN_LOCK_MS (no event append takes minutes);
 *   - no readable owner (a writer that died between create and write), older than OWNERLESS_LOCK_MS.
 * Takeover renames the judged lock aside and checks the moved bytes are the ones judged, so of two racing
 * recoveries exactly one wins and a fresh lock moved by mistake is put back. A live lock is waited on up to
 * `waitMs`, then refused with EngineBusyError naming the holder. Release removes the lock only while it still
 * carries the holder's token.
 *
 * Lock order: a writer takes its own record lock (slot, agent, entry) first and the engine lock last; nothing
 * waits on another lock while holding this one.
 */
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";

/** A lock with no readable owner this old was left by a writer that died before recording itself. */
export const OWNERLESS_LOCK_MS = 60_000;
/** A lock held this long by a writer on another host is abandoned. */
export const FOREIGN_LOCK_MS = 15 * 60_000;
/** How long appendEvent waits for a live lock before it refuses with EngineBusyError. */
export const ENGINE_LOCK_WAIT_MS = 5_000;
const POLL_MS = 5;

export interface LockOwner { readonly pid: number; readonly host: string; readonly at: number; readonly token: string }

/** The engine lock is held by a live writer past the wait. */
export class EngineBusyError extends Error {
  readonly code = "ENGINE_BUSY";
  readonly lock: string;
  readonly holder: Partial<LockOwner> | undefined;
  constructor(lock: string, holder: Partial<LockOwner> | undefined) {
    const who = holder && Number.isInteger(holder.pid)
      ? `pid ${holder.pid} on ${holder.host ?? "an unknown host"} since ${typeof holder.at === "number" ? new Date(holder.at).toISOString() : "an unknown time"}`
      : "a writer that has not recorded itself yet";
    super(`engine busy: ${lock} is held by ${who}; another event write is in progress and nothing was written. Retry; a lock whose owner is gone (a dead pid on this host, ${FOREIGN_LOCK_MS / 60_000} min from another host) is taken over by the next writer`);
    this.name = "EngineBusyError";
    this.lock = lock;
    this.holder = holder;
  }
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const pause = (ms: number) => { Atomics.wait(sleeper, 0, 0, ms); };
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};
const parseOwner = (raw: string): Partial<LockOwner> | undefined => {
  try {
    const owner = JSON.parse(raw) as Partial<LockOwner>;
    return owner && typeof owner === "object" ? owner : undefined;
  } catch { return undefined; }
};
const complete = (owner: Partial<LockOwner> | undefined): owner is LockOwner =>
  owner !== undefined && Number.isInteger(owner.pid) && typeof owner.host === "string" && typeof owner.at === "number";

/** Whether the lock whose bytes are `raw` (file mtime `mtimeMs`) was left by a writer that can no longer release it. */
export function staleOwner(raw: string, mtimeMs: number, now = Date.now(), host = hostname()): boolean {
  const owner = parseOwner(raw);
  if (!complete(owner)) return now - mtimeMs > OWNERLESS_LOCK_MS;
  if (owner.host === host) return !alive(owner.pid);
  return now - owner.at > FOREIGN_LOCK_MS;
}

function readLock(lock: string): { raw: string; mtimeMs: number } | undefined {
  try { return { raw: readFileSync(lock, "utf8"), mtimeMs: statSync(lock).mtimeMs }; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Create the lock exclusively; false when it exists. */
function tryCreate(lock: string, owner: LockOwner): boolean {
  let fd: number;
  try { fd = openSync(lock, "wx"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try { writeSync(fd, JSON.stringify(owner)); fsyncSync(fd); } finally { closeSync(fd); }
  return true;
}

/** Move a lock judged stale aside; true when the judged bytes were the ones moved (a fresh lock is put back). */
function takeOver(lock: string, judged: string): boolean {
  const aside = `${lock}.stale-${randomUUID()}`;
  try { renameSync(lock, aside); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  let moved = "";
  try { moved = readFileSync(aside, "utf8"); } catch { /* gone: nothing to put back */ }
  if (moved !== judged) {
    // Another recovery replaced the stale lock between our read and our rename: put its lock back.
    try { linkSync(aside, lock); } catch { /* a third writer holds the lock now; the moved holder's release sees a foreign token */ }
  }
  try { unlinkSync(aside); } catch { /* already gone */ }
  return moved === judged;
}

/** Hold the lock at `lock` while `action` runs. Waits up to `waitMs` for a live holder, then throws EngineBusyError. */
export function withEngineLock<T>(lock: string, action: () => T, waitMs = ENGINE_LOCK_WAIT_MS): T {
  mkdirSync(dirname(lock), { recursive: true });
  const owner: LockOwner = { pid: process.pid, host: hostname(), at: Date.now(), token: randomUUID() };
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    if (tryCreate(lock, { ...owner, at: Date.now() })) break;
    const held = readLock(lock);
    if (!held) continue;
    if (staleOwner(held.raw, held.mtimeMs)) { takeOver(lock, held.raw); continue; }
    if (Date.now() >= deadline) throw new EngineBusyError(lock, parseOwner(held.raw));
    pause(POLL_MS);
  }
  try { return action(); } finally {
    const held = readLock(lock);
    if (held && parseOwner(held.raw)?.token === owner.token) { try { unlinkSync(lock); } catch { /* already gone */ } }
  }
}
