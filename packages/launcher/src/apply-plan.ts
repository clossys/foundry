// Apply an approved plan (#1178): writes clossys/brief.json into a staffed
// repository once clossys/advisor/plan.json is approved, both validated
// against the shared plan and brief contracts (#1175, #1475).
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
// toEngagementBrief() is the one owner of that computation. This module
// receives an already-computed brief and only validates it and writes it,
// exactly the split #1187's governing principle draws between
// package-owned definition and judgment versus Launcher's deterministic
// mechanics.
//
// VALIDATION (issue #1475): see plan-contract.ts. There is no second,
// hand-written shape check here to drift from Advisor's: a plan or brief
// Advisor accepts, Launcher accepts, and every object in them is closed, so
// an unknown field is refused. This package still has no runtime
// dependency on @clossys/advisor.

import { validateAdvisorPlan, validateEngagementBrief } from "./plan-contract.js";
import type { AdvisorPlan, EngagementBrief } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";
import type { WorkspaceHost } from "./types.js";

export { validateAdvisorPlan, validateEngagementBrief } from "./plan-contract.js";
export type {
  AdvisorPlan, BlockerKind, EngagementBrief, EngagementBriefRole, EngagementContext, EngagementContextField, EngagementContextFieldId, GoalDirection, PlanBlocker, PlanDecision,
  ValidationResult,
} from "./plan-contract.js";

/**
 * The plan is approved when its most recent decision (by `at`) records
 * chosen === "approved". No decisions, or a most-recent decision that
 * isn't "approved", is not approved -- this never assumes approval from
 * absence. Fails closed on anything that would let array order decide
 * instead of time: a decision whose `at` does not parse to a finite time
 * (the plan contract already refuses one; this does not rely on that), or
 * two decisions at the same latest instant that do not all say "approved".
 */
export function isPlanApproved(plan: AdvisorPlan): boolean {
  if (plan.decisions.length === 0) return false;
  const times = plan.decisions.map((decision) => Date.parse(decision.at));
  if (!times.every(Number.isFinite)) return false;
  const latest = Math.max(...times);
  return plan.decisions.every((decision, index) => times[index] !== latest || decision.chosen === "approved");
}

export type ApplyBriefResult =
  | { readonly state: "applied"; readonly path: string; readonly planDigest: string }
  | { readonly state: "refused"; readonly reason: string };

/**
 * Writes clossys/brief.json into `repositoryDirectory`, byte-identically
 * from the validated brief -- never re-authors its prose. Refuses (does
 * not write) unless the plan validates and is approved and the brief,
 * including its context snapshot, validates. Reports the canonical digest
 * of the plan it applied.
 */
export function applyEngagementBrief(
  host: WorkspaceHost,
  repositoryDirectory: string,
  plan: AdvisorPlan,
  brief: EngagementBrief,
  briefRelPath: string,
): ApplyBriefResult {
  const planValidation = validateAdvisorPlan(plan);
  if (!planValidation.valid) {
    return { state: "refused", reason: `plan does not validate: ${planValidation.reason}` };
  }
  if (!isPlanApproved(plan)) {
    return { state: "refused", reason: "the plan's most recent decision is not \"approved\", or decisions made at that same time disagree" };
  }
  const validation = validateEngagementBrief(brief);
  if (!validation.valid) {
    return { state: "refused", reason: `brief does not validate: ${validation.reason}` };
  }
  // Everything that can refuse runs before the first write, so a refusal
  // never leaves a brief behind. A plan that validates always has a digest
  // (the contract refuses what canonical JSON cannot carry); this catch is
  // the backstop that keeps that a refusal rather than a throw after writing.
  let digest: string;
  try {
    digest = planDigest(plan);
  } catch (cause) {
    return { state: "refused", reason: `plan has no canonical digest: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const contents = `${JSON.stringify(brief, null, 2)}\n`;
  const path = `${repositoryDirectory}/${briefRelPath}`;
  host.mkdirp(path.slice(0, path.lastIndexOf("/")));
  host.writeText(path, contents);
  return { state: "applied", path, planDigest: digest };
}
