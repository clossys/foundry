import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateRepositoryPackageAdoption,
  planRepositoryPackageAdoption,
  validateRepositoryPackageAdoption,
} from "./adoption.js";

const fixture = JSON.parse(readFileSync(new URL("../../../../docs/contracts/repository-package-adoption.fixture.json", import.meta.url), "utf8"));
const shippedFixture = JSON.parse(readFileSync(new URL("../../contracts/repository-package-adoption.fixture.json", import.meta.url), "utf8"));
const shippedContract = JSON.parse(readFileSync(new URL("../../contracts/repository-package-adoption-contract.json", import.meta.url), "utf8"));
const documentedContract = JSON.parse(readFileSync(new URL("../../../../docs/contracts/repository-package-adoption-contract.json", import.meta.url), "utf8"));
const profile = {
  value: { schemaVersion: 3, defaultBranch: "main", commands: [], protectedPaths: [], requirements: [], rootEntries: [] },
  path: "governance/repository-profile.json",
  sha256: "5c65a57eadea456e72af0c30b07b7b23f41e65a4f907cb394e8d4b6b9ac1c1df",
};
const coverage = ["declaration", "commands", "protected-paths", "requirements", "root-entries"].map((name) => ({ name, result: { verdict: "satisfied" as const, evaluated: 1 } }));
const review = {
  policy: { requiredChecks: ["repository-package-adoption"], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" },
  evidence: {
    schemaVersion: 3,
    headSha: fixture.events[0].candidate.headSha,
    baseSha: fixture.events[0].candidate.baseSha,
    paginationComplete: true,
    checks: [{ name: "repository-package-adoption", conclusion: "success", headSha: fixture.events[0].candidate.headSha, completedAt: "2026-08-26T23:58:00.000Z" }], reviews: [], threads: [],
  },
};
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function input(adoption = fixture) {
  return { adoption, repositoryProfile: copy(profile), stableProfileCoverage: copy(coverage), foundationReview: copy(review) };
}
function ruleset(adoption = fixture) {
  const cutover = adoption.events[2];
  return {
    before: { state: "not-enforced", mainSha: cutover.mainSha, requiredCheck: cutover.requiredCheck, ruleId: cutover.ruleId, sourceRef: cutover.before.sourceRef, observedAt: cutover.before.observedAt },
    after: { state: "enforced", mainSha: cutover.mainSha, requiredCheck: cutover.requiredCheck, ruleId: cutover.ruleId, sourceRef: cutover.sourceRef, observedAt: cutover.observedAt },
  };
}

describe("RepositoryPackageAdoptionV1", () => {
  it("ships the same canonical contract and fixture that the documentation publishes", () => {
    expect(shippedFixture).toEqual(fixture);
    expect(shippedContract).toEqual(documentedContract);
  });

  it("keeps readiness phase-local and makes activation independently satisfiable", () => {
    expect(validateRepositoryPackageAdoption(fixture)).toEqual([]);
    const report = evaluateRepositoryPackageAdoption({
      ...input(),
      rulesetObservation: ruleset(),
    });
    expect(report.result).toEqual({ verdict: "indeterminate", reason: "closure-incomplete", detail: "Closure needs consumer ledger and completion evidence supplied to the existing validator." });
    expect(report.phase).toBe("closure");
    expect(report.status).toBe("closed");
    const foundation = copy(fixture); foundation.events.length = 1;
    expect(evaluateRepositoryPackageAdoption(input(foundation))).toMatchObject({ result: { verdict: "satisfied" }, phase: "foundation", status: "foundation-ready" });
    const canary = copy(fixture); canary.events.length = 2;
    expect(evaluateRepositoryPackageAdoption(input(canary))).toMatchObject({ result: { verdict: "satisfied" }, phase: "post-main-canary", status: "canary-ready" });
    const cutover = copy(fixture); cutover.events.length = 3;
    expect(evaluateRepositoryPackageAdoption({ ...input(cutover), rulesetObservation: ruleset(cutover) })).toMatchObject({ result: { verdict: "satisfied" }, phase: "atomic-ruleset-cutover", status: "cutover-ready" });
    const activation = copy(fixture); activation.events.length = 4;
    expect(evaluateRepositoryPackageAdoption({ ...input(activation), rulesetObservation: ruleset(activation) })).toMatchObject({ result: { verdict: "satisfied" }, phase: "activation", status: "activated" });
  });

  it("requires every stable profile coverage axis and profile v3", () => {
    const missing = input();
    missing.stableProfileCoverage.pop();
    expect(evaluateRepositoryPackageAdoption(missing).result.verdict).toBe("indeterminate");
    const legacy = input();
    legacy.repositoryProfile.value = { schemaVersion: 1, defaultBranch: "main", commands: [], protectedPaths: [] };
    expect(evaluateRepositoryPackageAdoption(legacy).result.verdict).toBe("indeterminate");
    const v2 = input();
    (v2.repositoryProfile as { value: unknown }).value = {
      schemaVersion: 2,
      defaultBranch: "main",
      commands: [],
      protectedPaths: [],
      requirements: [],
    };
    expect(evaluateRepositoryPackageAdoption(v2).result.verdict).toBe("indeterminate");
  });

  it("rejects vacuous or stale review, canary/head mismatch, and check/cutover mismatch", () => {
    const empty = input();
    empty.foundationReview.policy = { requiredChecks: [], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" };
    empty.foundationReview.evidence.checks = [];
    expect(evaluateRepositoryPackageAdoption(empty)).toMatchObject({ result: { verdict: "violated" }, findings: [{ rule: "foundation-review-vacuous" }] });
    const stale = input();
    stale.foundationReview.evidence.headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(evaluateRepositoryPackageAdoption(stale).result.verdict).toBe("violated");
    const canaryMismatch = copy(fixture);
    canaryMismatch.events[1].mainSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(validateRepositoryPackageAdoption(canaryMismatch).some((entry) => entry.rule === "event-head-mismatch")).toBe(true);
    const checkMismatch = copy(fixture);
    checkMismatch.events[2].requiredCheck = "other-check";
    expect(validateRepositoryPackageAdoption(checkMismatch).some((entry) => entry.rule === "event-check-mismatch")).toBe(true);
  });

  it("fails closed for unknown, not-enforced, and mismatched provider-neutral rulesets", () => {
    const adoption = copy(fixture); adoption.events.length = 3;
    const unknownObservation = ruleset(adoption); unknownObservation.after.state = "unknown";
    const unknown = evaluateRepositoryPackageAdoption({ ...input(adoption), rulesetObservation: unknownObservation });
    expect(unknown.result.verdict).toBe("indeterminate");
    const unenforcedObservation = ruleset(adoption); unenforcedObservation.after.state = "not-enforced";
    const unenforced = evaluateRepositoryPackageAdoption({ ...input(adoption), rulesetObservation: unenforcedObservation });
    expect(unenforced.result.verdict).toBe("violated");
    const mismatchObservation = ruleset(adoption); mismatchObservation.after.requiredCheck = "other-check";
    const mismatched = evaluateRepositoryPackageAdoption({ ...input(adoption), rulesetObservation: mismatchObservation });
    expect(mismatched.result.verdict).toBe("violated");
  });

  it("rejects out-of-order activation, package/position joins, ranges, multi-package fields, accessors, prototypes, and extras", () => {
    const outOfOrder = copy(fixture); outOfOrder.events = [outOfOrder.events[3]];
    expect(validateRepositoryPackageAdoption(outOfOrder).some((entry) => entry.rule === "event-order")).toBe(true);
    const packageMismatch = copy(fixture); packageMismatch.events[3].package.version = "1.2.4";
    expect(validateRepositoryPackageAdoption(packageMismatch).some((entry) => entry.rule === "event-package-mismatch")).toBe(true);
    const positionMismatch = copy(fixture); positionMismatch.events[4].positionId = "other-position";
    expect(validateRepositoryPackageAdoption(positionMismatch).some((entry) => entry.rule === "event-position-mismatch")).toBe(true);
    const range = copy(fixture); range.package.version = "^1.2.3";
    expect(validateRepositoryPackageAdoption(range).some((entry) => entry.rule === "package-version")).toBe(true);
    const invalidSri = copy(fixture); invalidSri.package.integrity = "sha512-dGVzdA==";
    expect(validateRepositoryPackageAdoption(invalidSri).some((entry) => entry.rule === "package-integrity")).toBe(true);
    const multi = copy(fixture); multi.packages = [multi.package];
    expect(validateRepositoryPackageAdoption(multi).length).toBeGreaterThan(0);
    const accessor = copy(fixture); Object.defineProperty(accessor, "id", { get: () => "unsafe", enumerable: true });
    expect(validateRepositoryPackageAdoption(accessor).length).toBeGreaterThan(0);
    const inherited = Object.assign(Object.create({ inherited: true }), fixture);
    expect(validateRepositoryPackageAdoption(inherited).length).toBeGreaterThan(0);
  });

  it("requires before-to-after atomic enforcement and strictly real ordered instants", () => {
    const invalidCanaryDate = copy(fixture); invalidCanaryDate.events[1].completedAt = "2026-02-30T00:00:00.000Z";
    expect(validateRepositoryPackageAdoption(invalidCanaryDate).some((entry) => entry.rule === "event-shape")).toBe(true);
    const unordered = copy(fixture); unordered.events[2].observedAt = unordered.events[1].completedAt;
    expect(validateRepositoryPackageAdoption(unordered).some((entry) => entry.rule === "event-chronology")).toBe(true);
    const missingBefore = copy(fixture); missingBefore.events[2].before.state = "enforced";
    expect(validateRepositoryPackageAdoption(missingBefore).some((entry) => entry.rule === "event-cutover-transition")).toBe(true);
  });

  it("closes evaluator and coverage shapes, including indeterminate results", () => {
    expect(evaluateRepositoryPackageAdoption({ ...input(), unexpected: true } as never)).toMatchObject({ result: { verdict: "indeterminate", reason: "adoption-invalid" } });
    const coverageExtra = input(); (coverageExtra.stableProfileCoverage[0] as Record<string, unknown>).unexpected = true;
    expect(evaluateRepositoryPackageAdoption(coverageExtra)).toMatchObject({ result: { verdict: "indeterminate", reason: "profile-coverage-incomplete" } });
    const indeterminateExtra = input();
    (indeterminateExtra.stableProfileCoverage[0] as { result: unknown }).result = { verdict: "indeterminate", reason: "unreadable", extra: true };
    expect(evaluateRepositoryPackageAdoption(indeterminateExtra)).toMatchObject({ result: { verdict: "indeterminate", reason: "profile-coverage-incomplete" } });
  });

  it("binds closure package version and duplicated evidence refs to one adoption authority", () => {
    const report = evaluateRepositoryPackageAdoption({
      ...input(), rulesetObservation: ruleset(), positionLedger: { positions: [] },
      completionEvidence: {
        positionId: fixture.events[3].positionId,
        package: fixture.package.name,
        artifact: { version: "1.2.4", manifestRef: "urn:other:manifest", lockfileRef: "urn:other:lock", cleanInstallRef: "urn:other:install" },
        invocation: { kind: "cli", target: "repository-package-adoption-check", runRef: "urn:other:invocation", occurredAt: "2026-08-27T00:02:00.000Z" },
        maintenance: {
          duplicate: { state: "removed", reason: "replacement", evidenceRefs: ["urn:other:duplicate"] },
          rollback: { procedureRef: "urn:other:rollback-procedure", verifiedAt: "2026-08-27T00:03:00.000Z", verificationRef: "urn:other:rollback-verification" },
        },
      },
    });
    expect(report.result.verdict).toBe("violated");
    expect(report.findings.map((entry) => entry.rule)).toEqual(expect.arrayContaining([
      "completion-package-mismatch", "completion-artifact-mismatch", "completion-invocation-mismatch", "completion-duplicate-mismatch", "completion-rollback-mismatch",
    ]));
  });

  it("plans only a candidate and cannot claim activation or closure", () => {
    const plan = planRepositoryPackageAdoption({ id: fixture.id, package: fixture.package, stableProfile: fixture.stableProfile });
    expect(plan.adoption.events).toEqual([]);
    expect(plan.nextPhase).toBe("foundation");
    expect(evaluateRepositoryPackageAdoption(input(plan.adoption)).result).toMatchObject({ verdict: "indeterminate", reason: "foundation-missing" });
  });
});
