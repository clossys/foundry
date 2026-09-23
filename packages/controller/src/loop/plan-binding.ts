/**
 * Stale-plan refusal (issue #1195): "A plan is bound to the assessment it
 * came from; if that assessment changes, the plan is re-proposed as a
 * diff and never executed as written." This is the general form of that
 * rule -- any proposed plan (an artifact-operation plan from `./artifacts.js`,
 * or any other caller-defined plan shape) carries the fingerprint of the
 * inputs it was computed from, and `decidePlanExecution` is the one place
 * that compares it against the current inputs before anything executes.
 */
import { isStale } from "./staleness.js";
import type { Fingerprint } from "./types.js";

/** A plan bound to the exact inputs it was computed from. `plan` is opaque here -- this module only ever judges the binding, never the plan's own content. */
export interface PlanBinding<Plan> {
  readonly plan: Plan;
  readonly boundFingerprint: Fingerprint;
}

export function bindPlan<Plan>(plan: Plan, boundFingerprint: Fingerprint): PlanBinding<Plan> {
  return Object.freeze({ plan, boundFingerprint });
}

export const PLAN_EXECUTION_OUTCOMES = Object.freeze(["execute", "stale-refuse"] as const);
export type PlanExecutionOutcome = (typeof PLAN_EXECUTION_OUTCOMES)[number];

export interface PlanExecutionDecision<Plan> {
  readonly outcome: PlanExecutionOutcome;
  readonly reason: string;
  /** The bound plan, carried through only on `execute` -- a caller that reads `plan` off a `stale-refuse` decision has skipped the check this module exists to enforce, so `stale-refuse` carries `null` instead. */
  readonly plan: Plan | null;
}

/**
 * Whether a bound plan may still execute as written, given the inputs'
 * current fingerprint. A `stale-refuse` is not an error -- it is the
 * expected outcome when the world moved between proposal and execution,
 * and the caller's own job is to re-propose a fresh plan (a diff against
 * the new state), never to execute the stale one.
 */
export function decidePlanExecution<Plan>(binding: PlanBinding<Plan>, currentFingerprint: Fingerprint): PlanExecutionDecision<Plan> {
  if (isStale(binding.boundFingerprint, currentFingerprint)) {
    return {
      outcome: "stale-refuse",
      reason: "the inputs this plan was computed from have changed; re-propose as a diff against the current state, never execute the plan as written",
      plan: null,
    };
  }
  return { outcome: "execute", reason: "the plan's bound inputs still match the current fingerprint", plan: binding.plan };
}
