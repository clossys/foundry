/**
 * The planner's launch log (CP1-PLANNERRUN), kept on the loop state as `units`: one record per launch of a
 * unit, with where it ran (`env`), at which tier, and when. `clossys unit run` (in `@clossys/producer`)
 * appends a launch here and refreshes every open one through `unitRunStatus` (`./staleness.js`), which flags
 * a launch with no pushed progress after 90 minutes as `stale`. Pure: no filesystem, clock or git access here;
 * a caller reads loop.json, the time and the branch heads, and writes the state this returns.
 */
import { unitRunStatus, UNIT_RUN_STALE_AFTER_MS } from "./staleness.js";
import { UNIT_ENVS, UNIT_RUN_STATUSES, UNIT_TIERS } from "./types.js";
import type { LoopState, UnitRun } from "./types.js";

export interface UnitRunFinding {
  readonly rule: string;
  readonly path: string;
  readonly message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isIso = (value: unknown): value is string => isText(value) && !Number.isNaN(new Date(value).getTime());
const oneOf = (value: unknown, list: readonly string[]): boolean => typeof value === "string" && list.includes(value);

/** A role's loop state with no capabilities and an empty launch log: what a first launch starts from. */
export function emptyLoopState(role: string): LoopState {
  return { schemaVersion: 1, role, capabilities: {}, units: {} };
}

/** Findings for a loop state's `units` field; none when it is absent or well-formed. */
export function validateUnitRuns(units: unknown): readonly UnitRunFinding[] {
  if (units === undefined) return [];
  if (!isRecord(units)) return [{ rule: "invalid-units", path: "units", message: "units must be an object mapping a unit id to its launches" }];
  const findings: UnitRunFinding[] = [];
  for (const [unit, runs] of Object.entries(units)) {
    const path = `units.${unit}`;
    if (!Array.isArray(runs)) { findings.push({ rule: "invalid-units", path, message: "a unit's launches must be an array" }); continue; }
    runs.forEach((run: unknown, index) => {
      const at = `${path}[${index}]`;
      if (!isRecord(run)) { findings.push({ rule: "invalid-unit-run", path: at, message: "a launch must be an object" }); return; }
      if (run.unit !== unit) findings.push({ rule: "unit-run-mismatch", path: `${at}.unit`, message: `unit must equal its key (${unit})` });
      if (!oneOf(run.env, UNIT_ENVS)) findings.push({ rule: "invalid-unit-run", path: `${at}.env`, message: `env must be one of ${UNIT_ENVS.join(", ")}` });
      if (!oneOf(run.tier, UNIT_TIERS)) findings.push({ rule: "invalid-unit-run", path: `${at}.tier`, message: `tier must be one of ${UNIT_TIERS.join(", ")}` });
      if (!isIso(run.at)) findings.push({ rule: "invalid-unit-run", path: `${at}.at`, message: "at must be a readable ISO datetime" });
      if (!isText(run.branch)) findings.push({ rule: "invalid-unit-run", path: `${at}.branch`, message: "branch must be a nonempty string" });
      if (run.headAtLaunch !== null && !isText(run.headAtLaunch)) findings.push({ rule: "invalid-unit-run", path: `${at}.headAtLaunch`, message: "headAtLaunch must be a commit or null" });
      if (!oneOf(run.status, UNIT_RUN_STATUSES)) findings.push({ rule: "invalid-unit-run", path: `${at}.status`, message: `status must be one of ${UNIT_RUN_STATUSES.join(", ")}` });
      if (run.status === "failed" && !isText(run.reason)) findings.push({ rule: "invalid-unit-run", path: `${at}.reason`, message: "a failed launch needs a reason" });
    });
  }
  return Object.freeze(findings);
}

/** The state with `run` appended to its unit's launches. */
export function recordUnitLaunch(state: LoopState, run: UnitRun): LoopState {
  const units = state.units ?? {};
  return { ...state, units: { ...units, [run.unit]: [...(units[run.unit] ?? []), run] } };
}

/** The state with the unit's latest launch recorded as failed, for `reason`; unchanged (and `null` run) when the unit has no launch. */
export function markLatestLaunchFailed(state: LoopState, unit: string, reason: string): { state: LoopState; run: UnitRun | null } {
  const runs = state.units?.[unit] ?? [];
  const last = runs.at(-1);
  if (!last) return { state, run: null };
  const failed: UnitRun = { ...last, status: "failed", reason };
  return { state: { ...state, units: { ...(state.units ?? {}), [unit]: [...runs.slice(0, -1), failed] } }, run: failed };
}

/** How many of the unit's launches ran in the cloud and were recorded as failed. */
export function failedCloudLaunches(state: LoopState, unit: string): number {
  return (state.units?.[unit] ?? []).filter((run) => run.env === "cloud" && run.status === "failed").length;
}

/**
 * Every open launch re-judged at `now`: `headOf(branch)` is the branch's remote head as last read (`null`
 * when it does not exist). Returns the new state and the launches that are stale now.
 */
export function refreshUnitRuns(
  state: LoopState,
  now: Date,
  headOf: (branch: string) => string | null,
  staleAfterMs: number = UNIT_RUN_STALE_AFTER_MS,
): { state: LoopState; stale: readonly UnitRun[] } {
  const stale: UnitRun[] = [];
  const units: Record<string, readonly UnitRun[]> = {};
  for (const [unit, runs] of Object.entries(state.units ?? {})) {
    units[unit] = runs.map((run) => {
      if (run.status === "progressed" || run.status === "failed") return run;
      const status = unitRunStatus(run, now, headOf(run.branch), staleAfterMs);
      const next = status === run.status ? run : { ...run, status };
      if (status === "stale") stale.push(next);
      return next;
    });
  }
  return { state: { ...state, units }, stale: Object.freeze(stale) };
}
