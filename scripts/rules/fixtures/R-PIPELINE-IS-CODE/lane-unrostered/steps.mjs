// R-PIPELINE-IS-CODE fixture: the real steps plus one creative step held by an agent that is not a
// roster entry. check:pipeline must fail it as lane.unrostered (the canvas has no lane for it).
import { CHECKS as REAL_CHECKS, STEPS as REAL_STEPS } from "../../../../../packages/producer/dist/pipeline/steps/index.js";

const designer = REAL_STEPS.find(step => step.id === "designer.candidates");
export const STEPS = [...REAL_STEPS, { ...designer, id: "auditor.candidates", actor: "agent:auditor", seat: "clossys/agents/producer/auditor.candidates/seat.json" }];
export const CHECKS = REAL_CHECKS;
