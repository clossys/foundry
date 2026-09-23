// Regression tests for check-package-conformance.mjs — the Stage B
// normalization-template gate (issue #1187, #1203, #1197). Exercises
// evaluateConformance directly with in-memory descriptors, using a real
// temporary directory only for the filesystem-backed checks (clossys/<role>/
// layout, loop.json, STATUS.md) that this gate reads beside packages/*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateConformance } from "./check-package-conformance.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-package-conformance.mjs");

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

// --- Classification (issue #1187 comment 5800189482, Decision 1): every
// packages/* manifest name must land in exactly one of "role" or "tooling",
// and evaluateConformance is handed that classification per descriptor
// rather than re-deriving it (collectDescriptors, the I/O layer, does the
// deriving via scripts/package-classification.mjs).

test("a tooling package is reported as an excluded row, not evaluated against the eight role items", (t) => {
  const root = makeTempRoot(t);
  const result = evaluateConformance(root, [descriptor({ classification: "tooling", role: "@clossys/launcher", packageDir: "launcher" })], { enforce: false });
  assert.deepEqual(result.findings, []);
  const row = result.table[0];
  assert.equal(row.classification, "tooling");
  assert.equal(row.excluded, "executable-tooling");
  assert.equal(row.manifestBlock, "n/a");
  assert.equal(row.lifecycleWords, "n/a");
  assert.equal(row.loopSection, "n/a");
  assert.equal(row.layout, "n/a");
  assert.equal(row.capabilityMap, "n/a");
  assert.equal(row.statusMd, "n/a");
});

test("a tooling row still reports the two applicable Stage B items: output envelope and the conversation-contract duplicate", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "packages", "launcher"), { recursive: true });
  const fixture = { package: "@clossys/launcher", version: "0.3.0", verdict: "satisfied", summary: "Everything checked out.", findings: [] };
  writeFileSync(join(root, "packages", "launcher", "check-output-envelope.fixture.json"), JSON.stringify(fixture));
  const result = evaluateConformance(root, [descriptor({
    classification: "tooling",
    role: "@clossys/launcher",
    packageDir: "launcher",
    skillSource: "# Launcher\n\n## How we work together\n\nold local copy\n",
  })], { enforce: false });
  assert.deepEqual(result.findings, []); // not-removed alone is never a report-mode failure
  const row = result.table[0];
  assert.equal(row.outputEnvelope, "declared");
  assert.equal(row.conversationContract, "not-removed");
  assert.equal(row.gaps, 1); // only the not-removed conversation contract counts
});

test("--enforce does not yet enforce a tooling row's two applicable items (Decision 1: report only, for now)", (t) => {
  const root = makeTempRoot(t);
  const result = evaluateConformance(root, [descriptor({ classification: "tooling", role: "@clossys/launcher", packageDir: "launcher" })], { enforce: true });
  assert.deepEqual(result.findings, []);
});

test("an unclassified package (in neither roles nor executable tooling) is always a finding, in report and enforce mode", (t) => {
  const root = makeTempRoot(t);
  const reportResult = evaluateConformance(root, [descriptor({ classification: "unclassified", role: "@scope/mystery" })], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "package-not-classified" && f.role === "@scope/mystery"));
  const enforceResult = evaluateConformance(root, [descriptor({ classification: "unclassified", role: "@scope/mystery" })], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "package-not-classified" && f.role === "@scope/mystery"));
});

test("a doubly classified package (both a role and executable tooling) is always a finding, in report and enforce mode", (t) => {
  const root = makeTempRoot(t);
  const reportResult = evaluateConformance(root, [descriptor({ classification: "both", role: "@scope/contradiction" })], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "package-double-classified" && f.role === "@scope/contradiction"));
  const enforceResult = evaluateConformance(root, [descriptor({ classification: "both", role: "@scope/contradiction" })], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "package-double-classified" && f.role === "@scope/contradiction"));
});

test("a role package is unchanged: an explicit classification: 'role' descriptor evaluates identically to an untagged one", (t) => {
  const root = makeTempRoot(t);
  const untagged = evaluateConformance(root, [descriptor()], { enforce: false });
  const tagged = evaluateConformance(root, [descriptor({ classification: "role" })], { enforce: false });
  assert.deepEqual(untagged.table, tagged.table);
  assert.deepEqual(untagged.findings, tagged.findings);
});

test("a package with no usable manifest name (classification: 'invalid-name') is always a finding, in report and enforce mode", (t) => {
  const root = makeTempRoot(t);
  const invalid = descriptor({ classification: "invalid-name", role: "mystery-widget", packageDir: "mystery-widget" });
  const reportResult = evaluateConformance(root, [invalid], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "invalid-manifest-name" && f.role === "mystery-widget"));
  const enforceResult = evaluateConformance(root, [invalid], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "invalid-manifest-name" && f.role === "mystery-widget"));
});

// --- Real collector + CLI regression (independent review on PR #1318,
// reproducing CodeRabbit's finding): before this fix, a packages/*
// package.json whose "name" was missing, empty, or not a string hit
// `!isText(manifest.name)` in collectDescriptors() and was silently
// `continue`d past -- it appeared in NEITHER the table nor the findings,
// exit 0, in both report and --enforce mode. These tests exercise the real
// collectDescriptors() and main() (via a spawned CLI process against a
// synthetic, temporary repository root), not just evaluateConformance
// above, because that is exactly the code path the defect lived in.

function makeFixtureRepo(t, packageName) {
  const root = mkdtempSync(join(tmpdir(), "check-package-conformance-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs", "contracts"), { recursive: true });
  writeFileSync(join(root, "docs", "contracts", "role-loop-archetypes.json"), JSON.stringify({ schemaVersion: 1, roles: {} }));
  writeFileSync(join(root, "docs", "contracts", "package-evidence.json"), JSON.stringify({ schemaVersion: 1, packages: [] }));
  const packageDir = join(root, "packages", "mystery-widget");
  mkdirSync(packageDir, { recursive: true });
  const manifest = { version: "0.1.0" };
  if (packageName !== undefined) manifest.name = packageName;
  writeFileSync(join(packageDir, "package.json"), JSON.stringify(manifest));
  return root;
}

function runCli(root, extraArgs = []) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, root, "--json", ...extraArgs], { encoding: "utf8" });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status, stdout: error.stdout?.toString() ?? "" };
  }
}

for (const [label, name] of [["missing", undefined], ["empty", ""], ["non-string", 42]]) {
  test(`CLI: a packages/* manifest.json with a ${label} name is reported as invalid-manifest-name, not silently skipped (report mode)`, (t) => {
    const root = makeFixtureRepo(t, name);
    const result = runCli(root);
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.findings.some((f) => f.rule === "invalid-manifest-name" && f.role === "mystery-widget"));
    assert.ok(parsed.table.some((row) => row.role === "mystery-widget" && row.classification === "invalid-name"));
  });

  test(`CLI: a packages/* manifest.json with a ${label} name still fails under --enforce`, (t) => {
    const root = makeFixtureRepo(t, name);
    const result = runCli(root, ["--enforce"]);
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.findings.some((f) => f.rule === "invalid-manifest-name" && f.role === "mystery-widget"));
  });
}

