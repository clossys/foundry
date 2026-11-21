/**
 * The consumer-layout contract's state folder (docs/contracts/consumer-layout.json (not shipped), `stateDir` and
 * `legacyStateDir`): the one place a workspace path of the engine and its machine files comes from. The event log, its
 * lock and index, run state and settle records, queue and request locks, check results, renders, builds and generated
 * output all live under STATE_DIR, beside the consumer's records in `clossys/`; no writer names the folder itself.
 * The two values are literals here, not read from the contract at run time (the contract does not ship);
 * state-dir.test.ts pins both to the contract.
 *
 * LEGACY_STATE_DIR is the root folder the engine wrote before: `clossys check --engine` fails while it exists, and
 * `clossys migrate state --apply` moves it into STATE_DIR. While it exists the workspace's state is there, not in
 * STATE_DIR, so every engine write refuses (`refuseLegacyState`, LegacyStateError) instead of starting a second log
 * or state tree beside it; only `clossys migrate state` writes then.
 *
 * Node runs this file with type stripping in child writers (engine/*.test.ts) and the trace preload loads it, so it
 * imports only node builtins.
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";

/** The contract's `stateDir`, workspace-relative POSIX. */
export const STATE_DIR = "clossys/.state";
/** The contract's `legacyStateDir`, workspace-relative POSIX: a root folder no writer may create. */
export const LEGACY_STATE_DIR = ".clossys";
/** STATE_DIR's segments, for code that compares split paths. */
export const STATE_SEGMENTS: readonly string[] = Object.freeze(STATE_DIR.split("/"));

/** A workspace-relative POSIX path under STATE_DIR: `stateRel("runs", "loops")` is `clossys/.state/runs/loops`. */
export const stateRel = (...segments: readonly string[]): string => [STATE_DIR, ...segments].join("/");
/** An absolute path under STATE_DIR of the workspace `root`. */
export const statePath = (root: string, ...segments: readonly string[]): string => join(root, STATE_DIR, ...segments);
/** Whether a workspace-relative POSIX path is STATE_DIR or lies under it. */
export const isStateRel = (path: string): boolean => path === STATE_DIR || path.startsWith(`${STATE_DIR}/`);

/** Whether a LEGACY_STATE_DIR exists at the workspace `root`, in any form (a folder, a file or a link). */
export function legacyStateAt(root: string): boolean {
  try { lstatSync(join(root, LEGACY_STATE_DIR)); return true; } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/** The workspace still keeps its engine state in LEGACY_STATE_DIR: an engine write would fork it, so nothing was written. */
export class LegacyStateError extends Error {
  readonly code = "LEGACY_STATE";
  readonly exitCode = 2;
  readonly root: string;
  constructor(root: string) {
    super(`${join(root, LEGACY_STATE_DIR)}/ holds this workspace's engine state from before the consumer layout (${STATE_DIR}/); nothing was written. Move it first: clossys migrate state --apply`);
    this.name = "LegacyStateError";
    this.root = root;
  }
}

/**
 * Refuse an engine write to the workspace `root` while LEGACY_STATE_DIR exists there (LegacyStateError): the write
 * would start a log or state tree in STATE_DIR beside the legacy one, after which `clossys migrate state` could not
 * move it without a merge. Every engine writer calls this before it writes; `clossys migrate state` alone does not.
 */
export function refuseLegacyState(root: string): void {
  if (legacyStateAt(root)) throw new LegacyStateError(root);
}
