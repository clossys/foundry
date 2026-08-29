import assert from "node:assert/strict";
import test from "node:test";
import { selectPolicyPackage, validateReleaseQualificationContract } from "./release-qualification-contract.mjs";
const adapter = { schemaVersion: 1, package: "@example/x", archetype: "current-direct", bins: { check: 0 }, fixtures: ["a.json", "b.json", "c.json"], cases: [{ id: "green", bin: "check", fixtureArgs: ["a.json"], exitCode: 0, group: "g" }, { id: "red", bin: "check", fixtureArgs: ["b.json"], exitCode: 1, group: "g" }, { id: "unknown", bin: "check", fixtureArgs: ["c.json"], exitCode: 2, group: "g" }], dimensionEvidence: { rollback: "restoration", duplicate: "g" } };
const entry = { packageKey: "x", recordStem: "x", packageDir: "packages/x", adapterPath: "governance/release-qualification-adapters/x/current-direct.json", fixturePath: "governance/release-qualification-fixtures/x/current-direct", archetypes: { "current-direct": { status: "required" }, "prior-minor": { status: "unsupported", reason: "none" }, "oldest-supported": { status: "unsupported", reason: "none" }, "control-plane": { status: "unsupported", reason: "none" } }, dimensions: { position: { status: "unsupported", reason: "none" }, completion: { status: "unsupported", reason: "none" }, rollback: { status: "required" }, duplicate: { status: "required" }, cadence: { status: "unsupported", reason: "none" }, closeWindow: { status: "unsupported", reason: "none" } } };
const policy = { schemaVersion: 1, protocol: "foundry-candidate-qualification-v1", packages: { "@example/x": entry } };
const input = () => ({ policy: structuredClone(policy), adapter: structuredClone(adapter), fixtures: Object.fromEntries(adapter.fixtures.map((name) => [name, { type: "file", symlink: false, tracked: true, size: 2 }])), manifestBins: { check: "dist/check.js" }, peerDependencies: { typescript: "~6.0.0", required: "^1.0.0" }, peerDependenciesMeta: { typescript: { optional: true } } });
test("accepts closed required policy and fixed adapter", () => assert.deepEqual(validateReleaseQualificationContract(input()), []));
test("accepts only data-bound literal, file, directory, and temporary consumer overlay operations", () => {
  const value = input();
  value.adapter.fixtures = ["request.json", "snapshot/snapshot.json", "overlay/package.json"];
  value.fixtures = Object.fromEntries(value.adapter.fixtures.map((name) => [name, { type: "file", symlink: false, tracked: true, size: 2 }]));
  value.adapter.consumerOverlay = [{ fixture: "overlay/package.json", target: "package.json" }];
  value.adapter.cases = [
    { id: "green", bin: "check", args: [{ literal: "decide" }, { fixture: "request.json" }, { fixtureDirectory: "snapshot" }], exitCode: 0, group: "g" },
    { id: "red", bin: "check", args: [{ fixture: "request.json" }], exitCode: 1, group: "g" },
    { id: "unknown", bin: "check", args: [{ fixture: "request.json" }], exitCode: 2, group: "g" },
  ];
  assert.deepEqual(validateReleaseQualificationContract(value), []);
  for (const mutate of [
    (copy) => { copy.adapter.cases[0].args[0] = { literal: "$(command)" }; },
    (copy) => { copy.adapter.cases[0].args[2] = { fixtureDirectory: "missing" }; },
    (copy) => { copy.adapter.consumerOverlay[0].target = "../package.json"; },
    (copy) => { copy.adapter.consumerOverlay[0].target = "node_modules/@example/x/package.json"; },
  ]) {
    const red = structuredClone(value); mutate(red);
    assert.ok(validateReleaseQualificationContract(red).some((item) => ["case", "consumer-overlay"].includes(item.rule)));
  }
});
test("rejects waivers, forbidden fields, unsafe fixtures, unknown bins, and missing controls", () => { const value = input(); value.policy.packages["@example/x"].archetypes["current-direct"] = { status: "unsupported", reason: "no" }; value.adapter.command = "sh"; value.adapter.fixtures[0] = "../a.json"; value.adapter.cases.pop(); value.adapter.bins.unknown = 0; const rules = validateReleaseQualificationContract(value).map((x) => x.rule); for (const rule of ["archetype-policy", "forbidden-field", "fixture", "bin", "exit-coverage"]) assert.ok(rules.includes(rule)); });
test("allows only exact compatible optional peers", () => {
  const green = input(); green.adapter.peerInstall = { typescript: "6.0.3" };
  assert.deepEqual(validateReleaseQualificationContract(green), []);
  for (const peerInstall of [{ typescript: "6.1.0" }, { typescript: "6.0" }, { unknown: "1.0.0" }, { required: "1.0.0" }]) {
    const red = input(); red.adapter.peerInstall = peerInstall;
    assert.ok(validateReleaseQualificationContract(red).some((item) => item.rule === "peer-install"));
  }
});
test("policy package bindings are unique while same leaf scoped packages remain distinct", () => {
  const value = input();
  const second = structuredClone(entry);
  second.packageKey = "other-controller"; second.recordStem = "other-controller"; second.packageDir = "packages/other-controller";
  second.adapterPath = "governance/release-qualification-adapters/other-controller/current-direct.json";
  second.fixturePath = "governance/release-qualification-fixtures/other-controller/current-direct";
  value.policy.packages["@other/controller"] = second;
  assert.deepEqual(validateReleaseQualificationContract(value), []);
  assert.equal(selectPolicyPackage(value.policy, "other-controller").name, "@other/controller");
  second.packageKey = "x";
  assert.ok(validateReleaseQualificationContract(value).some((item) => item.rule === "package-policy-unique"));
});
