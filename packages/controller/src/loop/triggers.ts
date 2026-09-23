/**
 * Trigger resolution (issue #1195): pure functions over the fixed table --
 * what changed decides where the loop re-enters and how much of this
 * role's own capability set that re-entry touches. Nothing here reads a
 * clock, a filesystem, or a network; a caller supplies the trigger it
 * already observed and gets back a deterministic stage and scope.
 */
import { TRIGGER_KINDS, type LoopStage, type TriggerKind, type TriggerScope } from "./types.js";

const REENTRY_STAGE: Readonly<Record<TriggerKind, LoopStage>> = Object.freeze({
  "inputs-changed": "sense",
  "role-changed": "judge",
  "freshness-window": "judge",
  "review-window": "learn",
  "outcome-missed": "learn",
  "client-request": "judge",
});

const REENTRY_SCOPE: Readonly<Record<TriggerKind, TriggerScope>> = Object.freeze({
  "inputs-changed": "affected-capabilities-only",
  "role-changed": "all-capabilities",
  "freshness-window": "all-capabilities",
  "review-window": "all-capabilities",
  "outcome-missed": "affected-capabilities-only",
  "client-request": "named-capability",
});

/** Where a trigger re-enters the loop. Total over `TriggerKind` -- every kind maps to exactly one stage. */
export function reentryStageForTrigger(trigger: TriggerKind): LoopStage {
  return REENTRY_STAGE[trigger];
}

/** How much of this role's capability set a trigger's re-entry touches. */
export function reentryScopeForTrigger(trigger: TriggerKind): TriggerScope {
  return REENTRY_SCOPE[trigger];
}

/** Every `TriggerKind` covered exactly once, in the fixed table's own order -- what a reviewer checks a new trigger kind was actually added to both maps above. */
export function isTriggerKind(value: unknown): value is TriggerKind {
  return typeof value === "string" && (TRIGGER_KINDS as readonly string[]).includes(value);
}
