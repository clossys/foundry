import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Static assertions against .github/workflows/verify-standards.yml itself,
// in the same shape scripts/record-publication-evidence-workflow.test.mjs
// uses for its own workflow.
//
// Issue #1470: the `review-evidence` check reads review threads live, but
// before this change the workflow only ran on pull_request
// opened/synchronize/reopened/edited and on merge_group. A review thread
// posted AFTER the pull request's last run left `verify-standards` green on
// the pull request, so the pull request could be enqueued, and the merge
// queue's own run then ejected it with `failed_checks`. Measured on #1432:
// run 35982043999 (pull_request, success) finished at 09:34:55Z, an
// automated reviewer opened two threads at 09:43:55Z on the same head, and
// merge-group run 36058946310 reported `unresolved-thread` twice and the
// queue removed the pull request at 21:04:19Z.
const workflow = readFileSync(".github/workflows/verify-standards.yml", "utf8");
const policy = JSON.parse(readFileSync(".github/verify-standards-policy.json", "utf8"));

function block(name) {
  const start = workflow.search(new RegExp(`^${name}:`, "m"));
  assert.notEqual(start, -1, `workflow is missing top-level ${name}:`);
  const bodyStart = workflow.indexOf("\n", start) + 1;
  const next = workflow.slice(bodyStart).search(/^[a-z][a-z0-9_-]*:/m);
  return workflow.slice(start, next === -1 ? workflow.length : bodyStart + next);
}

// Comments stripped, so an assertion about the trigger or permission set
// cannot be satisfied by prose that merely mentions it.
function code(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const on = code(block("on"));
const permissions = code(block("permissions"));
const concurrency = code(block("concurrency"));
const jobs = code(block("jobs"));

test("re-evaluates when a review is submitted or dismissed (#1470)", () => {
  assert.match(
    on,
    /^ {2}pull_request_review:\n {4}types: \[submitted, dismissed\]$/m,
    "pull_request_review must re-run the gate for submitted and dismissed reviews",
  );
  // The existing triggers stay exactly as they were.
  assert.match(on, /^ {2}pull_request:\n {4}types: \[opened, synchronize, reopened, edited\]$/m);
  assert.match(on, /^ {2}merge_group:\s*$/m);
});

test("does not subscribe per-comment or elevated events", () => {
  // Every new review comment, including a reply, arrives as part of a
  // submitted review. pull_request_review_comment would add one run per
  // inline comment for the same verdict, and GitHub does not reliably emit
  // it for comments bundled into a review (#944).
  assert.doesNotMatch(on, /pull_request_review_comment/);
  // issue_comment cannot change a review thread and competes for runners
  // (#1471).
  assert.doesNotMatch(on, /issue_comment/);
  // This job runs the pull request's own code (npm ci, build, scripts), so
  // it must never run with the base repository's elevated context.
  assert.doesNotMatch(on, /pull_request_target/);
});

test("the task-record policy applies to review events, so a review run reports the same checks as a pull_request run", () => {
  // Otherwise task-record reports `not-applicable-event` (indeterminate,
  // exit 2) on every review-triggered run and turns the check red.
  assert.deepEqual(
    [...policy.applicableEventKinds].sort(),
    ["pull_request", "pull_request_review"],
  );
  // Only merge_group narrows the check list. A review-triggered run that
  // evaluated review-evidence alone could replace a task-record failure with
  // a pass on the same head, and the merge queue never re-asks task-record.
  assert.match(jobs, /^ {10}CHECKS="task-record,review-evidence"$/m);
  const narrowed = [...jobs.matchAll(/^ {12}CHECKS="([^"]*)"$/gm)];
  assert.equal(narrowed.length, 1, "exactly one narrowing of CHECKS");
  assert.equal(narrowed[0][1], "review-evidence");
  assert.match(jobs, /if \[ "\$\{\{ github\.event_name \}\}" = "merge_group" \]; then\n {12}CHECKS="review-evidence"/);
});

test("one job, no job-level condition", () => {
  const jobIds = [...jobs.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]);
  assert.deepEqual(jobIds, ["verify-standards"], "a review event must cost exactly one job");
  assert.match(jobs, /^ {4}name: verify-standards$/m);
  // A job skipped by `if:` still reports its required context, and GitHub
  // counts a skipped required check as passing. On a review event that
  // would replace a real failure on the same head with a pass.
  assert.doesNotMatch(jobs, /^ {4}if:/m, "the verify-standards job must not be conditional");
});

test("the job stays light: no test suite, no full build, bounded timeout", () => {
  assert.doesNotMatch(jobs, /npm (run )?test\b/);
  assert.doesNotMatch(jobs, /npm run check\b/);
  const builds = [...jobs.matchAll(/npm run build\b[^\n]*/g)].map((match) => match[0]);
  assert.deepEqual(builds, [
    "npm run build --workspace=packages/controller",
    "npm run build --workspace=packages/inspector",
  ]);
  const timeout = jobs.match(/^ {4}timeout-minutes: (\d+)$/m);
  assert.ok(timeout, "the job must declare timeout-minutes");
  assert.ok(Number(timeout[1]) <= 15);
});

test("concurrency is keyed by the pull request's ref and cancels superseded evaluations", () => {
  // github.ref is refs/pull/<number>/merge for both pull_request and
  // pull_request_review, so a burst of reviews on one pull request collapses
  // to the newest run, and different pull requests never cancel each other.
  assert.match(concurrency, /^ {2}group: verify-standards-\$\{\{ github\.ref \}\}$/m);
  assert.match(concurrency, /^ {2}cancel-in-progress: true$/m);
});

test("permissions are read-only and unchanged", () => {
  const scopes = [...permissions.matchAll(/^ {2}([a-z-]+): ([a-z]+)$/gm)].map((match) => `${match[1]}: ${match[2]}`);
  assert.deepEqual(scopes, ["contents: read", "pull-requests: read", "issues: read", "checks: read"]);
  assert.doesNotMatch(workflow, /:\s*write\b/);
});

test("a review-triggered run binds evidence to the head its own event names", () => {
  assert.match(jobs, /--head "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/);
  assert.match(jobs, /--pr "\$\{\{ github\.event\.pull_request\.number \}\}"/);
});
