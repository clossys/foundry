#!/usr/bin/env node
// push-tree-identical — detect a GitHub merge commit on main whose tree is
// byte-identical to the merged pull-request head (second parent).
//
//   GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main node scripts/push-tree-identical.mjs
//
// Writes `duplicate=true|false` to $GITHUB_OUTPUT and stdout. Always exits 0:
// this is a router, never a gate. A detector failure must mean "run CI", not
// "skip CI" — skipping a required job that should have run is how a context
// stops reporting.
//
// WHY THIS EXISTS
// ---------------
// After `gh pr merge --merge`, GitHub creates a merge commit whose *tree* is
// the same object as the PR head that just passed required checks (the PR
// head was already `Merge main into <branch>`). `on.push` to main then starts
// a second full `ci.yml` run. On the Free plan the org has 20 concurrent
// GitHub-hosted jobs; that duplicate run queues the next stacked PR's
// `build and test` behind it. Live qualification is untouched: it lives in
// publish.yml, not here.
//
// A non-merge push, a merge whose parents disagree on the tree, or any event
// that is not a push to main reports duplicate=false.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function defaultGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * @param {{ eventName?: string, ref?: string, cwd?: string, gitRun?: typeof defaultGit }} [options]
 * @returns {boolean}
 */
export function isDuplicateMergeTree({ eventName = process.env.GITHUB_EVENT_NAME, ref = process.env.GITHUB_REF, cwd = process.cwd(), gitRun = defaultGit } = {}) {
  if (eventName !== "push" || ref !== "refs/heads/main") return false;
  let secondParentTree;
  let headTree;
  try {
    gitRun(["rev-parse", "--verify", "HEAD^2"], cwd);
    headTree = gitRun(["rev-parse", "HEAD^{tree}"], cwd);
    secondParentTree = gitRun(["rev-parse", "HEAD^2^{tree}"], cwd);
  } catch {
    return false;
  }
  return headTree === secondParentTree && /^[0-9a-f]{40}$/.test(headTree);
}

export function reportDuplicate(duplicate, { outputPath = process.env.GITHUB_OUTPUT, write = appendFileSync, log = console.log } = {}) {
  const line = `duplicate=${duplicate ? "true" : "false"}`;
  log(line);
  if (outputPath) write(outputPath, `${line}\n`);
}

function main() {
  try {
    reportDuplicate(isDuplicateMergeTree());
  } catch (error) {
    reportDuplicate(false);
    logDetectorFailure(error);
  }
}

function logDetectorFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`push-tree-identical detector failed; running CI: ${message}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
