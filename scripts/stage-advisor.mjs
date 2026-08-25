#!/usr/bin/env node
/**
 * Reproducible author-side staging evidence for the Advisor role.
 *
 * The fixture uses the compiled CLI through its dist path and exercises a
 * genuine unresolved pre-work defect, its cleared control, and unreadable
 * evidence. It proves only that Advisor discriminates those states; it does
 * not establish publication, consumer adoption, independent grounding, or
 * authority to mutate a consumer.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stageDir = mkdtempSync(join(tmpdir(), "foundry-advisor-stage-"));
const cli = join(repoRoot, "packages/advisor/dist/cli.js");

function writeJson(name, value) {
  const path = join(stageDir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function run(label, args, expectedStatus, requiredOutput) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) throw new Error(`${label}: expected exit ${expectedStatus}, got ${result.status}\n${output}`);
  if (!output.includes(requiredOutput)) throw new Error(`${label}: expected output containing ${JSON.stringify(requiredOutput)}\n${output}`);
  console.log(`${label}: exit ${result.status} (${requiredOutput})`);
}

const evidence = [{ id: "evidence-1", description: "Consumer-retained assessment observation." }];
const integrity = `sha512-${"a".repeat(86)}==`;
const digest = (letter) => `sha256:${letter.repeat(64)}`;
const basis = {
  snapshotDigest: digest("a"),
  grantDigest: digest("b"),
  catalogDigest: digest("c"),
  planDigest: digest("d"),
  blockerDigest: digest("e"),
  clearanceDigest: digest("f"),
  conflictDigest: digest("1"),
  baselineDigest: digest("2"),
  completionDefinitionDigest: digest("3"),
  assessedAt: "2026-08-24T00:00:00Z",
  freshUntil: "2026-09-02T00:00:00Z",
};
const fitCriteria = ["sponsor-mandate", "material-need", "offering-operating-compatibility", "expected-value-burden", "adoption-capacity", "legal-ethical-safety"];
const readinessCriteria = ["scope-repository-inventory", "read-access", "authority-approval", "initiative-mutation-dependency-inventory", "immutable-artifact-access", "baseline", "independent-outcome-owner", "rollback-review-window"];

function preWork(status = "satisfied") {
  return [
    Object.assign({
      id: "baseline",
      kind: "baseline",
      status,
      addressesReadinessCriteria: ["baseline"],
      targetRepositoryIds: ["repository-a"],
      ownerRef: "consumer-owner",
      impact: "Controller cannot be selected without a consumer-owned baseline.",
      evidence,
      nextAction: { kind: "confirm-baseline", ownerRef: "consumer-owner", dueAt: "2026-09-01T00:00:00Z", escalationRef: "sponsor" },
      dependencySurfaces: ["assessment-input"],
      mutationSurfaces: ["consumer-position"],
    }, status === "satisfied" ? { clearance: { authorityOwnerRef: "baseline-authority", evidence } } : {}),
    {
      id: "conflict",
      kind: "conflict",
      status: "satisfied",
      addressesReadinessCriteria: ["initiative-mutation-dependency-inventory"],
      targetRepositoryIds: ["repository-a"],
      ownerRef: "consumer-owner",
      impact: "Controller work cannot collide with an active mutation surface.",
      evidence,
      nextAction: { kind: "confirm-conflicts", ownerRef: "consumer-owner", dueAt: "2026-09-01T00:00:00Z", escalationRef: "sponsor" },
      dependencySurfaces: ["initiative-register"],
      mutationSurfaces: ["consumer-position"],
      clearance: { authorityOwnerRef: "initiative-authority", evidence },
    },
  ];
}

function readinessPreWork(status, criterion, kind) {
  return {
    id: `${kind}-${status}`,
    kind,
    status,
    addressesReadinessCriteria: [criterion],
    targetRepositoryIds: ["repository-a"],
    ownerRef: "consumer-owner",
    impact: `The readiness criterion ${criterion} remains unresolved.`,
    evidence,
    nextAction: { kind: "resolve-readiness", ownerRef: "consumer-owner", dueAt: "2026-09-01T00:00:00Z", escalationRef: "sponsor" },
    dependencySurfaces: ["assessment-input"],
    mutationSurfaces: ["consumer-position"],
  };
}

function assessment(overrides = {}) {
  return {
    id: "assessment-1",
    asOf: "2026-08-24T12:00:00Z",
    engagement: {
      id: "engagement-1",
      status: "active",
      nextAction: { kind: "assess", ownerRef: "consumer-owner", dueAt: "2026-09-01T00:00:00Z", escalationRef: "sponsor" },
      assessmentBasis: basis,
    },
    fitSignals: fitCriteria.map((id) => ({ id, state: "supported", evidence })),
    prerequisiteObservations: readinessCriteria.map((id) => ({ id, state: "satisfied", evidence })),
    initiatives: [
      { id: "initiative-a", status: "active", targetRepositoryIds: ["repository-a"], workstreamConflictKeys: ["workstream-a"], dependencyConflictKeys: ["dependency-a"], mutationConflictKeys: ["mutation-a"], authorityConflictKeys: ["authority-a"], scheduleConflictKeys: ["schedule-a"], dataOutcomeMetricConflictKeys: ["metric-a"] },
      { id: "initiative-b", status: "candidate", targetRepositoryIds: ["repository-b"], workstreamConflictKeys: ["workstream-b"], dependencyConflictKeys: ["dependency-b"], mutationConflictKeys: ["mutation-b"], authorityConflictKeys: ["authority-b"], scheduleConflictKeys: ["schedule-b"], dataOutcomeMetricConflictKeys: ["metric-b"] },
    ],
    firstWave: {
      initiativeIds: ["initiative-a"],
      objectives: ["Establish the first bounded decision"],
      workItems: [{
        id: "work-a",
        initiativeId: "initiative-a",
        targetRepositoryId: "repository-a",
        deliveryOwnerRef: "delivery-owner",
        package: { name: "@vespeneventures/controller", version: "0.8.15", integrity },
        invocation: "foundry-position-check",
        placement: "consumer-owned required check",
        baseline: { metricRef: "decision-currency", value: 0, observedAt: "2026-08-24T00:00:00Z", evidence: evidence[0] },
        completion: { definition: "Independent outcome reaches its setpoint.", independentOutcomeOwnerRef: "outcome-owner", evidenceSource: "consumer-owned measurement", direction: "increase", setpoint: 1, windowDays: 7 },
        rollback: { procedure: "Restore the exact prior manifest and lockfile.", evidenceSource: "consumer-owned rollback record" },
        mutationSurfaces: ["consumer manifest", "consumer lockfile", "consumer position ledger"],
      }],
    },
    preWorkItems: preWork(),
    reassessment: { cadenceDays: 7, triggers: ["scope-change", "evidence-change"] },
    ...overrides,
  };
}

try {
  const control = writeJson("assessment-control.json", assessment());
  const red = writeJson("assessment-red.json", assessment({ preWorkItems: preWork("unresolved") }));
  const indeterminate = writeJson("assessment-indeterminate.json", assessment({ prerequisiteObservations: readinessCriteria.map((id) => ({ id, state: id === "immutable-artifact-access" ? "unknown" : "satisfied", evidence })), preWorkItems: [...preWork(), readinessPreWork("indeterminate", "immutable-artifact-access", "artifact-access")] }));

  run("advisor pre-work red", [red], 1, '"state": "violated"');
  run("advisor control", [control], 0, '"state": "satisfied"');
  run("advisor unreadable evidence", [indeterminate], 2, '"state": "indeterminate"');

  console.log("Advisor fixture evidence: unresolved pre-work violated, the cleared control satisfied, and unknown readiness stayed indeterminate.");
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
