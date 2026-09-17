import { describe, expect, it } from "vitest";
import { validateInstalledPositionLedger } from "../positions/index.js";
import { joinFirstDayOnboarding } from "./join.js";
import { authorizeMutation, onboardingRunDigest, proposeInstalledPositionLedger } from "./ledger.js";
import { activeRolesFromContract } from "./index.js";
import { selectRoles } from "./selection.js";
import type { OnboardingRequest, RoleAssessmentObservation } from "./types.js";

const roles = activeRolesFromContract();
const request: OnboardingRequest = { schemaVersion: 1, engagement: { id: "engagement-alpha", decisionOwner: "decision-owner-alpha" }, unresolved: [], unmapped: [], candidateRoles: [] };

/** A position record a ROLE returns. The orchestration never builds one of these; these tests stand in for the role. */
function rolePosition(id: string, role: string): Record<string, unknown> {
  return {
    id, package: role,
    businessMetricPath: { l1: "synthetic value", l2: "synthetic northstar", l3: "synthetic operating metric" },
    causalHypothesis: "Synthetic hypothesis returned by the role's own assessment.",
    baseline: { value: 0.4, observedAt: "2026-08-17T00:00:00.000Z", evidenceRefs: ["synthetic-baseline"] },
    setpoint: { value: 0.9, evidenceRefs: ["synthetic-setpoint"] },
    operatingScope: { description: "Synthetic scope.", included: ["synthetic surface"], excluded: ["provider mutation"] },
    authority: { decisionOwner: "decision-owner-alpha", actionAuthority: "synthetic automation" },
    evidenceSource: { description: "Synthetic evidence.", locator: "synthetic-source" },
    cadence: { measure: "weekly", review: "monthly" },
    budget: { amount: 0, unit: "currency", period: "month" },
    guardrails: ["No live action."],
    escalationPath: ["Escalate to the decision owner."],
    workerComponents: [{ kind: "deterministic", responsibility: "Validate synthetic input." }],
    stageBindings: { sense: "Read evidence.", judge: "Compare values.", act: "Report result.", verify: "Re-read evidence.", learnOrEscalate: "Escalate failure." },
    firstDayAssessment: { gaps: ["synthetic gap"], target: "Synthetic target state.", openQuestions: ["synthetic question"], criticalPath: ["Validate the synthetic run."], deferredWork: ["synthetic refinement"], recommendation: "install", evidenceRefs: ["synthetic-baseline", "synthetic-setpoint"] },
  };
}

function observation(role: string, positions: readonly unknown[], overrides: Partial<RoleAssessmentObservation> = {}): RoleAssessmentObservation {
  return { role, surface: { role, version: "1.0.0", bin: "check", invocation: "single-json-input", executable: "dist/cli.js" }, absence: null, failure: null, exitCode: 0, assessment: { state: "satisfied", proposedPositions: positions }, ...overrides };
}

function run(observations: readonly RoleAssessmentObservation[], value: OnboardingRequest = request) {
  return joinFirstDayOnboarding(value, selectRoles(value, roles), observations);
}

describe("installed-position contract production", () => {
  it("produces a ledger that validates against the shipped installed-position contract", () => {
    const advisorPosition = rolePosition("synthetic-advisor-1", "@clossys/advisor");
    const proposal = proposeInstalledPositionLedger(run([observation("@clossys/advisor", [advisorPosition]), observation("@clossys/observer", [])]), roles);
    expect(proposal.findings).toEqual([]);
    expect(proposal.ledger).not.toBeNull();
    const report = validateInstalledPositionLedger(proposal.ledger);
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.openRoles).toBe(1);
    expect(report.positions).toBe(1);
  });

  it("carries every position by reference from the role that proposed it", () => {
    const advisorPosition = rolePosition("synthetic-advisor-1", "@clossys/advisor");
    const proposal = proposeInstalledPositionLedger(run([observation("@clossys/advisor", [advisorPosition]), observation("@clossys/observer", [])]), roles);
    const positions = (proposal.ledger as { positions: unknown[] }).positions;
    expect(Object.is(positions[0], advisorPosition)).toBe(true);
  });

  it("refuses a ledger when a selected role has no assessment surface", () => {
    const proposal = proposeInstalledPositionLedger(run([observation("@clossys/advisor", [rolePosition("synthetic-advisor-1", "@clossys/advisor")]), observation("@clossys/observer", [], { surface: null, absence: "no-assessment-declaration", exitCode: null, assessment: undefined })]), roles);
    expect(proposal.ledger).toBeNull();
    expect(proposal.findings.map((item) => item.rule)).toEqual(expect.arrayContaining(["ledger-blocked-by-run-state", "ledger-blocked-by-unassessed-role"]));
  });

  it("will not invent proposed positions for a role whose assessment returned none", () => {
    const proposal = proposeInstalledPositionLedger(run([observation("@clossys/advisor", [], { assessment: { state: "satisfied" } }), observation("@clossys/observer", [])]), roles);
    expect(proposal.ledger).toBeNull();
    expect(proposal.findings.map((item) => item.rule)).toContain("role-assessment-without-proposed-positions");
  });

  it("gives every excluded role one non-applicable disposition derived from the rule set", () => {
    const proposal = proposeInstalledPositionLedger(run([observation("@clossys/advisor", [rolePosition("synthetic-advisor-1", "@clossys/advisor")]), observation("@clossys/observer", [])]), roles);
    const dispositions = (proposal.ledger as { dispositions: { package: string; disposition: string; reason: string }[] }).dispositions;
    expect(dispositions).toHaveLength(roles.length);
    const writer = dispositions.find((item) => item.package === "@clossys/writer");
    expect(writer?.disposition).toBe("not-applicable");
    expect(writer?.reason).toContain("No selection rule opened this role");
  });
});

