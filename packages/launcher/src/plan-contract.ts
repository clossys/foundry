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
}

/** `reason` lists every violation, separated by `; `, each naming the field at fault (for example `plan.blockers[0].capabilityId is required`). */
export type ValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

function loadContract(name: string): ContractSchema {
  const contract = Object.hasOwn(PLAN_CONTRACTS, name) ? PLAN_CONTRACTS[name] : undefined;
  if (contract === undefined) throw new Error(`no packed contract named ${JSON.stringify(name)}`);
  return contract;
}

function validateAgainst(contractName: string, label: string, value: unknown): ValidationResult {
  const violations = validateAgainstContract(loadContract(contractName), value, loadContract);
  if (violations.length === 0) return { valid: true };
  return { valid: false, reason: violations.map((violation) => formatContractViolation(label, violation)).join("; ") };
}

/**
 * Validates a brief against docs/contracts/engagement-brief.json, including
 * its optional `context` snapshot against engagement-context.json: a known
 * context value must be one of that field's fixed choice ids, because the
 * brief is committed in every staffed repository. Both contracts are in the public repository, not shipped in this package.
 * Never mutates, never
 * re-derives content, and no reason echoes a value from the brief.
 */
export function validateEngagementBrief(value: unknown): ValidationResult {
  return validateAgainst("engagement-brief.json", "brief", value);
}

/** Validates a plan against docs/contracts/advisor-plan.json (in the public repository, not shipped in this package). */
export function validateAdvisorPlan(value: unknown): ValidationResult {
  return validateAgainst("advisor-plan.json", "plan", value);
}
