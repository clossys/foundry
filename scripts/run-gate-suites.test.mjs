// Regression test for the entry-point guard this script used to have:
// `if (process.argv[1] && import.meta.url === \`file://${process.argv[1]}\`) main();`
//
// That comparison is broken. `import.meta.url` is Node's own realpath- and
// percent-encoded module URL; `process.argv[1]` is neither. So the moment
// this script is reached through a symlinked directory, or through a path
// containing a space, `%`, `#`, or a non-ASCII character, the two sides
// disagree, the guard is false, `main()` never runs, and the process still
// exits 0 -- a silent, vacuous pass of exactly the kind `--shard-index`/
// `--shard-count`'s own zero-file guard (see gate-test-set.mjs) exists to
// rule out, just one layer earlier. Fixed by dropping the guard outright:
// nothing imports this file (confirmed by grep at the time of the fix), so
// there was never anything for it to protect against.
//
// This test reproduces both trigger shapes the review that caught this
// found -- a symlinked directory, and a path containing a space -- by
// symlinking the real scripts/ directory (this file's own directory, which
// holds run-gate-suites.mjs and its ./lib/gate-test-set.mjs import) into a
// fresh mkdtemp location, then invoking the script through that symlink
// with deliberately invalid shard arguments. Node resolves a symlink to its
// real target when loading an ES module, so `REPO_ROOT`
// (scripts/lib/gate-test-set.mjs's own `resolve(dirname(fileURLToPath(
// import.meta.url)), "..", "..")`) still lands on the real checkout either
// way -- meaning the ONLY thing standing between "ran and rejected the bad
// arguments" and "silently exited 0" was the guard itself.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// This test file lives in scripts/, next to run-gate-suites.mjs itself.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const realScriptPath = resolve(scriptsDir, "run-gate-suites.mjs");

// Deliberately invalid: shardIndex (9) is not < shardCount (4). Chosen to
// match the exact reproduction the review used, and specifically NOT the
// "discovered zero suites" or "missing scan root" failure paths -- this
// must fail because resolveGateShardArgs's own range check ran and refused
// the arguments, proving main() reached that far, not merely that SOME exit
// path fired first.
const INVALID_SHARD_ARGS = ["--shard-index", "9", "--shard-count", "4"];
const EXPECTED_ERROR = /shard-index.*shard-count.*0 <= shard-index < shard-count/s;

function runScriptAt(scriptPath) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...INVALID_SHARD_ARGS], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    // execFileSync throws on a non-zero exit; the thrown error still
    // carries status/stdout/stderr, which is exactly what this test needs.
    return { status: error.status, stdout: error.stdout?.toString() ?? "", stderr: error.stderr?.toString() ?? "" };
  }
}

test("invoked directly (no symlink, no space), invalid shard arguments exit non-zero with the range-check message", () => {
  const result = runScriptAt(realScriptPath);
  assert.notEqual(result.status, 0, "expected a non-zero exit for out-of-range --shard-index/--shard-count");
  assert.match(result.stderr, EXPECTED_ERROR);
});

test("invoked through a symlinked directory, invalid shard arguments still exit non-zero (regression: the removed entry-point guard used to make this silently exit 0)", () => {
  const work = mkdtempSync(join(tmpdir(), "run-gate-suites-symlink-"));
  try {
    const linkPath = join(work, "scripts-link");
    symlinkSync(scriptsDir, linkPath, "dir");
    const result = runScriptAt(join(linkPath, "run-gate-suites.mjs"));
    assert.notEqual(result.status, 0, "expected a non-zero exit through a symlinked directory, not a silent exit 0 with nothing run");
    assert.match(result.stderr, EXPECTED_ERROR);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("invoked through a path containing a space, invalid shard arguments still exit non-zero (regression: the removed entry-point guard used to make this silently exit 0)", () => {
  const work = mkdtempSync(join(tmpdir(), "run-gate-suites-space-"));
  try {
    const spacedDir = join(work, "has a space in it");
    mkdirSync(spacedDir);
    const linkPath = join(spacedDir, "scripts-link");
    symlinkSync(scriptsDir, linkPath, "dir");
    const result = runScriptAt(join(linkPath, "run-gate-suites.mjs"));
    assert.notEqual(result.status, 0, "expected a non-zero exit through a space-containing path, not a silent exit 0 with nothing run");
    assert.match(result.stderr, EXPECTED_ERROR);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("invoked through a symlinked directory reached via a space-containing path AND itself named with a space, invalid shard arguments still exit non-zero", () => {
  const work = mkdtempSync(join(tmpdir(), "run-gate-suites-combo-"));
  try {
    const spacedDir = join(work, "outer space");
    mkdirSync(spacedDir);
    const linkPath = join(spacedDir, "scripts link with spaces");
    symlinkSync(scriptsDir, linkPath, "dir");
    const result = runScriptAt(join(linkPath, "run-gate-suites.mjs"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, EXPECTED_ERROR);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