describe("mutation authorization", () => {
  const advisorPosition = rolePosition("synthetic-advisor-1", "@clossys/advisor");
  const clean = run([observation("@clossys/advisor", [advisorPosition]), observation("@clossys/observer", [])]);
  const cleanLedger = proposeInstalledPositionLedger(clean, roles).ledger;
  const approval = { decisionOwner: "decision-owner-alpha", approvedRunDigest: onboardingRunDigest(clean), approvedAt: "2026-08-18T00:00:00.000Z" };

  it("authorizes only a satisfied run whose exact digest this engagement's decision owner approved", () => {
    expect(authorizeMutation(clean, cleanLedger, approval)).toEqual({ authorized: true, findings: [] });
  });

  it("refuses mutation when the decision owner has not approved at all", () => {
    const result = authorizeMutation(clean, cleanLedger, undefined);
    expect(result.authorized).toBe(false);
    expect(result.findings.map((item) => item.rule)).toContain("mutation-blocked-by-missing-approval");
  });

  it("refuses an approval given by someone other than the engagement's decision owner", () => {
    const result = authorizeMutation(clean, cleanLedger, { ...approval, decisionOwner: "someone-else" });
    expect(result.findings.map((item) => item.rule)).toContain("mutation-blocked-by-wrong-approver");
  });

  it("refuses an approval that names a different run", () => {
    const result = authorizeMutation(clean, cleanLedger, { ...approval, approvedRunDigest: "0".repeat(64) });
    expect(result.findings.map((item) => item.rule)).toContain("mutation-blocked-by-stale-approval");
  });

  it("refuses mutation when a selected role was never assessed, however the ledger looks", () => {
    const gapped = run([observation("@clossys/advisor", [advisorPosition]), observation("@clossys/observer", [], { surface: null, absence: "package-not-installed", exitCode: null, assessment: undefined })]);
    const result = authorizeMutation(gapped, cleanLedger, { ...approval, approvedRunDigest: onboardingRunDigest(gapped) });
    expect(result.authorized).toBe(false);
    expect(result.findings.map((item) => item.rule)).toEqual(expect.arrayContaining(["mutation-blocked-by-run-state", "mutation-blocked-by-gap"]));
  });

  it("refuses mutation when a position carries no baseline evidence", () => {
    const withoutBaseline = { ...advisorPosition, baseline: { value: 0.4, observedAt: "2026-08-17T00:00:00.000Z", evidenceRefs: [] } };
    const degraded = run([observation("@clossys/advisor", [withoutBaseline]), observation("@clossys/observer", [])]);
    const ledger = proposeInstalledPositionLedger(degraded, roles).ledger;
    const result = authorizeMutation(degraded, ledger, { ...approval, approvedRunDigest: onboardingRunDigest(degraded) });
    expect(result.authorized).toBe(false);
    expect(result.findings.map((item) => item.rule)).toContain("mutation-blocked-by-invalid-ledger");
  });

  it("refuses mutation when a position declares no authority", () => {
    const withoutAuthority = { ...advisorPosition, authority: { decisionOwner: "", actionAuthority: "synthetic automation" } };
    const degraded = run([observation("@clossys/advisor", [withoutAuthority]), observation("@clossys/observer", [])]);
    const ledger = proposeInstalledPositionLedger(degraded, roles).ledger;
    const result = authorizeMutation(degraded, ledger, { ...approval, approvedRunDigest: onboardingRunDigest(degraded) });
    expect(result.authorized).toBe(false);
    expect(result.findings.map((item) => item.rule)).toContain("mutation-blocked-by-invalid-ledger");
  });
});
