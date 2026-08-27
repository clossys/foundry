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
  policy: { requiredChecks: [], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" },
  evidence: {
    schemaVersion: 3,
    headSha: fixture.events[0].candidate.headSha,
    baseSha: fixture.events[0].candidate.baseSha,
    paginationComplete: true,
    checks: [], reviews: [], threads: [],
  },
};
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function input(adoption = fixture) {
  return { adoption, repositoryProfile: copy(profile), stableProfileCoverage: copy(coverage), foundationReview: copy(review) };
}

describe("RepositoryPackageAdoptionV1", () => {
  it("ships the same canonical contract and fixture that the documentation publishes", () => {
    expect(shippedFixture).toEqual(fixture);
    expect(shippedContract).toEqual(documentedContract);
  });

  it("accepts the canonical ordered fixture and proves its cutover when enforcement is observed", () => {
    expect(validateRepositoryPackageAdoption(fixture)).toEqual([]);
    const report = evaluateRepositoryPackageAdoption({
      ...input(),
      rulesetObservation: {
        state: "enforced",
        mainSha: fixture.events[2].mainSha,
        requiredCheck: fixture.events[2].requiredCheck,
        ruleId: fixture.events[2].ruleId,
        sourceRef: fixture.events[2].sourceRef,
        observedAt: fixture.events[2].observedAt,
      },
    });
    expect(report.result).toEqual({ verdict: "indeterminate", reason: "closure-incomplete", detail: "Closure needs consumer ledger and completion evidence supplied to the existing validator." });
    expect(report.phase).toBe("closure");
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

  it("rejects stale review, canary/head mismatch, and check/cutover mismatch", () => {
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
    const unknown = evaluateRepositoryPackageAdoption({ ...input(adoption), rulesetObservation: { state: "unknown", mainSha: adoption.events[2].mainSha, requiredCheck: adoption.events[2].requiredCheck, ruleId: adoption.events[2].ruleId, sourceRef: adoption.events[2].sourceRef, observedAt: adoption.events[2].observedAt } });
    expect(unknown.result.verdict).toBe("indeterminate");
    const unenforced = evaluateRepositoryPackageAdoption({ ...input(adoption), rulesetObservation: { state: "not-enforced", mainSha: adoption.events[2].mainSha, requiredCheck: adoption.events[2].requiredCheck, ruleId: adoption.events[2].ruleId, sourceRef: adoption.events[2].sourceRef, observedAt: adoption.events[2].observedAt } });
    expect(unenforced.result.verdict).toBe("violated");
    const mismatched = evaluateRepositoryPackageAdoption({ ...input(adoption), rulesetObservation: { state: "enforced", mainSha: adoption.events[2].mainSha, requiredCheck: "other-check", ruleId: adoption.events[2].ruleId, sourceRef: adoption.events[2].sourceRef, observedAt: adoption.events[2].observedAt } });
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
    const multi = copy(fixture); multi.packages = [multi.package];
    expect(validateRepositoryPackageAdoption(multi).length).toBeGreaterThan(0);
    const accessor = copy(fixture); Object.defineProperty(accessor, "id", { get: () => "unsafe", enumerable: true });
    expect(validateRepositoryPackageAdoption(accessor).length).toBeGreaterThan(0);
    const inherited = Object.assign(Object.create({ inherited: true }), fixture);
    expect(validateRepositoryPackageAdoption(inherited).length).toBeGreaterThan(0);
  });

  it("plans only a candidate and cannot claim activation or closure", () => {
    const plan = planRepositoryPackageAdoption({ id: fixture.id, package: fixture.package, stableProfile: fixture.stableProfile });
    expect(plan.adoption.events).toEqual([]);
    expect(plan.nextPhase).toBe("foundation");
    expect(evaluateRepositoryPackageAdoption(input(plan.adoption)).result).toMatchObject({ verdict: "indeterminate", reason: "foundation-missing" });
  });
});
