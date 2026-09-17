import { describe, expect, it } from "vitest";
import { assertPassThroughAssessments, joinFirstDayOnboarding, onboardingExitCode } from "./join.js";
import type { AssessmentSurface, OnboardingRequest, RoleAssessmentObservation, RoleSelection } from "./types.js";

const request: OnboardingRequest = { schemaVersion: 1, engagement: { id: "engagement-alpha", decisionOwner: "decision-owner-alpha" }, unresolved: [], unmapped: [], candidateRoles: [] };
const surface: AssessmentSurface = { role: "@clossys/advisor", version: "1.0.0", bin: "advisor-check", invocation: "single-json-input", executable: "dist/cli.js" };
const selection: readonly RoleSelection[] = [
  { role: "@clossys/advisor", outcome: "selected", rule: "engagement-baseline" },
  { role: "@clossys/observer", outcome: "selected", rule: "independent-outcome" },
  { role: "@clossys/writer", outcome: "excluded", rule: "no-selection-rule-opened-this-role" },
];
function observed(role: string, overrides: Partial<RoleAssessmentObservation> = {}): RoleAssessmentObservation {
  return { role, surface: { ...surface, role }, absence: null, failure: null, exitCode: 0, assessment: { returnedBy: role }, ...overrides };
}

describe("the onboarding join", () => {
  it("carries a role's assessment by reference and never rebuilds it", () => {
    const returned = { proposedPositions: [], baselineTheRoleWrote: "only the role writes this" };
    const run = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor", { assessment: returned }), observed("@clossys/observer")]);
    const record = run.assessments.find((item) => item.role === "@clossys/advisor");
    expect(Object.is(record?.assessment, returned)).toBe(true);
  });

  it("throws rather than shipping an assessment the orchestration authored", () => {
    const returned = { gaps: ["role-written"] };
    expect(() => assertPassThroughAssessments(
      [{ role: "@clossys/advisor", outcome: "assessment-returned", surface, absence: null, failure: null, exitCode: 0, assessment: { ...returned } }],
      [observed("@clossys/advisor", { assessment: returned })],
    )).toThrow(/only a role may author its own assessment/);
  });

  it("emits no assessment for a role that returned none", () => {
    const run = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor"), observed("@clossys/observer", { surface: null, absence: "no-assessment-declaration", exitCode: null, assessment: undefined })]);
    expect(run.assessments.find((item) => item.role === "@clossys/observer")?.assessment).toBeUndefined();
  });

  it("reports a selected role with no assessment surface as a determinate gap, never a skip", () => {
    const run = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor"), observed("@clossys/observer", { surface: null, absence: "no-assessment-declaration", exitCode: null, assessment: undefined })]);
    expect(run.assessments.map((item) => item.role)).toEqual(["@clossys/advisor", "@clossys/observer"]);
    expect(run.gaps).toEqual([{ role: "@clossys/observer", reason: "no-assessment-declaration" }]);
    expect(run.findings.map((item) => item.rule)).toContain("selected-role-has-no-assessment-surface");
    expect(run.state).toBe("indeterminate");
  });

  it("grades an unassessed role differently from an assessed, clean one", () => {
    const clean = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor"), observed("@clossys/observer")]);
    const unobserved = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor"), observed("@clossys/observer", { surface: null, absence: "package-not-installed", exitCode: null, assessment: undefined })]);
    expect(clean.state).toBe("satisfied");
    expect(unobserved.state).toBe("indeterminate");
    expect(onboardingExitCode(clean.state)).not.toBe(onboardingExitCode(unobserved.state));
  });

  it("treats a missing observation for a selected role as not executed", () => {
    const run = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor")]);
    expect(run.gaps).toEqual([{ role: "@clossys/observer", reason: "assessment-not-executed" }]);
    expect(run.state).toBe("indeterminate");
  });

  it("keeps a role's violation as the role's finding and does not restate it as its own", () => {
    const run = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor", { exitCode: 1 }), observed("@clossys/observer")]);
    expect(run.state).toBe("violated");
    expect(run.assessments.find((item) => item.role === "@clossys/advisor")?.outcome).toBe("assessment-violated");
  });

  it("lets indeterminate dominate violated", () => {
    const run = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor", { exitCode: 1 }), observed("@clossys/observer", { exitCode: 2 })]);
    expect(run.state).toBe("indeterminate");
  });

  it("refuses to grade a run that assessed nothing as satisfied", () => {
    const run = joinFirstDayOnboarding(request, [{ role: "@clossys/writer", outcome: "excluded", rule: "no-selection-rule-opened-this-role" }], []);
    expect(run.state).toBe("indeterminate");
    expect(run.findings.map((item) => item.rule)).toContain("no-role-selected");
  });

  it("records, rather than absorbs, an assessment observed for an unselected role", () => {
    const run = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor"), observed("@clossys/observer"), observed("@clossys/writer")]);
    expect(run.findings.map((item) => item.rule)).toContain("unselected-role-observation");
    expect(run.assessments.map((item) => item.role)).not.toContain("@clossys/writer");
  });

  it("produces no baseline, target, gap analysis or recommendation of its own", () => {
    const run = joinFirstDayOnboarding(request, selection, [observed("@clossys/advisor"), observed("@clossys/observer")]);
    for (const key of ["baseline", "target", "setpoint", "causalHypothesis", "recommendation", "criticalPath", "openQuestions"]) {
      expect(Object.keys(run)).not.toContain(key);
      for (const item of run.assessments) expect(Object.keys(item)).not.toContain(key);
    }
  });
});
