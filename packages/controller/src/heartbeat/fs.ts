/**
 * The I/O half of the heartbeat (issue #1221): reads every
 * `clossys/<role>/loop.json` under a repository root, validates each one
 * with `../loop/state.js`'s `isValidLoopState` (skipping and reporting an
 * unreadable/invalid file as a finding rather than throwing), and can
 * write the rendered digest to `clossys/.state/decisions-waiting-for-you.md`.
 * Split into a read-only compute step and a separate write step so a
 * caller (`./cli.js`) can run in report mode -- compute, but never touch
 * disk -- by simply not calling the write half.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isValidLoopState } from "../loop/state.js";
import type { LoopState } from "../loop/types.js";
import { computeHeartbeat, renderDigest } from "./digest.js";
import type { HeartbeatDigest } from "./types.js";

export interface UnreadableLoopState {
  /** Repository-relative path, e.g. `clossys/advisor/loop.json`. */
  readonly path: string;
  readonly reason: string;
}

export interface LoadedLoopStates {
  readonly roles: Readonly<Record<string, LoopState>>;
  readonly unreadable: readonly UnreadableLoopState[];
}

/**
 * Reads every `clossys/<role>/loop.json` under `repoRoot`. A role
 * directory with no `loop.json` is silently skipped -- it has not
 * adopted the loop engine yet, which is not itself a heartbeat finding.
 * A `loop.json` that exists but fails to parse or validate is reported
 * in `unreadable` and excluded from `roles`, never thrown.
 */
export function loadLoopStates(repoRoot: string): LoadedLoopStates {
  const clossysDir = join(repoRoot, "clossys");
  const roles: Record<string, LoopState> = {};
  const unreadable: UnreadableLoopState[] = [];
  if (!existsSync(clossysDir)) return { roles: Object.freeze(roles), unreadable: Object.freeze(unreadable) };

  for (const entry of readdirSync(clossysDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name === ".state") continue;
    const loopPath = join(clossysDir, entry.name, "loop.json");
    if (!existsSync(loopPath)) continue;
    const relPath = `clossys/${entry.name}/loop.json`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(loopPath, "utf8"));
    } catch (error) {
      unreadable.push({ path: relPath, reason: `could not parse JSON: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (!isValidLoopState(parsed)) {
      unreadable.push({ path: relPath, reason: "does not validate as a well-formed loop.json document" });
      continue;
    }
    roles[entry.name] = parsed;
  }
  return { roles: Object.freeze(roles), unreadable: Object.freeze(unreadable) };
}

export interface HeartbeatRunResult {
  readonly digest: HeartbeatDigest;
  readonly unreadable: readonly UnreadableLoopState[];
}

/** Loads every role's `loop.json` and computes the digest. Pure read, no write -- see `writeHeartbeatDigest` for the write half. */
export function computeHeartbeatForRepo(repoRoot: string, now: Date = new Date()): HeartbeatRunResult {
  const { roles, unreadable } = loadLoopStates(repoRoot);
  return { digest: computeHeartbeat(roles, now), unreadable };
}

export const DIGEST_PATH = "clossys/.state/decisions-waiting-for-you.md";

/** Writes the rendered digest to `clossys/.state/decisions-waiting-for-you.md` under `repoRoot`, creating the directory if needed. Returns the repository-relative path written. */
export function writeHeartbeatDigest(repoRoot: string, digest: HeartbeatDigest, now: Date = new Date()): string {
  const outPath = join(repoRoot, DIGEST_PATH);
  mkdirSync(join(repoRoot, "clossys", ".state"), { recursive: true });
  writeFileSync(outPath, renderDigest(digest.entries, now));
  return DIGEST_PATH;
}
