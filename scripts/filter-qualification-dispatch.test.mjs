import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packagesNeedingDispatch, qualificationBranchName } from "./filter-qualification-dispatch.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "filter-qualification-dispatch.mjs");

// -------------------------------------------------------------- unit coverage

test("qualificationBranchName: matches qualify-candidate.yml's own branch=\"claude/qualify-${PKG}-${VERSION}\" line exactly", () => {
  assert.equal(qualificationBranchName("controller", "0.9.15"), "claude/qualify-controller-0.9.15");
});

test("packagesNeedingDispatch: a candidate whose qualification branch already exists is filtered out", () => {
  const candidates = [
    { package: "alpha", name: "@x/alpha", version: "1.0.0" },
    { package: "beta", name: "@x/beta", version: "2.0.0" },
  ];
  const existing = new Set(["claude/qualify-alpha-1.0.0"]);
  assert.deepEqual(packagesNeedingDispatch(candidates, existing), [{ package: "beta", name: "@x/beta", version: "2.0.0" }]);
});

test("packagesNeedingDispatch: an empty existing-branch set dispatches every candidate (the common case, no in-flight or completed run yet)", () => {
  const candidates = [{ package: "alpha", name: "@x/alpha", version: "1.0.0" }];
  assert.deepEqual(packagesNeedingDispatch(candidates, new Set()), candidates);
});

test("packagesNeedingDispatch: an unrelated branch name (same package, different version) does not suppress the candidate", () => {
  const candidates = [{ package: "alpha", name: "@x/alpha", version: "1.0.1" }];
  // A PRIOR version's qualification branch is a different string entirely —
  // it must never be mistaken for this candidate's own branch.
  const existing = new Set(["claude/qualify-alpha-1.0.0"]);
  assert.deepEqual(packagesNeedingDispatch(candidates, existing), candidates);
});

test("packagesNeedingDispatch: every candidate already branched leaves nothing to dispatch", () => {
  const candidates = [
    { package: "alpha", name: "@x/alpha", version: "1.0.0" },
    { package: "beta", name: "@x/beta", version: "2.0.0" },
  ];
  const existing = new Set(["claude/qualify-alpha-1.0.0", "claude/qualify-beta-2.0.0"]);
  assert.deepEqual(packagesNeedingDispatch(candidates, existing), []);
});

// ---------------------------------------------------------------- CLI coverage

function makeInputFile(candidates) {
  const dir = mkdtempSync(join(tmpdir(), "filter-qualification-dispatch-test-"));
  const path = join(dir, "unqualified.json");
  writeFileSync(path, JSON.stringify(candidates));
  return { dir, path };
}

// The CLI's own remote read (defaultExistingQualificationBranches) shells
// out to `git ls-remote`, which this suite never wants to hit for real — so
// these CLI-level cases run against a real git repo with a real `origin`
// remote pointed at a bare repo THIS test creates locally (no network), the
// same hermetic pattern this repository's other git-backed suites use.
function makeBareOriginWithBranches(branchNames) {
  const bareDir = mkdtempSync(join(tmpdir(), "filter-qualification-dispatch-bare-"));
  execFileSync("git", ["init", "--bare", "-q", bareDir]);
  const seedDir = mkdtempSync(join(tmpdir(), "filter-qualification-dispatch-seed-"));
  execFileSync("git", ["init", "-q", seedDir]);
  execFileSync("git", ["-C", seedDir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "seed"]);
  execFileSync("git", ["-C", seedDir, "remote", "add", "origin", bareDir]);
  for (const branch of branchNames) {
    execFileSync("git", ["-C", seedDir, "branch", branch]);
  }
  execFileSync("git", ["-C", seedDir, "push", "-q", "origin", "--all"]);
  return { bareDir, seedDir };
}

function run(inputPath, cwd, extraArgs = []) {
  return execFileSync(process.execPath, [scriptPath, inputPath, ...extraArgs], { cwd, encoding: "utf8" });
}

test("CLI: dispatches only the candidate with no existing qualification branch on the real remote", () => {
  const { bareDir, seedDir } = makeBareOriginWithBranches(["claude/qualify-alpha-1.0.0"]);
  const { dir: inputDir, path: inputPath } = makeInputFile([
    { package: "alpha", name: "@x/alpha", version: "1.0.0" },
    { package: "beta", name: "@x/beta", version: "2.0.0" },
  ]);
  try {
    const out = run(inputPath, seedDir, ["--json"]);
    assert.deepEqual(JSON.parse(out), [{ package: "beta", name: "@x/beta", version: "2.0.0" }]);
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
    rmSync(seedDir, { recursive: true, force: true });
    rmSync(inputDir, { recursive: true, force: true });
  }
});

test("CLI: nothing on the remote yet dispatches every candidate", () => {
  const { bareDir, seedDir } = makeBareOriginWithBranches([]);
  const { dir: inputDir, path: inputPath } = makeInputFile([{ package: "alpha", name: "@x/alpha", version: "1.0.0" }]);
  try {
    const out = run(inputPath, seedDir, ["--json"]);
    assert.deepEqual(JSON.parse(out), [{ package: "alpha", name: "@x/alpha", version: "1.0.0" }]);
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
    rmSync(seedDir, { recursive: true, force: true });
    rmSync(inputDir, { recursive: true, force: true });
  }
});

test("CLI: human-readable mode names the skipped candidate on stderr and prints only what still needs dispatch on stdout", () => {
  const { bareDir, seedDir } = makeBareOriginWithBranches(["claude/qualify-alpha-1.0.0"]);
  const { dir: inputDir, path: inputPath } = makeInputFile([{ package: "alpha", name: "@x/alpha", version: "1.0.0" }]);
  try {
    const result = spawnSync(process.execPath, [scriptPath, inputPath], { cwd: seedDir, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /nothing left to dispatch/);
    assert.match(result.stderr, /skipping alpha@1\.0\.0/);
    assert.match(result.stderr, /claude\/qualify-alpha-1\.0\.0 already exists on origin/);
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
    rmSync(seedDir, { recursive: true, force: true });
    rmSync(inputDir, { recursive: true, force: true });
  }
});
