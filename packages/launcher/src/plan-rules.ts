// The plan and brief contracts' code rules (issue #1178): the checks the
// contracts' JSON Schema keywords cannot express, because each one relates one
// field to another. They are defined once, as prose in the descriptions of
// the shared contracts docs/contracts/advisor-plan.json (R1-R9) and
// engagement-brief.json (B1-B2) -- in the public repository, not shipped in
// this package. @clossys/advisor implements the same rules separately; both
// packages are tested against one corpus,
// docs/contracts/advisor-plan-rules.fixture.json (likewise not shipped), so a
// plan or brief Advisor accepts, Launcher accepts, and the reverse.
//
// These functions assume the value already passed the schema: the validators
// in plan-contract.ts run them only then. A violation names its rule and the
// position of the field at fault, never a value, because a plan or brief can
// carry founder text.

import type { AdvisorPlan, EngagementBrief } from "./plan-contract.js";

/** A code rule of the plan contract (R1-R9) or the brief contract (B1-B2). */
export type ContractRuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "B1" | "B2";

export interface ContractRuleViolation {
  readonly rule: ContractRuleId;
  /** The field at fault, such as `staffing[1].repository`. */
  readonly path: string;
  /** What is wrong, by position only. */
  readonly message: string;
}

/** For each item, the index of the first earlier item with the same key, or -1 when there is none. */
function firstEarlier(keys: readonly string[]): number[] {
  return keys.map((key, index) => keys.indexOf(key) === index ? -1 : keys.indexOf(key));
}

/** Every violation of R1-R9, for a plan that already passed the plan contract's schema. */
export function planRuleViolations(plan: AdvisorPlan): ContractRuleViolation[] {
  const out: ContractRuleViolation[] = [];
  const staffing = plan.staffing;
  const packages = plan.packages;

  // R1: one staffing entry per repository, ids compared case-insensitively.
  if (staffing) {
    firstEarlier(staffing.map((entry) => entry.repository.toLowerCase())).forEach((earlier, index) => {
      if (earlier >= 0) {
        out.push({ rule: "R1", path: `staffing[${index}].repository`, message: `names the same repository as staffing[${earlier}].repository (repository ids compare case-insensitively)` });
      }
    });
  }

  // R2: staffed roles and mandate roles agree, in both directions.
  if (staffing) {
    for (let index = 0; index < staffing.length; index += 1) {
      const roles = staffing[index]!.roles;
      for (let position = 0; position < roles.length; position += 1) {
        if (!plan.mandate.roles.includes(roles[position]!)) out.push({ rule: "R2", path: `staffing[${index}].roles[${position}]`, message: "is not one of mandate.roles" });
      }
    }
    plan.mandate.roles.forEach((role, position) => {
      if (!staffing.some((entry) => entry.roles.includes(role))) out.push({ rule: "R2", path: `mandate.roles[${position}]`, message: "is not staffed in any staffing entry" });
    });
  }

  if (packages) {
    // R3: every act names a staffed repository, spelled exactly the same.
    packages.forEach((act, index) => {
      if (!(staffing ?? []).some((entry) => entry.repository === act.repository)) {
        out.push({ rule: "R3", path: `packages[${index}].repository`, message: "is not spelled exactly as any staffing[].repository" });
      }
    });
    // R4: planItem ids are unique.
    firstEarlier(packages.map((act) => act.planItem)).forEach((earlier, index) => {
      if (earlier >= 0) out.push({ rule: "R4", path: `packages[${index}].planItem`, message: `repeats packages[${earlier}].planItem` });
    });
    // R5: one act per (repository, name), repositories compared case-insensitively.
    firstEarlier(packages.map((act) => `${act.repository.toLowerCase()}\u0000${act.name}`)).forEach((earlier, index) => {
      if (earlier >= 0) out.push({ rule: "R5", path: `packages[${index}].name`, message: `repeats the repository and name of packages[${earlier}] (repositories compare case-insensitively)` });
    });
  }

  // R6: resolution exactly when packages.
  const hasPackages = Object.hasOwn(plan, "packages");
  const hasResolution = Object.hasOwn(plan, "resolution");
  if (hasPackages && !hasResolution) out.push({ rule: "R6", path: "resolution", message: "is required when packages is present" });
  if (!hasPackages && hasResolution) out.push({ rule: "R6", path: "resolution", message: "must be absent when there are no packages" });

  // R7: kit ids are unique.
  if (plan.kits) {
    firstEarlier(plan.kits.map((kit) => kit.id)).forEach((earlier, index) => {
      if (earlier >= 0) out.push({ rule: "R7", path: `kits[${index}].id`, message: `repeats kits[${earlier}].id` });
    });
  }

  // R8: no role twice within one staffing entry.
  staffing?.forEach((entry, index) => {
    firstEarlier(entry.roles).forEach((earlier, position) => {
      if (earlier >= 0) out.push({ rule: "R8", path: `staffing[${index}].roles[${position}]`, message: `repeats staffing[${index}].roles[${earlier}]` });
    });
  });

  // R9: no role twice in mandate.roles.
  firstEarlier(plan.mandate.roles).forEach((earlier, position) => {
    if (earlier >= 0) out.push({ rule: "R9", path: `mandate.roles[${position}]`, message: `repeats mandate.roles[${earlier}]` });
  });
  return out;
}

/** Every violation of B1-B2, for a brief that already passed the brief contract's schema. */
export function briefRuleViolations(brief: EngagementBrief): ContractRuleViolation[] {
  const out: ContractRuleViolation[] = [];
  const staffedHere = brief.staffedHere;
  if (!staffedHere) return out;
  staffedHere.forEach((role, index) => {
    if (!brief.roles.some((entry) => entry.role === role)) out.push({ rule: "B1", path: `staffedHere[${index}]`, message: "is not one of roles[].role" });
  });
  firstEarlier(staffedHere).forEach((earlier, index) => {
    if (earlier >= 0) out.push({ rule: "B2", path: `staffedHere[${index}]`, message: `repeats staffedHere[${earlier}]` });
  });
  return out;
}
