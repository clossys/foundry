import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Static assertions against .github/workflows/record-publication-evidence.yml
// itself — the same shape scripts/publish-workflow.test.mjs already uses for
// publish.yml. These exist specifically to keep the 2026-09-23 blind
// security and correctness reviews' fixes from regressing quietly: B1
// (trust boundary/trigger gating), B3 (branch-prefix collision and
// same-repo/author filtering), S1 (gate on the job's conclusion, not the
// run's), S4 (paginate the PR lookup), and N1 (no per-workflow concurrency
// group that can evict a pending record).
const workflow = readFileSync(".github/workflows/record-publication-evidence.yml", "utf8");

function job(name) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `workflow is missing ${name} job`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^  [a-z][a-z0-9-]*:\n/m);
  return workflow.slice(start, next === -1 ? workflow.length : start + 1 + next);
}

test("record-publication-evidence.yml only triggers on workflow_run for Publish, with an empty top-level permissions block", () => {
  assert.match(workflow, /^on:\n {2}workflow_run:\n {4}workflows: \["Publish"\]\n {4}types: \[completed\]$/m);
  assert.match(workflow, /^permissions: \{\}$/m);
});

test("determine-package gates on origin, not conclusion (security review B1; correctness review S1)", () => {
  const determinePackage = job("determine-package");
  const ifMatch = determinePackage.match(/^ {4}if: >-\n([\s\S]*?)\n {4}runs-on:/m);
  assert.ok(ifMatch, "determine-package must declare a job-level if: >- expression");
  const condition = ifMatch[1];

  // B1: every one of these four clauses is required to establish this is
  // genuinely THIS repository's own publish.yml, dispatched manually, with
  // its head on this repository (not a fork) and on the default branch.
  assert.match(condition, /github\.event\.workflow_run\.event == 'workflow_dispatch'/, "must require the workflow_dispatch event");
  assert.match(condition, /github\.event\.workflow_run\.path == '\.github\/workflows\/publish\.yml'/, "must pin the exact workflow FILE path, not just its display name");
  assert.match(condition, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/, "must refuse a fork's head_repository");
  assert.match(condition, /github\.event\.workflow_run\.head_branch == github\.event\.repository\.default_branch/, "must require the default branch");

  // S1: the run's OVERALL conclusion must NOT gate this job — publish
  // (<key>) can succeed while a later job (verify-published) fails, and
  // that version was still genuinely uploaded. The job-name match inside
  // the step is the real signal, not workflow_run.conclusion.
  assert.doesNotMatch(condition, /workflow_run\.conclusion/, "must not gate on the run's overall conclusion (S1) — gate on the matched job's own conclusion instead");
});

test("determine-package reads the matched publish job's OWN run_attempt, never the run's (correctness review B2)", () => {
  const determinePackage = job("determine-package");
  assert.match(determinePackage, /match && Number\.isSafeInteger\(match\.run_attempt\)/, "must read run_attempt from the matched job object");
  assert.doesNotMatch(determinePackage, /github\.event\.workflow_run\.run_attempt/, "must not use the run's own run_attempt — a job can be individually re-run without re-running publish");
});

test("record-evidence passes the job-level run-attempt output, never the run's, into the build step", () => {
  const recordEvidence = job("record-evidence");
  const buildStep = recordEvidence.slice(recordEvidence.indexOf("- name: Build publication evidence record"));
  assert.match(buildStep, /RUN_ATTEMPT: \$\{\{ needs\.determine-package\.outputs\.run-attempt \}\}/);
  assert.doesNotMatch(buildStep.split("\n- name:")[0], /github\.event\.workflow_run\.run_attempt/);
});

test("record-evidence checks out the default branch first and verifies ancestry before checking out the publish run's source commit (security review B1)", () => {
  const recordEvidence = job("record-evidence");
  const checkoutIndex = recordEvidence.indexOf("uses: actions/checkout@");
  const ancestryIndex = recordEvidence.indexOf("Verify the publish run's source commit is part of this repository's reviewed history");
  const verifiedCheckoutIndex = recordEvidence.indexOf("Check out the verified source commit");
  assert.ok(checkoutIndex !== -1 && ancestryIndex !== -1 && verifiedCheckoutIndex !== -1);
  assert.ok(checkoutIndex < ancestryIndex && ancestryIndex < verifiedCheckoutIndex, "must checkout the trusted default branch, then verify ancestry, then check out the verified commit — in that order");
  assert.match(recordEvidence, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/, "the first checkout must pin the default branch, never the event's head_sha directly");
  assert.match(recordEvidence, /git merge-base --is-ancestor "\$SOURCE_SHA" HEAD/, "must prove the source commit is an ancestor of this repository's own reviewed history");
});

test("record-evidence uses no actions/cache anywhere (security review B1 cache-poisoning note)", () => {
  assert.doesNotMatch(workflow, /actions\/cache@/);
  const setupNodeSteps = [...workflow.matchAll(/uses: actions\/setup-node@[^\n]+\n((?:[ \t]+\S[^\n]*\n)*)/g)];
  assert.ok(setupNodeSteps.length > 0, "expected at least one actions/setup-node step");
  for (const [, body] of setupNodeSteps) assert.doesNotMatch(body, /cache:/, "setup-node must not opt into its own npm cache in this workflow");
});

