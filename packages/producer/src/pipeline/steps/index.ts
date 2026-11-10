import { loadActions } from "../actions.js";
import { defineAction } from "../define.js";
import type { Step } from "../define.js";
import { BINDINGS } from "./bindings.js";

export { CHECKS } from "./checks.js";
export { BINDINGS } from "./bindings.js";

/**
 * Every pipeline step, in pipeline order: one per action contract (pipeline/actions.json), bound to
 * its code by id. A step with no contract cannot exist and a contract with no step cannot run.
 */
export const STEPS: readonly Step[] = Object.freeze(loadActions().map(source => defineAction(source.contract, BINDINGS[source.contract.id], source.package)));
