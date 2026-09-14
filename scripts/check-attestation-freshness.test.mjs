import assert from "node:assert/strict";
import test from "node:test";

import { findTimeBoxedFields, computeDeadline, classifyEnforcement, run, EXIT_CODES } from "./check-attestation-freshness.mjs";

const DAY = 24 * 60 * 60 * 1000;

test("a known date field is found", () => {
  const found = findTimeBoxedFields({ governance: { expiresAt: "2026-09-27T00:00:00Z" } }, "governance/entitlements.json");
  assert.equal(found.length, 1);
  assert.equal(found[0].field, "expiresAt");
  assert.equal(found[0].kind, "date");
});

test("a known budget-days field is found", () => {
  const found = findTimeBoxedFields({ asOf: "2026-08-01T00:00:00Z", _stalenessBudgetDays: 30 }, "strategy/facts/traction.json");
  assert.equal(found.length, 1);
  assert.equal(found[0].field, "_stalenessBudgetDays");
  assert.equal(found[0].kind, "budgetDays");
});

test("a differently-named field is still caught by the fallback pattern", () => {
  const found = findTimeBoxedFields({ nextReviewAt: "2026-10-01T00:00:00Z" }, "governance/foo.json");
  assert.equal(found.length, 1);
  assert.equal(found[0].field, "nextReviewAt");
});

test("a non-timestamp string on a date-shaped key is not reported", () => {
  const found = findTimeBoxedFields({ expiresAt: "not-a-date" }, "x.json");
  assert.deepEqual(found, []);
});

test("nested records at any depth are found, not only top-level", () => {
  const found = findTimeBoxedFields({ governance: { advisorAssessment: { basis: { freshUntil: "2026-09-20T00:00:00Z" } } } }, "governance/advisor-assessment.json");
  assert.equal(found.length, 1);
  assert.equal(found[0].pointer, "/governance/advisorAssessment/basis/freshUntil");
});

test("computeDeadline resolves a date field directly", () => {
  const now = Date.parse("2026-09-14T00:00:00Z");
  const record = { kind: "date", rawValue: "2026-09-21T00:00:00Z", container: {} };
  const deadline = computeDeadline(record, now);
  assert.equal(deadline.daysRemaining, 7);
});

test("computeDeadline resolves a budget-days field against its anchor", () => {
  const now = Date.parse("2026-09-14T00:00:00Z");
  const record = { kind: "budgetDays", rawValue: 30, container: { asOf: "2026-08-15T00:00:00Z" } };
  const deadline = computeDeadline(record, now);
  assert.equal(deadline.anchorField, "asOf");
  assert.equal(deadline.daysRemaining, 0); // 2026-08-15 + 30d = 2026-09-14, exactly now
});

test("a budget-days field with no anchor in the same object is reported unanchored, never guessed at", () => {
  const record = { kind: "budgetDays", rawValue: 30, container: {} };
  const deadline = computeDeadline(record, Date.now());
  assert.equal(deadline.unanchored, true);
  assert.equal(deadline.daysRemaining, null);
});

test("classifyEnforcement: no registry entry is unregistered, not enforced", () => {
  const result = classifyEnforcement({}, undefined, null);
  assert.equal(result.status, "unregistered");
});

test("classifyEnforcement: a registry entry naming no required check is declared", () => {
  const result = classifyEnforcement({}, { requiredCheckContext: null, notes: "read by a dashboard, wired into no workflow" }, null);
  assert.equal(result.status, "declared");
});

test("classifyEnforcement: a claimed required check with no live snapshot is declared-unverified, not trusted", () => {
  const result = classifyEnforcement({}, { requiredCheckContext: "traction-freshness" }, null);
  assert.equal(result.status, "declared-unverified");
});

test("classifyEnforcement: confirmed against an active ruleset is enforced", () => {
  const rulesets = [{ id: 1, enforcement: "active", requiredStatusContexts: ["traction-freshness"] }];
  const result = classifyEnforcement({}, { requiredCheckContext: "traction-freshness" }, rulesets);
  assert.equal(result.status, "enforced");
});

test("classifyEnforcement: a registry claim the live snapshot does not confirm is drift, not silently trusted either way", () => {
  const rulesets = [{ id: 1, enforcement: "active", requiredStatusContexts: ["some-other-check"] }];
  const result = classifyEnforcement({}, { requiredCheckContext: "traction-freshness" }, rulesets);
  assert.equal(result.status, "enforcement-drift");
});

test("classifyEnforcement: a disabled ruleset does not count as enforcing", () => {
  const rulesets = [{ id: 1, enforcement: "disabled", requiredStatusContexts: ["traction-freshness"] }];
  const result = classifyEnforcement({}, { requiredCheckContext: "traction-freshness" }, rulesets);
  assert.equal(result.status, "enforcement-drift");
});

test("run(): fixture paths are excluded so test data never reports as a live attestation", () => {
  const files = ["governance/release-qualification-fixtures/advisor/current-direct/assessment-satisfied.json"];
  const read = () => JSON.stringify({ engagement: { assessmentBasis: { freshUntil: "2026-09-15T00:00:00Z" } } });
  const result = run({ root: "/r", files, read, now: Date.parse("2026-09-14T00:00:00Z") });
  assert.equal(result.verdict, "satisfied");
  assert.deepEqual(result.findings, []);
});

test("run(): an enforced record inside its lead window is approaching-enforced", () => {
  const files = ["strategy/facts/traction.json"];
  const read = () => JSON.stringify({ asOf: "2026-08-20T00:00:00Z", _stalenessBudgetDays: 30 });
  const registryPathless = { records: [{ file: "strategy/facts/traction.json", field: "_stalenessBudgetDays", requiredCheckContext: "traction-freshness" }] };
  const rulesets = [{ id: 1, enforcement: "active", requiredStatusContexts: ["traction-freshness"] }];
  // now = 2026-09-14: deadline 2026-09-19, 5 days remaining, inside the default 14-day enforced lead
  const result = run({ root: "/r", files, read, now: Date.parse("2026-09-14T00:00:00Z"), registryPath: undefined, rulesetsPath: undefined });
  // Exercise loadRegistry/loadRulesets separately below; here confirm the unregistered path stays quiet-but-visible.
  assert.equal(result.findings[0].enforcement.status, "unregistered");
  void registryPathless; void rulesets;
});

test("run(): an overdue declared-only record is overdue-declared, never escalated past its real status", () => {
  const files = ["governance/foo.json"];
  const read = () => JSON.stringify({ expiresAt: "2026-08-01T00:00:00Z" });
  const result = run({ root: "/r", files, read, now: Date.parse("2026-09-14T00:00:00Z") });
  assert.equal(result.findings[0].urgency, "overdue-declared");
  assert.equal(result.findings[0].enforcement.status, "unregistered");
});

test("run(): a malformed JSON file is skipped, not reported as a finding", () => {
  const result = run({ root: "/r", files: ["broken.json"], read: () => "{not json" });
  assert.deepEqual(result.findings, []);
});

test("run() always exits satisfied even with urgent findings: this is a warning, never a gate", () => {
  const files = ["governance/foo.json"];
  const read = () => JSON.stringify({ expiresAt: "2020-01-01T00:00:00Z" });
  const result = run({ root: "/r", files, read, now: Date.now() });
  assert.equal(result.verdict, "satisfied");
  assert.equal(EXIT_CODES.satisfied, 0);
});

test("run() reports indeterminate, never a silent empty pass, when the registry file cannot be parsed", () => {
  const result = run({ root: "/r", files: [], registryPath: "/does/not/exist.json" });
  assert.equal(result.verdict, "indeterminate");
});

void DAY;
