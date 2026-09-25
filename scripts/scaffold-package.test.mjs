// Regression tests for scaffold-package.mjs (issue #1203): a new package
// starts complete and conforming instead of being retrofitted. The
// end-to-end test scaffolds into a REAL temporary directory (a standalone
// mini repository, not this checkout) and runs the real
// check-package-conformance.mjs CLI against it, so the proof is the same
// gate a contributor would run, not a reimplementation of it.
//
// The temp directory is always removed via t.after, including when a test
// fails or throws (issue #1250: a prior scaffold-shaped test leaked temp
// directories on failure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateIntakeCardsShape } from "./check-package-framework.mjs";
import { buildScaffold } from "./scaffold-package.mjs";
import { ENVELOPE_COPY_PATH, renderEnvelopeCopyFromRoot } from "./sync-envelope-copies.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

/**
 * A standalone temp "repository": a real copy of the one contract file the
 * gates under test need to resolve activeRoles/metrics/stage activities
 * (docs/contracts/role-loop-archetypes.json), never this checkout's own
 * packages/ tree. Copying one read-only reference file into an isolated,
 * disposable directory for a single test run is not "carrying a local copy"
 * of a shared definition in the sense this repository's AGENTS.md means (a
 * competing, committed fork) -- it is ordinary test fixture isolation, and
 * the directory is deleted before the test ends either way.
 */
function makeTempRepoRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "scaffold-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs", "contracts"), { recursive: true });
  mkdirSync(join(root, "packages"), { recursive: true });
  const contractSource = readFileSync(join(repoRoot, "docs", "contracts", "role-loop-archetypes.json"), "utf8");
  writeFileSync(join(root, "docs", "contracts", "role-loop-archetypes.json"), contractSource);
  writeFileSync(join(root, "docs", "contracts", "package-evidence.json"), readFileSync(join(repoRoot, "docs", "contracts", "package-evidence.json"), "utf8"));
  // The canonical envelope source the scaffold's generated copy is rendered
  // from, and verified against (issue #1384). A minimal controller manifest
  // keeps packages/controller/ a classifiable package in this temp repo; its
  // own row is not what these tests grade, so they filter to scaffolded rows
  // and allowlist it under --enforce.
  mkdirSync(join(root, "packages", "controller", "src", "gates"), { recursive: true });
  for (const path of ["src/envelope.ts", "src/gates/result.ts"]) {
    writeFileSync(join(root, "packages", "controller", path), readFileSync(join(repoRoot, "packages", "controller", path), "utf8"));
  }
  writeFileSync(join(root, "packages", "controller", "package.json"), JSON.stringify({ name: "@clossys/controller", version: "0.0.0" }));
  writeFileSync(join(root, "controller-allowlist.json"), JSON.stringify({ roles: { "@clossys/controller": "temp-repo stand-in for the canonical envelope source only" } }));
  return root;
}

const stageActivities = { sense: "s", judge: "j", act: "a", verify: "v", learn: "l" };
const scaffoldedRows = (result) => result.table.filter((row) => row.role !== "@clossys/controller");

test("buildScaffold produces a package.json whose foundry block declares every Stage A field", () => {
  const { packageFiles, repoFiles } = buildScaffold({ role: "@clossys/customer", shortName: "customer", roleDefinition: {}, stageActivities, envelopeCopy: renderEnvelopeCopyFromRoot(repoRoot) });
  const manifest = JSON.parse(packageFiles.get("package.json"));
  assert.equal(manifest.name, "@clossys/customer");
  for (const field of ["assessment", "intake", "outputs", "status", "fit", "solves", "needs", "feeds", "capabilities"]) {
    assert.ok(field in manifest.foundry, `expected foundry.${field} to be declared`);
  }
  assert.ok(packageFiles.has("skill/SKILL.md"));
  assert.ok(packageFiles.get("skill/SKILL.md").includes("## Run the feedback loop"));
  assert.ok(repoFiles.has("governance/release-qualification-adapters/customer/current-direct.json"));
});