test("record-evidence's concurrency group is keyed per publish run, never shared workflow-wide (security review N1; correctness review B1)", () => {
  // A shared workflow-wide group evicts a PENDING run whenever a new one
  // arrives, even with cancel-in-progress: false — measured to silently
  // drop 8 of 10 records on a real batched release day. There must be no
  // top-level concurrency: block, and record-evidence's own job-level group
  // must include workflow_run.id so two DIFFERENT publishes never compete
  // for the same pending slot.
  assert.doesNotMatch(workflow, /^concurrency:\n/m, "must not declare a workflow-wide concurrency: block");
  const recordEvidence = job("record-evidence");
  assert.match(recordEvidence, /group: record-publication-evidence-\$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(recordEvidence, /cancel-in-progress: false/);
});

test("record-evidence's permissions are exactly actions: read, contents: write, pull-requests: write — never id-token or a broader scope", () => {
  const recordEvidence = job("record-evidence");
  const permissionsMatch = recordEvidence.match(/permissions:\n((?: {6}\S[^\n]*\n)+)/);
  assert.ok(permissionsMatch, "record-evidence must declare its own permissions:");
  const lines = permissionsMatch[1].trim().split("\n").map((line) => line.trim()).sort();
  assert.deepEqual(lines, ["actions: read", "contents: write", "pull-requests: write"]);
});

test("the token authenticating this script's own GitHub API reads is not named GITHUB_TOKEN or GH_TOKEN (security review N2)", () => {
  const recordEvidence = job("record-evidence");
  const buildStep = recordEvidence.slice(recordEvidence.indexOf("- name: Build publication evidence record"), recordEvidence.indexOf("- name: Push branch"));
  assert.match(buildStep, /PUBLICATION_EVIDENCE_GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(buildStep, /\n\s+GITHUB_TOKEN: /);
  assert.doesNotMatch(buildStep, /\n\s+GH_TOKEN: /);
});

test("the batching branch prefix is reserved and distinct from this repository's claude/* agent-branch namespace (security review B3; correctness review B3)", () => {
  const recordEvidence = job("record-evidence");
  assert.match(recordEvidence, /BRANCH_PREFIX="automation\/publication-evidence\/"/);
  // The exact collision the correctness review measured: this PR's own head
  // branch, claude/publication-evidence-automation, matched the OLD
  // "claude/publication-evidence-" prefix.
  assert.doesNotMatch(recordEvidence, /BRANCH_PREFIX="claude\//);
});

test("the batching PR lookup filters on same-repository and the bot's own author, and is paginated with no default limit (security review B3; correctness review S4)", () => {
  const recordEvidence = job("record-evidence");
  const selectFn = recordEvidence.slice(recordEvidence.indexOf("select_reusable_branch()"), recordEvidence.indexOf("branch=\"\""));
  assert.match(selectFn, /isCrossRepository/, "must filter out cross-repository (fork) pull requests");
  assert.match(selectFn, /author\.login==\\"app\/github-actions\\"/, "must filter to only the bot's own pull requests");
  assert.match(selectFn, /--limit 500/, "must not rely on gh pr list's default 30-result limit");
});

test("an adopted branch's history is independently verified as bot-authored and scoped to the later-publications directory before it is written to (security review B3)", () => {
  const recordEvidence = job("record-evidence");
  const verifyFn = recordEvidence.slice(recordEvidence.indexOf("verify_branch_is_ours()"), recordEvidence.indexOf("select_reusable_branch()"));
  assert.match(verifyFn, /github-actions\[bot\] <41898282\+github-actions\[bot\]@users\.noreply\.github\.com>/);
  assert.match(verifyFn, /\^governance\/release-publications\/later\//);
  assert.match(recordEvidence, /Refusing to adopt an unverified branch/, "a branch that fails verification must fall back to a fresh branch, not be written to");
});

test("the push loop keeps a non-git copy of the built record and retries on conflict instead of failing outright (correctness review B1)", () => {
  const recordEvidence = job("record-evidence");
  const pushStep = recordEvidence.slice(recordEvidence.indexOf("- name: Push branch"));
  assert.match(pushStep, /safe_copy="\$RUNNER_TEMP\/publication-evidence-record\.json"/);
  assert.match(pushStep, /max_attempts=10/);
  assert.match(pushStep, /reused=true # a fresh branch that just raced another fresh push is now a reuse candidate too/);
});

test("a failed PR creation fails the job visibly after bounded retries, rather than silently splitting the batch (correctness review S3)", () => {
  const recordEvidence = job("record-evidence");
  const pushStep = recordEvidence.slice(recordEvidence.indexOf("- name: Push branch"));
  assert.match(pushStep, /gh_max_attempts=3/);
  assert.match(pushStep, /::error title=Could not open or update the publication-evidence pull request/);
});

test("idempotency is checked before any build work: an already-recorded version is a clean no-op (correctness review S2)", () => {
  const recordEvidence = job("record-evidence");
  assert.match(recordEvidence, /- name: Check whether this version's evidence already exists/);
  const idempotencyIndex = recordEvidence.indexOf("Check whether this version's evidence already exists");
  const buildIndex = recordEvidence.indexOf("- name: Build publication evidence record");
  assert.ok(idempotencyIndex < buildIndex);
  const gatedSteps = recordEvidence.slice(recordEvidence.indexOf("- name: Check out the verified source commit"));
  for (const stepName of ["Check out the verified source commit", "Assert release runtime", "Build publication evidence record", "Push branch and open or update the publication-evidence pull request"]) {
    const stepIndex = gatedSteps.indexOf(`- name: ${stepName}`);
    assert.ok(stepIndex !== -1, `expected a "${stepName}" step`);
    const stepBody = gatedSteps.slice(stepIndex, gatedSteps.indexOf("\n      - name:", stepIndex + 1));
    assert.match(stepBody, /if: steps\.idempotency\.outputs\.already-recorded != 'true'/, `"${stepName}" must be gated on the idempotency check`);
  }
});
