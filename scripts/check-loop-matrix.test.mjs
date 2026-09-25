// Regression tests for check-loop-matrix.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("a package directory with no package.json (classification: 'missing-manifest') is always a finding, in report and enforce mode", () => {
  const descriptor = { role: "ghost-package", classification: "missing-manifest", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null };
  const reportResult = evaluateLoopMatrix([descriptor], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "missing-manifest" && f.role === "ghost-package"));
  const enforceResult = evaluateLoopMatrix([descriptor], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "missing-manifest" && f.role === "ghost-package"));
});

test("a package.json that is not valid JSON (classification: 'invalid-manifest') is always a finding, in report and enforce mode", () => {
  const descriptor = { role: "broken-json-widget", classification: "invalid-manifest", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null };
  const reportResult = evaluateLoopMatrix([descriptor], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "invalid-manifest" && f.role === "broken-json-widget"));
  const enforceResult = evaluateLoopMatrix([descriptor], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "invalid-manifest" && f.role === "broken-json-widget"));
});

test("a symlinked package directory (classification: 'symlinked-package') is always a finding, in report and enforce mode", () => {
  const descriptor = { role: "symlinked-widget", classification: "symlinked-package", matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null };
  const reportResult = evaluateLoopMatrix([descriptor], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "symlinked-package" && f.role === "symlinked-widget"));
  const enforceResult = evaluateLoopMatrix([descriptor], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "symlinked-package" && f.role === "symlinked-widget"));
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

function makeFixtureRepoWithContracts(t) {
  const root = mkdtempSync(join(tmpdir(), "check-loop-matrix-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs", "contracts"), { recursive: true });
  writeFileSync(join(root, "docs", "contracts", "role-loop-archetypes.json"), JSON.stringify({ schemaVersion: 1, roles: {} }));
  writeFileSync(join(root, "docs", "contracts", "package-evidence.json"), JSON.stringify({ schemaVersion: 1, packages: [] }));
  return root;
}

function makeFixtureRepo(t, packageName) {
  const root = makeFixtureRepoWithContracts(t);
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

// --- Real collector + CLI regression (independent review on PR #1318, round
// two): a packages/<dir> with no package.json at all still hit
// `if (!existsSync(manifestPath)) continue;` unconditionally and escaped
// both the table and the findings, exit 0. And a package.json that exists
// but is not valid JSON hit an unguarded `readJson`, throwing uncaught and
// aborting the ENTIRE gate run with exit 2 rather than reporting a finding
// attributable to just that one package.

test("CLI: a packages/* directory with no package.json at all is reported as missing-manifest, not silently skipped (report mode)", (t) => {
  const root = makeFixtureRepoWithContracts(t);
  const packageDir = join(root, "packages", "ghost-package");
  mkdirSync(join(packageDir, "src"), { recursive: true });
  writeFileSync(join(packageDir, "src", "index.ts"), "export {};\n"); // a real file in the directory, just no package.json
  const result = runCli(root);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings.some((f) => f.rule === "missing-manifest" && f.role === "ghost-package"));
  assert.ok(parsed.table.some((row) => row.role === "ghost-package" && row.classification === "missing-manifest"));
});

test("CLI: a packages/* directory with no package.json at all still fails under --enforce", (t) => {
  const root = makeFixtureRepoWithContracts(t);
  mkdirSync(join(root, "packages", "ghost-package"), { recursive: true });
  const result = runCli(root, ["--enforce"]);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings.some((f) => f.rule === "missing-manifest" && f.role === "ghost-package"));
});

test("CLI: a package.json that is not valid JSON is reported as invalid-manifest for just that package, not an exit-2 abort of the whole run (report mode)", (t) => {
  const root = makeFixtureRepoWithContracts(t);
  const packageDir = join(root, "packages", "broken-json-widget");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), "{ this is not json");
  const result = runCli(root);
  assert.equal(result.status, 1); // fails closed on a real finding, not exit 2
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings.some((f) => f.rule === "invalid-manifest" && f.role === "broken-json-widget"));
  assert.ok(parsed.table.some((row) => row.role === "broken-json-widget" && row.classification === "invalid-manifest"));
});

