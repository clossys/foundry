import { describe, expect, it } from "vitest";
import { REQUIRED_FIT_CRITERIA, REQUIRED_READINESS_CRITERIA, assessAdvisorEngagement, proposalReadyForClient, validateManagedEngagement } from "./index.js";
import type { AdvisorAssessmentInput, AssessmentBasis, EngagementNextAction, Initiative, PreWorkItem } from "./index.js";

// Fixture pattern mirrors runtime.test.ts's own `input()` builder: a single
// initiative, one work item, and a satisfied baseline + conflict pre-work
// pair reach the "satisfied" top-level state with no overlap.
const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const integrity = (letter = "a") => `sha512-${letter.repeat(86)}==`;
const nextAction: EngagementNextAction = { kind: "reconcile", ownerRef: "engagement-owner", dueAt: "2026-09-01T12:00:00Z", escalationRef: "governance-route" };

function basis(): AssessmentBasis {
  return {
    snapshotDigest: hash("a"),
    grantDigest: hash("b"),
    catalogDigest: hash("c"),
    planDigest: hash("d"),
    blockerDigest: hash("e"),
    clearanceDigest: hash("f"),
    conflictDigest: hash("1"),
    baselineDigest: hash("2"),
    completionDefinitionDigest: hash("3"),
    assessedAt: "2026-08-24T12:00:00Z",
    freshUntil: "2026-08-31T12:00:00Z",
  };
}
function proof(id: string) {
  return { id, description: `Independent evidence for ${id}.` };
}
function initiative(id: string): Initiative {
  return {
    id,
    status: "candidate",
    targetRepositoryIds: [`repo-${id}`],
    workstreamConflictKeys: [`workstream-${id}`],
    dependencyConflictKeys: [`dependency-${id}`],
    mutationConflictKeys: [`mutation-${id}`],
    authorityConflictKeys: [`authority-${id}`],
    scheduleConflictKeys: [`schedule-${id}`],
    dataOutcomeMetricConflictKeys: [`metric-${id}`],
  };
}
function work(item: Initiative) {
  return {
    id: `work-${item.id}`,
    initiativeId: item.id,
    targetRepositoryId: item.targetRepositoryIds[0] as string,
    deliveryOwnerRef: `delivery-${item.id}`,
    package: { name: `package-${item.id}`, version: "1.2.3", integrity: integrity() },
    bin: "approved-check",
    invocation: "single-json-input" as const,
    placement: "declared placement",
    baseline: { metricRef: `metric-${item.id}`, value: 0, observedAt: "2026-08-24T12:00:00Z", evidence: proof(`baseline-${item.id}`) },
    completion: {
      definition: "Outcome moves in the declared direction.",
      independentOutcomeOwnerRef: `outcome-${item.id}`,
      evidenceSource: "independent-measurement",
      direction: "increase" as const,
      setpoint: 1,
      windowDays: 14,
    },
    rollback: { procedure: "Use the approved rollback procedure.", evidenceSource: "rollback-record" },
    mutationSurfaces: [`mutation-${item.id}`],
  };
}
function prework(id: string, kind: PreWorkItem["kind"], repository: string): PreWorkItem {
  return {
    id,
    kind,
    status: "satisfied",
    addressesReadinessCriteria: [kind === "baseline" ? "baseline" : "initiative-mutation-dependency-inventory"],
    targetRepositoryIds: [repository],
    ownerRef: `work-owner-${id}`,
    impact: "Affects the first-wave decision.",
    evidence: [proof(`observed-${id}`)],
    nextAction: { ...nextAction, ownerRef: `work-owner-${id}` },
    dependencySurfaces: ["dependency-surface"],
    mutationSurfaces: ["mutation-surface"],
    clearance: { authorityOwnerRef: `authority-owner-${id}`, evidence: [proof(`clearance-${id}`)] },
  };
}
function input(overrides: { engagement?: Partial<AdvisorAssessmentInput["engagement"]> } = {}): AdvisorAssessmentInput {
  const one = initiative("one");
  return {
    id: "assessment-managed",
    asOf: "2026-08-24T13:00:00Z",
    engagement: { id: "engagement-managed", status: "active", nextAction, assessmentBasis: basis(), ...overrides.engagement },
    fitSignals: REQUIRED_FIT_CRITERIA.map((criterion) => ({ id: criterion.id as never, state: "supported" as const, evidence: [proof(`fit-${criterion.id}`)] })),
    prerequisiteObservations: REQUIRED_READINESS_CRITERIA.map((criterion) => ({ id: criterion.id as never, state: "satisfied" as const, evidence: [proof(`readiness-${criterion.id}`)] })),
    initiatives: [one],
    firstWave: { initiativeIds: [one.id], objectives: ["A bounded first outcome."], workItems: [work(one)] },
    preWorkItems: [prework("baseline-one", "baseline", "repo-one"), prework("conflict-one", "conflict", "repo-one")],
    reassessment: { cadenceDays: 7, triggers: ["evidence-change", "sponsor-request"] },
  };
}

