/**
 * The loop engine's public surface (`@clossys/controller/loop`): loop-state validation, staleness, and the
 * planner's launch log (CP1-PLANNERRUN) that `clossys unit run` records launches in, and the next legal step of a
 * unit (CP1-UNITNEXT) that `clossys unit next` prints.
 */
export { isValidLoopState, resumeStage, validateLoopState } from "./state.js";
export type { LoopStateFinding } from "./state.js";
export { affectedCapabilities, changedInputs, fingerprintInputs, isStale, unitRunStatus, UNIT_RUN_STALE_AFTER_MS } from "./staleness.js";
export { emptyLoopState, failedCloudLaunches, markLatestLaunchFailed, recordUnitLaunch, refreshUnitRuns, validateUnitRuns } from "./units.js";
export type { UnitRunFinding } from "./units.js";
export { LOOP_STAGES, UNIT_ENVS, UNIT_RUN_STATUSES, UNIT_TIERS } from "./types.js";
export type { LoopState, LoopStage, UnitEnv, UnitRun, UnitRunStatus, UnitTier } from "./types.js";
export {
  CHECK_STATUSES, markSuperseded, nextVerdictLine, parseStepVerdict, PRECONDITION_RULE, RECORDED_STEPS, sameCommit, STEP_VERDICT_FORMS,
  supersedeChecks, unitNext, UNIT_PRECONDITIONS, UNIT_STEPS, UNIT_WIP_CAP_DEFAULT,
} from "./unit-next.js";
export type { CheckStatus, RecordedStep, Refusal, StepRecord, StepVerdict, UnitCheck, UnitFacts, UnitNext, UnitPrecondition, UnitStep, WipFacts } from "./unit-next.js";
