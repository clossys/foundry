/**
 * The loop engine's public surface (`@clossys/controller/loop`): loop-state validation, staleness, and the
 * planner's launch log (CP1-PLANNERRUN) that `clossys unit run` records launches in.
 */
export { isValidLoopState, resumeStage, validateLoopState } from "./state.js";
export type { LoopStateFinding } from "./state.js";
export { affectedCapabilities, changedInputs, fingerprintInputs, isStale, unitRunStatus, UNIT_RUN_STALE_AFTER_MS } from "./staleness.js";
export { emptyLoopState, failedCloudLaunches, markLatestLaunchFailed, recordUnitLaunch, refreshUnitRuns, validateUnitRuns } from "./units.js";
export type { UnitRunFinding } from "./units.js";
export { LOOP_STAGES, UNIT_ENVS, UNIT_RUN_STATUSES, UNIT_TIERS } from "./types.js";
export type { LoopState, LoopStage, UnitEnv, UnitRun, UnitRunStatus, UnitTier } from "./types.js";
