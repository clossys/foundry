import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_FIT_CRITERIA, REQUIRED_READINESS_CRITERIA } from "./assessment.js";
import { fileURLToPath } from "node:url";
import { AdvisorCliInputError, isDirectInvocation, main } from "./cli.js";

let root: string;
let executionCli: string;
const hash = `sha256:${"a".repeat(64)}`;
const integrity = `sha512-${"a".repeat(86)}==`;
function valid(): Record<string, unknown> {
  const evidence = (id: string) => [{ id, description: "Independent evidence." }];
  const action = { kind: "reconcile", ownerRef: "owner", dueAt: "2026-09-01T00:00:00Z", escalationRef: "route" };
  const assessmentBasis = { snapshotDigest: hash, grantDigest: hash, catalogDigest: hash, planDigest: hash, blockerDigest: hash, clearanceDigest: hash, conflictDigest: hash, baselineDigest: hash, completionDefinitionDigest: hash, assessedAt: "2026-08-24T00:00:00Z", freshUntil: "2026-08-31T00:00:00Z" };
  const initiative = { id: "initiative", status: "candidate", targetRepositoryIds: ["repo"], workstreamConflictKeys: ["stream"], dependencyConflictKeys: ["dependency"], mutationConflictKeys: ["mutation"], authorityConflictKeys: ["authority"], scheduleConflictKeys: ["schedule"], dataOutcomeMetricConflictKeys: ["metric"] };
  return { id: "assessment", asOf: "2026-08-24T12:00:00Z", engagement: { id: "engagement", status: "active", nextAction: action, assessmentBasis }, fitSignals: REQUIRED_FIT_CRITERIA.map(({ id }) => ({ id, state: "supported", evidence: evidence(`fit-${id}`) })), prerequisiteObservations: REQUIRED_READINESS_CRITERIA.map(({ id }) => ({ id, state: "satisfied", evidence: evidence(`ready-${id}`) })), initiatives: [initiative], firstWave: { initiativeIds: ["initiative"], objectives: ["objective"], workItems: [{ id: "work", initiativeId: "initiative", targetRepositoryId: "repo", deliveryOwnerRef: "delivery", package: { name: "package", version: "1.0.0", integrity }, bin: "approved-check", invocation: "single-json-input", placement: "placement", baseline: { metricRef: "metric", value: 0, observedAt: "2026-08-24T00:00:00Z", evidence: { id: "baseline", description: "Baseline." } }, completion: { definition: "definition", independentOutcomeOwnerRef: "outcome", evidenceSource: "measurement", direction: "increase", setpoint: 1, windowDays: 7 }, rollback: { procedure: "rollback", evidenceSource: "record" }, mutationSurfaces: ["mutation"] }] }, preWorkItems: ["baseline", "conflict"].map((kind) => ({ id: kind, kind, status: "satisfied", addressesReadinessCriteria: [kind === "baseline" ? "baseline" : "initiative-mutation-dependency-inventory"], targetRepositoryIds: ["repo"], ownerRef: `${kind}-owner`, impact: "impact", evidence: evidence(`${kind}-evidence`), nextAction: { ...action, ownerRef: `${kind}-owner` }, dependencySurfaces: ["dependency"], mutationSurfaces: ["mutation"], clearance: { authorityOwnerRef: `${kind}-authority`, evidence: evidence(`${kind}-clearance`) } })), reassessment: { cadenceDays: 7, triggers: ["evidence-change"] } };
}
function authorization(assessment: Record<string, unknown>): Record<string, unknown> {
  const engagement = assessment.engagement as Record<string, unknown>;
  const assessmentBasis = engagement.assessmentBasis as Record<string, unknown>;
  return { planDigest: assessmentBasis.planDigest, assessmentBasis, sponsorRef: "sponsor", permittedRepositoryIds: ["repo"], permittedPackages: [{ name: "package", version: "1.0.0", integrity }], permittedMutationSurfaces: ["mutation"], grantedAt: "2026-08-24T12:00:00Z", expiresAt: "2026-08-25T12:00:00Z" };
}
function write(value: unknown): string { const path = join(root, "assessment.json"); writeFileSync(path, JSON.stringify(value)); return path; }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "advisor-cli-")); vi.spyOn(console, "log").mockImplementation(() => {}); });
beforeAll(() => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const compiler = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
  const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: packageRoot, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`Advisor build failed: ${built.stderr || built.stdout}`);
  executionCli = join(packageRoot, "dist", "execution-readiness-cli.js");
});
describe("advisor-check", () => {
  it("maps satisfied, violated, and indeterminate reports to 0, 1, and 2", () => {
    const assessment = valid(); expect(main([write(assessment)])).toBe(0);
    const preWorkItems = (assessment.preWorkItems as Array<Record<string, unknown>>).map((item) => ({ ...item, status: "unresolved", clearance: undefined }));
    expect(main([write({ ...assessment, preWorkItems })])).toBe(1);
    expect(main([write({})])).toBe(2);
  });
  it("uses exit-2 input semantics and documents the tri-state contract", () => {
    expect(() => main([])).toThrow(AdvisorCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(AdvisorCliInputError);
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
  });
  it("never exits 0 for malformed or mismatched retained authorization", () => {
    const assessment = valid(); const engagement = assessment.engagement as Record<string, unknown>;
    expect(main([write({ ...assessment, engagement: { ...engagement, executionAuthorization: authorization(assessment) } })])).toBe(0);
    expect(main([write({ ...assessment, engagement: { ...engagement, executionAuthorization: null } })])).toBe(2);
    expect(main([write({ ...assessment, engagement: { ...engagement, executionAuthorization: { ...authorization(assessment), planDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" } } })])).toBe(2);
  });
  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./cli.ts", import.meta.url);
    const binPath = join(root, "advisor-check");
    symlinkSync(fileURLToPath(sourceUrl), binPath);
    expect(isDirectInvocation(sourceUrl.href, binPath)).toBe(true);
  });
});

describe("advisor-execution-readiness compiled CLI", () => {
  function invoke(value: unknown, currentAsOf = "2026-08-24T12:00:00Z") {
    const assessmentPath = write(value);
    return spawnSync(process.execPath, [executionCli, assessmentPath, currentAsOf], { encoding: "utf8" });
  }
  it("uses the runner clock rather than consumer assessment.asOf", () => {
    const assessment = valid();
    assessment.asOf = "1900-01-01T00:00:00Z";
    const engagement = assessment.engagement as Record<string, unknown>;
    const authorizationValue = authorization(assessment);
    const response = invoke({ ...assessment, engagement: { ...engagement, executionAuthorization: authorizationValue } });
    expect(response.status).toBe(0);
    expect(JSON.parse(response.stdout)).toMatchObject({ state: "satisfied", assessment: { firstWavePlan: { state: "ready-for-sponsor-approval" }, preWork: { state: "satisfied" } } });
  });
  it("returns 1 for concrete authorization and readiness violations", () => {
    const assessment = valid();
    const engagement = assessment.engagement as Record<string, unknown>;
    const exact = authorization(assessment);
    const basis = engagement.assessmentBasis as Record<string, unknown>;
    const cases: readonly [string, Record<string, unknown>, Record<string, unknown>, string][] = [
      ["expired", { ...exact, expiresAt: "2026-08-24T12:30:00Z" }, assessment, "2026-08-24T13:00:00Z"],
      ["not-yet-valid", { ...exact, grantedAt: "2026-08-24T12:30:00Z" }, assessment, "2026-08-24T12:00:00Z"],
      ["stale-basis", { ...exact, assessmentBasis: { ...basis, freshUntil: "2026-08-24T12:00:00Z" } }, { ...assessment, engagement: { ...engagement, assessmentBasis: { ...basis, freshUntil: "2026-08-24T12:00:00Z" } } }, "2026-08-24T12:00:00Z"],
      ["plan", { ...exact, planDigest: `sha256:${"f".repeat(64)}` }, assessment, "2026-08-24T12:00:00Z"],
      ["repository", { ...exact, permittedRepositoryIds: ["other-repository"] }, assessment, "2026-08-24T12:00:00Z"],
      ["package", { ...exact, permittedPackages: [{ name: "other-package", version: "1.0.0", integrity }] }, assessment, "2026-08-24T12:00:00Z"],
      ["mutation", { ...exact, permittedMutationSurfaces: ["other-mutation"] }, assessment, "2026-08-24T12:00:00Z"],
    ];
    for (const [name, executionAuthorization, evidence, currentAsOf] of cases) {
      const evidenceEngagement = evidence.engagement as Record<string, unknown>;
      const response = invoke({ ...evidence, engagement: { ...evidenceEngagement, executionAuthorization } }, currentAsOf);
      expect(response.status, name).toBe(1);
    }
    const unresolved = (assessment.preWorkItems as Array<Record<string, unknown>>).map((item) => ({ ...item, status: "unresolved", clearance: undefined }));
    expect(invoke({ ...assessment, engagement: { ...engagement, executionAuthorization: exact }, preWorkItems: unresolved }).status).toBe(1);
  });
  it("returns 2 for malformed and unreadable evidence", () => {
    const malformed = valid(); const engagement = malformed.engagement as Record<string, unknown>;
    expect(invoke({ ...malformed, engagement: { ...engagement, executionAuthorization: null } }).status).toBe(2);
    expect(invoke({ ...malformed, engagement: { ...engagement, executionAuthorization: { ...authorization(malformed), grantedAt: "not-a-time" } } }).status).toBe(2);
    const missing = spawnSync(process.execPath, [executionCli, join(root, "missing.json"), "2026-08-24T12:00:00Z"], { encoding: "utf8" });
    expect(missing.status).toBe(2);
  });
});
