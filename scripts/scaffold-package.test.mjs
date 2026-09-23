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
import { buildScaffold } from "./scaffold-package.mjs";

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
  return root;
}

test("buildScaffold produces a package.json whose foundry block declares every Stage A field", () => {
  const stageActivities = { sense: "s", judge: "j", act: "a", verify: "v", learn: "l" };
  const { packageFiles, repoFiles } = buildScaffold({ role: "@clossys/customer", shortName: "customer", roleDefinition: {}, stageActivities });
  const manifest = JSON.parse(packageFiles.get("package.json"));
  assert.equal(manifest.name, "@clossys/customer");
  for (const field of ["assessment", "intake", "outputs", "status", "fit", "solves", "needs", "feeds", "capabilities"]) {
    assert.ok(field in manifest.foundry, `expected foundry.${field} to be declared`);
  }
  assert.ok(packageFiles.has("skill/SKILL.md"));
  assert.ok(packageFiles.get("skill/SKILL.md").includes("## Run the feedback loop"));
  assert.ok(repoFiles.has("clossys/customer/STATUS.md"));
  assert.ok(repoFiles.has("clossys/customer/loop.json"));
  assert.ok(repoFiles.has("governance/release-qualification-adapters/customer/current-direct.json"));
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

  // --enforce is allowed to fail with a non-zero exit (execFileSync throws on
  // exit != 0), so this proves the same thing at the stronger bar.
  let enforceExitCode = 0;
  let enforceOut;
  try {
    enforceOut = execFileSync(process.execPath, [join(scriptDir, "check-package-conformance.mjs"), "--json", "--enforce", root], { stdio: "pipe" }).toString("utf8");
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
  assert.equal(result.table.length, 2);
  for (const row of result.table) assert.equal(row.gaps, 0, `expected zero gaps for ${row.role}, got: ${JSON.stringify(row)}`);
});
