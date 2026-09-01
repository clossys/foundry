import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateV2PlanSha256, validateAggregateV2Closure, validateAggregateV2Plan, validateAggregateV2PlanHistory } from "./public-npm-aggregate-canary-v2.mjs";

const plan = JSON.parse(readFileSync("governance/public-npm-aggregate-canary-v2.json", "utf8"));
const read = (path) => readFileSync(path, "utf8");
const clone = (value) => structuredClone(value);

test("v2 plan closes all 19 source releases from immutable qualification evidence", () => {
  assert.deepEqual(validateAggregateV2Plan(plan, { read }), []);
  assert.equal(plan.sets[0].packages.length, 19);
  assert.equal(plan.optionalPeerMatrix.find((row) => row.packageKey === "designer").version, "0.2.7");
  assert.deepEqual(plan.peerResolution.disposition.find((row) => row.name === "react").requested, ["18.3.1", "19.2.8"]);
  assert.equal(plan.peerResolution.disposition.find((row) => row.name === "react").resolved, "19.2.8");
});

test("v2 never reads live package manifests for structural expectations", () => {
  assert.deepEqual(validateAggregateV2Plan(plan, { read: (path) => path.startsWith("packages/") ? (() => { throw new Error("live source read"); })() : read(path) }), []);
});

test("plan identity binds every field, including schema/kind/path", () => {
  const fields = ["schemaVersion", "kind", "registry", "peerResolution", "sets", "optionalPeerMatrix", "selectedEvidence"];
  const original = aggregateV2PlanSha256(plan);
  for (const field of fields) {
    const changed = clone(plan);
    if (typeof changed[field] === "number") changed[field]++;
    else if (typeof changed[field] === "string") changed[field] += "-changed";
    else if (Array.isArray(changed[field])) changed[field] = [...changed[field], { changed: true }];
    else changed[field] = { ...changed[field], changed: true };
    assert.notEqual(aggregateV2PlanSha256(changed), original, field);
  }
});

test("qualification-only versions cannot satisfy a current-release plan", () => {
  const changed = clone(plan);
  changed.sets[0].packages[1].version = "0.1.4";
  assert.ok(validateAggregateV2Plan(changed, { read }).some((item) => item.rule === "selected-evidence" || item.rule === "package-identity"));
});

test("React 18-only resolution is violated", () => {
  const changed = clone(plan);
  changed.peerResolution.disposition[0].resolved = "18.3.1";
  assert.ok(validateAggregateV2Plan(changed, { read }).some((item) => item.rule === "react-resolution"));
});

test("absent and malformed closures are fail-closed", () => {
  assert.equal(validateAggregateV2Closure(null, plan)[0].rule, "closure-indeterminate");
  assert.equal(validateAggregateV2Closure({}, plan)[0].rule, "closure-identity");
});

test("history rejects rewrites, deletes, renames, duplicates, and symlink-like records", () => {
  assert.deepEqual(validateAggregateV2PlanHistory({ history: [] }), []);
  assert.deepEqual(validateAggregateV2PlanHistory({ history: [{ status: "A", sha256: "a".repeat(64) }] }), []);
  for (const status of ["M", "D", "R", "C"]) assert.equal(validateAggregateV2PlanHistory({ history: [{ status, sha256: "a".repeat(64) }] })[0].rule, "plan-history");
  assert.equal(validateAggregateV2PlanHistory({ history: [{ status: "A", sha256: "a".repeat(64) }, { status: "A", sha256: "b".repeat(64) }] })[0].rule, "plan-history");
});
