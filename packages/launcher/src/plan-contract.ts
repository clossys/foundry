// The plan record and the engagement brief (issue #1475), validated against
// the shared contracts docs/contracts/advisor-plan.json, engagement-brief.json
// and engagement-context.json -- in the public repository, not shipped in this package.
// This package's build packs their content into
// src/generated/ as plain data, with a generated copy of the one contract
// checker @clossys/advisor also uses, so Launcher and Advisor validate
// against the same definition with no runtime dependency between them.
// The TypeScript types below describe the same shapes for callers; they
// validate nothing.

import { formatContractViolation, validateAgainstContract } from "./generated/contract-schema.generated.js";
import type { ContractSchema } from "./generated/contract-schema.generated.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { briefRuleViolations, planRuleViolations } from "./plan-rules.js";
import type { ContractRuleId } from "./plan-rules.js";

/** An engagement-context field id (docs/contracts/engagement-context.json, in the public repository, not shipped in this package). */
export type EngagementContextFieldId = "business" | "product" | "audience" | "stage" | "intent" | "constraints";

/** An unknown context field, or a known one whose value is one of that field's fixed choice ids -- never founder text. */
export type EngagementContextField =
  | { readonly id: EngagementContextFieldId; readonly state: "unknown" }
  | { readonly id: EngagementContextFieldId; readonly state: "known"; readonly value: string };

/** The engagement-context snapshot a brief may carry (docs/contracts/engagement-context.json, in the public repository, not shipped in this package). */
export interface EngagementContext {
  readonly schemaVersion: 1;
  readonly fields: readonly EngagementContextField[];
}

export type GoalDirection = "increase" | "decrease" | "maintain" | "target-range";

export interface EngagementBriefRole {
  readonly role: string;
  readonly why: string;
  readonly goal: { readonly metric: string; readonly direction: GoalDirection };
  readonly inputsFrom: readonly string[];
  readonly outputsTo: readonly string[];
}

/** clossys/brief.json (docs/contracts/engagement-brief.json, in the public repository, not shipped in this package). */
export interface EngagementBrief {
  readonly schemaVersion: 1;
  readonly problem: string;
  readonly roles: readonly EngagementBriefRole[];
  readonly sequence: readonly string[];
  readonly deliverables: readonly string[];
  /** The roles staffed in the repository this brief is written to, in plan order; absent in the hub brief (#1178). */
  readonly staffedHere?: readonly string[];
  /** Optional snapshot of the hub's engagement context; absent means every field is unknown. */
  readonly context?: EngagementContext;
}

export type BlockerKind = "missing-input" | "missing-authority" | "failing-evidence" | "unavailable-environment" | "contradiction";

/** One capability at rest with exactly one next action: who does it, how, and by when. */
export interface PlanBlocker {
  readonly capabilityId: string;
  readonly kind: BlockerKind;
  readonly owner: string;
  readonly nextAction: { readonly who: string; readonly how: string; readonly byWhen: string };
  /** ISO 8601 date-time the blocker was recorded. */
  readonly since: string;
}

export interface PlanDecision {
  readonly at: string;
  readonly recommended: string;
  readonly chosen: string;
  readonly by: string;
  /** On an approving decision, the digest of the exact change the approver was shown; an approval without it binds nothing (#1178). */
  readonly subjectDigest?: string;
}

/** A kit recommended for the plan (#1178). */
export interface PlanKit {
  readonly id: string;
  readonly source: "preset" | "composed";
  readonly verdict: "recommended";
}

/** Which roles work in one repository, named by its repository inventory id (#1178). */
export interface PlanStaffing {
  readonly repository: string;
  readonly roles: readonly string[];
}

/** One exact package act: one version and one sha512 integrity value (#1178). */
export interface PlanPackageAct {
  readonly planItem: string;
  readonly repository: string;
  readonly act: "install" | "pin-starter";
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly placement: "dependencies" | "devDependencies";
}

