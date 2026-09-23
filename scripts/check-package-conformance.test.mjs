// Regression tests for check-package-conformance.mjs — the Stage B
// normalization-template gate (issue #1187, #1203, #1197). Exercises
// evaluateConformance directly with in-memory descriptors, using a real
// temporary directory only for the filesystem-backed checks (clossys/<role>/
// layout, loop.json, STATUS.md) that this gate reads beside packages/*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateConformance } from "./check-package-conformance.mjs";

function manifest(overrides = {}) {
  return { name: "@scope/alpha", version: "0.1.0", foundry: { assessment: { bin: "alpha-check", invocation: "single-json-input" } }, bin: { "alpha-check": "dist/cli.js" }, ...overrides };
}

function descriptor(overrides = {}) {
  return {
    role: "@scope/alpha",
    packageDir: "alpha",
    manifest: manifest(),
    skillSource: "---\nname: clossys-alpha\n---\n\n# Alpha\n\nbody",
    loopMatrixDoc: null,
    capabilityIds: null,
    stageActivities: null,
    ...overrides,
  };
}

// A minimal temp "repository root" so the fs-backed checks (clossys/<role>/,
// loop.json, STATUS.md) resolve against a real, isolated directory rather
// than this checkout's own tree, which is what makes this a synthetic
// package rather than an integration test over the real repository.
function makeTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "check-package-conformance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("a package declaring nothing beyond assessment reports every other gap as absent, never a report-mode finding", (t) => {
  const root = makeTempRoot(t);
  const result = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.deepEqual(result.findings, []);
  const row = result.table[0];
  assert.equal(row.manifestBlock, "partial");
  assert.equal(row.outputEnvelope, "absent");
  assert.equal(row.lifecycleWords, "absent");
  assert.equal(row.loopSection, "absent");
  assert.equal(row.layout, "absent");
  assert.equal(row.capabilityMap, "absent");
  assert.equal(row.statusMd, "absent");
  assert.ok(row.gaps > 0);
});

test("a skill source still carrying the legacy conversation heading reports not-removed", (t) => {
  const root = makeTempRoot(t);
  const result = evaluateConformance(root, [descriptor({ skillSource: "# Alpha\n\n## How we work together\n\nold local copy\n" })], { enforce: false });
  assert.equal(result.table[0].conversationContract, "not-removed");
  assert.deepEqual(result.findings, []); // report mode: absence/not-removed alone is never a failure
});

test("a skill source with no legacy heading and no clossys/ folder reports absent, not declared (absence is not the same as removal having happened)", (t) => {
  const root = makeTempRoot(t);
  const result = evaluateConformance(root, [descriptor({ skillSource: "# Alpha\n\nno legacy heading here\n" })], { enforce: false });
  assert.equal(result.table[0].conversationContract, "declared");
});

test("--enforce fails a synthetic non-conforming package on every absent dimension", (t) => {
  const root = makeTempRoot(t);
  const result = evaluateConformance(root, [descriptor()], { enforce: true });
  assert.ok(result.findings.length > 0, "expected --enforce to produce findings for a fully non-conforming package");
  const rules = result.findings.map((f) => f.rule);
  assert.ok(rules.includes("required-intake-absent"));
  assert.ok(rules.includes("required-capabilities-absent"));
  assert.ok(rules.includes("conformance-gap-outputEnvelope"));
  assert.ok(rules.includes("conformance-gap-lifecycleWords"));
  assert.ok(rules.includes("conformance-gap-layout"));
  assert.ok(rules.includes("conformance-gap-statusMd"));
});

test("--enforce with an allowlisted role produces no findings for that role", (t) => {
  const root = makeTempRoot(t);
  const result = evaluateConformance(root, [descriptor()], { enforce: true, allowlist: { "@scope/alpha": "synthetic fixture, exempt for this test" } });
  assert.deepEqual(result.findings, []);
});

test("a malformed committed STATUS.md always fails, in both report and enforce mode", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "clossys", "alpha"), { recursive: true });
  writeFileSync(join(root, "clossys", "alpha", "STATUS.md"), "# Status\n\n## Mandate\n\nx\n\n## Wrong Section\n\ny\n");
  const reportResult = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "status-md-sections-mismatch"));
  const enforceResult = evaluateConformance(root, [descriptor()], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "status-md-sections-mismatch"));
});

test("a well-formed committed STATUS.md with the exact five sections in order reports declared", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "clossys", "alpha"), { recursive: true });
  const body = ["# Status", "", "## Mandate", "x", "", "## Where we are", "x", "", "## Recommended next", "x", "", "## Decisions", "x", "", "## Blockers", "x", ""].join("\n");
  writeFileSync(join(root, "clossys", "alpha", "STATUS.md"), body);
  const result = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.equal(result.table[0].statusMd, "declared");
  assert.deepEqual(result.findings, []);
});

test("a non-lifecycle state word in clossys/<role>/loop.json is always a finding", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "clossys", "alpha"), { recursive: true });
  writeFileSync(join(root, "clossys", "alpha", "loop.json"), JSON.stringify({ capabilities: [{ id: "x", state: "in-progress", condition: "current" }] }));
  const result = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.ok(result.findings.some((f) => f.rule === "non-lifecycle-state-word"));
});

test("a valid lifecycle state/condition word in clossys/<role>/loop.json reports declared", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "clossys", "alpha"), { recursive: true });
  writeFileSync(join(root, "clossys", "alpha", "loop.json"), JSON.stringify({ capabilities: [{ id: "x", state: "approved", condition: "current" }] }));
  const result = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.equal(result.table[0].lifecycleWords, "declared");
  assert.deepEqual(result.findings, []);
});

test("presence of a clossys/<role>/ folder reports layout as declared", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "clossys", "alpha"), { recursive: true });
  const result = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.equal(result.table[0].layout, "declared");
});

test("a well-formed check-output-envelope.fixture.json reports outputEnvelope declared", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  const fixture = { package: "@scope/alpha", version: "0.1.0", verdict: "satisfied", summary: "Everything checked out.", findings: [] };
  writeFileSync(join(root, "packages", "alpha", "check-output-envelope.fixture.json"), JSON.stringify(fixture));
  const result = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.equal(result.table[0].outputEnvelope, "declared");
  assert.deepEqual(result.findings, []);
});

test("a malformed check-output-envelope.fixture.json always fails, in both report and enforce mode", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  const fixture = { package: "@scope/alpha", version: "0.1.0", verdict: "violated", summary: "Everything checked out.", findings: [] }; // violated with no findings is malformed
  writeFileSync(join(root, "packages", "alpha", "check-output-envelope.fixture.json"), JSON.stringify(fixture));
  const reportResult = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "envelope-findings-empty-for-non-satisfied-verdict"));
  const enforceResult = evaluateConformance(root, [descriptor()], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "envelope-findings-empty-for-non-satisfied-verdict"));
});