test("CLI: an invalid-JSON package.json still fails under --enforce, attributed to that one package", (t) => {
  const root = makeFixtureRepoWithContracts(t);
  const packageDir = join(root, "packages", "broken-json-widget");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), "{ this is not json");
  const result = runCli(root, ["--enforce"]);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings.some((f) => f.rule === "invalid-manifest" && f.role === "broken-json-widget"));
});

// --- Real collector + CLI regression (independent review on PR #1318,
// round three): a package.json that parses successfully to something other
// than a plain object -- `null`, an array, or a primitive -- is NOT caught
// by "JSON.parse threw" (it doesn't throw). `null` specifically used to
// crash the ENTIRE run (`manifest.name` on `null` throws an uncaught
// TypeError, one line past the old try/catch). readManifest
// (package-classification.mjs) is now the one place a manifest gets read,
// and it treats every non-object JSON.parse result the same way as a parse
// failure: a per-package invalid-manifest finding, never a crash. And a
// packages/<dir> entry that is itself a symlink is never followed --
// Dirent.isDirectory() is false for a symlink even when it points at a
// real directory with a valid manifest, so a plain `isDirectory()` check
// silently dropped it; it now gets its own symlinked-package finding.

for (const [label, body] of [["null", "null"], ["an array", "[]"], ["a primitive", "\"just a string\""]]) {
  test(`CLI: a package.json that parses to ${label} (not a plain object) is reported as invalid-manifest, not a whole-run crash (report mode)`, (t) => {
    const root = makeFixtureRepoWithContracts(t);
    const packageDir = join(root, "packages", "non-object-widget");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), body);
    const result = runCli(root);
    assert.equal(result.status, 1); // fails closed on a real finding, not exit 2 and not an uncaught crash
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.findings.some((f) => f.rule === "invalid-manifest" && f.role === "non-object-widget"));
    assert.ok(parsed.table.some((row) => row.role === "non-object-widget" && row.classification === "invalid-manifest"));
  });

  test(`CLI: a package.json that parses to ${label} still fails under --enforce, attributed to that one package`, (t) => {
    const root = makeFixtureRepoWithContracts(t);
    const packageDir = join(root, "packages", "non-object-widget");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), body);
    const result = runCli(root, ["--enforce"]);
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.findings.some((f) => f.rule === "invalid-manifest" && f.role === "non-object-widget"));
  });
}

test("CLI: a package.json path that is itself a directory (unreadable as a file) is reported as invalid-manifest, not a crash (report mode)", (t) => {
  // A portable, deterministic stand-in for "package.json exists but can't be
  // read" that doesn't depend on OS permission bits (chmod is unreliable
  // across platforms/sandboxes, and a root-owned test process ignores
  // permissions entirely) -- readFileSync throws EISDIR here exactly the
  // way it would throw EACCES on a genuinely unreadable file, and
  // readManifest's catch-all handles both identically.
  const root = makeFixtureRepoWithContracts(t);
  const packageDir = join(root, "packages", "unreadable-widget");
  mkdirSync(join(packageDir, "package.json"), { recursive: true }); // package.json is a directory, not a file
  const result = runCli(root);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings.some((f) => f.rule === "invalid-manifest" && f.role === "unreadable-widget"));
});

