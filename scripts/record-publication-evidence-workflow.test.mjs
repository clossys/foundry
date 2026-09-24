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

function step(name) {
  const recordEvidence = job("record-evidence");
  const start = recordEvidence.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `record-evidence is missing the "${name}" step`);
  const next = recordEvidence.indexOf("\n      - ", start + 1);
  return recordEvidence.slice(start, next === -1 ? recordEvidence.length : next);
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

test("the open evidence PR lookup filters on same-repository, the bot's own author, and the reserved prefix, and is paginated with no default limit (security review B3; correctness review S4)", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  const lookup = pushStep.slice(pushStep.indexOf('open_evidence_prs="$(gh pr list'), pushStep.indexOf("while IFS=' ' read -r open_number open_branch"));
  assert.match(lookup, /isCrossRepository\|not/, "must filter out cross-repository (fork) pull requests");
  assert.match(lookup, /author\.login==\\"app\/github-actions\\"/, "must filter to only the bot's own pull requests");
  assert.match(lookup, /startswith\(\\"\$\{BRANCH_PREFIX\}\\"\)/, "must filter to the reserved prefix");
  assert.match(lookup, /--limit 500/, "must not rely on gh pr list's default 30-result limit");
});

test("the branch helpers are sourced from the shared, independently-tested script AFTER checking out the default branch's tip, so the YAML and the functions it calls are one revision (issue #1468)", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  const checkoutIndex = pushStep.indexOf('git checkout -B work "origin/${GITHUB_BASE_REF_OR_DEFAULT}"');
  const sourceIndex = pushStep.indexOf("source scripts/lib/publication-evidence-branch.sh");
  assert.ok(checkoutIndex !== -1 && sourceIndex !== -1);
  assert.ok(checkoutIndex < sourceIndex, "must source the helpers from the default-branch checkout, never from the publish run's older source commit");
  for (const inline of ["verify_branch_is_ours()", "classify_open_evidence_branch()", "evidence_branch_name()"]) {
    assert.ok(!pushStep.includes(inline), `${inline} must not be redefined inline`);
  }
});

test("a fresh branch name comes from evidence_branch_name — run id plus runner entropy — never the predictable run id alone (security re-review, finding B3-residual)", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  assert.match(pushStep, /branch="\$\(evidence_branch_name "\$BRANCH_PREFIX" "\$RUN_ID"\)"/);
  assert.doesNotMatch(pushStep, /branch="\$\{BRANCH_PREFIX\}\$\{RUN_ID\}"\s*$/m, "must never fall back to the predictable BRANCH_PREFIX+RUN_ID name alone");
});

test("the push step keeps a non-git copy of the built record and removes the working-tree copy before the first checkout (fresh-final review S2)", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  assert.match(pushStep, /safe_copy="\$RUNNER_TEMP\/publication-evidence-record\.json"/);
  assert.match(pushStep, /cp "\$RECORD_PATH" "\$safe_copy"\n\s*rm -f "\$RECORD_PATH"/, "the untracked working-tree copy must be removed before checkout -B is ever called");
  assert.ok(pushStep.indexOf('rm -f "$RECORD_PATH"') < pushStep.indexOf("git checkout -B work"));
  assert.match(pushStep, /max_attempts=3/);
});

test("the PR is always created fresh for this run's own branch, never edited or resolved by branch name (security re-review, finding B3-residual; issue #1468)", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  assert.match(pushStep, /gh pr create --title "\$title" --base "\$GITHUB_BASE_REF_OR_DEFAULT" --head "\$branch"/);
  assert.doesNotMatch(workflow, /gh pr edit/, "an earlier run's pull request is never edited");
  assert.doesNotMatch(workflow, /gh pr close/, "an earlier run's pull request is never closed by this workflow");
  assert.ok(pushStep.indexOf("gh pr create") > pushStep.indexOf('git push origin "work:refs/heads/${branch}"'), "the PR is opened only after the push lands");
});

test("a failed PR creation fails the job visibly after bounded retries, and the error message does not promise a pickup no later run performs (correctness review S3; fresh-final review S4)", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  assert.match(pushStep, /gh_max_attempts=3/);
  assert.match(pushStep, /::error title=Could not open the publication-evidence pull request/);
  assert.doesNotMatch(pushStep, /a later trigger will find this branch/i);
  assert.match(pushStep, /a human must open one from it directly/);
});

