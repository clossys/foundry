import assert from "node:assert/strict";
import { test } from "node:test";

import { precisionRecall, scoreScenario } from "./accuracy.mjs";

test("precisionRecall: identical sets score 1/1", () => {
  const { precision, recall } = precisionRecall(["a", "b"], ["b", "a"]);
  assert.equal(precision, 1);
  assert.equal(recall, 1);
});

test("precisionRecall: extra actual role lowers precision, not recall", () => {
  const { precision, recall } = precisionRecall(["a"], ["a", "b"]);
  assert.equal(precision, 0.5);
  assert.equal(recall, 1);
});

test("precisionRecall: missing expected role lowers recall, not precision", () => {
  const { precision, recall } = precisionRecall(["a", "b"], ["a"]);
  assert.equal(precision, 1);
  assert.equal(recall, 0.5);
});

test("precisionRecall: both empty scores 1/1 rather than dividing by zero", () => {
  const { precision, recall } = precisionRecall([], []);
  assert.equal(precision, 1);
  assert.equal(recall, 1);
});

test("scoreScenario: composed result matching expect passes with no findings", () => {
  const scenario = {
    id: "fixture-a",
    expect: { state: "composed", mustIncludeRoles: ["strategist"], mustExcludeRoles: ["designer"], maxRoles: 1, sequence: ["strategist"], unsatisfiedNeeds: [] },
  };
  const result = { state: "composed", roles: [{ role: "strategist" }], sequence: ["strategist"], unsatisfiedNeeds: [] };
  const scored = scoreScenario(scenario, result);
  assert.equal(scored.passed, true);
  assert.deepEqual(scored.findings, []);
  assert.equal(scored.precision, 1);
  assert.equal(scored.recall, 1);
});

test("scoreScenario: missing expected role is a finding", () => {
  const scenario = { id: "fixture-b", expect: { state: "composed", mustIncludeRoles: ["strategist", "designer"], mustExcludeRoles: [] } };
  const result = { state: "composed", roles: [{ role: "strategist" }], sequence: ["strategist"], unsatisfiedNeeds: [] };
  const scored = scoreScenario(scenario, result);
  assert.equal(scored.passed, false);
  assert.ok(scored.findings.some((f) => f.rule === "composition-missing-expected-role"));
});

test("scoreScenario: excluded role present is a finding", () => {
  const scenario = { id: "fixture-c", expect: { state: "composed", mustIncludeRoles: ["strategist"], mustExcludeRoles: ["designer"] } };
  const result = { state: "composed", roles: [{ role: "strategist" }, { role: "designer" }], sequence: ["strategist", "designer"], unsatisfiedNeeds: [] };
  const scored = scoreScenario(scenario, result);
  assert.equal(scored.passed, false);
  assert.ok(scored.findings.some((f) => f.rule === "composition-unexpected-role"));
});

test("scoreScenario: unlisted extra role is a finding even when not in mustExcludeRoles", () => {
  const scenario = { id: "fixture-d", expect: { state: "composed", mustIncludeRoles: ["strategist"], mustExcludeRoles: [] } };
  const result = { state: "composed", roles: [{ role: "strategist" }, { role: "controller" }], sequence: ["strategist", "controller"], unsatisfiedNeeds: [] };
  const scored = scoreScenario(scenario, result);
  assert.equal(scored.passed, false);
  assert.ok(scored.findings.some((f) => f.rule === "composition-unaccounted-role"));
});

test("scoreScenario: sequence mismatch is a finding", () => {
  const scenario = { id: "fixture-e", expect: { state: "composed", mustIncludeRoles: ["a", "b"], mustExcludeRoles: [], sequence: ["a", "b"] } };
  const result = { state: "composed", roles: [{ role: "a" }, { role: "b" }], sequence: ["b", "a"], unsatisfiedNeeds: [] };
  const scored = scoreScenario(scenario, result);
  assert.equal(scored.passed, false);
  assert.ok(scored.findings.some((f) => f.rule === "composition-sequence-mismatch"));
});

test("scoreScenario: state mismatch short-circuits with one finding", () => {
  const scenario = { id: "fixture-f", expect: { state: "composed", mustIncludeRoles: ["a"], mustExcludeRoles: [] } };
  const result = { state: "indeterminate", reason: "unknown role: a" };
  const scored = scoreScenario(scenario, result);
  assert.equal(scored.passed, false);
  assert.equal(scored.findings.length, 1);
  assert.equal(scored.findings[0].rule, "composition-state-mismatch");
});

test("scoreScenario: indeterminate expectation checks the reason substring", () => {
  const scenario = { id: "fixture-g", expect: { state: "indeterminate", reasonIncludes: "unknown role" } };
  const passing = scoreScenario(scenario, { state: "indeterminate", reason: "unknown role: x" });
  assert.equal(passing.passed, true);
  const failing = scoreScenario(scenario, { state: "indeterminate", reason: "something else entirely" });
  assert.equal(failing.passed, false);
});

test("scoreScenario: over-cap cap/roleCount mismatches are findings", () => {
  const scenario = { id: "fixture-h", expect: { state: "over-cap", cap: 5, roleCount: 6, mustIncludeRoles: ["a"], mustExcludeRoles: [] } };
  const result = { state: "over-cap", cap: 4, roleCount: 7, roles: [{ role: "a" }], sequence: ["a"] };
  const scored = scoreScenario(scenario, result);
  assert.equal(scored.passed, false);
  assert.ok(scored.findings.some((f) => f.rule === "composition-cap-mismatch"));
  assert.ok(scored.findings.some((f) => f.rule === "composition-role-count-mismatch"));
});
