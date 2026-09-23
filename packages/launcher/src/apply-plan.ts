// Apply an approved plan (#1178): writes clossys/brief.json into a staffed
// repository from the exact EngagementBrief shape and plan.json contract
// recorded on issue #1175 ("Plan file contract", posted 2026-09-22).
//
// SCOPE OF THIS MODULE (see the wave-2 PR body for the full explanation):
// this lands the mechanical, auditable core the landed contract fully
// specifies -- reading clossys/advisor/plan.json, confirming it is
// approved, validating an EngagementBrief, and writing clossys/brief.json
// byte-identically. Multi-repository orchestration (branch creation, exact
// package installs, Starter's caller workflow, opening one pull request
// per repository) is deferred: the landed contract does not yet specify
// how a plan's approved roles map to inventory repository ids or to
// install/remove/relocate work items, and building that mapping now would
// mean inventing an interface Advisor's still-open PR (#1193) might define
// differently.
//
// clossys/brief.json's shape is NOT re-derived here -- @clossys/advisor's
// EngagementBrief export (landing in #1193) is the one owner of that
// computation. This module receives an already-computed brief (as a file
// path today; a direct call once #1193 lands and a caller can import the
// package) and only validates its shape and writes it, exactly the split
// #1187's governing principle draws between package-owned definition and
// judgment versus Launcher's deterministic mechanics.

import type { WorkspaceHost } from "./types.js";

export interface EngagementBriefRole {
  readonly role: string;
  readonly why: string;
  readonly goal: { readonly metric: string; readonly direction: "increase" | "decrease" };
  readonly inputsFrom: readonly string[];
  readonly outputsTo: readonly string[];
}

export interface EngagementBrief {
  readonly schemaVersion: 1;
  readonly problem: string;
  readonly roles: readonly EngagementBriefRole[];
  readonly sequence: readonly string[];
  readonly deliverables: readonly string[];
}

export type BlockerKind = "missing-input" | "missing-authority" | "failing-evidence" | "unavailable-environment" | "contradiction";

export interface PlanBlocker {
  readonly kind: BlockerKind;
  readonly description: string;
  readonly owner: string;
  readonly dueDate?: string;
}

export interface PlanDecision {
  readonly at: string;
  readonly recommended: string;
  readonly chosen: string;
  readonly by: string;
}

export interface AdvisorPlan {
  readonly schemaVersion: 1;
  readonly asOf: string;
  readonly mandate: { readonly problem: string; readonly primaryProblemId: string; readonly roles: readonly string[] };
  readonly whereWeAre: readonly string[];
  readonly recommendedNext: { readonly action: string; readonly owner: string; readonly due: string } | null;
  readonly decisions: readonly PlanDecision[];
  readonly blockers: readonly PlanBlocker[];
}

export type ValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Validates an EngagementBrief's shape exactly against the #1175 contract. Never mutates, never re-derives content. */
export function validateEngagementBrief(value: unknown): ValidationResult {
  if (!isRecord(value)) return { valid: false, reason: "brief must be an object" };
  if (value.schemaVersion !== 1) return { valid: false, reason: "brief.schemaVersion must be 1" };
  if (!nonEmptyString(value.problem)) return { valid: false, reason: "brief.problem must be a non-empty string" };
  if (!Array.isArray(value.roles) || value.roles.length === 0) return { valid: false, reason: "brief.roles must be a non-empty array" };
  for (const [index, role] of value.roles.entries()) {
    if (!isRecord(role)) return { valid: false, reason: `brief.roles[${index}] must be an object` };
    if (!nonEmptyString(role.role)) return { valid: false, reason: `brief.roles[${index}].role must be a non-empty string` };
    if (!nonEmptyString(role.why)) return { valid: false, reason: `brief.roles[${index}].why must be a non-empty string` };
    if (!isRecord(role.goal) || !nonEmptyString(role.goal.metric) || (role.goal.direction !== "increase" && role.goal.direction !== "decrease")) {
      return { valid: false, reason: `brief.roles[${index}].goal must have a metric and a direction of increase or decrease` };
    }
    if (!stringArray(role.inputsFrom)) return { valid: false, reason: `brief.roles[${index}].inputsFrom must be a string array` };
    if (!stringArray(role.outputsTo)) return { valid: false, reason: `brief.roles[${index}].outputsTo must be a string array` };
  }
  if (!stringArray(value.sequence) || value.sequence.length === 0) return { valid: false, reason: "brief.sequence must be a non-empty string array" };
  if (!stringArray(value.deliverables)) return { valid: false, reason: "brief.deliverables must be a string array" };
  return { valid: true };
}

