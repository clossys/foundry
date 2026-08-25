import { describe, expect, it } from "vitest";
import { ADVISOR_CHARTER, REQUIRED_FIT_CRITERIA, REQUIRED_READINESS_CRITERIA, SPONSOR_ENTRY_PROMPT, advanceAdvisorSession, assessAdvisorEngagement, assessEngagementDecisionCurrency, createAdvisorSession, handleAdvisorTool, resolveEngagementActionDisposition, validateAdvisorAssessmentInput } from "./index.js";
import type { AdvisorAssessmentInput, AssessmentBasis, EngagementNextAction, FirstWaveWorkItem, Initiative, PreWorkItem } from "./types.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const integrity = (letter = "a") => `sha512-${letter.repeat(86)}==`;
const nextAction: EngagementNextAction = { kind: "reconcile", ownerRef: "engagement-owner", dueAt: "2026-09-01T12:00:00Z", escalationRef: "governance-route" };
function basis(letter = "a"): AssessmentBasis { return { snapshotDigest: hash(letter), grantDigest: hash("b"), catalogDigest: hash("c"), planDigest: hash("d"), blockerDigest: hash("e"), clearanceDigest: hash("f"), conflictDigest: hash("1"), baselineDigest: hash("2"), completionDefinitionDigest: hash("3"), assessedAt: "2026-08-24T12:00:00Z", freshUntil: "2026-08-31T12:00:00Z" }; }
function proof(id: string) { return { id, description: `Independent evidence for ${id}.` }; }
function initiative(id: string, repository = `repo-${id}`, shared: Partial<Initiative> = {}): Initiative { return { id, status: "candidate", targetRepositoryIds: [repository], workstreamConflictKeys: [`workstream-${id}`], dependencyConflictKeys: [`dependency-${id}`], mutationConflictKeys: [`mutation-${id}`], authorityConflictKeys: [`authority-${id}`], scheduleConflictKeys: [`schedule-${id}`], dataOutcomeMetricConflictKeys: [`metric-${id}`], ...shared }; }
function work(item: Initiative): FirstWaveWorkItem { return { id: `work-${item.id}`, initiativeId: item.id, targetRepositoryId: item.targetRepositoryIds[0] as string, deliveryOwnerRef: `delivery-${item.id}`, package: { name: `package-${item.id}`, version: "1.2.3", integrity: integrity() }, invocation: "invoke through an approved connector", placement: "declared placement", baseline: { metricRef: `metric-${item.id}`, value: 0, observedAt: "2026-08-24T12:00:00Z", evidence: proof(`baseline-${item.id}`) }, completion: { definition: "Outcome moves in the declared direction.", independentOutcomeOwnerRef: `outcome-${item.id}`, evidenceSource: "independent-measurement", direction: "increase", setpoint: 1, windowDays: 14 }, rollback: { procedure: "Use the approved rollback procedure.", evidenceSource: "rollback-record" }, mutationSurfaces: [`mutation-${item.id}`] }; }
function prework(id: string, kind: PreWorkItem["kind"], repository: string, status: PreWorkItem["status"] = "satisfied"): PreWorkItem { const value: PreWorkItem = { id, kind, status, addressesReadinessCriteria: [kind === "baseline" ? "baseline" : "initiative-mutation-dependency-inventory"], targetRepositoryIds: [repository], ownerRef: `work-owner-${id}`, impact: "Affects the first-wave decision.", evidence: [proof(`observed-${id}`)], nextAction: { ...nextAction, ownerRef: `work-owner-${id}` }, dependencySurfaces: ["dependency-surface"], mutationSurfaces: ["mutation-surface"] }; if (status === "satisfied") value.clearance = { authorityOwnerRef: `authority-owner-${id}`, evidence: [proof(`clearance-${id}`)] }; return value; }
function overlapPrework(first: Initiative, second: Initiative): PreWorkItem { return { ...prework(`overlap-${first.id}-${second.id}`, "conflict", first.targetRepositoryIds[0] as string, "unresolved"), initiativeOverlapIds: [first.id, second.id] }; }
function input(overrides: Partial<AdvisorAssessmentInput> = {}): AdvisorAssessmentInput { const one = initiative("one"); const two = initiative("two"); return { id: "assessment-one", asOf: "2026-08-24T13:00:00Z", engagement: { id: "engagement-one", status: "active", nextAction, assessmentBasis: basis() }, fitSignals: REQUIRED_FIT_CRITERIA.map((criterion) => ({ id: criterion.id as never, state: "supported" as const, evidence: [proof(`fit-${criterion.id}`)] })), prerequisiteObservations: REQUIRED_READINESS_CRITERIA.map((criterion) => ({ id: criterion.id as never, state: "satisfied" as const, evidence: [proof(`readiness-${criterion.id}`)] })), initiatives: [one, two], firstWave: { initiativeIds: [one.id], objectives: ["A bounded first outcome."], workItems: [work(one)] }, preWorkItems: [prework("baseline-one", "baseline", "repo-one"), prework("conflict-one", "conflict", "repo-one")], reassessment: { cadenceDays: 7, triggers: ["evidence-change", "sponsor-request"] }, ...overrides }; }

