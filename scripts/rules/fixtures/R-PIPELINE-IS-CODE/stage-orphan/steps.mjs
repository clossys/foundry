// R-PIPELINE-IS-CODE fixture: the real steps with every input removed from the `capture` step.
// capture sits in the publish.check stage, so nothing would feed it: check:pipeline must fail it as
// stage.orphan (only a first-stage step may start the flow).
import { CHECKS as REAL_CHECKS, STEPS as REAL_STEPS } from "../../../../../packages/producer/dist/pipeline/steps/index.js";

export const STEPS = REAL_STEPS.map(step => step.id === "capture" ? { ...step, inputs: [] } : step);
export const CHECKS = REAL_CHECKS;
