import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  COLLECTORS,
  CONSENT_BASES,
  EVIDENCE_KINDS,
  WEIGHT_CLASSES,
  evaluateRealCustomerEvidenceContract,
  evaluateRealCustomerEvidenceRecord,
  computeRealEvidenceShare,
} from "./check-real-customer-evidence.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const contract = readJson(join(repoRoot, "docs/contracts/real-customer-evidence-contract.json"));
const lifecycle = readJson(join(repoRoot, "docs/contracts/lifecycle.json"));
const fixtureRecord = readJson(join(repoRoot, "docs/contracts/real-customer-evidence.fixture.json"));

function rules(result) {
  return result.findings.map((item) => item.rule);
}

test("the vocabularies stay finite and small", () => {
  assert.deepEqual(EVIDENCE_KINDS, ["interview", "support-thread", "call-summary", "survey-response", "usage-signal"]);
  assert.deepEqual(COLLECTORS, ["coding-agent", "human"]);
  assert.deepEqual(CONSENT_BASES, ["explicit-recorded-consent", "existing-support-relationship-terms", "anonymized-aggregate-no-consent-required"]);
  assert.deepEqual(WEIGHT_CLASSES, ["primary", "corroborating", "context-only"]);
});

test("the contract declares no local copy of the shared lifecycle vocabulary", () => {
  assert.equal(contract.lifecycleStates, undefined);
  assert.equal(contract.conditions, undefined);
  assert.ok(Array.isArray(lifecycle.states) && lifecycle.states.length > 0);
});

test("the repository contract passes against the shared lifecycle", () => {
  const result = evaluateRealCustomerEvidenceContract({ contract, lifecycle });
  assert.deepEqual(rules(result), []);
});

test("a contract missing the shared lifecycle document is indeterminate, not silently valid", () => {
  const result = evaluateRealCustomerEvidenceContract({ contract, lifecycle: {} });
  assert.deepEqual(rules(result), ["unreadable-shared-lifecycle"]);
});

test("a contract whose lifecycleTransitions omits a shared state is a finding", () => {
  const broken = structuredClone(contract);
  delete broken.lifecycleTransitions.retired;
  const result = evaluateRealCustomerEvidenceContract({ contract: broken, lifecycle });
  assert.ok(rules(result).includes("lifecycle-transitions-mismatch"));
});

test("the shipped fixture record is satisfied", () => {
  const result = evaluateRealCustomerEvidenceRecord({ record: fixtureRecord, contract, lifecycle });
  assert.equal(result.verdict, "satisfied");
  assert.deepEqual(result.findings, []);
});

test("a record is indeterminate when its top-level shape is unusable", () => {
  const result = evaluateRealCustomerEvidenceRecord({ record: { not: "a record" }, contract, lifecycle });
  assert.equal(result.verdict, "indeterminate");
});

test("a forbidden personal-data field name anywhere in the record is a finding, not silently accepted", () => {
  const withPii = structuredClone(fixtureRecord);
  withPii.source.email = "someone@example.com";
  const result = evaluateRealCustomerEvidenceRecord({ record: withPii, contract, lifecycle });
  assert.notEqual(result.verdict, "satisfied");
  assert.ok(rules(result).includes("forbidden-personal-data-field"));
});

test("an email-shaped value inside an otherwise legal field is caught lexically", () => {
  const leaked = structuredClone(fixtureRecord);
  leaked.summary = "Reach the client at someone@example.com for follow-up.";
  const result = evaluateRealCustomerEvidenceRecord({ record: leaked, contract, lifecycle });
  assert.equal(result.verdict, "violated");
  assert.ok(rules(result).includes("personal-data-shaped-value"));
  assert.ok(!result.findings.some((item) => item.fatal));
});

test("a phone-number-shaped value is caught lexically", () => {
  const leaked = structuredClone(fixtureRecord);
  leaked.summary = "Call them back at 555-867-5309 to confirm.";
  const result = evaluateRealCustomerEvidenceRecord({ record: leaked, contract, lifecycle });
  assert.equal(result.verdict, "violated");
  assert.ok(rules(result).includes("personal-data-shaped-value"));
});

test("retention.holder must be keeper, never the citing role", () => {
  const wrongHolder = structuredClone(fixtureRecord);
  wrongHolder.retention.holder = "strategist";
  const result = evaluateRealCustomerEvidenceRecord({ record: wrongHolder, contract, lifecycle });
  assert.equal(result.verdict, "violated");
  assert.ok(rules(result).includes("invalid-retention-holder"));
});

test("a retired record needs a nonempty reason", () => {
  const retired = structuredClone(fixtureRecord);
  retired.lifecycle.state = "retired";
  retired.lifecycle.reason = "";
  const result = evaluateRealCustomerEvidenceRecord({ record: retired, contract, lifecycle });
  assert.ok(rules(result).includes("missing-lifecycle-reason"));
});

test("a blocked condition needs a nonempty reason even in an earlier state", () => {
  const blocked = structuredClone(fixtureRecord);
  blocked.lifecycle.state = "draft";
  blocked.lifecycle.condition = "blocked";
  blocked.lifecycle.reason = "";
  blocked.weighting.calibrationNote = "";
  const result = evaluateRealCustomerEvidenceRecord({ record: blocked, contract, lifecycle });
  assert.ok(rules(result).includes("missing-lifecycle-reason"));
});

test("a draft record may not yet carry a calibration note", () => {
  const draft = structuredClone(fixtureRecord);
  draft.lifecycle.state = "draft";
  const result = evaluateRealCustomerEvidenceRecord({ record: draft, contract, lifecycle });
  assert.ok(rules(result).includes("premature-calibration-note"));
});

test("an approved record without a calibration note is a finding", () => {
  const approved = structuredClone(fixtureRecord);
  approved.lifecycle.state = "approved";
  approved.weighting.calibrationNote = "";
  const result = evaluateRealCustomerEvidenceRecord({ record: approved, contract, lifecycle });
  assert.ok(rules(result).includes("missing-calibration-note"));
});

test("computeRealEvidenceShare treats context-only evidence as not counted toward the real share", () => {
  const contextOnly = structuredClone(fixtureRecord);
  contextOnly.weighting.weightClass = "context-only";
  const share = computeRealEvidenceShare({ records: [contextOnly], claimId: "claim-onboarding-first-pr-is-findable" });
  assert.equal(share.realShare, 0);
  assert.equal(share.calibratedBy, "synthetic-only");
});

test("computeRealEvidenceShare counts a current, judged, weighted record toward the real share", () => {
  const share = computeRealEvidenceShare({ records: [fixtureRecord], claimId: "claim-onboarding-first-pr-is-findable" });
  assert.equal(share.realShare, 1);
  assert.equal(share.calibratedBy, "real-and-synthetic");
});

test("computeRealEvidenceShare reports synthetic-only when no record applies to the claim", () => {
  const share = computeRealEvidenceShare({ records: [fixtureRecord], claimId: "claim-nothing-cites-this" });
  assert.equal(share.citedRecordCount, 0);
  assert.equal(share.calibratedBy, "synthetic-only");
});
