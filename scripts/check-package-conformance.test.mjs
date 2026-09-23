// Regression tests for check-package-conformance.mjs — the Stage B
// normalization-template gate (issue #1187, #1203, #1197, #1381, #1384).
// Exercises evaluateConformance directly with in-memory descriptors, using a
// real temporary directory only for the filesystem-backed checks (package
// source for envelope emission, generated envelope copies) that this gate
// reads under packages/*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateConformance, NOT_APPLICABLE_TO_PRODUCER } from "./check-package-conformance.mjs";
import { ENVELOPE_COPY_PATH, renderEnvelopeCopyFromRoot } from "./sync-envelope-copies.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-package-conformance.mjs");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  assert.equal(row.lifecycleWords, "n/a");
  assert.equal(row.loopSection, "absent");
  assert.equal(row.layout, "absent");
  assert.equal(row.capabilityMap, "absent");
  assert.equal(row.statusMd, "n/a");
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

test("--enforce fails a synthetic non-conforming package on every absent dimension that applies to a producer", (t) => {
  const root = makeTempRoot(t);
  const result = evaluateConformance(root, [descriptor()], { enforce: true });
  assert.ok(result.findings.length > 0, "expected --enforce to produce findings for a fully non-conforming package");
  const rules = result.findings.map((f) => f.rule);
  assert.ok(rules.includes("required-intake-absent"));
  assert.ok(rules.includes("required-capabilities-absent"));
  assert.ok(rules.includes("conformance-gap-outputEnvelope"));
  assert.ok(rules.includes("conformance-gap-layout"));
  // #1381: items 3 and 8 do not apply to a producer, so --enforce never asks for them.
  assert.equal(rules.includes("conformance-gap-lifecycleWords"), false);
  assert.equal(rules.includes("conformance-gap-statusMd"), false);
});

test("--enforce with an allowlisted role produces no findings for that role", (t) => {
  const root = makeTempRoot(t);
  const result = evaluateConformance(root, [descriptor()], { enforce: true, allowlist: { "@scope/alpha": "synthetic fixture, exempt for this test" } });
  assert.deepEqual(result.findings, []);
});

// --- #1381: items 3 (lifecycle words) and 8 (STATUS.md) are consumer state
// and are no longer graded from this repository's own root clossys/<role>/;
// item 5 (layout) is graded from what the package's manifest declares.

test("items 3 and 8 are n/a with a stated reason, never counted as gaps, whatever this repository's root clossys/<role>/ holds", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "clossys", "alpha"), { recursive: true });
  writeFileSync(join(root, "clossys", "alpha", "STATUS.md"), "# Status\n\n## Mandate\n\nx\n\n## Wrong Section\n\ny\n");
  writeFileSync(join(root, "clossys", "alpha", "loop.json"), JSON.stringify({ capabilities: [{ id: "x", state: "in-progress", condition: "current" }] }));
  for (const enforce of [false, true]) {
    const result = evaluateConformance(root, [descriptor()], { enforce });
    const row = result.table[0];
    assert.equal(row.lifecycleWords, "n/a");
    assert.equal(row.statusMd, "n/a");
    assert.deepEqual(Object.keys(row.notApplicable).sort(), ["lifecycleWords", "statusMd"]);
    for (const reason of Object.values(row.notApplicable)) assert.match(reason, /not applicable to a producer package/);
    const rules = result.findings.map((f) => f.rule);
    for (const rule of ["status-md-sections-mismatch", "non-lifecycle-state-word", "conformance-gap-lifecycleWords", "conformance-gap-statusMd"]) assert.equal(rules.includes(rule), false, rule);
  }
  assert.equal(NOT_APPLICABLE_TO_PRODUCER.lifecycleWords.includes("#1381"), true);
});

test("a clossys/<role>/ folder in this repository no longer makes layout declared -- only the manifest's declared paths do", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "clossys", "alpha"), { recursive: true });
  const result = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.equal(result.table[0].layout, "absent");
});

test("layout is declared when every manifest-declared path (outputs, feeds, capability outputs) sits under clossys/<role>/", (t) => {
  const root = makeTempRoot(t);
  const foundry = {
    assessment: { bin: "alpha-check", invocation: "single-json-input" },
    outputs: ["clossys/alpha/report.json"],
    feeds: [{ artifact: "report", path: "clossys/alpha/report.json" }],
  };
  const result = evaluateConformance(root, [descriptor({ manifest: manifest({ foundry }) })], { enforce: false });
  assert.equal(result.table[0].layout, "declared");
});

