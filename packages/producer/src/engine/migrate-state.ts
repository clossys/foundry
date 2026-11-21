/**
 * `clossys migrate state`: move a legacy root state folder (LEGACY_STATE_DIR, `.clossys/`) into the consumer-layout
 * contract's state folder (STATE_DIR, `clossys/.state/`), the one place the engine now reads and writes. The folder's
 * top-level entries (the event log, its index, run state, locks, check results, renders, builds) are renamed into
 * STATE_DIR under the engine lock, the emptied legacy folder is removed, and one `state.migrate` event is appended to
 * the moved log: every record path the log still logs under the legacy folder is named absent, and its new path under
 * STATE_DIR carries the bytes the log vouched for, so `clossys check --engine` sees neither drift nor a layout finding.
 *
 * The plan refuses, moving nothing (no merge, no fallback): a legacy path that is not a plain folder; a lock file
 * anywhere in it (a writer may hold it); a loop run still waiting or running (its snapshot names legacy paths); an entry
 * whose name STATE_DIR already holds. A second run plans nothing.
 */
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { enginePaths } from "./chain.js";
import { computeIndex } from "./derived.js";
import { withEngineLock } from "./lock.js";
import { appendEvent } from "./log.js";
import { LEGACY_STATE_DIR, STATE_DIR, statePath, stateRel } from "./state-dir.js";
import type { EngineEvent, EventInput } from "./types.js";

/** The event kind and actor of a state migration. */
export const STATE_MIGRATE_KIND = "state.migrate";
export const STATE_MIGRATE_ACTOR = "code:clossys migrate state";

export interface StateMigrationPlan {
  /** Whether a legacy folder exists at the workspace root. */
  readonly legacy: boolean;
  /** Top-level entries of the legacy folder, each moving to STATE_DIR/<name>. */
  readonly moves: readonly string[];
  /** Why the plan cannot apply; empty when it can. */
  readonly refusals: readonly string[];
}

const exists = (path: string): boolean => {
  try { lstatSync(path); return true; } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
};

/** Every file below `dir`, workspace-relative to `base`, symbolic links reported as files. */
function filesBelow(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...filesBelow(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** The plan for the workspace `root`: what moves and what refuses the move. Reads only. */
export function planStateMigration(root: string): StateMigrationPlan {
  const at = resolve(root);
  const legacy = join(at, LEGACY_STATE_DIR);
  let stat;
  try { stat = lstatSync(legacy); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { legacy: false, moves: [], refusals: [] };
    throw error;
  }
  if (!stat.isDirectory()) return { legacy: true, moves: [], refusals: [`${LEGACY_STATE_DIR} is not a folder (a file or a symbolic link); nothing was moved, remove or rename it yourself`] };
  const refusals: string[] = [];
  const moves = readdirSync(legacy).sort();
  for (const file of filesBelow(legacy, "")) {
    if (file.endsWith(".lock") || file.includes(".lock.")) refusals.push(`${LEGACY_STATE_DIR}/${file} is a lock: a writer may hold it; let it finish, then run again`);
  }
  const loops = join(legacy, "runs", "loops");
  if (exists(loops) && lstatSync(loops).isDirectory()) {
    for (const name of readdirSync(loops).filter(name => name.endsWith(".json")).sort()) {
      let status: unknown;
      try { status = (JSON.parse(readFileSync(join(loops, name), "utf8")) as { status?: unknown }).status; } catch { continue; }
      if (status === "waiting" || status === "running") refusals.push(`${LEGACY_STATE_DIR}/runs/loops/${name} is a ${status} run: its snapshot names ${LEGACY_STATE_DIR} paths; finish or stop it, then run again`);
    }
  }
  for (const name of moves) {
    if (exists(statePath(at, name))) refusals.push(`${stateRel(name)} already exists: ${LEGACY_STATE_DIR}/${name} is not merged into it; nothing was moved`);
  }
  return { legacy: true, moves, refusals };
}

export interface StateMigrationResult {
  readonly plan: StateMigrationPlan;
  /** The state.migrate event, when the log logged any legacy record path. */
  readonly event?: EngineEvent;
}

/** The new path of a workspace-relative path under the legacy folder. */
const moved = (path: string): string => `${STATE_DIR}/${path.slice(LEGACY_STATE_DIR.length + 1)}`;

/**
 * Apply the plan: refuses (throws, moving nothing) when the plan has a refusal. Renames each entry into STATE_DIR
 * under the engine lock, removes the emptied legacy folder, then appends one state.migrate event naming each legacy
 * record path the moved log logs: absent at its old path, and at its new path the sha256 the log last logged for it.
 */
export function applyStateMigration(root: string): StateMigrationResult {
  const at = resolve(root);
  const plan = planStateMigration(at);
  if (plan.refusals.length) throw new Error(`migrate state: ${plan.refusals.join("; ")}`);
  if (!plan.legacy) return { plan };
  const paths = enginePaths(at);
  mkdirSync(paths.dir, { recursive: true });
  withEngineLock(paths.lock, () => {
    const again = planStateMigration(at);
    if (again.refusals.length) throw new Error(`migrate state: ${again.refusals.join("; ")}`);
    for (const name of again.moves) renameSync(join(at, LEGACY_STATE_DIR, name), statePath(at, name));
    rmdirSync(join(at, LEGACY_STATE_DIR));
  });
  const prefix = `${LEGACY_STATE_DIR}/`;
  const records = computeIndex(at).records;
  const byPath = new Map<string, EventInput>();
  for (const [path, entry] of Object.entries(records)) {
    if (!path.startsWith(prefix) || entry.logged === null) continue;
    byPath.set(path, { path, sha256: null });
    byPath.set(moved(path), { path: moved(path), sha256: entry.logged });
  }
  const inputs = [...byPath.values()];
  if (!inputs.length) return { plan };
  const event = appendEvent(at, { actor: STATE_MIGRATE_ACTOR, kind: "state.migrate", subject: `state:${STATE_DIR}`, inputs });
  return { plan, event };
}
