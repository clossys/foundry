// Regression tests for check-loop-matrix.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateLoopMatrix, validateLoopMatrixShape } from "./check-loop-matrix.mjs";
import { generateLoopSection } from "./generate-loop-section.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-loop-matrix.mjs");

const ROLE = "@scope/alpha";
const STAGE_ACTIVITIES = {
  sense: "sense default", judge: "judge default", act: "act default", verify: "verify default", learn: "learn default",
};

function demand(overrides = {}) {
  return { reasoningTier: "standard", visionRequired: false, contextSize: "medium", parallel: false, independence: false, ...overrides };
}

function fullCellsFor(capabilities) {
  const cells = [];
  for (const capability of capabilities) {
    for (const stage of ["sense", "judge", "act", "verify", "learn"]) {
      cells.push({ capability, stage, applicable: false, reason: `${stage} not applicable to ${capability}` });
    }
  }
  return cells;
}

test("absence of loop-matrix.json is printed and counted, never a report-mode failure", () => {
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.table[0].loopMatrix, "absent");
});

test("--enforce fails a role with no loop-matrix.json", () => {
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }], { enforce: true });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, "required-loop-matrix-absent");
});

test("validateLoopMatrixShape requires every capability × every stage exactly once", () => {
  const doc = { role: ROLE, cells: fullCellsFor(["confirm-fit"]).slice(0, 4) }; // missing "learn"
  const findings = validateLoopMatrixShape(ROLE, doc, ["confirm-fit"]);
  assert.ok(findings.some((f) => f.rule === "loop-matrix-missing-cell" && f.message.includes("learn")));
});

test("validateLoopMatrixShape rejects an applicable cell missing required fields", () => {
  const doc = { role: ROLE, cells: [{ capability: "confirm-fit", stage: "sense", applicable: true }] };
  const findings = validateLoopMatrixShape(ROLE, doc, null);
  const rules = findings.map((f) => f.rule);
  assert.ok(rules.includes("invalid-cell-inputs"));
  assert.ok(rules.includes("invalid-cell-check"));
  assert.ok(rules.includes("cell-output-outside-role-folder"));
  assert.ok(rules.includes("invalid-cell-proof-case"));
});

test("validateLoopMatrixShape rejects an n/a cell that also carries content", () => {
  const doc = { role: ROLE, cells: [{ capability: "confirm-fit", stage: "sense", applicable: false, reason: "n/a", inputs: "should not be here" }] };
  const findings = validateLoopMatrixShape(ROLE, doc, null);
  assert.ok(findings.some((f) => f.rule === "cell-na-carries-content"));
});

test("validateLoopMatrixShape rejects a demand floor above the declared tier", () => {
  const doc = {
    role: ROLE,
    cells: [{ capability: "confirm-fit", stage: "sense", applicable: true, inputs: "x", check: "y", output: "clossys/alpha/z.json", proofCase: "case-1", demand: demand({ reasoningTier: "light", minimumTierFloor: "deep" }) }],
  };
  const findings = validateLoopMatrixShape(ROLE, doc, null);
  assert.ok(findings.some((f) => f.rule === "cell-demand-floor-above-tier"));
});

test("a well-formed matrix with no generated section in the skill reports declared/absent and no findings in report mode", () => {
  const doc = { role: ROLE, cells: fullCellsFor(["confirm-fit"]) };
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: doc, capabilityIds: ["confirm-fit"], skillSource: "# Alpha\n\nno loop section here", stageActivities: STAGE_ACTIVITIES }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.table[0].loopMatrix, "declared");
  assert.equal(result.table[0].generatedSection, "absent");
});

test("a generated section matching the matrix reports current with no findings", () => {
  const doc = { role: ROLE, cells: fullCellsFor(["confirm-fit"]) };
  const generated = generateLoopSection(ROLE, doc, STAGE_ACTIVITIES);
  const skillSource = `# Alpha\n\n${generated}\n## When this package is installed\n\ninstalled body\n`;
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: doc, capabilityIds: ["confirm-fit"], skillSource, stageActivities: STAGE_ACTIVITIES }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.table[0].generatedSection, "current");
});

