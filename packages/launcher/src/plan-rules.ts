// The plan and brief contracts' code rules (issue #1178): the checks the
// contracts' JSON Schema keywords cannot express, because each one relates one
// field to another. They are defined once, as prose in the descriptions of
// the shared contracts docs/contracts/advisor-plan.json (R1-R11) and
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

import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import type { AdvisorPlan, EngagementBrief } from "./plan-contract.js";

/** A code rule of the plan contract (R1-R11) or the brief contract (B1-B2). */
export type ContractRuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "B1" | "B2";

/**
 * The roles whose package lives in the engagement hub only, read from the
 * packed plan contract's `definitions.hubOnlyRoles`, the one list every
 * package that validates a plan reads (issue #1178). Code rules R2 and R11
 * use it. A packed contract without a well-formed list is a build defect, so
 * loading this module throws rather than judge plans against a guess.
 */
export const HUB_ONLY_ROLES: readonly string[] = (() => {
  const definitions = PLAN_CONTRACTS["advisor-plan.json"]?.definitions as Record<string, { const?: unknown }> | undefined;
  const roles = definitions?.hubOnlyRoles?.const;
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string")) throw new Error("the packed plan contract has no well-formed definitions.hubOnlyRoles");
  return Object.freeze([...(roles as string[])]);
})();

export interface ContractRuleViolation {
  readonly rule: ContractRuleId;
  /** The field at fault, such as `staffing[1].repository`. */
  readonly path: string;
  /** What is wrong, by position only. */
  readonly message: string;
}

/** Calls `onRepeat(index, firstIndex)` for every item whose key an earlier item already had. One pass, with a Map. */
function eachRepeat<T>(items: readonly T[], key: (item: T) => string, onRepeat: (index: number, firstIndex: number) => void): void {
  const first = new Map<string, number>();
  for (let index = 0; index < items.length; index += 1) {
    const value = key(items[index]!);
    const earlier = first.get(value);
    if (earlier === undefined) first.set(value, index);
    else onRepeat(index, earlier);
  }
}

/**
 * A document's own member, or undefined. The schema checker sees only own
 * members, so these rules read only those too: a member inherited from a
 * prototype is ignored, never judged -- exactly as @clossys/advisor does.
 */
function own<T extends object, K extends keyof T>(document: T, name: K): T[K] | undefined {
  return Object.hasOwn(document, name) ? document[name] : undefined;
}

