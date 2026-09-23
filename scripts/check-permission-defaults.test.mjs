import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  TIERS,
  RETIRED_CLIENT_FACING_WORDS,
  evaluatePermissionDefaultsContract,
  evaluatePermissionDefaultsRecord,
  evaluateClientFacingText,
} from "./check-permission-defaults.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const contract = readJson(join(repoRoot, "docs/contracts/permission-defaults-contract.json"));
const fixtureRecord = readJson(join(repoRoot, "docs/contracts/permission-defaults.fixture.json"));
const trustStatementText = readFileSync(join(repoRoot, "docs/contracts/trust-statement.md"), "utf8");

function rules(result) {
  return result.findings.map((item) => item.rule);
}

test("the tier vocabulary is exactly three words", () => {
  assert.deepEqual(TIERS, ["unasked", "approval", "never"]);
});

test("the repository contract passes", () => {
  const result = evaluatePermissionDefaultsContract({ contract });
  assert.deepEqual(rules(result), []);
});

test("every alwaysHumanCapabilityId is also a requiredCapabilityId", () => {
  const requiredIds = new Set(contract.requiredCapabilityIds);
  for (const id of contract.alwaysHumanCapabilityIds) assert.ok(requiredIds.has(id), `${id} must be required`);
});

test("the shipped fixture record is satisfied", () => {
  const result = evaluatePermissionDefaultsRecord({ record: fixtureRecord, contract });
  assert.equal(result.verdict, "satisfied");
  assert.deepEqual(result.findings, []);
});

test("a record is indeterminate when its top-level shape is unusable", () => {
  const result = evaluatePermissionDefaultsRecord({ record: { not: "a record" }, contract });
  assert.equal(result.verdict, "indeterminate");
});

test("a record missing a required capability id is violated", () => {
  const missing = structuredClone(fixtureRecord);
  missing.capabilities = missing.capabilities.filter((item) => item.id !== "merge-a-pull-request");
  const result = evaluatePermissionDefaultsRecord({ record: missing, contract });
  assert.equal(result.verdict, "violated");
  assert.ok(rules(result).includes("missing-required-capability"));
});

test("declaring an always-human capability as unasked is violated", () => {
  const relaxed = structuredClone(fixtureRecord);
  const credentials = relaxed.capabilities.find((item) => item.id === "handle-or-store-credentials-or-secrets");
  credentials.tier = "unasked";
  const result = evaluatePermissionDefaultsRecord({ record: relaxed, contract });
  assert.equal(result.verdict, "violated");
  assert.ok(rules(result).includes("always-human-capability-set-unasked"));
});

test("declaring an always-human capability as approval (not unasked) is fine", () => {
  const relaxed = structuredClone(fixtureRecord);
  const purchase = relaxed.capabilities.find((item) => item.id === "spend-money-or-authorize-a-purchase");
  purchase.tier = "approval";
  const result = evaluatePermissionDefaultsRecord({ record: relaxed, contract });
  assert.equal(result.verdict, "satisfied");
});

test("a capability with no rationale is a finding", () => {
  const bare = structuredClone(fixtureRecord);
  bare.capabilities[0].rationale = "";
  const result = evaluatePermissionDefaultsRecord({ record: bare, contract });
  assert.ok(rules(result).includes("missing-capability-rationale"));
});

test("a duplicate capability id is a finding", () => {
  const duplicated = structuredClone(fixtureRecord);
  duplicated.capabilities.push(structuredClone(duplicated.capabilities[0]));
  const result = evaluatePermissionDefaultsRecord({ record: duplicated, contract });
  assert.ok(rules(result).includes("duplicate-capability-id"));
});

test("an unknown tier value is a finding", () => {
  const badTier = structuredClone(fixtureRecord);
  badTier.capabilities[0].tier = "sometimes";
  const result = evaluatePermissionDefaultsRecord({ record: badTier, contract });
  assert.ok(rules(result).includes("invalid-capability-tier"));
});

test("the shipped trust statement's body uses no retired client-facing vocabulary", () => {
  const result = evaluateClientFacingText({ text: trustStatementText, label: "docs/contracts/trust-statement.md" });
  assert.deepEqual(result.findings, []);
});

test("a maintainer-only HTML comment mentioning the retired words is not itself a finding", () => {
  assert.ok(/<!--[\s\S]*Foundry[\s\S]*-->/.test(trustStatementText), "fixture assumption: the file's own HTML comment mentions Foundry");
});

test("Foundry in client-facing body text is a finding", () => {
  const result = evaluateClientFacingText({ text: "Welcome to Foundry, home of your team.", label: "fixture" });
  assert.deepEqual(rules(result), ["retired-client-facing-word"]);
});

test("retired vocabulary (voices) in client-facing body text is a finding", () => {
  const result = evaluateClientFacingText({ text: "Read what the customer voices say.", label: "fixture" });
  assert.deepEqual(rules(result), ["retired-client-facing-word"]);
});

test("Clossys and roles are fine", () => {
  const result = evaluateClientFacingText({ text: "Your Clossys team is made of roles.", label: "fixture" });
  assert.deepEqual(result.findings, []);
});

test("RETIRED_CLIENT_FACING_WORDS is Foundry and voices", () => {
  assert.deepEqual(RETIRED_CLIENT_FACING_WORDS, ["Foundry", "voices"]);
});
