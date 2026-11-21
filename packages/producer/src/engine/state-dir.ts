/**
 * The consumer-layout contract's state folder (docs/contracts/consumer-layout.json (not shipped), `stateDir` and
 * `legacyStateDir`): the one place a workspace path of the engine and its machine files comes from. The event log, its
 * lock and index, run state and settle records, queue and request locks, check results, renders, builds and generated
 * output all live under STATE_DIR, beside the consumer's records in `clossys/`; no writer names the folder itself.
 * LEGACY_STATE_DIR is the root folder the engine wrote before: `clossys check --engine` fails while it exists, and
 * `clossys migrate state --apply` moves it into STATE_DIR. state-dir.test.ts pins both values to the contract.
 *
 * Node runs this file with type stripping in child writers (engine/*.test.ts) and the trace preload loads it, so it
 * imports only node builtins.
 */
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