// Issue #1468: publication evidence PR #1461 was built by adopting an older
// run's branch whose base predated publisher 0.7.0's qualification record;
// scripts/check-later-publications.mjs rejected it and no merge could repair
// the ancestry. These pin the replacement: one fresh branch per run, cut
// from the default branch's current tip, fail-closed on an open duplicate.
test("#1468: the only base any commit is built on is the freshly fetched default-branch tip — an earlier run's branch is never checked out, committed on, or pushed to", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  assert.match(pushStep, /git fetch origin "\+refs\/heads\/\$\{GITHUB_BASE_REF_OR_DEFAULT\}:refs\/remotes\/origin\/\$\{GITHUB_BASE_REF_OR_DEFAULT\}"/, "must refresh the default branch before cutting from it");
  const checkouts = [...pushStep.matchAll(/git checkout -B work "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(checkouts, ["origin/${GITHUB_BASE_REF_OR_DEFAULT}"], "exactly one checkout, and it is the default branch");
  assert.doesNotMatch(pushStep, /select_candidate_branch|reused=|candidate_branch/, "no adoption of an earlier run's branch");
  const pushes = [...pushStep.matchAll(/git push origin "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pushes, ["work:refs/heads/${branch}"], "exactly one push, of this run's own commit");
  const loop = pushStep.slice(pushStep.indexOf("while :; do"), pushStep.indexOf('title="Record publication evidence'));
  assert.ok(loop.includes("git push origin"), "the push must be inside the retry loop");
  assert.match(loop, /branch="\$\(evidence_branch_name/, "each push attempt picks a NEW name, never retries onto an existing branch");
});

test("#1468: the publish source commit must already be in the base before the record is committed", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  assert.match(pushStep, /SOURCE_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  const guardIndex = pushStep.indexOf('if ! git merge-base --is-ancestor "$SOURCE_SHA" work; then');
  assert.ok(guardIndex !== -1, "must prove the base contains the publish source");
  assert.ok(guardIndex > pushStep.indexOf("git checkout -B work") && guardIndex < pushStep.indexOf("git commit -F"));
});

test("#1468: scripts/check-later-publications.mjs gates the committed branch before anything is pushed", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  const commitIndex = pushStep.indexOf("git commit -F");
  const gateIndex = pushStep.indexOf("if ! node scripts/check-later-publications.mjs; then");
  const pushIndex = pushStep.indexOf("git push origin");
  assert.ok(commitIndex !== -1 && gateIndex !== -1 && pushIndex !== -1);
  assert.ok(commitIndex < gateIndex && gateIndex < pushIndex);
  assert.match(pushStep.slice(gateIndex, pushIndex), /exit 1/);
});

test("#1468: an open evidence PR already carrying this record is a no-op only when classified duplicate, and fails the run otherwise — before anything is written", () => {
  const pushStep = step("Push branch and open the publication-evidence pull request");
  const classifyIndex = pushStep.indexOf('verdict="$(classify_open_evidence_branch "origin/${open_branch}" "origin/${GITHUB_BASE_REF_OR_DEFAULT}" "$RECORD_PATH" "$safe_copy" "$SOURCE_SHA")"');
  assert.ok(classifyIndex !== -1);
  assert.ok(classifyIndex < pushStep.indexOf('cp "$safe_copy" "$RECORD_PATH"'), "must decide before writing the record");
  const cases = pushStep.slice(classifyIndex, pushStep.indexOf("esac", classifyIndex));
  assert.match(cases, /absent\) ;;/);
  assert.match(cases, /duplicate\)\n[^\n]*::notice[^\n]*\n\s*exit 0/);
  assert.match(cases, /\*\)\n[^\n]*::error title=Conflicting open evidence pull request[^\n]*\n\s*exit 1/, "any other verdict fails closed");
  assert.match(workflow, /^# ONE PULL REQUEST PER RECORD, CUT FROM THE CURRENT DEFAULT BRANCH \(#1468\)$/m, "the file header documents the policy");
});

test("idempotency is checked before any build work: an already-recorded version is a clean no-op (correctness review S2)", () => {
  const recordEvidence = job("record-evidence");
  assert.match(recordEvidence, /- name: Check whether this version's evidence already exists/);
  const idempotencyIndex = recordEvidence.indexOf("Check whether this version's evidence already exists");
  const buildIndex = recordEvidence.indexOf("- name: Build publication evidence record");
  assert.ok(idempotencyIndex < buildIndex);
  const gatedSteps = recordEvidence.slice(recordEvidence.indexOf("- name: Check out the verified source commit"));
  for (const stepName of ["Check out the verified source commit", "Assert release runtime", "Build publication evidence record", "Push branch and open the publication-evidence pull request"]) {
    const stepIndex = gatedSteps.indexOf(`- name: ${stepName}`);
    assert.ok(stepIndex !== -1, `expected a "${stepName}" step`);
    const stepBody = gatedSteps.slice(stepIndex, gatedSteps.indexOf("\n      - name:", stepIndex + 1));
    assert.match(stepBody, /if: steps\.idempotency\.outputs\.already-recorded != 'true'/, `"${stepName}" must be gated on the idempotency check`);
  }
});