/** Every violation of R1-R11, for a plan that already passed the plan contract's schema. */
export function planRuleViolations(plan: AdvisorPlan): ContractRuleViolation[] {
  const out: ContractRuleViolation[] = [];
  const add = (rule: ContractRuleId, path: string, message: string): void => {
    out.push({ rule, path, message });
  };
  const staffing = own(plan, "staffing");
  const packages = own(plan, "packages");
  const kits = own(plan, "kits");
  const mandateRoles = plan.mandate.roles;

  // R1: one staffing entry per repository, ids compared case-insensitively.
  if (staffing !== undefined) {
    eachRepeat(staffing, (entry) => entry.repository.toLowerCase(), (index, first) => {
      add("R1", `staffing[${index}].repository`, `names the same repository as staffing[${first}].repository (repository ids compare case-insensitively)`);
    });
  }

  // R2: staffed roles and mandate roles agree, in both directions; a hub-only role is never required to be staffed.
  if (staffing !== undefined) {
    const inMandate = new Set<string>(mandateRoles);
    const staffedRoles = new Set<string>();
    for (let index = 0; index < staffing.length; index += 1) {
      const roles = staffing[index]!.roles;
      for (let position = 0; position < roles.length; position += 1) {
        staffedRoles.add(roles[position]!);
        if (!inMandate.has(roles[position]!)) add("R2", `staffing[${index}].roles[${position}]`, "is not one of mandate.roles");
      }
    }
    for (let position = 0; position < mandateRoles.length; position += 1) {
      if (!staffedRoles.has(mandateRoles[position]!) && !HUB_ONLY_ROLES.includes(mandateRoles[position]!)) add("R2", `mandate.roles[${position}]`, "is not staffed in any staffing entry");
    }
  }

  if (packages !== undefined) {
    // R3: every act names a staffed repository, spelled exactly the same.
    const staffed = new Set<string>((staffing ?? []).map((entry) => entry.repository));
    for (let index = 0; index < packages.length; index += 1) {
      if (!staffed.has(packages[index]!.repository)) add("R3", `packages[${index}].repository`, "is not spelled exactly as any staffing[].repository");
    }
    // R4: planItem ids are unique.
    eachRepeat(packages, (act) => act.planItem, (index, first) => {
      add("R4", `packages[${index}].planItem`, `repeats packages[${first}].planItem`);
    });
    // R5: one act per (repository, name), repositories compared case-insensitively.
    eachRepeat(packages, (act) => `${act.repository.toLowerCase()}\u0000${act.name}`, (index, first) => {
      add("R5", `packages[${index}].name`, `repeats the repository and name of packages[${first}] (repositories compare case-insensitively)`);
    });
  }

  // R6: resolution exactly when packages.
  const hasPackages = Object.hasOwn(plan, "packages");
  const hasResolution = Object.hasOwn(plan, "resolution");
  if (hasPackages && !hasResolution) add("R6", "resolution", "is required when packages is present");
  if (!hasPackages && hasResolution) add("R6", "resolution", "must be absent when there are no packages");

  // R7: kit ids are unique.
  if (kits !== undefined) {
    eachRepeat(kits, (kit) => kit.id, (index, first) => {
      add("R7", `kits[${index}].id`, `repeats kits[${first}].id`);
    });
  }

  // R8: no role twice within one staffing entry.
  if (staffing !== undefined) {
    for (let index = 0; index < staffing.length; index += 1) {
      eachRepeat(staffing[index]!.roles, (role) => role, (position, first) => {
        add("R8", `staffing[${index}].roles[${position}]`, `repeats staffing[${index}].roles[${first}]`);
      });
    }
  }

  // R9: no role twice in mandate.roles.
  eachRepeat(mandateRoles, (role) => role, (position, first) => {
    add("R9", `mandate.roles[${position}]`, `repeats mandate.roles[${first}]`);
  });

  // R10: at most one pin-starter act per repository (compared case-insensitively), and it is a devDependency.
  if (packages !== undefined) {
    const pins: number[] = [];
    for (let index = 0; index < packages.length; index += 1) if (packages[index]!.act === "pin-starter") pins.push(index);
    eachRepeat(pins, (index) => packages[index]!.repository.toLowerCase(), (position, first) => {
      add("R10", `packages[${pins[position]}].act`, `is a second act of this kind for the repository of packages[${pins[first]}] (repositories compare case-insensitively)`);
    });
    for (const index of pins) {
      if (packages[index]!.placement !== "devDependencies") add("R10", `packages[${index}].placement`, "must be devDependencies for a pin-starter act");
    }
  }

  // R11: a hub-only role is never staffed in a repository.
  if (staffing !== undefined) {
    for (let index = 0; index < staffing.length; index += 1) {
      const roles = staffing[index]!.roles;
      for (let position = 0; position < roles.length; position += 1) {
        if (HUB_ONLY_ROLES.includes(roles[position]!)) add("R11", `staffing[${index}].roles[${position}]`, "is a hub-only role, which works from the hub and is never staffed in a repository");
      }
    }
  }
  return out;
}

/** Every violation of B1-B2, for a brief that already passed the brief contract's schema. */
export function briefRuleViolations(brief: EngagementBrief): ContractRuleViolation[] {
  const out: ContractRuleViolation[] = [];
  const add = (rule: ContractRuleId, path: string, message: string): void => {
    out.push({ rule, path, message });
  };
  const staffedHere = own(brief, "staffedHere");
  if (staffedHere === undefined) return out;
  // B1: every entry is one of the brief's roles.
  const roles = new Set<string>(brief.roles.map((entry) => entry.role));
  for (let index = 0; index < staffedHere.length; index += 1) {
    if (!roles.has(staffedHere[index]!)) add("B1", `staffedHere[${index}]`, "is not one of roles[].role");
  }
  // B2: no entry repeats.
  eachRepeat(staffedHere, (role) => role, (index, first) => {
    add("B2", `staffedHere[${index}]`, `repeats staffedHere[${first}]`);
  });
  return out;
}
