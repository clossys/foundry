/**
 * The standard's requirements plus the contract's, run inside certification (R05 with W2-I's
 * loader). A check is synchronous, so this is the synchronous twin of `requirementsVerdict`
 * (criteria/core/verdict.ts): the same `resolveRequirements`, `subjectOf` and `certifyKey`, with
 * criteria resolved from the core registry's static map, then the per-agent static map
 * (criteria/agent-criteria.ts). A criterion id neither map holds fails its requirement; it never
 * passes silently.
 */
import { AGENT_CRITERIA } from "../criteria/agent-criteria.js";
import { CORE_CRITERIA } from "../criteria/core/index.js";
import { certifyKey, resolveRequirements, subjectOf, type RequirementResult, type Verdict, type VerdictInputs } from "../criteria/core/verdict.js";
import type { Criterion } from "../criteria/core/types.js";

export const syncCriterion = (id: string): Criterion => {
  const fn = Object.hasOwn(CORE_CRITERIA, id) ? CORE_CRITERIA[id] : Object.hasOwn(AGENT_CRITERIA, id) ? AGENT_CRITERIA[id] : undefined;
  if (!fn) throw new Error(`criterion ${id} is not a registered criterion (core or agent); certification fails it`);
  return fn;
};

/** The requirements verdict, synchronously; equal to `requirementsVerdict` for registered criteria (certify.test.ts (not shipped)). */
export function requirementsVerdictSync(inputs: VerdictInputs, resolve: (id: string) => Criterion = syncCriterion): Verdict {
  const subject = subjectOf(inputs.candidate.name, inputs.candidate.bytes, inputs.kind);
  const results: RequirementResult[] = [];
  for (const requirement of resolveRequirements(inputs.standard.requirements, inputs.contract)) {
    let failures: string[];
    try { failures = resolve(requirement.check)(subject, requirement.params); }
    catch (error) { failures = [(error as Error).message]; }
    results.push({ check: requirement.check, pass: failures.length === 0, failures });
  }
  return { schema: "clossys.requirements-verdict/1", key: certifyKey(inputs), pass: results.every(result => result.pass), results };
}
