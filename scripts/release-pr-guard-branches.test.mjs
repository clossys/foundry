// release-pr-guard-branches.test — textual regression coverage for issue
// #1392: the release-pr.yml Saturday guard's skip message must name the
// blocking branch(es) (not only its own stderr), and a leftover branch
// (a release PR closed without merging) must not block every subsequent
// Saturday forever. The pure classification logic itself is unit-tested in
// scripts/lib/release-calendar.test.mjs (inProgressReleaseBranches()); this
// file proves the ACTUAL workflow step actually calls it and actually
// prints its result, the same way scripts/apply-release-changesets.test.mjs's
// own "release-pr.yml stages docs/changelogs/" test reads the real YAML
// rather than trusting a description of it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = resolve(repoRoot, ".github", "workflows", "release-pr.yml");

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

test("release-pr.yml's guard classifies matched branches via inProgressReleaseBranches() rather than treating every matched branch as in progress forever", () => {
  const workflow = readWorkflow();
  assert.match(
    workflow,
    /inProgressReleaseBranches/,
    "the guard step must reuse scripts/lib/release-calendar.mjs's own leftover-branch classifier, not count a closed-without-merging release PR's branch as in progress forever",
  );
});

test("release-pr.yml's visible skip message names the in-progress branch(es), not only its own stderr", () => {
  const workflow = readWorkflow();
  assert.match(
    workflow,
    /in-progress release branch\(es\): \$in_progress_branches/,
    "a maintainer investigating a skipped Saturday run must be able to read the blocking branch name(s) in the job summary/log line itself, not have to dig through this step's stderr",
  );
});

// Review B1: runs the guard step's REAL inline script, extracted verbatim from
// the workflow, with a fake `gh` on PATH -- so this exercises the code the
// workflow actually runs, not a restatement of it. The fake refuses any call
// that does not request isCrossRepository.
function guardScript() {
  const match = /node --input-type=module -e '\n([\s\S]*?)\n\s*'\)"/.exec(readWorkflow());
  assert.ok(match, "the guard's inline node script must be extractable from release-pr.yml");
  return match[1];
}

function runGuard(t, ghJson) {
  const bin = mkdtempSync(join(tmpdir(), "release-pr-guard-gh-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, "gh"), `#!/bin/sh\ncase "$*" in *"--json state,isCrossRepository"*) printf '%s' "$FAKE_GH_JSON" ;; *) echo "fake gh: unexpected args: $*" >&2; exit 64 ;; esac\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const branch = "claude/release-2026-09-26-36024191110";
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", guardScript()], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "clossys/foundry", OPEN_COUNT: "0", BRANCH_REFS: `0000000000000000000000000000000000000000\trefs/heads/${branch}\n`, FAKE_GH_JSON: JSON.stringify(ghJson) },
  });
  return { ...result, branch, inProgressLine: result.stdout.split("\n")[1] };
}

test("the real guard script keeps a pushed release branch in progress when only a same-named FORK PR was closed", (t) => {
  const run = runGuard(t, [{ state: "CLOSED", isCrossRepository: true }]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.inProgressLine, run.branch);
  assert.doesNotMatch(run.stderr, /ignoring 1 leftover/);
});

test("the real guard script keeps the branch in progress when any same-repository PR is OPEN, and drops it only when all are CLOSED/MERGED", (t) => {
  assert.equal(runGuard(t, [{ state: "CLOSED", isCrossRepository: false }, { state: "OPEN", isCrossRepository: false }]).inProgressLine, "claude/release-2026-09-26-36024191110");
  const leftover = runGuard(t, [{ state: "CLOSED", isCrossRepository: false }, { state: "MERGED", isCrossRepository: false }]);
  assert.equal(leftover.status, 0, leftover.stderr);
  assert.equal(leftover.inProgressLine, "");
  assert.match(leftover.stderr, /ignoring 1 leftover .*claude\/release-2026-09-26-36024191110/);
});