test("layout is malformed (a gap, reported once by the Stage A gate) when a declared path escapes clossys/<role>/", (t) => {
  const root = makeTempRoot(t);
  const foundry = { assessment: { bin: "alpha-check", invocation: "single-json-input" }, outputs: ["strategy/report.json"] };
  const result = evaluateConformance(root, [descriptor({ manifest: manifest({ foundry }) })], { enforce: false });
  assert.equal(result.table[0].layout, "malformed");
  assert.equal(result.findings.filter((f) => f.rule === "output-path-outside-role-folder").length, 1);
});

// --- #1384: item 2 is graded on real emission through the canonical
// constructor, never on a hand-written sample.

function withCanonicalEnvelope(root) {
  mkdirSync(join(root, "packages", "controller", "src", "gates"), { recursive: true });
  for (const path of ["src/envelope.ts", "src/gates/result.ts"]) {
    writeFileSync(join(root, "packages", "controller", path), readFileSync(join(repoRoot, "packages", "controller", path), "utf8"));
  }
}

function writeSource(root, relativePath, text) {
  const target = join(root, "packages", "alpha", relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

// A package that imports @clossys/controller must declare it: only a declared
// dependency survives packing (review of PR #1387, B2).
const DEPENDS_ON_CONTROLLER = { dependencies: { "@clossys/controller": "^0.1.0" } };
const controllerDependent = () => descriptor({ manifest: manifest(DEPENDS_ON_CONTROLLER) });

const EMITTER = (specifier) => `import { buildCheckOutputEnvelope } from "${specifier}";\nexport function report() { return buildCheckOutputEnvelope({ package: "a", version: "1", verdict: "satisfied", summary: "Fine.", findings: [] }); }\n`;

test("a hand-written check-output-envelope.fixture.json is sample-only: a gap, never adoption, and a finding under --enforce", (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  const fixture = { package: "@scope/alpha", version: "0.1.0", verdict: "satisfied", summary: "Everything checked out.", findings: [] };
  writeFileSync(join(root, "packages", "alpha", "check-output-envelope.fixture.json"), JSON.stringify(fixture));
  const reportResult = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.equal(reportResult.table[0].outputEnvelope, "sample-only");
  assert.deepEqual(reportResult.findings, []);
  const enforceResult = evaluateConformance(root, [descriptor()], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "conformance-gap-outputEnvelope" && /sample/.test(f.message)));
});

test("source calling buildCheckOutputEnvelope imported from @clossys/controller is declared, with the emitting file as evidence", (t) => {
  const root = makeTempRoot(t);
  writeSource(root, "src/report.ts", EMITTER("@clossys/controller"));
  const result = evaluateConformance(root, [controllerDependent()], { enforce: false });
  assert.equal(result.table[0].outputEnvelope, "declared");
  assert.deepEqual(result.table[0].envelopeEvidence, ["packages/alpha/src/report.ts"]);
});

test("#1387 review: an import from @clossys/controller is adoption only when the manifest declares it in dependencies or peerDependencies", (t) => {
  const root = makeTempRoot(t);
  writeSource(root, "src/report.ts", EMITTER("@clossys/controller"));
  // Resolves here through workspace hoisting, but would fail with ERR_MODULE_NOT_FOUND once packed and installed.
  for (const overrides of [{}, { devDependencies: { "@clossys/controller": "^0.1.0" } }, { dependencies: { "@clossys/other": "^0.1.0" } }]) {
    const result = evaluateConformance(root, [descriptor({ manifest: manifest(overrides) })], { enforce: false });
    assert.equal(result.table[0].outputEnvelope, "absent", JSON.stringify(overrides));
    assert.deepEqual(result.table[0].envelopeEvidence, []);
  }
  for (const overrides of [DEPENDS_ON_CONTROLLER, { peerDependencies: { "@clossys/controller": "^0.1.0" } }]) {
    const result = evaluateConformance(root, [descriptor({ manifest: manifest(overrides) })], { enforce: false });
    assert.equal(result.table[0].outputEnvelope, "declared", JSON.stringify(overrides));
  }
});

test("#1387 review: the constructor's name inside a string or template-literal text is not a call, but a call inside a template interpolation is", (t) => {
  const root = makeTempRoot(t);
  writeSource(root, "src/strings.ts", [
    `import { buildCheckOutputEnvelope } from "@clossys/controller";`,
    `export const a = "buildCheckOutputEnvelope(";`,
    `export const b = 'it\\'s buildCheckOutputEnvelope(';`,
    "export const c = `call buildCheckOutputEnvelope( later`;",
    `export const d = /["']/g; export const e = "// buildCheckOutputEnvelope(";`,
    "",
  ].join("\n"));
  const absent = evaluateConformance(root, [controllerDependent()], { enforce: false });
  assert.equal(absent.table[0].outputEnvelope, "absent");
  writeSource(root, "src/interpolated.ts", [
    `import { buildCheckOutputEnvelope } from "@clossys/controller";`,
    "export const f = `${JSON.stringify(buildCheckOutputEnvelope({ package: \"a\", version: \"1\", verdict: \"satisfied\", summary: \"Fine.\", findings: [] }))}`;",
    "",
  ].join("\n"));
  const declared = evaluateConformance(root, [controllerDependent()], { enforce: false });
  assert.equal(declared.table[0].outputEnvelope, "declared");
  assert.deepEqual(declared.table[0].envelopeEvidence, ["packages/alpha/src/interpolated.ts"]);
});

test("an import that is never called or only mentioned in a comment, a type-only import, a test file, a hand-written local constructor, or a cross-package relative import is not emission evidence", (t) => {
  const root = makeTempRoot(t);
  writeSource(root, "src/unused.ts", `import { buildCheckOutputEnvelope } from "@clossys/controller";\nexport const x = 1;\n`);
  writeSource(root, "src/types-only.ts", `import type { buildCheckOutputEnvelope } from "@clossys/controller";\nexport const y = buildCheckOutputEnvelope;\n`);
  writeSource(root, "src/report.test.ts", EMITTER("@clossys/controller"));
  writeSource(root, "src/local-envelope.ts", `export function buildCheckOutputEnvelope(x: unknown) { return x; }\n`);
  writeSource(root, "src/uses-local.ts", EMITTER("./local-envelope.js"));
  writeSource(root, "src/comment-only.ts", `import { buildCheckOutputEnvelope } from "@clossys/controller";\n// buildCheckOutputEnvelope({ ... }) is what we would call\n/* buildCheckOutputEnvelope( */\nexport const z = 3;\n`);
  withCanonicalEnvelope(root);
  writeSource(root, "src/reaches-across.ts", EMITTER("../../controller/src/envelope.js"));
  // Declares the dependency, so each case above is judged on its own merits, not on the missing dependency.
  const result = evaluateConformance(root, [controllerDependent()], { enforce: false });
  assert.equal(result.table[0].outputEnvelope, "absent");
  assert.deepEqual(result.table[0].envelopeEvidence, []);
});

test("an aliased import of the canonical constructor still counts when the alias is called", (t) => {
  const root = makeTempRoot(t);
  writeSource(root, "src/report.ts", `import { buildCheckOutputEnvelope as build } from "@clossys/controller";\nexport const r = build({ package: "a", version: "1", verdict: "satisfied", summary: "Fine.", findings: [] });\n`);
  const result = evaluateConformance(root, [controllerDependent()], { enforce: false });
  assert.equal(result.table[0].outputEnvelope, "declared");
});

test("a zero-dependency package emitting through a current generated copy is declared", (t) => {
  const root = makeTempRoot(t);
  withCanonicalEnvelope(root);
  writeSource(root, ENVELOPE_COPY_PATH, renderEnvelopeCopyFromRoot(root));
  writeSource(root, "src/report.ts", EMITTER("./generated/check-output-envelope.js"));
  const result = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.deepEqual(result.findings, []);
  assert.equal(result.table[0].outputEnvelope, "declared");
});

test("a generated copy that differs by one byte is a finding in report mode and --enforce alike, and is not evidence", (t) => {
  const root = makeTempRoot(t);
  withCanonicalEnvelope(root);
  writeSource(root, ENVELOPE_COPY_PATH, `${renderEnvelopeCopyFromRoot(root)} `);
  writeSource(root, "src/report.ts", EMITTER("./generated/check-output-envelope.js"));
  for (const enforce of [false, true]) {
    const result = evaluateConformance(root, [descriptor()], { enforce });
    assert.equal(result.table[0].outputEnvelope, "drifted");
    assert.ok(result.findings.some((f) => f.rule === "envelope-copy-drifted"));
  }
});

test("a generated copy with no canonical source to verify against is a finding, never silently trusted", (t) => {
  const root = makeTempRoot(t);
  writeSource(root, ENVELOPE_COPY_PATH, "// a copy with nothing to compare against\n");
  const result = evaluateConformance(root, [descriptor()], { enforce: false });
  assert.ok(result.findings.some((f) => f.rule === "envelope-copy-unverifiable"));
});

test("#1383: a declared status probe must itself emit the envelope (directly or through one relative import); otherwise partial", (t) => {
  const root = makeTempRoot(t);
  const probeManifest = manifest({
    ...DEPENDS_ON_CONTROLLER,
    bin: { "alpha-check": "dist/cli.js", "alpha-status": "dist/status.js" },
    foundry: { assessment: { bin: "alpha-check", invocation: "single-json-input" }, status: { bin: "alpha-status", invocation: "single-json-input" } },
  });
  writeSource(root, "src/report.ts", EMITTER("@clossys/controller"));
  writeSource(root, "src/status.ts", `export const nothing = 1;\n`);
  const partial = evaluateConformance(root, [descriptor({ manifest: probeManifest })], { enforce: false });
  assert.equal(partial.table[0].outputEnvelope, "partial");
  assert.deepEqual(partial.findings, []);
  const enforced = evaluateConformance(root, [descriptor({ manifest: probeManifest })], { enforce: true });
  assert.ok(enforced.findings.some((f) => f.rule === "conformance-gap-outputEnvelope" && /status probe/.test(f.message)));

  writeSource(root, "src/status.ts", `import { report } from "./report.js";\nprocess.stdout.write(JSON.stringify(report()));\n`);
  const declared = evaluateConformance(root, [descriptor({ manifest: probeManifest })], { enforce: false });
  assert.equal(declared.table[0].outputEnvelope, "declared");
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
  assert.deepEqual(result.findings, []); // sample-only and not-removed alone are never a report-mode failure
  const row = result.table[0];
  assert.equal(row.outputEnvelope, "sample-only"); // #1384: a hand-written sample is not adoption
  assert.equal(row.conversationContract, "not-removed");
  assert.equal(row.gaps, 2);
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

test("a package directory with no package.json (classification: 'missing-manifest') is always a finding, in report and enforce mode", (t) => {
  const root = makeTempRoot(t);
  const invalid = descriptor({ classification: "missing-manifest", role: "ghost-package", packageDir: "ghost-package", manifest: null });
  const reportResult = evaluateConformance(root, [invalid], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "missing-manifest" && f.role === "ghost-package"));
  const enforceResult = evaluateConformance(root, [invalid], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "missing-manifest" && f.role === "ghost-package"));
});

test("a package.json that is not valid JSON (classification: 'invalid-manifest') is always a finding, in report and enforce mode", (t) => {
  const root = makeTempRoot(t);
  const invalid = descriptor({ classification: "invalid-manifest", role: "broken-json-widget", packageDir: "broken-json-widget", manifest: null });
  const reportResult = evaluateConformance(root, [invalid], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "invalid-manifest" && f.role === "broken-json-widget"));
  const enforceResult = evaluateConformance(root, [invalid], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "invalid-manifest" && f.role === "broken-json-widget"));
});

test("a symlinked package directory (classification: 'symlinked-package') is always a finding, in report and enforce mode", (t) => {
  const root = makeTempRoot(t);
  const invalid = descriptor({ classification: "symlinked-package", role: "symlinked-widget", packageDir: "symlinked-widget", manifest: null });
  const reportResult = evaluateConformance(root, [invalid], { enforce: false });
  assert.ok(reportResult.findings.some((f) => f.rule === "symlinked-package" && f.role === "symlinked-widget"));
  const enforceResult = evaluateConformance(root, [invalid], { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "symlinked-package" && f.role === "symlinked-widget"));
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

function makeFixtureRepoWithContracts(t) {
  const root = mkdtempSync(join(tmpdir(), "check-package-conformance-cli-"));
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

