// The plan contract's code rules R1-R12 (issue #1178, read here for issue
// #1586): the checks the contract's JSON Schema keywords cannot express,
// because each one relates one field to another. They are defined once, as
// prose in the description of the shared contract
// docs/contracts/advisor-plan.json -- in the public repository, not shipped
// in this package. This is @clossys/writer's own implementation, written from
// that text; every other reader of a plan implements the rules separately,
// and each is tested against one corpus,
// docs/contracts/advisor-plan-rules.fixture.json (likewise in the public
// repository, not shipped in this package), so a plan one of them accepts,
// they all accept, and the reverse.
//
// These functions assume the value already passed the plan contract's
// schema: plan-contract.ts runs them only then. A violation names its rule and
// the position of the field at fault, never a value, because a plan can carry
// founder text.

import { ADVISOR_PLAN_CONTRACT } from "./generated/advisor-plan-contract.generated.js";

/** A code rule of the plan contract. */
export type PlanRuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12";

/**
 * The roles whose package lives in the engagement hub only, read from the
 * packed plan contract's `definitions.hubOnlyRoles`, the one list every
 * reader of a plan uses. Code rules R2 and R11 use it. A packed contract
 * without a well-formed list is a build defect, so loading this module throws
 * rather than judge plans against a guess.
 */
export const HUB_ONLY_ROLES: readonly string[] = (() => {
  const definitions = ADVISOR_PLAN_CONTRACT.definitions as Record<string, { const?: unknown }> | undefined;
  const roles = definitions?.hubOnlyRoles?.const;
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string")) {
    throw new Error("the packed plan contract has no well-formed definitions.hubOnlyRoles");
  }
  return Object.freeze([...(roles as string[])]);
})();

/**
 * The members of a plan these rules and the authority read, and no more. A
 * plan that passed the contract's schema has this shape; it is a structural
 * view, not the contract, and it validates nothing.
 */
export interface PlanDocument {
  readonly mandate: { readonly roles: readonly string[] };
  readonly staffing?: readonly { readonly repository: string; readonly roles: readonly string[] }[];
  readonly packages?: readonly {
    readonly planItem: string;
    readonly repository: string;
    readonly act: string;
    readonly name: string;
    readonly placement: string;
  }[];
  readonly kits?: readonly { readonly id: string }[];
  readonly resolution?: unknown;
  readonly delegatedCopyApproval?: { readonly target: "production"; readonly scopes?: readonly string[] };
  readonly decisions: readonly { readonly at: string; readonly chosen: string; readonly subjectDigest?: string }[];
}

export interface PlanRuleViolation {
  readonly rule: PlanRuleId;
  /** The field at fault, such as `staffing[1].repository`. */
  readonly path: string;
  /** What is wrong, by position only. */
  readonly message: string;
}

/**
 * The position of every item whose key an earlier item already had, with the
 * position of the first item that had it. Items keep their order.
 */
function repeats(keys: readonly string[]): { index: number; first: number }[] {
  const seenAt = new Map<string, number>();
  const found: { index: number; first: number }[] = [];
  keys.forEach((key, index) => {
    const first = seenAt.get(key);
    if (first === undefined) seenAt.set(key, index);
    else found.push({ index, first });
  });
  return found;
}

/**
 * A plan's own member, or undefined. The schema checker sees only own
 * members, so these rules read only those too: a member inherited from a
 * prototype is ignored, never judged.
 */
function ownMember<T extends object, K extends keyof T>(document: T, name: K): T[K] | undefined {
  return Object.hasOwn(document, name) ? document[name] : undefined;
}