describe("programmatic standards and reconciliation", () => {
  it("exports reconcile-first charter and complete v1 criterion prompts", () => {
    expect(ADVISOR_CHARTER.primaryMode).toBe("reconcile");
    expect(REQUIRED_FIT_CRITERIA).toHaveLength(6);
    expect(REQUIRED_READINESS_CRITERIA).toHaveLength(8);
    expect([...REQUIRED_FIT_CRITERIA, ...REQUIRED_READINESS_CRITERIA].every((criterion) => criterion.prompt.length > 0)).toBe(true);
    expect(SPONSOR_ENTRY_PROMPT).toContain("resume it; otherwise onboard me");
    expect(SPONSOR_ENTRY_PROMPT).toContain("make no changes until I approve");
  });
  it("requires every strategic-fit and readiness criterion, never a one-item pass", () => {
    for (const criterion of REQUIRED_FIT_CRITERIA) expect(validateAdvisorAssessmentInput(input({ fitSignals: input().fitSignals.filter((item) => item.id !== criterion.id) })).map((entry) => entry.rule)).toContain("criterion-coverage");
    for (const criterion of REQUIRED_READINESS_CRITERIA) expect(validateAdvisorAssessmentInput(input({ prerequisiteObservations: input().prerequisiteObservations.filter((item) => item.id !== criterion.id) })).map((entry) => entry.rule)).toContain("criterion-coverage");
  });
  it("turns unknown evidence into an actionable sponsor question", () => {
    const signals = input().fitSignals.map((item) => item.id === "adoption-capacity" ? { ...item, state: "unknown" as const, evidence: [] } : item);
    const report = assessAdvisorEngagement(input({ fitSignals: signals }));
    expect(report).toMatchObject({ state: "indeterminate", fit: { state: "indeterminate" } });
    expect(report.fit.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sponsor-question" })]));
  });
  it("recognizes a fully described single initiative as no-overlap satisfied", () => {
    const one = initiative("one");
    const report = assessAdvisorEngagement(input({ initiatives: [one], firstWave: { initiativeIds: [one.id], objectives: ["objective"], workItems: [work(one)] } }));
    expect(report.initiativeOverlap).toMatchObject({ state: "satisfied", overlaps: [] });
  });
  it("reconciles every conflict surface, not only workstream", () => {
    const dimensions = ["workstreamConflictKeys", "dependencyConflictKeys", "mutationConflictKeys", "authorityConflictKeys", "scheduleConflictKeys", "dataOutcomeMetricConflictKeys"] as const;
    for (const dimension of dimensions) {
      const one = initiative("one"); const two = initiative("two", "repo-two", { [dimension]: one[dimension] });
      const blocker = overlapPrework(one, two); const report = assessAdvisorEngagement(input({ initiatives: [one, two], firstWave: { initiativeIds: [one.id], objectives: ["objective"], workItems: [work(one)] }, preWorkItems: [...input().preWorkItems, blocker] }));
      expect(report).toMatchObject({ initiativeOverlap: { state: "violated", overlaps: [expect.objectContaining({ [dimension]: one[dimension] })] }, firstWavePlan: { state: "stabilize-first", steps: expect.arrayContaining([expect.objectContaining({ blockedBy: [blocker.id], nextAction: blocker.nextAction })]) } });
    }
  });
  it("requires every derived initiative collision to become linked owned pre-work", () => {
    const one = initiative("one"); const two = initiative("two", "repo-two", { mutationConflictKeys: one.mutationConflictKeys });
    const report = assessAdvisorEngagement(input({ initiatives: [one, two], firstWave: { initiativeIds: [one.id], objectives: ["objective"], workItems: [work(one)] } }));
    expect(report).toMatchObject({ state: "indeterminate", firstWavePlan: { state: "indeterminate" } });
    expect(report.findings.map((entry) => entry.rule)).toContain("initiative-overlap-pre-work");
  });
  it("does not invent a collision from a shared repository when exclusive keys are disjoint", () => {
    const one = initiative("one", "same-target"); const two = initiative("two", "same-target");
    const preWorkItems = [prework("baseline-same-target", "baseline", "same-target"), prework("conflict-same-target", "conflict", "same-target")];
    expect(assessAdvisorEngagement(input({ initiatives: [one, two], firstWave: { initiativeIds: [one.id], objectives: ["objective"], workItems: [work(one)] }, preWorkItems })).initiativeOverlap.state).toBe("satisfied");
  });
});

describe("first-wave and pre-work gates", () => {
  it("requires exact package, placement, baseline, outcome, window, and rollback bindings", () => {
    const invalid = input(); invalid.firstWave.workItems[0] = { ...invalid.firstWave.workItems[0] as FirstWaveWorkItem, package: { name: "package", version: "latest", integrity: hash("4") } };
    expect(assessAdvisorEngagement(invalid).findings.map((entry) => entry.rule)).toContain("work-item-package");
    const leadingZero = input(); leadingZero.firstWave.workItems[0] = { ...leadingZero.firstWave.workItems[0] as FirstWaveWorkItem, package: { name: "package", version: "01.2.3", integrity: integrity() } };
    expect(assessAdvisorEngagement(leadingZero).findings.map((entry) => entry.rule)).toContain("work-item-package");
    const shortDigest = input(); shortDigest.firstWave.workItems[0] = { ...shortDigest.firstWave.workItems[0] as FirstWaveWorkItem, package: { name: "package", version: "1.2.3", integrity: "sha512-a" } };
    expect(assessAdvisorEngagement(shortDigest).findings.map((entry) => entry.rule)).toContain("work-item-package");
    const selfOutcome = input(); selfOutcome.firstWave.workItems[0] = { ...selfOutcome.firstWave.workItems[0] as FirstWaveWorkItem, completion: { ...selfOutcome.firstWave.workItems[0]?.completion as NonNullable<FirstWaveWorkItem["completion"]>, independentOutcomeOwnerRef: "delivery-one" } };
    expect(assessAdvisorEngagement(selfOutcome).findings.map((entry) => entry.rule)).toContain("work-item-self-outcome");
  });
  it("rejects an extra repository target that its selected initiative never declared", () => {
    const value = input(); const declared = value.firstWave.workItems[0] as FirstWaveWorkItem;
    value.firstWave.workItems = [declared, { ...declared, id: "work-extra", targetRepositoryId: "repo-extra" }];
    const report = assessAdvisorEngagement(value);
    expect(report).toMatchObject({ state: "indeterminate", firstWavePlan: { state: "indeterminate" } });
    expect(report.findings.map((entry) => entry.rule)).toContain("first-wave-work-item-target");
  });
  it("requires authority-owned clearance and prohibits self or unearned clearance", () => {
    const self = input(); self.preWorkItems[0] = { ...self.preWorkItems[0] as PreWorkItem, clearance: { authorityOwnerRef: self.preWorkItems[0]?.ownerRef as string, evidence: [proof("self")] } };
    expect(assessAdvisorEngagement(self).findings.map((entry) => entry.rule)).toContain("pre-work-self-clearance");
    const unearned = input(); unearned.preWorkItems[0] = { ...unearned.preWorkItems[0] as PreWorkItem, status: "unresolved", clearance: { authorityOwnerRef: "independent", evidence: [proof("too-early")] } };
    expect(assessAdvisorEngagement(unearned).findings.map((entry) => entry.rule)).toContain("pre-work-unearned-clearance");
  });
  it("reopens a ready wave to stabilize-first when any actionable pre-work becomes unresolved", () => {
    const changed = input(); changed.preWorkItems[1] = prework("conflict-one", "conflict", "repo-one", "unresolved");
    expect(assessAdvisorEngagement(changed)).toMatchObject({ state: "violated", firstWavePlan: { state: "stabilize-first", steps: [expect.objectContaining({ nextAction: expect.objectContaining({ ownerRef: "work-owner-conflict-one" }) })] } });
  });
  it("requires every violated readiness result to become owned unresolved pre-work", () => {
    const readiness = input().prerequisiteObservations.map((item) => item.id === "immutable-artifact-access" ? { ...item, state: "violated" as const } : item);
    expect(assessAdvisorEngagement(input({ prerequisiteObservations: readiness })).findings.map((entry) => entry.rule)).toContain("readiness-pre-work");
    const artifact = { ...prework("artifact", "artifact-access", "repo-one", "unresolved"), addressesReadinessCriteria: ["immutable-artifact-access" as const] };
    expect(assessAdvisorEngagement(input({ prerequisiteObservations: readiness, preWorkItems: [...input().preWorkItems, artifact] })).firstWavePlan.steps).toEqual(expect.arrayContaining([expect.objectContaining({ blockedBy: ["artifact"], nextAction: artifact.nextAction })]));
  });
  it("rejects a HOLD-shaped nine-repository assessment, then treats its explicit unresolved conversion as stabilize-first", () => {
    const initiatives = Array.from({ length: 9 }, (_, index) => initiative(String(index + 1), `repo-${index + 1}`));
    const preWork = initiatives.flatMap((item) => [prework(`baseline-${item.id}`, "baseline", item.targetRepositoryIds[0] as string), prework(`conflict-${item.id}`, "conflict", item.targetRepositoryIds[0] as string)]);
    const nine = input({ initiatives, firstWave: { initiativeIds: initiatives.map((item) => item.id), objectives: ["objective"], workItems: initiatives.map(work) }, preWorkItems: preWork });
    expect(assessAdvisorEngagement(nine).firstWavePlan.state).toBe("ready-for-sponsor-approval");
    preWork[17] = { ...preWork[17] as PreWorkItem, status: "passive-hold" as never };
    expect(assessAdvisorEngagement(nine).findings.map((entry) => entry.rule)).toContain("pre-work-status");
    preWork[17] = prework("conflict-9", "conflict", "repo-9", "unresolved");
    expect(assessAdvisorEngagement(nine).firstWavePlan.state).toBe("stabilize-first");
  });
});

describe("freshness, authorization, and action-bearing sessions", () => {
  it("rejects stale basis shapes and calculates current decision currency", () => {
    const stale = input(); stale.engagement = { ...stale.engagement, assessmentBasis: { ...stale.engagement.assessmentBasis, freshUntil: "2026-08-24T12:30:00Z" } };
    expect(assessAdvisorEngagement(stale).findings.map((entry) => entry.rule)).toContain("assessment-basis-stale");
    const assessmentInput = input(); const engagement = assessmentInput.engagement;
    expect(assessEngagementDecisionCurrency({ asOf: "2026-08-24T13:00:00Z", engagements: [engagement], assessmentInputs: [assessmentInput], elapsedDaysByEngagement: { [engagement.id]: 2 } }).state).toBe("satisfied");
    expect(resolveEngagementActionDisposition(engagement, "2026-09-02T12:00:00Z")).toBe("reassess-required");
  });
  it("marks invalid and inverted decision-currency basis windows stale", () => {
    for (const assessmentBasis of [{ ...basis(), assessedAt: "not-a-time" }, { ...basis(), assessedAt: "2026-09-01T12:00:00Z", freshUntil: "2026-08-31T12:00:00Z" }]) {
      const assessmentInput = input(); assessmentInput.engagement = { ...assessmentInput.engagement, assessmentBasis };
      const result = assessEngagementDecisionCurrency({ asOf: "2026-08-24T13:00:00Z", engagements: [assessmentInput.engagement], assessmentInputs: [assessmentInput], elapsedDaysByEngagement: { [assessmentInput.engagement.id]: 2 } });
      expect(result).toMatchObject({ state: "violated", rate: 0 });
      expect(result.findings.map((entry) => entry.rule)).toContain("assessment-basis-stale");
    }
  });
  it("never uses another engagement's assessment even when basis digests match", () => {
    const assessmentInput = input(); const other = { ...assessmentInput.engagement, id: "engagement-two" };
    const result = assessEngagementDecisionCurrency({ asOf: "2026-08-24T13:00:00Z", engagements: [other], assessmentInputs: [assessmentInput], elapsedDaysByEngagement: { [other.id]: 2 } });
    expect(result).toMatchObject({ state: "violated", rate: 0 });
    expect(result.findings.map((entry) => entry.rule)).toContain("assessment-basis-current");
  });
  it("requires exact sponsor authorization scope and expiry", () => {
    const assessmentInput = input(); const report = assessAdvisorEngagement(assessmentInput); const session = advanceAdvisorSession(createAdvisorSession("session", nextAction), { type: "assessment-recorded", assessmentInput, nextAction }).session;
    const exact = { planDigest: report.firstWavePlan.basis?.planDigest as string, assessmentBasis: report.firstWavePlan.basis as AssessmentBasis, sponsorRef: "sponsor", permittedRepositoryIds: ["repo-one"], permittedPackages: [work(initiative("one")).package], permittedMutationSurfaces: ["mutation-one"], grantedAt: "2026-08-24T13:00:00Z", expiresAt: "2026-08-25T13:00:00Z" };
    expect(advanceAdvisorSession(session, { type: "sponsor-approved", authorization: { ...exact, permittedRepositoryIds: [] }, asOf: "2026-08-24T14:00:00Z", nextAction }).findings.map((entry) => entry.rule)).toContain("execution-authorization-repositories");
    expect(advanceAdvisorSession(session, { type: "sponsor-approved", authorization: { ...exact, expiresAt: "2026-08-24T13:30:00Z" }, asOf: "2026-08-24T14:00:00Z", nextAction }).findings.map((entry) => entry.rule)).toContain("execution-authorization-expiry");
    expect(advanceAdvisorSession(session, { type: "sponsor-approved", authorization: { ...exact, sponsorRef: "advisor" }, asOf: "2026-08-24T14:00:00Z", nextAction }).findings.map((entry) => entry.rule)).toContain("execution-authorization-sponsor");
    expect(advanceAdvisorSession(session, { type: "sponsor-approved", authorization: { ...exact, expiresAt: "2026-09-02T13:00:00Z" }, asOf: "2026-08-24T14:00:00Z", nextAction }).findings.map((entry) => entry.rule)).toContain("execution-authorization-expiry");
    expect(advanceAdvisorSession(session, { type: "sponsor-approved", authorization: exact, asOf: "2026-08-24T14:00:00Z", nextAction }).session.state).toBe("ready-for-execution");
  });
  it("fails recurring assessment closed when a retained authorization is malformed or no longer bound to its plan", () => {
    const source = input(); const report = assessAdvisorEngagement(source);
    const exact = { planDigest: report.firstWavePlan.basis?.planDigest as string, assessmentBasis: report.firstWavePlan.basis as AssessmentBasis, sponsorRef: "sponsor", permittedRepositoryIds: ["repo-one"], permittedPackages: [work(initiative("one")).package], permittedMutationSurfaces: ["mutation-one"], grantedAt: "2026-08-24T13:00:00Z", expiresAt: "2026-08-25T13:00:00Z" };
    expect(validateAdvisorAssessmentInput({ ...source, engagement: { ...source.engagement, executionAuthorization: exact } })).toEqual([]);
    expect(assessAdvisorEngagement({ ...source, engagement: { ...source.engagement, executionAuthorization: exact } })).toMatchObject({ state: "satisfied" });
    expect(validateAdvisorAssessmentInput({ ...source, engagement: { ...source.engagement, executionAuthorization: null } }).map((entry) => entry.rule)).toContain("execution-authorization-shape");
    const malformed = assessAdvisorEngagement({ ...source, engagement: { ...source.engagement, executionAuthorization: null } });
    expect(malformed).toMatchObject({ state: "indeterminate" });
    expect(malformed.findings.map((entry) => entry.rule)).toContain("execution-authorization-shape");
    const mismatched = assessAdvisorEngagement({ ...source, engagement: { ...source.engagement, executionAuthorization: { ...exact, planDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" } } });
    expect(mismatched).toMatchObject({ state: "indeterminate" });
    expect(mismatched.findings.map((entry) => entry.rule)).toContain("execution-authorization-basis");
  });
  it("recomputes readiness from retained evidence and rejects fabricated assessment state", () => {
    const report = assessAdvisorEngagement(input());
    const forged = { ...createAdvisorSession("session", nextAction), state: "ready-for-sponsor-approval" as const, lastAssessment: report, lastAssessmentInput: {} };
    const authorization = { planDigest: report.firstWavePlan.basis?.planDigest as string, assessmentBasis: report.firstWavePlan.basis as AssessmentBasis, sponsorRef: "sponsor", permittedRepositoryIds: ["repo-one"], permittedPackages: [work(initiative("one")).package], permittedMutationSurfaces: ["mutation-one"], grantedAt: "2026-08-24T13:00:00Z", expiresAt: "2026-08-25T13:00:00Z" };
    expect(advanceAdvisorSession(forged, { type: "sponsor-approved", authorization, asOf: "2026-08-24T14:00:00Z", nextAction }).findings.map((entry) => entry.rule)).toContain("execution-not-ready");
  });
  it("snapshots recorded input and keeps approved input synchronized with its recomputed assessment", () => {
    const original = input(); const recorded = advanceAdvisorSession(createAdvisorSession("session", nextAction), { type: "assessment-recorded", assessmentInput: original, nextAction }).session;
    original.firstWave.objectives[0] = "Caller mutation after recording.";
    expect((recorded.lastAssessmentInput as AdvisorAssessmentInput).firstWave.objectives[0]).toBe("A bounded first outcome.");
    const retained = recorded.lastAssessmentInput as AdvisorAssessmentInput; const changedWork = { ...retained.firstWave.workItems[0] as FirstWaveWorkItem, package: { name: "package-reassessed", version: "1.2.3", integrity: integrity() } }; retained.firstWave.workItems[0] = changedWork;
    const recomputed = assessAdvisorEngagement(retained); const authorization = { planDigest: recomputed.firstWavePlan.basis?.planDigest as string, assessmentBasis: recomputed.firstWavePlan.basis as AssessmentBasis, sponsorRef: "sponsor", permittedRepositoryIds: ["repo-one"], permittedPackages: [changedWork.package], permittedMutationSurfaces: ["mutation-one"], grantedAt: "2026-08-24T13:00:00Z", expiresAt: "2026-08-25T13:00:00Z" };
    const approved = advanceAdvisorSession(recorded, { type: "sponsor-approved", authorization, asOf: "2026-08-24T14:00:00Z", nextAction }).session;
    expect(approved.state).toBe("ready-for-execution");
    expect(approved.lastAssessmentInput).not.toBe(retained);
    expect(approved.lastAssessment).toEqual(assessAdvisorEngagement(approved.lastAssessmentInput));
  });
  it("uses the same strict authorization contract for decision currency", () => {
    const report = assessAdvisorEngagement(input()); const engagement = input().engagement;
    const authorization = { planDigest: report.firstWavePlan.basis?.planDigest as string, assessmentBasis: report.firstWavePlan.basis as AssessmentBasis, sponsorRef: "advisor", permittedRepositoryIds: ["repo-one"], permittedPackages: [work(initiative("one")).package], permittedMutationSurfaces: ["mutation-one"], grantedAt: "2026-08-20T13:00:00Z", expiresAt: "2026-09-30T13:00:00Z" };
    const result = assessEngagementDecisionCurrency({ asOf: "2026-08-24T14:00:00Z", engagements: [{ ...engagement, executionAuthorization: authorization }], assessmentInputs: [input()], elapsedDaysByEngagement: { [engagement.id]: 2 } });
    expect(result).toMatchObject({ state: "violated", rate: 0 });
    expect(result.findings.map((entry) => entry.rule)).toEqual(expect.arrayContaining(["execution-authorization-sponsor", "execution-authorization-expiry"]));
  });
  it("has no pause parking and needs closure evidence", () => {
    const session = createAdvisorSession("session", nextAction);
    expect(advanceAdvisorSession(session, { type: "close", reason: "", evidence: [] }).findings.map((entry) => entry.rule)).toContain("session-closure");
    const closed = advanceAdvisorSession(session, { type: "close", reason: "Decision recorded.", evidence: [proof("closure")] }).session;
    expect(closed.state).toBe("closed");
    const repeated = advanceAdvisorSession(closed, { type: "close", reason: "Overwrite attempted.", evidence: [proof("replacement")] });
    expect(repeated.findings.map((entry) => entry.rule)).toContain("session-closed");
    expect(repeated.session).toBe(closed);
  });
  it("fails malformed connector JSON closed instead of throwing", () => {
    expect(handleAdvisorTool(null)).toMatchObject({ state: "indeterminate", output: null, findings: [expect.objectContaining({ rule: "tool-input" })] });
    expect(handleAdvisorTool({ name: "advance_advisor_session", input: { session: null, event: null } })).toMatchObject({ state: "indeterminate", output: null, findings: [expect.objectContaining({ rule: "tool-input" })] });
    const assessmentInput = input(); const session = advanceAdvisorSession(createAdvisorSession("session", nextAction), { type: "assessment-recorded", assessmentInput, nextAction }).session;
    const malformed = handleAdvisorTool({ name: "advance_advisor_session", input: { session, event: { type: "sponsor-approved", authorization: null, asOf: "2026-08-24T14:00:00Z", nextAction } } });
    expect(malformed).toMatchObject({ state: "indeterminate", findings: [expect.objectContaining({ rule: "execution-authorization-shape" })] });
    const report = assessAdvisorEngagement(assessmentInput); const packageMalformed = { planDigest: report.firstWavePlan.basis?.planDigest, assessmentBasis: report.firstWavePlan.basis, sponsorRef: "sponsor", permittedRepositoryIds: ["repo-one"], permittedPackages: [null], permittedMutationSurfaces: ["mutation-one"], grantedAt: "2026-08-24T13:00:00Z", expiresAt: "2026-08-25T13:00:00Z" };
    expect(advanceAdvisorSession(session, { type: "sponsor-approved", authorization: packageMalformed as never, asOf: "2026-08-24T14:00:00Z", nextAction }).findings.map((entry) => entry.rule)).toContain("execution-authorization-packages");
  });
});
