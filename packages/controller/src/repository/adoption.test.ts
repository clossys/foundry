import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateRepositoryPackageAdoption,
  planRepositoryPackageAdoption,
  validateRepositoryPackageAdoption,
} from "./adoption.js";
import { computeDigest } from "../policy/digest.js";

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
    expect(report.status).toBe("closure-incomplete");
    const foundation = copy(fixture); foundation.events.length = 1;
    expect(evaluateRepositoryPackageAdoption(input(foundation))).toMatchObject({ result: { verdict: "satisfied" }, phase: "foundation", status: "foundation-ready" });
    const canary = copy(fixture); canary.events.length = 2;
    expect(evaluateRepositoryPackageAdoption(input(canary))).toMatchObject({ result: { verdict: "satisfied" }, phase: "post-main-canary", status: "canary-ready" });
    const cutover = copy(fixture); cutover.events.length = 3;
    expect(evaluateRepositoryPackageAdoption({ ...input(cutover), rulesetObservation: ruleset(cutover) })).toMatchObject({ result: { verdict: "satisfied" }, phase: "atomic-ruleset-cutover", status: "cutover-ready" });
    const activation = copy(fixture); activation.events.length = 4;
    expect(evaluateRepositoryPackageAdoption({ ...input(activation), rulesetObservation: ruleset(activation) })).toMatchObject({ result: { verdict: "satisfied" }, phase: "activation", status: "activated" });
  });

  it("requires graph evidence that exactly joins an adopted singular authority", () => {
    const ordinary = copy(fixture); ordinary.events.length = 1;
    const foundation = copy(ordinary);
    foundation.package.singularAuthority = "repository-adoption";
    foundation.events[0].candidate.singularAuthority = "repository-adoption";
    const green = {
      lockfile: { format: "npm" as const, content: JSON.stringify({ lockfileVersion: 3, packages: {
        "": { devDependencies: { "@example/repository-adoption": "1.2.3" } },
        "node_modules/@example/repository-adoption": { version: "1.2.3" },
      } }) },
      declarations: [{ packageName: "@example/repository-adoption", authority: "repository-adoption" }],
      target: { authority: "repository-adoption", version: "1.2.3" },
    };
    expect(evaluateRepositoryPackageAdoption({ ...input(foundation), singularAuthorityConvergence: green }))
      .toMatchObject({ result: { verdict: "satisfied" }, status: "foundation-ready" });
    const aliasWithDisposedAdoptedCopy = {
      ...green,
      declarations: [...green.declarations, { packageName: "@example/repository-alias", authority: "repository-adoption" }],
      lockfile: { format: "npm" as const, content: JSON.stringify({ lockfileVersion: 3, packages: {
        "": { dependencies: { "@example/repository-adoption": "1.1.0", "@example/repository-alias": "1.2.3" } },
        "node_modules/@example/repository-adoption": { version: "1.1.0" },
        "node_modules/@example/repository-alias": { version: "1.2.3" },
      } }) },
      dispositions: [{ authority: "repository-adoption", node: "node_modules/@example/repository-adoption", kind: "isolated-non-authoritative-helper" as const, reference: "urn:example:isolated-adopted-copy" }],
    };
    expect(evaluateRepositoryPackageAdoption({ ...input(foundation), singularAuthorityConvergence: aliasWithDisposedAdoptedCopy }))
      .toMatchObject({ result: { verdict: "violated" }, findings: [{ rule: "singular-authority-convergence" }] });
    let filterReads = 0;
    const hostileDispositions = new Proxy([] as never[], {
      get(target, property, receiver) {
        if (property === "filter" && ++filterReads > 1) throw new Error("second disposition read");
        return Reflect.get(target, property, receiver);
      },
    });
    const hostileReport = evaluateRepositoryPackageAdoption({ ...input(foundation), singularAuthorityConvergence: { ...green, dispositions: hostileDispositions } });
    expect(hostileReport).toMatchObject({ result: { verdict: "indeterminate", reason: "singular-authority-convergence-indeterminate" } });
    expect(evaluateRepositoryPackageAdoption(input(foundation)))
      .toMatchObject({ result: { verdict: "indeterminate", reason: "singular-authority-convergence-indeterminate" } });
    expect(evaluateRepositoryPackageAdoption({ ...input(ordinary), singularAuthorityConvergence: green }))
      .toMatchObject({ result: { verdict: "violated" }, findings: [{ rule: "singular-authority-convergence" }] });
    const unrelated = { ...green, declarations: [{ packageName: "@example/other", authority: "repository-adoption" }] };
    expect(evaluateRepositoryPackageAdoption({ ...input(foundation), singularAuthorityConvergence: unrelated }))
      .toMatchObject({ result: { verdict: "violated" }, findings: [{ rule: "singular-authority-convergence" }] });
    const wrongVersion = { ...green, target: { authority: "repository-adoption", version: "1.2.4" } };
    expect(evaluateRepositoryPackageAdoption({ ...input(foundation), singularAuthorityConvergence: wrongVersion }))
      .toMatchObject({ result: { verdict: "violated" }, findings: [{ rule: "singular-authority-convergence" }] });
    const updateRequired = {
      ...green,
      lockfile: { format: "npm" as const, content: JSON.stringify({ lockfileVersion: 3, packages: {
        "": { dependencies: { "@scope/builder": "^0.7.0", "@example/repository-adoption": "1.2.3" } },
        "node_modules/@scope/builder": { version: "0.7.1", dependencies: { "@example/repository-adoption": "^1.3.0" } },
        "node_modules/@example/repository-adoption": { version: "1.2.3" },
      } }) },
    };
    expect(evaluateRepositoryPackageAdoption({ ...input(foundation), singularAuthorityConvergence: updateRequired }))
      .toMatchObject({ result: { verdict: "violated" }, findings: [{ rule: "singular-authority-convergence" }] });
    const indeterminate = { ...green, lockfile: { format: "npm" as const, content: JSON.stringify({ lockfileVersion: 1, packages: {} }) } };
    expect(evaluateRepositoryPackageAdoption({ ...input(foundation), singularAuthorityConvergence: indeterminate }))
      .toMatchObject({ result: { verdict: "indeterminate", reason: "singular-authority-convergence-indeterminate" } });
  });

  it("requires every stable profile coverage axis and profile v3", () => {
    const missing = input();
    missing.stableProfileCoverage.pop();
    expect(evaluateRepositoryPackageAdoption(missing).result.verdict).toBe("indeterminate");
    const legacy = input();
    legacy.repositoryProfile.value = { schemaVersion: 1, defaultBranch: "main", commands: [], protectedPaths: [] };
    const legacyReport = evaluateRepositoryPackageAdoption(legacy);
    expect(legacyReport.result.verdict).toBe("indeterminate");
    expect(legacyReport.findings.some((entry) => entry.rule === "profile-version")).toBe(true);
    const v2 = input();
    (v2.repositoryProfile as { value: unknown }).value = {
      schemaVersion: 2,
      defaultBranch: "main",
      commands: [],
      protectedPaths: [],
      requirements: [],
    };
    const v2Report = evaluateRepositoryPackageAdoption(v2);
    expect(v2Report.result.verdict).toBe("indeterminate");
    expect(v2Report.findings.some((entry) => entry.rule === "profile-version")).toBe(true);
  });

  it("rejects vacuous or stale review, canary/head mismatch, and check/cutover mismatch", () => {
    const empty = input();
    empty.foundationReview.policy = { requiredChecks: [], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" };
    empty.foundationReview.evidence.checks = [];
    expect(evaluateRepositoryPackageAdoption(empty)).toMatchObject({ result: { verdict: "violated" }, findings: [{ rule: "foundation-review-vacuous" }] });
    const staleAdoption = copy(fixture); staleAdoption.events.length = 1;
    const stale = input(staleAdoption);
    stale.foundationReview.evidence.headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(evaluateRepositoryPackageAdoption(stale)).toMatchObject({ result: { verdict: "violated" }, status: "foundation-violated" });
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
    expect(unknown).toMatchObject({ result: { verdict: "indeterminate" }, status: "cutover-incomplete" });
    const unenforcedObservation = ruleset(adoption); unenforcedObservation.after.state = "not-enforced";
    const unenforced = evaluateRepositoryPackageAdoption({ ...input(adoption), rulesetObservation: unenforcedObservation });
    expect(unenforced).toMatchObject({ result: { verdict: "violated" }, status: "cutover-violated" });
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
    const invalidAuthority = copy(fixture); invalidAuthority.package.singularAuthority = "Controller"; invalidAuthority.events[0].candidate.singularAuthority = "Controller";
    expect(validateRepositoryPackageAdoption(invalidAuthority)).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "package", path: "package.singularAuthority" })]));
    const authorityMismatch = copy(fixture); authorityMismatch.package.singularAuthority = "controller"; authorityMismatch.events[0].candidate.singularAuthority = "other";
    expect(validateRepositoryPackageAdoption(authorityMismatch)).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "event-package-mismatch", path: "events[0].candidate" })]));
    const multi = copy(fixture); multi.packages = [multi.package];
    expect(validateRepositoryPackageAdoption(multi).length).toBeGreaterThan(0);
    const accessor = copy(fixture); Object.defineProperty(accessor, "id", { get: () => "unsafe", enumerable: true });
    expect(validateRepositoryPackageAdoption(accessor).length).toBeGreaterThan(0);
    const malformedEvent = copy(fixture);
    Object.defineProperty(malformedEvent.events[0], "candidate", { get: () => fixture.package, enumerable: true });
    const malformedFindings = validateRepositoryPackageAdoption(malformedEvent);
    expect(malformedFindings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "event-order", path: "events[0]" })]));
    expect(malformedFindings.some((entry) => entry.rule === "adoption-shape")).toBe(false);
    const rejectedFoundation = copy(fixture);
    rejectedFoundation.events[0].candidate.headSha = "not-a-sha";
    const rejectedFoundationFindings = validateRepositoryPackageAdoption(rejectedFoundation);
    expect(rejectedFoundationFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "event-head-mismatch", path: "events[0].candidate.headSha" }),
      expect.objectContaining({ rule: "event-head-mismatch", path: "events[1].mainSha" }),
    ]));
    const unknownEventKind = copy(fixture); unknownEventKind.events.length = 1; unknownEventKind.events[0].kind = "unknown";
    expect(evaluateRepositoryPackageAdoption(input(unknownEventKind))).toMatchObject({
      result: { verdict: "indeterminate", reason: "adoption-invalid" },
      phase: "candidate",
      status: "candidate-incomplete",
    });
    const inherited = Object.assign(Object.create({ inherited: true }), fixture);
    expect(validateRepositoryPackageAdoption(inherited).length).toBeGreaterThan(0);
  });

  it("accepts exact prerelease/build package identities and rejects large adversarial versions", () => {
    const exact = copy(fixture);
    const version = "1.2.3-rc.1+build.7";
    exact.package.version = version;
    exact.events[0].candidate.version = version;
    exact.events[3].package.version = version;
    exact.events[4].package.version = version;
    expect(validateRepositoryPackageAdoption(exact).filter((entry) => entry.rule === "package-version")).toEqual([]);

    const adversarial = copy(fixture);
    adversarial.package.version = `0.0.0${"--".repeat(40_000)}`;
    expect(validateRepositoryPackageAdoption(adversarial)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "package-version", path: "package.version" }),
    ]));
  });

  it("requires before-to-after atomic enforcement and strictly real ordered instants", () => {
    const invalidCanaryDate = copy(fixture); invalidCanaryDate.events[1].completedAt = "2026-02-30T00:00:00.000Z";
    expect(validateRepositoryPackageAdoption(invalidCanaryDate).some((entry) => entry.rule === "event-shape")).toBe(true);
    const unordered = copy(fixture); unordered.events[2].observedAt = unordered.events[1].completedAt;
    expect(validateRepositoryPackageAdoption(unordered).some((entry) => entry.rule === "event-chronology")).toBe(true);
    const beforeCanary = copy(fixture); beforeCanary.events[2].before.observedAt = beforeCanary.events[1].completedAt;
    expect(validateRepositoryPackageAdoption(beforeCanary).some((entry) => entry.rule === "event-chronology")).toBe(true);
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

  it("canonicalizes valid profile collections above the event-array cap through the validated 10,000-entry maximum", () => {
    for (const count of [33, 10_000]) {
      const rootEntries = Array.from({ length: count }, (_, index) => ({ name: `entry-${index}`, classification: "extension", disposition: "allowed" }));
      const canonicalProfile = {
        commands: [],
        defaultBranch: "main",
        protectedPaths: [],
        requirements: [],
        rootEntries: rootEntries.map(({ name }) => ({ classification: "extension", disposition: "allowed", name })),
        schemaVersion: 3,
      };
      const hash = computeDigest(JSON.stringify(canonicalProfile), "sha256");
      const adoption = copy(fixture); adoption.events.length = 1; adoption.stableProfile.sha256 = hash;
      const report = evaluateRepositoryPackageAdoption({
        ...input(adoption),
        repositoryProfile: { value: { schemaVersion: 3, defaultBranch: "main", commands: [], protectedPaths: [], requirements: [], rootEntries }, path: "governance/repository-profile.json", sha256: hash },
      });
      expect(report).toMatchObject({ result: { verdict: "satisfied" }, status: "foundation-ready" });
      expect(report.findings.some((entry) => entry.rule === "profile-hash-mismatch" || entry.rule === "profile-hash-unavailable")).toBe(false);
    }
  });

  it("keeps a validated profile that exceeds bounded canonicalization indeterminate rather than calling it a hash mismatch", () => {
    const adoption = copy(fixture); adoption.events.length = 1;
    const bounded = input(adoption);
    bounded.repositoryProfile.value = {
      schemaVersion: 3,
      defaultBranch: "a".repeat(8_000_001),
      commands: [],
      protectedPaths: [],
      requirements: [],
      rootEntries: [],
    };
    const report = evaluateRepositoryPackageAdoption(bounded);
    expect(report).toMatchObject({ result: { verdict: "indeterminate", reason: "profile-coverage-incomplete" }, status: "foundation-incomplete" });
    expect(report.findings.map((entry) => entry.rule)).toContain("profile-hash-unavailable");
    expect(report.findings.map((entry) => entry.rule)).not.toContain("profile-hash-mismatch");
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