/** Every violation of R1-R12, for a plan that already passed the plan contract's schema. */
export function planRuleViolations(plan: PlanDocument): PlanRuleViolation[] {
  const found: PlanRuleViolation[] = [];
  const report = (rule: PlanRuleId, path: string, message: string): void => {
    found.push({ rule, path, message });
  };
  const staffing = ownMember(plan, "staffing");
  const acts = ownMember(plan, "packages");
  const kits = ownMember(plan, "kits");
  const mandateRoles = plan.mandate.roles;
  const lower = (text: string): string => text.toLowerCase();

  if (staffing !== undefined) {
    // R1: one staffing entry per repository; ids compare case-insensitively.
    for (const { index, first } of repeats(staffing.map((entry) => lower(entry.repository)))) {
      report("R1", `staffing[${index}].repository`, `names the same repository as staffing[${first}].repository (repository ids compare case-insensitively)`);
    }

    // R2: staffed roles and mandate roles agree in both directions; a hub-only role is never required to be staffed.
    const mandated = new Set(mandateRoles);
    const staffed = new Set(staffing.flatMap((entry) => entry.roles));
    staffing.forEach((entry, index) => {
      entry.roles.forEach((role, position) => {
        if (!mandated.has(role)) report("R2", `staffing[${index}].roles[${position}]`, "is not one of mandate.roles");
      });
    });
    mandateRoles.forEach((role, position) => {
      if (!staffed.has(role) && !HUB_ONLY_ROLES.includes(role)) report("R2", `mandate.roles[${position}]`, "is not staffed in any staffing entry");
    });

    staffing.forEach((entry, index) => {
      // R8: no role twice within one staffing entry.
      for (const { index: position, first } of repeats(entry.roles)) {
        report("R8", `staffing[${index}].roles[${position}]`, `repeats staffing[${index}].roles[${first}]`);
      }
      // R11: a hub-only role is never staffed in a repository.
      entry.roles.forEach((role, position) => {
        if (HUB_ONLY_ROLES.includes(role)) report("R11", `staffing[${index}].roles[${position}]`, "is a hub-only role, which works from the hub and is never staffed in a repository");
      });
    });
  }

  if (acts !== undefined) {
    // R3: every act names a staffed repository, spelled exactly the same.
    const staffedRepositories = new Set((staffing ?? []).map((entry) => entry.repository));
    acts.forEach((act, index) => {
      if (!staffedRepositories.has(act.repository)) report("R3", `packages[${index}].repository`, "is not spelled exactly as any staffing[].repository");
    });
    // R4: planItem ids are unique.
    for (const { index, first } of repeats(acts.map((act) => act.planItem))) {
      report("R4", `packages[${index}].planItem`, `repeats packages[${first}].planItem`);
    }
    // R5: one act per (repository, name); repositories compare case-insensitively.
    for (const { index, first } of repeats(acts.map((act) => JSON.stringify([lower(act.repository), act.name])))) {
      report("R5", `packages[${index}].name`, `repeats the repository and name of packages[${first}] (repositories compare case-insensitively)`);
    }
    // R12: every planItem is exactly its act's repository, a colon and its name, in the same letter case.
    acts.forEach((act, index) => {
      if (act.planItem !== `${act.repository}:${act.name}`) report("R12", `packages[${index}].planItem`, "is not this act's repository, a colon and its name, in the same letter case");
    });
    // R10: at most one pin-starter act per repository (compared case-insensitively), and it is a devDependency.
    const pinAt = acts.flatMap((act, index) => (act.act === "pin-starter" ? [index] : []));
    for (const { index, first } of repeats(pinAt.map((position) => lower(acts[position]!.repository)))) {
      report("R10", `packages[${pinAt[index]}].act`, `is a second act of this kind for the repository of packages[${pinAt[first]}] (repositories compare case-insensitively)`);
    }
    for (const position of pinAt) {
      if (acts[position]!.placement !== "devDependencies") report("R10", `packages[${position}].placement`, "must be devDependencies for a pin-starter act");
    }
  }

  // R6: resolution is present exactly when packages is.
  const hasPackages = Object.hasOwn(plan, "packages");
  const hasResolution = Object.hasOwn(plan, "resolution");
  if (hasPackages && !hasResolution) report("R6", "resolution", "is required when packages is present");
  if (!hasPackages && hasResolution) report("R6", "resolution", "must be absent when there are no packages");

  // R7: kit ids are unique.
  for (const { index, first } of repeats((kits ?? []).map((kit) => kit.id))) {
    report("R7", `kits[${index}].id`, `repeats kits[${first}].id`);
  }

  // R9: no role twice in mandate.roles.
  for (const { index, first } of repeats(mandateRoles)) {
    report("R9", `mandate.roles[${index}]`, `repeats mandate.roles[${first}]`);
  }

  return found;
}