test("buildScaffold writes no fabricated consumer state and no hand-written envelope sample (#1381, #1384)", () => {
  const { packageFiles, repoFiles } = buildScaffold({ role: "@clossys/customer", shortName: "customer", roleDefinition: {}, stageActivities, envelopeCopy: renderEnvelopeCopyFromRoot(repoRoot) });
  assert.deepEqual([...repoFiles.keys()].filter((path) => path.startsWith("clossys/")), []);
  assert.equal(packageFiles.has("check-output-envelope.fixture.json"), false);
  assert.equal(packageFiles.get(ENVELOPE_COPY_PATH), renderEnvelopeCopyFromRoot(repoRoot));
  const probe = packageFiles.get("src/cli.ts");
  assert.match(probe, /import \{ buildCheckOutputEnvelope, envelopeToExitCode \} from "\.\/generated\/check-output-envelope\.js";/);
  assert.match(probe, /verdict: "indeterminate"/);
});

test("#1387 review: the scaffold can build its own declared status bin -- a build script and a tsconfig mapping src/cli.ts to dist/cli.js", () => {
  const { packageFiles } = buildScaffold({ role: "@clossys/customer", shortName: "customer", roleDefinition: {}, stageActivities, envelopeCopy: renderEnvelopeCopyFromRoot(repoRoot) });
  const manifest = JSON.parse(packageFiles.get("package.json"));
  assert.equal(manifest.bin["customer-check"], "dist/cli.js");
  assert.equal(manifest.foundry.status.bin, "customer-check");
  assert.equal(manifest.scripts.build, "tsc -p tsconfig.json");
  assert.ok(packageFiles.has("src/cli.ts"));
  const tsconfig = JSON.parse(packageFiles.get("tsconfig.json"));
  assert.equal(tsconfig.compilerOptions.rootDir, "./src");
  assert.equal(tsconfig.compilerOptions.outDir, "./dist");
  assert.deepEqual(tsconfig.include, ["src/**/*"]);
});

test("#1387 review: a planned scaffold capability carries proofCase: null (nothing proves a capability that does not exist yet)", () => {
  const { packageFiles } = buildScaffold({ role: "@clossys/customer", shortName: "customer", roleDefinition: {}, stageActivities, envelopeCopy: renderEnvelopeCopyFromRoot(repoRoot) });
  const [capability] = JSON.parse(packageFiles.get("package.json")).foundry.capabilities;
  assert.equal(capability.maturity, "planned");
  assert.equal(capability.proofCase, null);
});

test("buildScaffold refuses to run without the generated envelope copy", () => {
  assert.throws(() => buildScaffold({ role: "@clossys/customer", shortName: "customer", roleDefinition: {}, stageActivities }), /envelopeCopy/);
});

test("scaffold-package.mjs refuses a role not declared in role-loop-archetypes.json", (t) => {
  const root = makeTempRepoRoot(t);
  assert.throws(() => execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "not-a-real-role", "--root", root], { stdio: "pipe" }));
});

test("scaffold-package.mjs refuses to overwrite an existing package without --force", (t) => {
  const root = makeTempRepoRoot(t);
  execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "customer", "--root", root], { stdio: "pipe" });
  assert.throws(() => execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "customer", "--root", root], { stdio: "pipe" }));
  // --force succeeds over the existing directory.
  execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "customer", "--root", root, "--force"], { stdio: "pipe" });
  assert.ok(existsSync(join(root, "packages", "customer", "package.json")));
});

test("a package scaffolded into a fresh temp directory reports zero gaps against the real conformance gate, in report and enforce mode", (t) => {
  const root = makeTempRepoRoot(t);
  execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "customer", "--root", root], { stdio: "pipe" });

  const reportOut = execFileSync(process.execPath, [join(scriptDir, "check-package-conformance.mjs"), "--json", root], { stdio: "pipe" }).toString("utf8");
  const reportResult = JSON.parse(reportOut);
  assert.deepEqual(reportResult.findings, []);
  const row = reportResult.table.find((item) => item.role === "@clossys/customer");
  assert.ok(row, "expected the scaffolded @clossys/customer row in the conformance report");
  assert.equal(row.gaps, 0, `expected zero gaps, got: ${JSON.stringify(row)}`);
  assert.equal(row.outputEnvelope, "declared");
  assert.deepEqual(row.envelopeEvidence, ["packages/customer/src/cli.ts"]);
  assert.equal(row.layout, "declared");
  assert.equal(row.lifecycleWords, "n/a");
  assert.equal(row.statusMd, "n/a");
  assert.equal(existsSync(join(root, "clossys")), false, "the scaffold must not write consumer state into the repository root");

  // --enforce is allowed to fail with a non-zero exit (execFileSync throws on
  // exit != 0), so this proves the same thing at the stronger bar.
  let enforceExitCode = 0;
  let enforceOut;
  try {
    enforceOut = execFileSync(process.execPath, [join(scriptDir, "check-package-conformance.mjs"), "--json", "--enforce", "--allowlist", join(root, "controller-allowlist.json"), root], { stdio: "pipe" }).toString("utf8");
  } catch (error) {
    enforceExitCode = error.status;
    enforceOut = error.stdout.toString("utf8");
  }
  const enforceResult = JSON.parse(enforceOut);
  assert.deepEqual(enforceResult.findings, [], `expected zero --enforce findings for the scaffolded package, got: ${JSON.stringify(enforceResult.findings)}`);
  assert.equal(enforceExitCode, 0);
});

