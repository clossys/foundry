/**
 * The engine lock: one writer of a workspace's event log at a time. `clossys/.state/engine.lock` is created with O_EXCL
 * (`wx`) and holds its owner, `{ pid, host, at, token }`. A lock whose owner is gone is stale:
 *   - same host, owner pid no longer alive;
 *   - another host, held longer than FOREIGN_LOCK_MS (no event append takes minutes);
 *   - no readable owner (a writer that died between create and write), older than OWNERLESS_LOCK_MS.
 *
 * Recovery never vacates the lock path. A writer that judged one exact lock instance stale (its bytes, device, inode
 * and mtime) first creates that instance's recovery marker with O_EXCL (`engine.lock.recover-<instance hash>`), so of
 * all the writers that judged the same instance exactly one recovers it. Under the marker it re-reads the lock: only
 * when it is still the very instance judged, and still stale, does the writer rename its own fully written lock over
 * it (an atomic replace). Any other lock there (a recovery that already won, a fresh writer) is left alone. A marker
 * whose recoverer died is itself recovered by the same rule, one level down. A live lock is waited on up to `waitMs`,
 * then refused with EngineBusyError naming the holder. Release removes the lock only while it still carries the
 * holder's token.
 *
 * Limit: staleness is judged by pid, host and age, never by asking the holder, so a second writer is possible only
 * when a live holder is judged stale under these rules (a foreign holder past FOREIGN_LOCK_MS or seen so through
 * clock skew, a machine sharing the host name, a live writer with no readable owner past OWNERLESS_LOCK_MS).
 *
 * Lock order: a writer takes its own record lock (slot, agent, entry) first and the engine lock last; nothing
 * waits on another lock while holding this one.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
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

/** One lock file as read: its bytes and the identity of the inode that held them. */
export interface SeenLock { readonly raw: string; readonly dev: number; readonly ino: number; readonly mtimeMs: number }

/** The lock at `lock` as one instance (bytes and fstat of the same open file), or undefined when there is none. */
function readLock(lock: string): SeenLock | undefined {
  let fd: number;
  try { fd = openSync(lock, "r"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    return { raw: readFileSync(fd, "utf8"), dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs };
  } finally { closeSync(fd); }
}
const sameLock = (a: SeenLock, b: SeenLock) => a.dev === b.dev && a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.raw === b.raw;

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

/**
 * Test seam (engine/lock.test.ts (not shipped)): called at each recovery step with the step's name and the lock path. Unset in
 * production. `judged`: a writer judged the lock stale and is about to recover it; `replace`: it holds the
 * instance's marker, re-verified the instance and is about to rename its own lock over it; `declined`: the recovery
 * left the lock as it was (another writer recovered it, or holds the marker).
 */
export const recoveryProbe: { at?: (step: "judged" | "replace" | "declined", lock: string) => void } = {};

/** The recovery marker of one lock instance: every writer that judged that same instance contends for this one file. */
export function recoveryMarker(lock: string, seen: SeenLock): string {
  const id = createHash("sha256").update(`${seen.dev}\0${seen.ino}\0${seen.mtimeMs}\0${seen.raw}`).digest("hex").slice(0, 32);
  return `${lock}.recover-${id}`;
}
/** The recovery marker of the lock at `lock` as it is now; undefined when there is no lock. */
export function currentRecoveryMarker(lock: string): string | undefined {
  const seen = readLock(lock);
  return seen && recoveryMarker(lock, seen);
}

/** A marker of a marker of a ... : recoveries of dead recoverers nest at most this deep. */
const MAX_RECOVERY_DEPTH = 4;

/** Write `owner` to a fresh sibling and rename it over `lock`: the lock path is never absent. */
function replaceLock(lock: string, owner: LockOwner): void {
  const fresh = `${lock}.new-${owner.token}-${randomUUID()}`;
  if (!tryCreate(fresh, owner)) throw new Error(`${fresh} exists`);
  try { renameSync(fresh, lock); } catch (error) {
    try { unlinkSync(fresh); } catch { /* already gone */ }
    throw error;
  }
}
/** Remove `lock` only while it still carries `token`. */
function releaseIfMine(lock: string, token: string): void {
  const held = readLock(lock);
  if (held && parseOwner(held.raw)?.token === token) { try { unlinkSync(lock); } catch { /* already gone */ } }
}

/**
 * Recover the stale lock instance `judged` at `lock` for `owner`: true when `lock` now carries `owner` (this writer
 * holds it), false when it was left as it was. Only the writer holding the instance's marker may replace it, and only
 * while the lock is still that exact instance and still stale.
 */
function recoverLock(lock: string, judged: SeenLock, owner: LockOwner, depth = 0): boolean {
  if (depth > MAX_RECOVERY_DEPTH) return false;
  const marker = recoveryMarker(lock, judged);
  if (!tryCreate(marker, { ...owner, at: Date.now() })) {
    const seen = readLock(marker);
    // Released meanwhile: its recoverer finished, so the instance is gone or about to be judged afresh.
    if (!seen || !staleOwner(seen.raw, seen.mtimeMs)) return false;
    // The marker's recoverer died before it finished: recover the marker by the same rule.
    if (!recoverLock(marker, seen, { ...owner, at: Date.now() }, depth + 1)) return false;
  }
  try {
    const now = readLock(lock);
    if (!now || !sameLock(now, judged)) return false;
    if (!staleOwner(now.raw, now.mtimeMs)) return false;
    recoveryProbe.at?.("replace", lock);
    replaceLock(lock, { ...owner, at: Date.now() });
    return true;
  } finally { releaseIfMine(marker, owner.token); }
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
    if (staleOwner(held.raw, held.mtimeMs)) {
      recoveryProbe.at?.("judged", lock);
      if (recoverLock(lock, held, owner)) break;
      recoveryProbe.at?.("declined", lock);
    }
    if (Date.now() >= deadline) throw new EngineBusyError(lock, parseOwner(held.raw));
    pause(POLL_MS);
  }
  try { return action(); } finally { releaseIfMine(lock, owner.token); }
}
