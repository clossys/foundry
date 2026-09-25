import { formatContractViolation, validateAgainstContract } from "./contract-schema.js";
import type { ContractSchema } from "./contract-schema.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import type { AdvisorFinding } from "./types.js";

/**
 * The shared plan and brief contracts (issue #1475), packed into this
 * package at build time from this repository's docs/contracts/. The plan
 * record and the engagement brief are validated against these files and
 * nothing else, so this package and @clossys/launcher cannot drift apart.
 */
export function loadPlanContract(name: string): ContractSchema {
  const contract = Object.hasOwn(PLAN_CONTRACTS, name) ? PLAN_CONTRACTS[name] : undefined;
  if (contract === undefined) throw new Error(`no packed contract named ${JSON.stringify(name)}`);
  return contract;
}

/** Every violation of `value` against the named packed contract, as error findings under one `rule`. */
export function contractFindings(contractName: string, rule: string, label: string, value: unknown): AdvisorFinding[] {
  return validateAgainstContract(loadPlanContract(contractName), value, loadPlanContract).map((violation) => ({
    rule,
    severity: "error",
    message: formatContractViolation(label, violation),
    ...(violation.path === "" ? {} : { path: violation.path }),
  }));
}
