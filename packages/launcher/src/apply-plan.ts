// Apply an approved plan (#1178): writes clossys/brief.json into a staffed
// repository once clossys/advisor/plan.json is approved, both validated
// against the shared plan and brief contracts (#1175, #1475).
//
// SCOPE OF THIS MODULE (see the wave-2 PR body for the full explanation):
// this lands the mechanical, auditable core the landed contract fully
// specifies -- reading clossys/advisor/plan.json, confirming it is
// approved, validating an EngagementBrief, and writing clossys/brief.json
// byte-identically. The plan contract now says which roles work in which
// inventory repository (`staffing`) and which exact package acts are
// authorized (`packages`), and approvedSubject() below says what an
// approval binds (#1178). Multi-repository orchestration (computing each
// repository's change, branch creation, exact package installs, Starter's
// caller workflow, opening one pull request per repository) is not built
// yet, and this module does not act on those fields.
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
import type { AdvisorPlan, EngagementBrief, PlanDecision } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";
import type { WorkspaceHost } from "./types.js";

export { validateAdvisorPlan, validateEngagementBrief } from "./plan-contract.js";
export type {
  AdvisorPlan, BlockerKind, EngagementBrief, EngagementBriefRole, EngagementContext, EngagementContextField, EngagementContextFieldId, GoalDirection, PlanBlocker, PlanDecision,
  PlanKit, PlanPackageAct, PlanStaffing, ValidationResult,
} from "./plan-contract.js";

/**
 * The decisions made at the latest instant, by `at` -- never by array
 * position -- or null when there are none, or when any decision's `at` does
 * not parse to a finite time (the plan contract already refuses one; this
 * does not rely on that), because then time cannot say which is latest.
 */
function latestDecisions(plan: AdvisorPlan): readonly PlanDecision[] | null {
  if (plan.decisions.length === 0) return null;
  const times = plan.decisions.map((decision) => Date.parse(decision.at));
  if (!times.every(Number.isFinite)) return null;
  const latest = Math.max(...times);
  return plan.decisions.filter((_, index) => times[index] === latest);
}

const SUBJECT_DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * What an approval binds (#1178): the `subjectDigest` of the plan's latest
 * decision, by `at`, when that decision has chosen "approved" -- the digest of
 * the exact change the approver was shown. Otherwise null, and null binds
 * nothing. Fails closed:
 *
 * - no decisions, or any decision time that does not parse: null;
 * - a latest decision that is not "approved": null;
 * - an approval with no `subjectDigest`, or one that is not a sha256 digest:
 *   null -- an approval that names no bytes approves no bytes;
 * - several decisions at the latest instant: their subject only when every
 *   one of them is "approved" with the same `subjectDigest`, else null.
 *
 * It says what was approved, not whether that is what is about to be applied:
 * the caller recomputes the digest of the change it holds and refuses unless
 * the two are equal.
 */
export function approvedSubject(plan: AdvisorPlan): string | null {
  const latest = latestDecisions(plan);
  if (latest === null || !latest.every((decision) => decision.chosen === "approved")) return null;
  const subject = latest[0]!.subjectDigest;
  if (typeof subject !== "string" || !SUBJECT_DIGEST.test(subject)) return null;
  return latest.every((decision) => decision.subjectDigest === subject) ? subject : null;
}

/**
 * The plan is approved when its most recent decision (by `at`) records
 * chosen === "approved". No decisions, or a most-recent decision that
 * isn't "approved", is not approved -- this never assumes approval from
 * absence. Fails closed on anything that would let array order decide
 * instead of time: a decision whose `at` does not parse to a finite time
 * (the plan contract already refuses one; this does not rely on that), or
 * two decisions at the same latest instant that do not all say "approved".
 *
 * It binds no bytes (#1178): it does not look at `subjectDigest`, so it is
 * true for an approval that names no change at all. It says only that the
 * latest decision is an approval. Anything that applies a plan must use
 * `approvedSubject()` instead, and compare the subject it returns with the
 * digest of the change it holds.
 */
export function isPlanApproved(plan: AdvisorPlan): boolean {
  const latest = latestDecisions(plan);
  return latest !== null && latest.every((decision) => decision.chosen === "approved");
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
 *
 * LEGACY (#1178): this path predates the approval binding. It accepts an
 * approval whether or not it carries a `subjectDigest` and checks no
 * binding (it uses `isPlanApproved()`), exactly as before; it is kept
 * working, not extended. Anything that must know what an approval binds uses
 * `approvedSubject()`.
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
