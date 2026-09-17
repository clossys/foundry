/**
 * The orchestration's own output: the JOIN, and nothing else.
 *
 * This module answers three questions and refuses every other one:
 *
 *   1. Which roles did a deterministic rule open?
 *   2. What did each opened role's own assessment surface return?
 *   3. What could not be observed, and why?
 *
 * It does not produce a baseline, a target, a gap analysis, a causal
 * hypothesis or a recommendation. Those are the ROLE's output and appear in
 * this report only inside `assessment`, which is carried by reference and is
 * typed `unknown` so no code here can construct one that typechecks as
 * content. `assertPassThroughAssessments` re-checks that by reference
 * identity before the report is returned: a record whose `assessment` is not
 * the very object the role returned throws rather than shipping.
 *
 * A selected role that returned nothing is NOT dropped. It becomes a gap, and
 * a run with any gap is `indeterminate` — never `satisfied`. A capability
 * that could not be observed must not grade identically to one that was
 * observed and was fine.
 */
import type { AssessmentOutcome, OnboardingFinding, OnboardingGap, OnboardingRequest, OnboardingRun, OnboardingState, RoleAssessmentObservation, RoleAssessmentRecord, RoleSelection } from "./types.js";

function outcomeFor(observation: RoleAssessmentObservation): { outcome: AssessmentOutcome; failure: RoleAssessmentObservation["failure"] } {
  if (observation.absence !== null) return { outcome: "no-assessment-surface", failure: null };
  if (observation.failure !== null) return { outcome: "assessment-not-returned", failure: observation.failure };
  if (observation.exitCode === 0) {
    return observation.assessment === undefined
      ? { outcome: "assessment-not-returned", failure: "assessment-output-unreadable" }
      : { outcome: "assessment-returned", failure: null };
  }
  if (observation.exitCode === 1) return { outcome: "assessment-violated", failure: null };
  if (observation.exitCode === 2) return { outcome: "assessment-indeterminate", failure: null };
  return { outcome: "assessment-not-returned", failure: "assessment-exit-inconsistent" };
}

/**
 * Throws when any record's `assessment` is not reference-identical to the
 * value its role returned. This is the structural guard against the
 * orchestration authoring, normalizing, defaulting or merging assessment
 * content: any such value is a different object and trips here.
 */
export function assertPassThroughAssessments(records: readonly RoleAssessmentRecord[], observations: readonly RoleAssessmentObservation[]): void {
  const returned = new Map(observations.map((observation) => [observation.role, observation.assessment] as const));
  for (const item of records) {
    if (item.assessment === undefined) continue;
    if (!Object.is(item.assessment, returned.get(item.role))) {
      throw new Error(`onboarding join authored an assessment for ${item.role}; only a role may author its own assessment`);
    }
  }
}

/** Joins a selection with the roles' own returned assessments. Pure: no I/O, no process, no clock. */
export function joinFirstDayOnboarding(request: OnboardingRequest, selection: readonly RoleSelection[], observations: readonly RoleAssessmentObservation[]): OnboardingRun {
  const findings: OnboardingFinding[] = [];
  const gaps: OnboardingGap[] = [];
  const byRole = new Map(observations.map((observation) => [observation.role, observation] as const));
  const selected = selection.filter((item) => item.outcome === "selected");
  const assessments: RoleAssessmentRecord[] = [];

  for (const item of selected) {
    const observation = byRole.get(item.role) ?? { role: item.role, surface: null, absence: null, failure: "assessment-not-executed" as const, exitCode: null, assessment: undefined };
    const { outcome, failure } = outcomeFor(observation);
    assessments.push({
      role: item.role,
      outcome,
      surface: observation.surface,
      absence: observation.absence,
      failure,
      exitCode: observation.exitCode,
      assessment: outcome === "assessment-returned" ? observation.assessment : undefined,
    });
    if (outcome === "no-assessment-surface") {
      gaps.push({ role: item.role, reason: observation.absence as NonNullable<RoleAssessmentObservation["absence"]> });
      findings.push({ rule: "selected-role-has-no-assessment-surface", path: item.role, message: `opened by rule "${item.rule}" but its installed manifest exposes no assessment entry point (${observation.absence}); this role was not assessed` });
    } else if (outcome === "assessment-not-returned") {
      gaps.push({ role: item.role, reason: failure as NonNullable<RoleAssessmentObservation["failure"]> });
      findings.push({ rule: "selected-role-returned-no-assessment", path: item.role, message: `opened by rule "${item.rule}"; its assessment surface was discovered but returned no usable result (${failure})` });
    } else if (outcome === "assessment-violated") {
      findings.push({ rule: "role-assessment-violated", path: item.role, message: "the role's own assessment reported a violation; read the role's report, not this join" });
    } else if (outcome === "assessment-indeterminate") {
      findings.push({ rule: "role-assessment-indeterminate", path: item.role, message: "the role's own assessment could not conclude; read the role's report, not this join" });
    }
  }

  for (const observation of observations) {
    if (!selected.some((item) => item.role === observation.role)) {
      findings.push({ rule: "unselected-role-observation", path: observation.role, message: "an assessment was observed for a role no selection rule opened; it is recorded here and carried no further" });
    }
  }
  if (selected.length === 0) findings.push({ rule: "no-role-selected", path: "selection", message: "no selection rule opened any role; a run that assessed nothing is indeterminate, not satisfied" });

  const state: OnboardingState =
    selected.length === 0 || assessments.some((item) => item.outcome === "no-assessment-surface" || item.outcome === "assessment-not-returned" || item.outcome === "assessment-indeterminate")
      ? "indeterminate"
      : assessments.some((item) => item.outcome === "assessment-violated") ? "violated" : "satisfied";

  assertPassThroughAssessments(assessments, observations);
  return { schemaVersion: 1, state, engagement: request.engagement, selection, assessments, gaps, findings };
}

/** The process exit code for a run state, on this repository's fixed ternary. */
export function onboardingExitCode(state: OnboardingState): number { return state === "satisfied" ? 0 : state === "violated" ? 1 : 2; }