describe("validateManagedEngagement (issue #1044)", () => {
  it("omitted engagementMode is self-serve and always valid", () => {
    expect(validateManagedEngagement({})).toEqual([]);
    expect(validateManagedEngagement({ engagementMode: "self-serve" })).toEqual([]);
  });

  it("managed mode requires a nonempty operatorRef", () => {
    const findings = validateManagedEngagement({ engagementMode: "managed" });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("managed-engagement-missing-operator");
  });

  it("managed mode refuses an operatorRef that names Advisor itself", () => {
    for (const operatorRef of ["advisor", "Advisor", "@clossys/advisor"]) {
      const findings = validateManagedEngagement({ engagementMode: "managed", operatorRef });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("managed-engagement-operator-is-advisor");
    }
  });

  it("managed mode with a real third-party operator is valid", () => {
    expect(validateManagedEngagement({ engagementMode: "managed", operatorRef: "acme-consulting" })).toEqual([]);
  });
});

describe("proposalReadyForClient (operator-review hook, #1044/#1220)", () => {
  it("self-serve is always ready", () => {
    expect(proposalReadyForClient({})).toBe(true);
  });

  it("managed mode is not ready without a review", () => {
    expect(proposalReadyForClient({ engagementMode: "managed", operatorRef: "acme-consulting" })).toBe(false);
  });

  it("managed mode is ready once the engaged operator approves", () => {
    const engagement = { engagementMode: "managed" as const, operatorRef: "acme-consulting" };
    const review = { operatorRef: "acme-consulting", reviewedAt: "2026-09-22T00:00:00Z", disposition: "approved" as const };
    expect(proposalReadyForClient(engagement, review)).toBe(true);
  });

  it("a review from someone other than the engaged operator does not count", () => {
    const engagement = { engagementMode: "managed" as const, operatorRef: "acme-consulting" };
    const review = { operatorRef: "someone-else", reviewedAt: "2026-09-22T00:00:00Z", disposition: "approved" as const };
    expect(proposalReadyForClient(engagement, review)).toBe(false);
  });

  it("a 'revise' disposition is not ready", () => {
    const engagement = { engagementMode: "managed" as const, operatorRef: "acme-consulting" };
    const review = { operatorRef: "acme-consulting", reviewedAt: "2026-09-22T00:00:00Z", disposition: "revise" as const };
    expect(proposalReadyForClient(engagement, review)).toBe(false);
  });
});

describe("assessAdvisorEngagement integration: managed mode is additive", () => {
  it("a self-serve engagement (engagementMode omitted) reaches satisfied exactly as before", () => {
    expect(assessAdvisorEngagement(input()).state).toBe("satisfied");
  });

  it("a managed engagement with no operatorRef becomes indeterminate, citing the missing-operator rule", () => {
    const report = assessAdvisorEngagement(input({ engagement: { engagementMode: "managed" } }));
    expect(report.state).toBe("indeterminate");
    expect(report.findings.some((finding) => finding.rule === "managed-engagement-missing-operator")).toBe(true);
  });

  it("a managed engagement with a valid operatorRef reaches satisfied, same as self-serve", () => {
    const report = assessAdvisorEngagement(input({ engagement: { engagementMode: "managed", operatorRef: "acme-consulting" } }));
    expect(report.state).toBe("satisfied");
  });
});
