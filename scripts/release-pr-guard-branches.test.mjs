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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "release-pr.yml");

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