test("a drifted generated section ALWAYS fails, even in report mode", () => {
  const doc = { role: ROLE, cells: fullCellsFor(["confirm-fit"]) };
  const skillSource = "# Alpha\n\n## Run the feedback loop\n\nhand-written, stale prose\n\n## When this package is installed\n";
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: doc, capabilityIds: ["confirm-fit"], skillSource, stageActivities: STAGE_ACTIVITIES }], { enforce: false });
  assert.ok(result.findings.some((f) => f.rule === "loop-section-drifted"));
  assert.equal(result.table[0].generatedSection, "stale");
});

// --- Classification (issue #1187 comment 5800189482, Decision 1): every
// packages/* manifest name must land in exactly one of "role" or "tooling".
// evaluateLoopMatrix is handed that classification per descriptor rather
// than re-deriving it (collect, the I/O layer, derives it via
// scripts/package-classification.mjs).

test("a tooling package is reported as an excluded row, with loopMatrix and generatedSection both n/a (no capability x stage loop applies)", () => {
  const result = evaluateLoopMatrix([{ role: "@clossys/launcher", classification: "tooling", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }]);
  assert.deepEqual(result.findings, []);
  const row = result.table[0];
  assert.equal(row.classification, "tooling");
  assert.equal(row.excluded, "executable-tooling");
  assert.equal(row.loopMatrix, "n/a");
  assert.equal(row.generatedSection, "n/a");
});

test("--enforce does not flag a tooling row (the loop matrix is not applicable to executable tooling)", () => {
  const result = evaluateLoopMatrix([{ role: "@clossys/launcher", classification: "tooling", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }], { enforce: true });
  assert.deepEqual(result.findings, []);
});

test("an unclassified package (in neither roles nor executable tooling) is always a finding, in report and enforce mode", () => {
  const reportResult = evaluateLoopMatrix([{ role: "@scope/mystery", classification: "unclassified", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "package-not-classified" && f.role === "@scope/mystery"));
  const enforceResult = evaluateLoopMatrix([{ role: "@scope/mystery", classification: "unclassified", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "package-not-classified" && f.role === "@scope/mystery"));
});

test("a doubly classified package (both a role and executable tooling) is always a finding, in report and enforce mode", () => {
  const reportResult = evaluateLoopMatrix([{ role: "@scope/contradiction", classification: "both", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "package-double-classified" && f.role === "@scope/contradiction"));
  const enforceResult = evaluateLoopMatrix([{ role: "@scope/contradiction", classification: "both", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "package-double-classified" && f.role === "@scope/contradiction"));
});

test("a role package is unchanged: an explicit classification: 'role' descriptor evaluates identically to an untagged one", () => {
  const untagged = evaluateLoopMatrix([{ role: ROLE, matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }]);
  const tagged = evaluateLoopMatrix([{ role: ROLE, classification: "role", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }]);
  assert.deepEqual(untagged.table, tagged.table);
  assert.deepEqual(untagged.findings, tagged.findings);
});

test("a package with no usable manifest name (classification: 'invalid-name') is always a finding, in report and enforce mode", () => {
  const descriptor = { role: "mystery-widget", classification: "invalid-name", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null };
  const reportResult = evaluateLoopMatrix([descriptor], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "invalid-manifest-name" && f.role === "mystery-widget"));
  const enforceResult = evaluateLoopMatrix([descriptor], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "invalid-manifest-name" && f.role === "mystery-widget"));
});

// --- Real collector + CLI regression (independent review on PR #1318,
// reproducing CodeRabbit's finding): before this fix, a packages/*
// package.json whose "name" was missing, empty, or not a string hit
// `!isText(manifest.name)` in collect() and was silently `continue`d past
// -- it appeared in NEITHER the table nor the findings, exit 0, in both
// report and --enforce mode. These tests exercise the real collect() and
// main() (via a spawned CLI process against a synthetic, temporary
// repository root), not just the pure evaluator above, because that is
// exactly the code path the defect lived in.

function makeFixtureRepo(t, packageName) {
  const root = mkdtempSync(join(tmpdir(), "check-loop-matrix-cli-"));
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
