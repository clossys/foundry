// Reads a plan record (issue #1586) against the shared plan contract
// docs/contracts/advisor-plan.json -- in the public repository, not shipped in
// this package. This package's build packs that contract into src/generated/
// as plain data, with a generated copy of the one contract checker every
// other reader of a plan also uses (packages/advisor/src/contract-schema.ts,
// likewise in the public repository, not shipped in this package), so
// Writer validates against the same definition with no runtime dependency on
// any other package.

import { ADVISOR_PLAN_CONTRACT } from "./generated/advisor-plan-contract.generated.js";
import { formatContractViolation, validateAgainstContract } from "./generated/contract-schema.generated.js";
import { planRuleViolations } from "./plan-rules.js";
import type { PlanDocument, PlanRuleId } from "./plan-rules.js";

/** One reason a plan is refused: `rule` is "schema" for the contract's keywords, else the code rule's id. */
export interface PlanViolation {
  readonly rule: "schema" | PlanRuleId;
  /** The field at fault, like `staffing[1].repository`, or "" for the document itself. */
  readonly path: string;
  /** The whole message, starting with `plan` and the path; it never quotes a value. */
  readonly message: string;
}

/** The plan contract refers to no other contract file, so every name is refused. */
function refuseEveryName(name: string): never {
  throw new Error(`the plan contract refers to no other contract, but the checker asked for ${JSON.stringify(name)}`);
}

/**
 * Every reason `value` is not a valid plan: the plan contract's schema, then,
 * once that passes, its code rules R1-R12. Empty means valid. Never throws
 * for a bad value, and no message echoes a value from the plan.
 */
export function planViolations(value: unknown): PlanViolation[] {
  const schema = validateAgainstContract(ADVISOR_PLAN_CONTRACT, value, refuseEveryName);
  if (schema.length > 0) {
    return schema.map((violation) => ({ rule: "schema", path: violation.path, message: formatContractViolation("plan", violation) }));
  }
  // The code rules relate fields to one another, so they run only on a plan whose shape is known good.
  return planRuleViolations(value as PlanDocument).map((violation) => ({
    rule: violation.rule,
    path: violation.path,
    message: `plan.${violation.path} ${violation.message} (rule ${violation.rule})`,
  }));
}
