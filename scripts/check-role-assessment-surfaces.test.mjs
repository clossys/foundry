// Regression tests for check-role-assessment-surfaces.mjs.
//
// Fixture cases plant a declaration that must be caught, or an absence that
// must stay visible, and assert the gate does not quietly pass it. The live
// tree case is the positive control: Advisor must currently declare a mapped
// surface, or the first-wave engagement gate is a counted gap again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRoleAssessmentSurfaces } from "./check-role-assessment-surfaces.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-role-assessment-surfaces.mjs");

const ROLES = ["@scope/alpha", "@scope/beta"];
function manifests(entries) { return new Map(entries.map((manifest) => [manifest.name, manifest])); }

test("a coherent declaration passes and is reported as declared", () => {
  const result = evaluateRoleAssessmentSurfaces(ROLES, manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "dist/cli.js" }, foundry: { assessment: { bin: "alpha-check", invocation: "single-json-input" } } },
    { name: "@scope/beta", bin: { "beta-check": "dist/cli.js" } },
  ]));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.declared.map((item) => item.role), ["@scope/alpha"]);
  assert.deepEqual(result.undeclared.map((item) => item.role), ["@scope/beta"]);
});

test("a declaration naming a bin the manifest does not map is a finding, not a silent absence", () => {
  const result = evaluateRoleAssessmentSurfaces(ROLES, manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "dist/cli.js" }, foundry: { assessment: { bin: "alpha-assess", invocation: "single-json-input" } } },
    { name: "@scope/beta", bin: {} },
  ]));
  assert.deepEqual(result.findings.map((item) => item.rule), ["undeclared-assessment-bin"]);
  assert.deepEqual(result.declared, []);
});

test("a declaration with an unimplemented invocation kind is a finding", () => {
  const result = evaluateRoleAssessmentSurfaces(["@scope/alpha"], manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "dist/cli.js" }, foundry: { assessment: { bin: "alpha-check", invocation: "interactive-session" } } },
  ]));
  assert.deepEqual(result.findings.map((item) => item.rule), ["invalid-assessment-declaration"]);
});

test("a declaration that is not an object is a finding", () => {
  const result = evaluateRoleAssessmentSurfaces(["@scope/alpha"], manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "dist/cli.js" }, foundry: { assessment: "advisor-check" } },
  ]));
  assert.deepEqual(result.findings.map((item) => item.rule), ["invalid-assessment-declaration"]);
});

test("a bin target that escapes the package directory is a finding", () => {
  const result = evaluateRoleAssessmentSurfaces(["@scope/alpha"], manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "../../elsewhere/cli.js" }, foundry: { assessment: { bin: "alpha-check", invocation: "single-json-input" } } },
  ]));
  assert.deepEqual(result.findings.map((item) => item.rule), ["escaping-assessment-bin"]);
});

test("an absolute bin target is a finding", () => {
  const result = evaluateRoleAssessmentSurfaces(["@scope/alpha"], manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "/usr/local/bin/alpha" }, foundry: { assessment: { bin: "alpha-check", invocation: "single-json-input" } } },
  ]));
  assert.deepEqual(result.findings.map((item) => item.rule), ["escaping-assessment-bin"]);
});

test("a role with no shipped package stays visible as undeclared rather than disappearing", () => {
  const result = evaluateRoleAssessmentSurfaces(["@scope/alpha", "@scope/missing"], manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "dist/cli.js" }, foundry: { assessment: { bin: "alpha-check", invocation: "single-json-input" } } },
  ]));
  assert.deepEqual(result.undeclared.map((item) => item.role), ["@scope/missing"]);
  assert.deepEqual(result.findings, []);
});

test("a required role with no foundry.assessment declaration is a finding, not a counted absence", () => {
  const result = evaluateRoleAssessmentSurfaces(ROLES, manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "dist/cli.js" } },
    { name: "@scope/beta", bin: { "beta-check": "dist/cli.js" } },
  ]), ["@scope/alpha"]);
  assert.deepEqual(result.findings.map((item) => item.rule), ["required-assessment-undeclared"]);
  assert.deepEqual(result.findings.map((item) => item.role), ["@scope/alpha"]);
  assert.deepEqual(result.undeclared.map((item) => item.role), ["@scope/beta"]);
  assert.deepEqual(result.declared, []);
});

test("a required role with no shipped package is a finding, not a silent undeclared row", () => {
  const result = evaluateRoleAssessmentSurfaces(["@scope/alpha", "@scope/missing"], manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "dist/cli.js" }, foundry: { assessment: { bin: "alpha-check", invocation: "single-json-input" } } },
  ]), ["@scope/missing"]);
  assert.deepEqual(result.findings.map((item) => item.rule), ["required-assessment-undeclared"]);
  assert.deepEqual(result.findings.map((item) => item.role), ["@scope/missing"]);
  assert.deepEqual(result.undeclared, []);
});

test("a required role that declares a mapped bin is declared, not a finding", () => {
  const result = evaluateRoleAssessmentSurfaces(ROLES, manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "dist/cli.js" }, foundry: { assessment: { bin: "alpha-check", invocation: "single-json-input" } } },
    { name: "@scope/beta", bin: { "beta-check": "dist/cli.js" } },
  ]), ["@scope/alpha"]);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.declared.map((item) => item.role), ["@scope/alpha"]);
  assert.deepEqual(result.undeclared.map((item) => item.role), ["@scope/beta"]);
});

test("every active role appears in exactly one of declared, undeclared or findings", () => {
  const roles = ["@scope/alpha", "@scope/beta", "@scope/gamma"];
  const result = evaluateRoleAssessmentSurfaces(roles, manifests([
    { name: "@scope/alpha", bin: { "alpha-check": "dist/cli.js" }, foundry: { assessment: { bin: "alpha-check", invocation: "single-json-input" } } },
    { name: "@scope/beta", bin: { "beta-check": "dist/cli.js" }, foundry: { assessment: { bin: "nope", invocation: "single-json-input" } } },
    { name: "@scope/gamma", bin: { "gamma-check": "dist/cli.js" } },
  ]), ["@scope/gamma"]);
  const seen = [...result.declared, ...result.undeclared, ...result.findings].map((item) => item.role).sort();
  assert.deepEqual(seen, roles);
  assert.equal(result.undeclared.length, 0);
  assert.deepEqual(result.findings.map((item) => item.rule).sort(), ["required-assessment-undeclared", "undeclared-assessment-bin"]);
});

test("the live Advisor package declares a mapped assessment surface and the gate passes", () => {
  const run = spawnSync(process.execPath, [script, "--json", repoRoot], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  const scope = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8")).scope;
  assert.equal(typeof scope, "string");
  const advisor = result.declared.find((item) => item.role === `${scope}/advisor`);
  assert.deepEqual(advisor, {
    role: `${scope}/advisor`,
    bin: "advisor-check",
    invocation: "single-json-input",
    target: "dist/cli.js",
  });
  assert.equal(result.findings.length, 0);
});
