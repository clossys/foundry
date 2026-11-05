// R-PIPELINE-IS-CODE fixture: the real steps with the stage removed from the `ia` step.
// check:pipeline must fail it as stage.missing (the canvas has no column for it).
import { CHECKS as REAL_CHECKS, STEPS as REAL_STEPS } from "../../../../../packages/producer/dist/pipeline/steps/index.js";

export const STEPS = REAL_STEPS.map(step => {
  if (step.id !== "ia") return step;
  const { stage, ...rest } = step;
  return rest;
});
export const CHECKS = REAL_CHECKS;