/** clossys/advisor/plan.json (docs/contracts/advisor-plan.json, in the public repository, not shipped in this package). */
export interface AdvisorPlan {
  readonly schemaVersion: 1;
  readonly asOf: string;
  readonly mandate: { readonly problem: string; readonly primaryProblemId: string; readonly roles: readonly string[] };
  readonly whereWeAre: readonly string[];
  readonly recommendedNext: { readonly action: string; readonly owner: string; readonly due?: string } | null;
  readonly decisions: readonly PlanDecision[];
  readonly blockers: readonly PlanBlocker[];
  readonly kits?: readonly PlanKit[];
  readonly staffing?: readonly PlanStaffing[];
  /** Present exactly when `resolution` is. */
  readonly packages?: readonly PlanPackageAct[];
  readonly resolution?: { readonly snapshotDigest: string };
}

/** `reason` lists every violation, separated by `; `, each naming the field at fault (for example `plan.blockers[0].capabilityId is required`). */
export type ValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

function loadContract(name: string): ContractSchema {
  const contract = Object.hasOwn(PLAN_CONTRACTS, name) ? PLAN_CONTRACTS[name] : undefined;
  if (contract === undefined) throw new Error(`no packed contract named ${JSON.stringify(name)}`);
  return contract;
}

/** One reason a plan or brief is refused: `rule` is "schema" for the contract's keywords, else the code rule's id. */
export interface DocumentViolation {
  readonly rule: "schema" | ContractRuleId;
  /** The field at fault, like `staffing[1].repository`, or "" for the document itself. */
  readonly path: string;
  /** The whole message, starting with the label and path; it never quotes a value. */
  readonly message: string;
}

function violationsOf<T>(contractName: string, label: string, value: unknown, rules: (document: T) => readonly { rule: ContractRuleId; path: string; message: string }[]): DocumentViolation[] {
  const schema = validateAgainstContract(loadContract(contractName), value, loadContract);
  if (schema.length > 0) return schema.map((violation) => ({ rule: "schema", path: violation.path, message: formatContractViolation(label, violation) }));
  // The code rules relate fields to one another, so they run only on a document whose shape is known good.
  return rules(value as T).map((violation) => ({ rule: violation.rule, path: violation.path, message: `${label}.${violation.path} ${violation.message} (rule ${violation.rule})` }));
}

function result(violations: readonly DocumentViolation[]): ValidationResult {
  if (violations.length === 0) return { valid: true };
  return { valid: false, reason: violations.map((violation) => violation.message).join("; ") };
}

/** Every reason a plan is refused: the plan contract's schema, then, once that passes, its code rules R1-R10. */
export function advisorPlanViolations(value: unknown): DocumentViolation[] {
  return violationsOf<AdvisorPlan>("advisor-plan.json", "plan", value, planRuleViolations);
}

/** Every reason a brief is refused: the brief contract's schema, then, once that passes, its code rules B1-B2. */
export function engagementBriefViolations(value: unknown): DocumentViolation[] {
  return violationsOf<EngagementBrief>("engagement-brief.json", "brief", value, briefRuleViolations);
}

/**
 * Validates a brief against docs/contracts/engagement-brief.json, including
 * its optional `context` snapshot against engagement-context.json: a known
 * context value must be one of that field's fixed choice ids, because the
 * brief is committed in every staffed repository. Both contracts are in the public repository, not shipped in this package.
 * Once the schema passes, the contract's code rules run: every `staffedHere`
 * entry is one of `roles[].role` (B1), and none repeats (B2). Never mutates,
 * never re-derives content, and no reason echoes a value from the brief.
 */
export function validateEngagementBrief(value: unknown): ValidationResult {
  return result(engagementBriefViolations(value));
}

/**
 * Validates a plan against docs/contracts/advisor-plan.json (in the public repository, not shipped in this package):
 * its schema, then, once that passes, its code rules R1-R10 -- staffing and
 * package entries that repeat, and the joins between staffing, the mandate
 * and packages (#1178). No reason echoes a value from the plan.
 */
export function validateAdvisorPlan(value: unknown): ValidationResult {
  return result(advisorPlanViolations(value));
}
