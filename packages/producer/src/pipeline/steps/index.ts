import type { Step } from "../define.js";
import { AGENT_STEPS } from "./agents.js";
import { CLI_STEPS } from "./cli.js";
import { DECISION_STEPS } from "./decisions.js";
import { SCRIPT_STEPS } from "./scripts.js";

export { CHECKS } from "./checks.js";

/** Every pipeline step, in pipeline order. A step absent from this list cannot run. */
export const STEPS: readonly Step[] = Object.freeze([...DECISION_STEPS, ...AGENT_STEPS, ...CLI_STEPS, ...SCRIPT_STEPS]);