test("scaffolding two different roles in the same temp directory leaves each package independently zero-gap", (t) => {
  const root = makeTempRepoRoot(t);
  execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "customer", "--root", root], { stdio: "pipe" });
  execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "advisor", "--root", root], { stdio: "pipe" });
  const out = execFileSync(process.execPath, [join(scriptDir, "check-package-conformance.mjs"), "--json", root], { stdio: "pipe" }).toString("utf8");
  const result = JSON.parse(out);
  assert.deepEqual(result.findings, []);
  assert.equal(scaffoldedRows(result).length, 2);
  for (const row of scaffoldedRows(result)) assert.equal(row.gaps, 0, `expected zero gaps for ${row.role}, got: ${JSON.stringify(row)}`);
});

test("hand-editing a scaffolded package's generated envelope copy is a finding in report mode (#1384)", (t) => {
  const root = makeTempRepoRoot(t);
  execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "customer", "--root", root], { stdio: "pipe" });
  const copyPath = join(root, "packages", "customer", ENVELOPE_COPY_PATH);
  writeFileSync(copyPath, `${readFileSync(copyPath, "utf8")}\n// a local tweak\n`);
  let out;
  try { out = execFileSync(process.execPath, [join(scriptDir, "check-package-conformance.mjs"), "--json", root], { stdio: "pipe" }).toString("utf8"); assert.fail("expected a non-zero exit"); }
  catch (error) { if (error.stdout === undefined) throw error; assert.equal(error.status, 1); out = error.stdout.toString("utf8"); }
  const result = JSON.parse(out);
  assert.ok(result.findings.some((item) => item.rule === "envelope-copy-drifted" && item.role === "@clossys/customer"));
  assert.equal(result.table.find((item) => item.role === "@clossys/customer").outputEnvelope, "drifted");
});

test("buildScaffold puts the first changelog entry at docs/changelogs/<shortName>.md, never in the package", () => {
  const { packageFiles, repoFiles } = buildScaffold({ role: "@clossys/customer", shortName: "customer", roleDefinition: {}, stageActivities, envelopeCopy: renderEnvelopeCopyFromRoot(repoRoot) });
  assert.equal(packageFiles.has("CHANGELOG.md"), false);
  assert.match(repoFiles.get("docs/changelogs/customer.md"), /^# Changelog\n\n## 0\.1\.0\n/);
});

test("scaffold-package.mjs keeps an existing docs/changelogs/<shortName>.md -- release history is not scaffold output", (t) => {
  const root = makeTempRepoRoot(t);
  mkdirSync(join(root, "docs", "changelogs"), { recursive: true });
  const history = "# Changelog\n\n## 0.4.0 - 2026-01-01\n\n- An earlier release.\n";
  writeFileSync(join(root, "docs", "changelogs", "customer.md"), history);
  execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "customer", "--root", root], { stdio: "pipe" });
  assert.equal(readFileSync(join(root, "docs", "changelogs", "customer.md"), "utf8"), history);
  assert.equal(existsSync(join(root, "packages", "customer", "CHANGELOG.md")), false);
});

test("#1179: the scaffolded intake file passes the closed intake-card shape check", () => {
  const { packageFiles } = buildScaffold({ role: "@clossys/customer", shortName: "customer", roleDefinition: {}, stageActivities, envelopeCopy: renderEnvelopeCopyFromRoot(repoRoot) });
  const cards = JSON.parse(packageFiles.get("intake-question-cards.json"));
  assert.deepEqual(validateIntakeCardsShape(cards, "@clossys/customer"), []);
});