test("CLI: a symlinked package directory is reported as symlinked-package and its target is never read (report mode)", (t) => {
  const root = makeFixtureRepoWithContracts(t);
  // The target lives OUTSIDE packages/ entirely, so it is never enumerated
  // as its own package directory -- if the symlink were (wrongly) followed,
  // its manifest name would leak into the output somewhere; if it is
  // correctly never followed, there is no trace of it anywhere.
  const targetDir = join(root, "target-outside-packages");
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, "package.json"), JSON.stringify({ name: "@scope/leaked-if-followed", version: "0.1.0" }));
  mkdirSync(join(root, "packages"), { recursive: true });
  symlinkSync(targetDir, join(root, "packages", "symlinked-widget"), "dir");
  const result = runCli(root);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings.some((f) => f.rule === "symlinked-package" && f.role === "symlinked-widget"));
  assert.ok(parsed.table.some((row) => row.role === "symlinked-widget" && row.classification === "symlinked-package"));
  assert.ok(!JSON.stringify(parsed).includes("leaked-if-followed"));
});

test("CLI: a symlinked package directory still fails under --enforce, and its target is never read", (t) => {
  const root = makeFixtureRepoWithContracts(t);
  const targetDir = join(root, "target-outside-packages");
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, "package.json"), JSON.stringify({ name: "@scope/leaked-if-followed", version: "0.1.0" }));
  mkdirSync(join(root, "packages"), { recursive: true });
  symlinkSync(targetDir, join(root, "packages", "symlinked-widget"), "dir");
  const result = runCli(root, ["--enforce"]);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings.some((f) => f.rule === "symlinked-package" && f.role === "symlinked-widget"));
  assert.ok(!JSON.stringify(parsed).includes("leaked-if-followed"));
});

// --- Every OTHER way a packages/ entry could be skipped or crash the run,
// audited (round three's third ask) rather than fixed piecemeal:
//
//   - a plain file directly under packages/ (neither a directory nor a
//     symlink) -- correctly produces zero findings/rows, not a defect
//     (confirmed by an earlier independent review round); this test pins
//     that behavior so it can't silently regress into a "missing-manifest"
//     or similar false positive.
//   - a FIFO, socket, block device, or character device entry -- cannot
//     occur in a git-tracked packages/ at all (git only ever stores blobs,
//     trees, and symlinks; it has no object type for any of these), and
//     Node's own fs module has no portable, cross-platform way to create
//     one in a test fixture. Even if one existed on disk out-of-band, it is
//     neither a directory nor a symlink, so it falls into the exact same
//     "ignore, not a package" bucket as a plain file above -- no separate
//     code path, so no separate defect to test for.
//   - a directory that exists but can't be listed/read at all (EACCES) --
//     covered by the same readManifest catch-all already exercised by the
//     "package.json path is itself a directory" (EISDIR) test above: any
//     read error, permission-based or otherwise, is caught uniformly and
//     reported as invalid-manifest rather than propagating. A dedicated
//     chmod-based fixture is deliberately not added: permission bits are
//     unreliable across platforms/sandboxes and are ignored entirely by a
//     root-owned test process, which would make such a test flaky rather
//     than meaningful.
//   - the packages/ directory itself missing or unreadable -- a
//     structural precondition, not a specific package's defect (there is
//     no entry list to iterate at all); readdirSync(packagesDir) throws,
//     caught by main()'s own outer try/catch, exit 2 with an error message
//     -- the same "the question could not be answered" contract this
//     script already documents for its other structural reads (e.g.
//     docs/contracts/role-loop-archetypes.json missing). Unchanged by this
//     fix and out of scope for a per-package finding.
//   - entry.name not being a string -- not reachable: Dirent.name is
//     always a string by Node's own fs API contract.
//   - manifest.name present but not a string -- already covered by the
//     "invalid-name" classification and its round-one tests above.

test("CLI: a plain file directly under packages/ (not a directory, not a symlink) produces no findings and no table row", (t) => {
  const root = makeFixtureRepoWithContracts(t);
  mkdirSync(join(root, "packages"), { recursive: true });
  writeFileSync(join(root, "packages", "README.md"), "# not a package\n");
  const result = runCli(root);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.findings, []);
  assert.deepEqual(parsed.table, []);
});
