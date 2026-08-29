import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CONSUMER_BINDINGS,
  METRIC_DIRECTIONS,
  METRIC_UNITS,
  MODE_NAMES,
  QUALIFICATION_VERDICTS,
  UNIVERSAL_STAGES,
  evaluateRoleLoopArchetypes,
  qualifyRoleCandidate,
} from "./check-role-loop-archetypes.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-role-loop-archetypes.mjs");
const roleContractPath = join(repoRoot, "docs/contracts/role-loop-archetypes.json");

function read(path) {
  return JSON.parse(execFileSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path)}, 'utf8'))`], { encoding: "utf8" }));
}

function rules(result) {
  return result.findings.map((item) => item.rule);
}

function candidateAssessment(overrides = {}) {
  return {
    schemaVersion: 1,
    candidate: {
      name: "@example/operator",
      jobQuestion: "Did the proposed operation move its one owned metric?",
      closeCondition: "Independent consumer evidence shows the owned metric meets the declared setpoint over the review cadence.",
      metric: {
        name: "verified operation rate",
        formula: "verified qualified outcomes / all eligible opportunities",
        unit: "rate",
        direction: "increase",
      },
      primaryMode: "optimize",
      secondaryModes: ["fulfill"],
      boundary: {
        owns: "One bounded outcome loop.",
        excludes: ["adjacent worker capabilities", "self-authorized mutation"],
      },
    },
    sameJobMetricLoopCoverage: [],
    rejectionReasons: [],
    ...overrides,
  };
}

function coverage(role) {
  return {
    role,
    jobEvidence: "The current role already answers the same material job question.",
    metricEvidence: "The current role already owns the same metric and direction.",
    loopClosureEvidence: "The current role already senses, judges, acts, verifies, and learns or escalates for this outcome.",
  };
}

test("the canonical stages, bindings, modes, metric vocabulary, and verdict vocabulary are finite", () => {
  assert.deepEqual(UNIVERSAL_STAGES, ["sense", "judge", "act", "verify", "learnOrEscalate"]);
  assert.deepEqual(CONSUMER_BINDINGS, ["businessMetricPath", "causalHypothesis", "baseline", "setpoint", "operatingScope", "authority", "evidenceSource", "cadence", "budget", "guardrails", "escalationPath", "workerComponents", "stageBindings", "firstDayAssessment"]);
  assert.deepEqual(MODE_NAMES, ["assure", "reconcile", "fulfill", "interact", "steward", "optimize"]);
  assert.deepEqual(METRIC_UNITS, ["ratio", "count", "duration", "currency", "rate"]);
  assert.deepEqual(METRIC_DIRECTIONS, ["increase", "decrease", "maintain", "target-range"]);
  assert.deepEqual(QUALIFICATION_VERDICTS, ["create", "extend", "compose", "reject"]);
});

test("the repository contract passes and rejects incomplete or duplicate role charters", () => {
  const contract = read(roleContractPath);
  assert.deepEqual(rules(evaluateRoleLoopArchetypes({ contract })), []);

  const wrongBindings = structuredClone(contract);
  wrongBindings.consumerBindings.reverse();
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: wrongBindings })).includes("consumer-bindings-mismatch"), true);

  const missingStage = structuredClone(contract);
  delete missingStage.modes.optimize.stageActivities.verify;
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: missingStage })).includes("mode-stage-coverage"), true);

  const emptyFormula = structuredClone(contract);
  emptyFormula.roles["@clossys/architect"].metric.formula = "";
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: emptyFormula })).includes("invalid-metric-formula"), true);

  const noCloseCondition = structuredClone(contract);
  noCloseCondition.roles["@clossys/architect"].closeCondition = "";
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: noCloseCondition })).includes("invalid-close-condition"), true);

  const invalidDirection = structuredClone(contract);
  invalidDirection.roles["@clossys/architect"].metric.direction = "halt";
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: invalidDirection })).includes("invalid-metric-direction"), true);

  const duplicateMetric = structuredClone(contract);
  duplicateMetric.roles["@clossys/controller"].metric.name = duplicateMetric.roles["@clossys/architect"].metric.name;
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: duplicateMetric })).includes("duplicate-owned-metric"), true);

  const unknownMode = structuredClone(contract);
  unknownMode.roles["@clossys/controller"].primaryMode = "advice";
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: unknownMode })).includes("invalid-primary-mode"), true);
});

test("candidate qualification returns create, extend, compose, and reject without inferring composition from adjacency", () => {
  const contract = read(roleContractPath);

  const create = qualifyRoleCandidate({ assessment: candidateAssessment(), contract });
  assert.deepEqual(create, { verdict: "create", validAssessment: true, relatedRoles: [], reasons: [] });

  const extend = qualifyRoleCandidate({
    assessment: candidateAssessment({ sameJobMetricLoopCoverage: [coverage("@clossys/observer")] }),
    contract,
  });
  assert.equal(extend.verdict, "extend");

  const compose = qualifyRoleCandidate({
    assessment: candidateAssessment({
      sameJobMetricLoopCoverage: [coverage("@clossys/observer"), coverage("@clossys/publisher")],
    }),
    contract,
  });
  assert.equal(compose.verdict, "compose");

  const rejectedByJudgment = qualifyRoleCandidate({
    assessment: candidateAssessment({ rejectionReasons: ["The proposed boundary gives the package authority to grade its own evidence."] }),
    contract,
  });
  assert.equal(rejectedByJudgment.verdict, "reject");
  assert.equal(rejectedByJudgment.validAssessment, true);

  const structurallyRejected = candidateAssessment();
  structurallyRejected.candidate.metric.formula = "";
  const reject = qualifyRoleCandidate({ assessment: structurallyRejected, contract });
  assert.equal(reject.verdict, "reject");
  assert.equal(reject.validAssessment, false);
});

test("same-job coverage requires job, metric, and loop-closure evidence from current roles", () => {
  const contract = read(roleContractPath);
  const assessment = candidateAssessment({
    sameJobMetricLoopCoverage: [{
      role: "@clossys/observer",
      jobEvidence: "Observer is adjacent and may supply evidence.",
      metricEvidence: "",
      loopClosureEvidence: "",
    }],
  });
  const result = qualifyRoleCandidate({ assessment, contract });
  assert.equal(result.verdict, "reject");
  assert.equal(result.validAssessment, false);
  assert.equal(result.reasons.some((reason) => reason.includes("invalid-same-job-coverage")), true);
});

test("the CLI fails closed for unreadable data and exits 1 for readable defects", () => {
  const dir = mkdtempSync(join(tmpdir(), "role-qualification-"));
  try {
    assert.throws(
      () => execFileSync(process.execPath, [script, join(dir, "missing.json")], { cwd: repoRoot, stdio: "pipe" }),
      (error) => error.status === 2,
    );

    const malformed = join(dir, "malformed.json");
    writeFileSync(malformed, JSON.stringify({ schemaVersion: 3 }));
    assert.throws(
      () => execFileSync(process.execPath, [script, malformed], { cwd: repoRoot, stdio: "pipe" }),
      (error) => error.status === 2,
    );

    const wrong = read(roleContractPath);
    wrong.roles["@clossys/controller"].metric.direction = "hold";
    const wrongPath = join(dir, "wrong.json");
    writeFileSync(wrongPath, JSON.stringify(wrong));
    assert.throws(
      () => execFileSync(process.execPath, [script, wrongPath], { cwd: repoRoot, stdio: "pipe" }),
      (error) => error.status === 1,
    );

    const candidatePath = join(dir, "candidate.json");
    writeFileSync(candidatePath, JSON.stringify(candidateAssessment()));
    const output = execFileSync(process.execPath, [script, roleContractPath, candidatePath], { cwd: repoRoot, encoding: "utf8" });
    assert.match(output, /ROLE CANDIDATE CREATE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
