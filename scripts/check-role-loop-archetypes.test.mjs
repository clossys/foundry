import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ARCHETYPES, LOOP_GRAMMAR, ROLE_ARCHETYPES, deriveRolePackages, evaluateRoleLoopArchetypes } from "./check-role-loop-archetypes.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-role-loop-archetypes.mjs");
const roleContractPath = join(repoRoot, "docs/contracts/role-loop-archetypes.json");
const programsContractPath = join(repoRoot, "docs/contracts/package-programs.json");

function read(path) {
  return JSON.parse(execFileSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path)}, 'utf8'))`], { encoding: "utf8" }));
}

function rules(result) {
  return result.findings.map((finding) => finding.rule);
}

test("the normalized grammar, archetypes, and expected role mapping are fixed", () => {
  assert.deepEqual(LOOP_GRAMMAR, [
    "subjectOrAddressee",
    "authoritativeSetpoint",
    "actualObservation",
    "ternaryJudgment",
    "correctionOrHandoff",
    "independentOutcome",
    "cadenceAndCloseCondition",
  ]);
  assert.deepEqual(Object.keys(ARCHETYPES), ["conformance-gate", "reconciliation", "actuation-provisioning", "confirmation-interaction", "custody-lifecycle", "observation-learning"]);
  assert.equal(Object.keys(ROLE_ARCHETYPES).length, 14);
});

test("Programs A, B, and C derive exactly the 14 roles, excluding donors and foundation", () => {
  const { packages, findings } = deriveRolePackages(read(programsContractPath));
  assert.deepEqual(findings, []);
  assert.deepEqual([...packages].sort(), Object.keys(ROLE_ARCHETYPES).sort());
});

test("the repository contract passes, while order, archetype, role, and secondary defects fail", () => {
  const contract = read(roleContractPath);
  const programsContract = read(programsContractPath);
  assert.deepEqual(rules(evaluateRoleLoopArchetypes({ contract, programsContract })), []);

  const wrongGrammar = structuredClone(contract);
  wrongGrammar.loopGrammar.reverse();
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: wrongGrammar, programsContract })).includes("loop-grammar-mismatch"), true);

  const wrongPhases = structuredClone(contract);
  wrongPhases.archetypes.reconciliation.phases.reverse();
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: wrongPhases, programsContract })).includes("archetype-phases-mismatch"), true);

  const missingRole = structuredClone(contract);
  delete missingRole.roles["@vespeneventures/keeper"];
  assert.equal(rules(evaluateRoleLoopArchetypes({ contract: missingRole, programsContract })).includes("role-coverage-mismatch"), true);

  const duplicateSecondary = structuredClone(contract);
  duplicateSecondary.roles["@vespeneventures/builder"].secondary = ["reconciliation", "reconciliation"];
  const duplicateRules = rules(evaluateRoleLoopArchetypes({ contract: duplicateSecondary, programsContract }));
  assert.equal(duplicateRules.includes("duplicate-secondary-archetype"), true);
  assert.equal(duplicateRules.includes("secondary-mapping-mismatch"), true);
});

test("the CLI fails closed for unreadable data and exits 1 for readable contract defects", () => {
  const dir = mkdtempSync(join(tmpdir(), "role-loops-"));
  try {
    assert.throws(
      () => execFileSync(process.execPath, [script, join(dir, "missing.json"), programsContractPath], { cwd: repoRoot, stdio: "pipe" }),
      (error) => error.status === 2,
    );

    const malformed = join(dir, "malformed.json");
    writeFileSync(malformed, JSON.stringify({ schemaVersion: 1 }));
    assert.throws(
      () => execFileSync(process.execPath, [script, malformed, programsContractPath], { cwd: repoRoot, stdio: "pipe" }),
      (error) => error.status === 2,
    );

    const wrong = read(roleContractPath);
    wrong.roles["@vespeneventures/controller"].primary = "conformance-gate";
    const wrongPath = join(dir, "wrong.json");
    writeFileSync(wrongPath, JSON.stringify(wrong));
    assert.throws(
      () => execFileSync(process.execPath, [script, wrongPath, programsContractPath], { cwd: repoRoot, stdio: "pipe" }),
      (error) => error.status === 1,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
