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

/** A code rule of the plan contract (R1-R10) or the brief contract (B1-B2). */
export type ContractRuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "B1" | "B2";

export interface ContractRuleViolation {
  readonly rule: ContractRuleId;
  /** The field at fault, like `staffing[1].repository`. */
  readonly path: string;
  /** What is wrong, by position only, never quoting a value. */
  readonly message: string;
}

/** Calls `onRepeat(index, firstIndex)` for every item whose key an earlier item already had. One pass, with a Map. */
function eachRepeat<T>(items: readonly T[], key: (item: T) => string, onRepeat: (index: number, firstIndex: number) => void): void {
  const first = new Map<string, number>();
  items.forEach((item, index) => {
    const value = key(item);
    const earlier = first.get(value);
    if (earlier === undefined) first.set(value, index);
    else onRepeat(index, earlier);
  });
}

/**
 * A document's own member, or undefined. The schema sees only own members, so
 * the rules read only those too: a member inherited from a prototype is
 * ignored, never judged.
 */
function own<T extends object, K extends keyof T>(document: T, name: K): T[K] | undefined {
  return Object.hasOwn(document, name) ? document[name] : undefined;
}

/** Every violation of the plan contract's code rules R1-R10, for a plan that already passed the schema. */
export function planRuleViolations(plan: AdvisorPlan): ContractRuleViolation[] {
  const violations: ContractRuleViolation[] = [];
  const add = (rule: ContractRuleId, path: string, message: string) => violations.push({ rule, path, message });
  const staffing = own(plan, "staffing");
  const packages = own(plan, "packages");
  const kits = own(plan, "kits");
  const mandateRoles = plan.mandate.roles;

  // R1: one staffing entry per repository, ids compared case-insensitively.
  if (staffing !== undefined) {
    eachRepeat(staffing, (entry) => entry.repository.toLowerCase(), (index, first) =>
      add("R1", `staffing[${index}].repository`, `names the same repository as staffing[${first}].repository (repository ids compare case-insensitively)`),
    );
  }

  // R2: staffed roles and mandate roles agree, in both directions.
  if (staffing !== undefined) {
    const inMandate = new Set(mandateRoles);
    staffing.forEach((entry, index) =>
      entry.roles.forEach((role, position) => {
        if (!inMandate.has(role)) add("R2", `staffing[${index}].roles[${position}]`, "is not one of mandate.roles");
      }),
    );
    const staffedRoles = new Set(staffing.flatMap((entry) => entry.roles));
    mandateRoles.forEach((role, position) => {
      if (!staffedRoles.has(role)) add("R2", `mandate.roles[${position}]`, "is not staffed in any staffing entry");
    });
  }

  if (packages !== undefined) {
    // R3: every act names a staffed repository, spelled exactly the same.
    const staffed = new Set((staffing ?? []).map((entry) => entry.repository));
    packages.forEach((act, index) => {
      if (!staffed.has(act.repository)) add("R3", `packages[${index}].repository`, "is not spelled exactly as any staffing[].repository");
    });
    // R4: planItem ids are unique.
    eachRepeat(packages, (act) => act.planItem, (index, first) => add("R4", `packages[${index}].planItem`, `repeats packages[${first}].planItem`));
    // R5: one act per (repository, name), repositories compared case-insensitively.
    eachRepeat(packages, (act) => JSON.stringify([act.repository.toLowerCase(), act.name]), (index, first) =>
      add("R5", `packages[${index}].name`, `repeats the repository and name of packages[${first}] (repositories compare case-insensitively)`),
    );
  }

  // R6: resolution exactly when packages.
  const hasPackages = Object.hasOwn(plan, "packages");
  const hasResolution = Object.hasOwn(plan, "resolution");
  if (hasPackages && !hasResolution) add("R6", "resolution", "is required when packages is present");
  if (!hasPackages && hasResolution) add("R6", "resolution", "must be absent when there are no packages");

  // R7: kit ids are unique.
  if (kits !== undefined) eachRepeat(kits, (kit) => kit.id, (index, first) => add("R7", `kits[${index}].id`, `repeats kits[${first}].id`));

  // R8: no role twice within one staffing entry.
  if (staffing !== undefined) {
    staffing.forEach((entry, index) =>
      eachRepeat(entry.roles, (role) => role, (position, first) => add("R8", `staffing[${index}].roles[${position}]`, `repeats staffing[${index}].roles[${first}]`)),
    );
  }

  // R9: no role twice in mandate.roles.
  eachRepeat(mandateRoles, (role) => role, (position, first) => add("R9", `mandate.roles[${position}]`, `repeats mandate.roles[${first}]`));

  // R10: at most one pin-starter act per repository (compared case-insensitively), and it is a devDependency.
  if (packages !== undefined) {
    const pins = packages.map((act, index) => ({ act, index })).filter((entry) => entry.act.act === "pin-starter");
    eachRepeat(pins, (entry) => entry.act.repository.toLowerCase(), (position, first) =>
      add("R10", `packages[${pins[position]!.index}].act`, `is a second act of this kind for the repository of packages[${pins[first]!.index}] (repositories compare case-insensitively)`),
    );
    for (const { act, index } of pins) {
      if (act.placement !== "devDependencies") add("R10", `packages[${index}].placement`, "must be devDependencies for a pin-starter act");
    }
  }
  return violations;
}

/** Every violation of the brief contract's code rules B1-B2, for a brief that already passed the schema. */
export function briefRuleViolations(brief: EngagementBrief): ContractRuleViolation[] {
  const violations: ContractRuleViolation[] = [];
  const add = (rule: ContractRuleId, path: string, message: string) => violations.push({ rule, path, message });
  const staffedHere = own(brief, "staffedHere");
  if (staffedHere === undefined) return violations;
  // B1: every entry is one of the brief's roles.
  const roles = new Set(brief.roles.map((role) => role.role));
  staffedHere.forEach((role, index) => {
    if (!roles.has(role)) add("B1", `staffedHere[${index}]`, "is not one of roles[].role");
  });
  // B2: no entry repeats.
  eachRepeat(staffedHere, (role) => role, (index, first) => add("B2", `staffedHere[${index}]`, `repeats staffedHere[${first}]`));
  return violations;
}
