import type { EngagementBrief } from "./engagement-brief.js";
import type { AdvisorPlan } from "./status.js";

/**
 * The plan and brief contracts' code rules (issue #1178): the checks their
 * JSON Schema keywords cannot express, because each relates one field to
 * another. They are defined once, as prose in the descriptions of the shared
 * plan and brief contracts (`docs/contracts/advisor-plan.json` and
 * `engagement-brief.json`, in the public repository, not shipped in this
 * package), and implemented here and, separately, in @clossys/launcher. Both
 * packages are tested against the same corpus
 * (`docs/contracts/advisor-plan-rules.fixture.json`, likewise not shipped), so
 * a plan or brief one package accepts, the other accepts.
 *
 * Each function assumes its input already passed the schema: the validators
 * run these only then. A violation names its rule and the position of the
 * field at fault, never a value, because a plan or brief can carry founder
 * text.
 */

/** A code rule of the plan contract (R1-R9) or the brief contract (B1-B2). */
export type ContractRuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "B1" | "B2";

export interface ContractRuleViolation {
  readonly rule: ContractRuleId;
  /** The field at fault, like `staffing[1].repository`. */
  readonly path: string;
  /** What is wrong, by position only, never quoting a value. */
  readonly message: string;
}

/** Calls `onRepeat(index, firstIndex)` for every item whose key an earlier item already had. */
function eachRepeat<T>(items: readonly T[], key: (item: T) => string, onRepeat: (index: number, firstIndex: number) => void): void {
  const first = new Map<string, number>();
  items.forEach((item, index) => {
    const value = key(item);
    const earlier = first.get(value);
    if (earlier === undefined) first.set(value, index);
    else onRepeat(index, earlier);
  });
}

/** Every violation of the plan contract's code rules R1-R9, for a plan that already passed the schema. */
export function planRuleViolations(plan: AdvisorPlan): ContractRuleViolation[] {
  const violations: ContractRuleViolation[] = [];
  const add = (rule: ContractRuleId, path: string, message: string) => violations.push({ rule, path, message });
  const { staffing, packages, kits } = plan;

  if (staffing !== undefined) {
    eachRepeat(staffing, (entry) => entry.repository.toLowerCase(), (index, first) =>
      add("R1", `staffing[${index}].repository`, `names the same repository as staffing[${first}].repository (repository ids compare case-insensitively)`),
    );
    const mandateRoles = new Set(plan.mandate.roles);
    staffing.forEach((entry, index) =>
      entry.roles.forEach((role, position) => {
        if (!mandateRoles.has(role)) add("R2", `staffing[${index}].roles[${position}]`, "is not one of mandate.roles");
      }),
    );
    const staffedRoles = new Set(staffing.flatMap((entry) => entry.roles));
    plan.mandate.roles.forEach((role, position) => {
      if (!staffedRoles.has(role)) add("R2", `mandate.roles[${position}]`, "is not staffed in any staffing entry");
    });
  }

  if (packages !== undefined) {
    const staffed = new Set((staffing ?? []).map((entry) => entry.repository));
    packages.forEach((act, index) => {
      if (!staffed.has(act.repository)) add("R3", `packages[${index}].repository`, "is not spelled exactly as any staffing[].repository");
    });
    eachRepeat(packages, (act) => act.planItem, (index, first) => add("R4", `packages[${index}].planItem`, `repeats packages[${first}].planItem`));
    eachRepeat(packages, (act) => JSON.stringify([act.repository.toLowerCase(), act.name]), (index, first) =>
      add("R5", `packages[${index}].name`, `repeats the repository and name of packages[${first}] (repositories compare case-insensitively)`),
    );
  }

  if ((packages === undefined) !== (plan.resolution === undefined)) {
    add("R6", "resolution", packages === undefined ? "must be absent when there are no packages" : "is required when packages is present");
  }

  if (kits !== undefined) eachRepeat(kits, (kit) => kit.id, (index, first) => add("R7", `kits[${index}].id`, `repeats kits[${first}].id`));

  staffing?.forEach((entry, index) =>
    eachRepeat(entry.roles, (role) => role, (position, first) =>
      add("R8", `staffing[${index}].roles[${position}]`, `repeats staffing[${index}].roles[${first}]`),
    ),
  );

  eachRepeat(plan.mandate.roles, (role) => role, (position, first) => add("R9", `mandate.roles[${position}]`, `repeats mandate.roles[${first}]`));
  return violations;
}

/** Every violation of the brief contract's code rules B1-B2, for a brief that already passed the schema. */
export function briefRuleViolations(brief: EngagementBrief): ContractRuleViolation[] {
  const violations: ContractRuleViolation[] = [];
  if (brief.staffedHere === undefined) return violations;
  const roles = new Set(brief.roles.map((role) => role.role));
  brief.staffedHere.forEach((role, index) => {
    if (!roles.has(role)) violations.push({ rule: "B1", path: `staffedHere[${index}]`, message: "is not one of roles[].role" });
  });
  eachRepeat(brief.staffedHere, (role) => role, (index, first) => violations.push({ rule: "B2", path: `staffedHere[${index}]`, message: `repeats staffedHere[${first}]` }));
  return violations;
}