const BLOCKER_KINDS = new Set<BlockerKind>(["missing-input", "missing-authority", "failing-evidence", "unavailable-environment", "contradiction"]);

/** Validates an AdvisorPlan's shape exactly against the #1175 contract. */
export function validateAdvisorPlan(value: unknown): ValidationResult {
  if (!isRecord(value)) return { valid: false, reason: "plan must be an object" };
  if (value.schemaVersion !== 1) return { valid: false, reason: "plan.schemaVersion must be 1" };
  if (!nonEmptyString(value.asOf)) return { valid: false, reason: "plan.asOf must be a non-empty string" };
  if (!isRecord(value.mandate) || !nonEmptyString(value.mandate.problem) || !nonEmptyString(value.mandate.primaryProblemId) || !stringArray(value.mandate.roles)) {
    return { valid: false, reason: "plan.mandate must have problem, primaryProblemId, and a roles string array" };
  }
  if (!stringArray(value.whereWeAre)) return { valid: false, reason: "plan.whereWeAre must be a string array" };
  if (value.recommendedNext !== null) {
    if (!isRecord(value.recommendedNext) || !nonEmptyString(value.recommendedNext.action) || !nonEmptyString(value.recommendedNext.owner) || !nonEmptyString(value.recommendedNext.due)) {
      return { valid: false, reason: "plan.recommendedNext must be null or have action, owner, and due" };
    }
  }
  if (!Array.isArray(value.decisions)) return { valid: false, reason: "plan.decisions must be an array" };
  for (const [index, decision] of value.decisions.entries()) {
    if (!isRecord(decision) || !nonEmptyString(decision.at) || !nonEmptyString(decision.recommended) || !nonEmptyString(decision.chosen) || !nonEmptyString(decision.by)) {
      return { valid: false, reason: `plan.decisions[${index}] must have at, recommended, chosen, and by` };
    }
  }
  if (!Array.isArray(value.blockers)) return { valid: false, reason: "plan.blockers must be an array" };
  for (const [index, blocker] of value.blockers.entries()) {
    if (!isRecord(blocker) || !BLOCKER_KINDS.has(blocker.kind as BlockerKind) || !nonEmptyString(blocker.description) || !nonEmptyString(blocker.owner)) {
      return { valid: false, reason: `plan.blockers[${index}] must have a valid kind, description, and owner` };
    }
  }
  return { valid: true };
}

/**
 * The plan is approved when its most recent decision (by `at`) records
 * chosen === "approved". No decisions, or a most-recent decision that
 * isn't "approved", is not approved -- this never assumes approval from
 * absence.
 */
export function isPlanApproved(plan: AdvisorPlan): boolean {
  if (plan.decisions.length === 0) return false;
  const mostRecent = [...plan.decisions].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)).at(-1);
  return mostRecent?.chosen === "approved";
}

export type ApplyBriefResult =
  | { readonly state: "applied"; readonly path: string }
  | { readonly state: "refused"; readonly reason: string };

/**
 * Writes clossys/brief.json into `repositoryDirectory`, byte-identically
 * from the validated brief -- never re-authors its prose. Refuses (does
 * not write) unless both the plan is approved and the brief validates.
 */
export function applyEngagementBrief(
  host: WorkspaceHost,
  repositoryDirectory: string,
  plan: AdvisorPlan,
  brief: EngagementBrief,
  briefRelPath: string,
): ApplyBriefResult {
  if (!isPlanApproved(plan)) {
    return { state: "refused", reason: "the plan's most recent decision is not \"approved\"" };
  }
  const validation = validateEngagementBrief(brief);
  if (!validation.valid) {
    return { state: "refused", reason: `brief does not validate: ${validation.reason}` };
  }
  const path = `${repositoryDirectory}/${briefRelPath}`;
  host.mkdirp(path.slice(0, path.lastIndexOf("/")));
  host.writeText(path, `${JSON.stringify(brief, null, 2)}\n`);
  return { state: "applied", path };
}
