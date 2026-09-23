import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { isDuplicateMergeTree, reportDuplicate } from "./push-tree-identical.mjs";
import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeRepo(t) {
  const dir = makeTmpDirSync(t, "push-tree-identical-");
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "test@example.invalid"], dir);
  git(["config", "user.name", "push-tree test"], dir);
  writeFileSync(join(dir, "README.md"), "base\n");
  git(["add", "."], dir);
  git(["commit", "-qm", "base"], dir);
  return dir;
}

test("pull_request and other events are never duplicates", () => {
  assert.equal(isDuplicateMergeTree({ eventName: "pull_request", ref: "refs/heads/main" }), false);
  assert.equal(isDuplicateMergeTree({ eventName: "push", ref: "refs/heads/other" }), false);
  assert.equal(isDuplicateMergeTree({ eventName: "workflow_dispatch", ref: "refs/heads/main" }), false);
});

test("a single-parent push to main is not a duplicate", (t) => {
  const dir = makeRepo(t);
  assert.equal(isDuplicateMergeTree({ eventName: "push", ref: "refs/heads/main", cwd: dir }), false);
});

test("a GitHub-shaped merge whose tree equals the second parent is a duplicate", (t) => {
  const dir = makeRepo(t);
  git(["checkout", "-qb", "pr"], dir);
  writeFileSync(join(dir, "feature.md"), "pr\n");
  git(["add", "."], dir);
  git(["commit", "-qm", "feature"], dir);
  const prHead = git(["rev-parse", "HEAD"], dir);
  git(["checkout", "-q", "main"], dir);
  git(["merge", "--no-ff", "-m", "Merge pull request #1 from pr", prHead], dir);
  assert.equal(git(["rev-parse", "HEAD^{tree}"], dir), git(["rev-parse", "HEAD^2^{tree}"], dir));
  assert.equal(isDuplicateMergeTree({ eventName: "push", ref: "refs/heads/main", cwd: dir }), true);
});

test("a merge whose tree differs from the second parent is not a duplicate", (t) => {
  const dir = makeRepo(t);
  git(["checkout", "-qb", "pr"], dir);
  writeFileSync(join(dir, "feature.md"), "pr\n");
  git(["add", "."], dir);
  git(["commit", "-qm", "feature"], dir);
  const prHead = git(["rev-parse", "HEAD"], dir);
  git(["checkout", "-q", "main"], dir);
  writeFileSync(join(dir, "main-only.md"), "main moved\n");
  git(["add", "."], dir);
  git(["commit", "-qm", "main moved"], dir);
  git(["merge", "--no-ff", "-m", "Merge pull request #1 from pr", prHead], dir);
  assert.notEqual(git(["rev-parse", "HEAD^{tree}"], dir), git(["rev-parse", "HEAD^2^{tree}"], dir));
  assert.equal(isDuplicateMergeTree({ eventName: "push", ref: "refs/heads/main", cwd: dir }), false);
});

test("a git failure reports not-duplicate (run CI)", () => {
  assert.equal(
    isDuplicateMergeTree({
      eventName: "push",
      ref: "refs/heads/main",
      gitRun: () => {
        throw new Error("not a merge");
      },
    }),
    false,
  );
});

test("reportDuplicate writes GITHUB_OUTPUT without throwing when unset", () => {
  const lines = [];
  reportDuplicate(true, { outputPath: undefined, log: (line) => lines.push(line) });
  assert.deepEqual(lines, ["duplicate=true"]);
  const written = [];
  reportDuplicate(false, { outputPath: "/tmp/unused", write: (path, text) => written.push([path, text]), log: () => {} });
  assert.deepEqual(written, [["/tmp/unused", "duplicate=false\n"]]);
});
