import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_FIT_CRITERIA, REQUIRED_READINESS_CRITERIA } from "./assessment.js";
import { fileURLToPath } from "node:url";
import { AdvisorCliInputError, isDirectInvocation, main } from "./cli.js";

let root: string;
const hash = `sha256:${"a".repeat(64)}`;
const integrity = `sha512-${"a".repeat(86)}==`;
function valid(): Record<string, unknown> {
  const evidence = (id: string) => [{ id, description: "Independent evidence." }];
  const action = { kind: "reconcile", ownerRef: "owner", dueAt: "2026-09-01T00:00:00Z", escalationRef: "route" };
  const assessmentBasis = { snapshotDigest: hash, grantDigest: hash, catalogDigest: hash, planDigest: hash, blockerDigest: hash, clearanceDigest: hash, conflictDigest: hash, baselineDigest: hash, completionDefinitionDigest: hash, assessedAt: "2026-08-24T00:00:00Z", freshUntil: "2026-08-31T00:00:00Z" };
  const initiative = { id: "initiative", status: "candidate", targetRepositoryIds: ["repo"], workstreamConflictKeys: ["stream"], dependencyConflictKeys: ["dependency"], mutationConflictKeys: ["mutation"], authorityConflictKeys: ["authority"], scheduleConflictKeys: ["schedule"], dataOutcomeMetricConflictKeys: ["metric"] };
  return { id: "assessment", asOf: "2026-08-24T12:00:00Z", engagement: { id: "engagement", status: "active", nextAction: action, assessmentBasis }, fitSignals: REQUIRED_FIT_CRITERIA.map(({ id }) => ({ id, state: "supported", evidence: evidence(`fit-${id}`) })), prerequisiteObservations: REQUIRED_READINESS_CRITERIA.map(({ id }) => ({ id, state: "satisfied", evidence: evidence(`ready-${id}`) })), initiatives: [initiative], firstWave: { initiativeIds: ["initiative"], objectives: ["objective"], workItems: [{ id: "work", initiativeId: "initiative", targetRepositoryId: "repo", deliveryOwnerRef: "delivery", package: { name: "package", version: "1.0.0", integrity }, invocation: "invoke", placement: "placement", baseline: { metricRef: "metric", value: 0, observedAt: "2026-08-24T00:00:00Z", evidence: { id: "baseline", description: "Baseline." } }, completion: { definition: "definition", independentOutcomeOwnerRef: "outcome", evidenceSource: "measurement", direction: "increase", setpoint: 1, windowDays: 7 }, rollback: { procedure: "rollback", evidenceSource: "record" }, mutationSurfaces: ["mutation"] }] }, preWorkItems: ["baseline", "conflict"].map((kind) => ({ id: kind, kind, status: "satisfied", addressesReadinessCriteria: [kind === "baseline" ? "baseline" : "initiative-mutation-dependency-inventory"], targetRepositoryIds: ["repo"], ownerRef: `${kind}-owner`, impact: "impact", evidence: evidence(`${kind}-evidence`), nextAction: { ...action, ownerRef: `${kind}-owner` }, dependencySurfaces: ["dependency"], mutationSurfaces: ["mutation"], clearance: { authorityOwnerRef: `${kind}-authority`, evidence: evidence(`${kind}-clearance`) } })), reassessment: { cadenceDays: 7, triggers: ["evidence-change"] } };
}
function write(value: unknown): string { const path = join(root, "assessment.json"); writeFileSync(path, JSON.stringify(value)); return path; }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "advisor-cli-")); vi.spyOn(console, "log").mockImplementation(() => {}); });
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
  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./cli.ts", import.meta.url);
    const binPath = join(root, "advisor-check");
    symlinkSync(fileURLToPath(sourceUrl), binPath);
    expect(isDirectInvocation(sourceUrl.href, binPath)).toBe(true);
  });
});
