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

const PUSH_STEP = "Push branch and open or update the publication-evidence pull request";

test("the open evidence PR lookup filters on same-repository, the bot's own author, and the reserved prefix, is paginated with no default limit, and sorts oldest-first so the last one seen is the newest (security review B3; correctness review S4)", () => {
  const pushStep = step(PUSH_STEP);
  const lookup = pushStep.slice(pushStep.indexOf('open_evidence_prs="$(gh pr list'), pushStep.indexOf("while IFS=' ' read -r open_number open_branch"));
  assert.match(lookup, /isCrossRepository\|not/, "must filter out cross-repository (fork) pull requests");
  assert.match(lookup, /author\.login==\\"app\/github-actions\\"/, "must filter to only the bot's own pull requests");
  assert.match(lookup, /startswith\(\\"\$\{BRANCH_PREFIX\}\\"\)/, "must filter to the reserved prefix");
  assert.match(lookup, /sort_by\(\.number\)/, "newest must be well-defined");
  assert.match(lookup, /--limit 500/, "must not rely on gh pr list's default 30-result limit");
});

test("the branch helpers are sourced from the shared, independently-tested script AFTER checking out the default branch's tip, and the gate is the default branch's own copy (issue #1468)", () => {
  const pushStep = step(PUSH_STEP);
  const checkoutIndex = pushStep.indexOf('git checkout -B work "origin/${GITHUB_BASE_REF_OR_DEFAULT}"');
  const sourceIndex = pushStep.indexOf("source scripts/lib/publication-evidence-branch.sh");
  assert.ok(checkoutIndex !== -1 && sourceIndex !== -1);
  assert.ok(checkoutIndex < sourceIndex, "must source the helpers from the default-branch checkout, never from the publish run's older source commit");
  for (const inline of ["verify_branch_is_ours()", "classify_open_evidence_branch()", "evidence_branch_name()"]) {
    assert.ok(!pushStep.includes(inline), `${inline} must not be redefined inline`);
  }
  assert.match(pushStep, /git worktree add -q --detach "\$gate_dir" "origin\/\$\{GITHUB_BASE_REF_OR_DEFAULT\}"/);
});

test("a fresh branch name always comes from evidence_branch_name — run id plus runner entropy — never the predictable run id alone (security re-review, finding B3-residual)", () => {
  const pushStep = step(PUSH_STEP);
  const assignments = [...pushStep.matchAll(/^\s*branch=(.*)$/gm)].map((m) => m[1]);
  assert.ok(assignments.length >= 4, "fresh-name assignments are expected on every fall-back path");
  for (const value of assignments) {
    assert.ok(value === '"$newest_branch"' || value === '"$(evidence_branch_name "$BRANCH_PREFIX" "$RUN_ID")"', `unexpected branch assignment: ${value}`);
  }
  assert.doesNotMatch(pushStep, /branch="\$\{BRANCH_PREFIX\}\$\{RUN_ID\}"\s*$/m, "must never fall back to the predictable BRANCH_PREFIX+RUN_ID name alone");
});

test("the push step keeps a non-git copy of the built record, removes the working-tree copy before the first checkout, and retries on conflict (correctness review B1; fresh-final review S2)", () => {
  const pushStep = step(PUSH_STEP);
  assert.match(pushStep, /safe_copy="\$RUNNER_TEMP\/publication-evidence-record\.json"/);
  assert.match(pushStep, /cp "\$RECORD_PATH" "\$safe_copy"\n\s*rm -f "\$RECORD_PATH"/, "the untracked working-tree copy must be removed before checkout -B is ever called");
  assert.ok(pushStep.indexOf('rm -f "$RECORD_PATH"') < pushStep.indexOf("git checkout -B work"));
  assert.match(pushStep, /max_attempts=10/);
});

test("PRs are edited by NUMBER, looked up fresh after the push lands — never resolved by branch name, never closed (security re-review, finding B3-residual; fresh-final review S1)", () => {
  const pushStep = step(PUSH_STEP);
  const lookupIndex = pushStep.indexOf('open_pr="$(gh pr list');
  assert.ok(lookupIndex !== -1, "expected a fresh open_pr lookup");
  assert.ok(lookupIndex > pushStep.indexOf('git push origin "work:refs/heads/${branch}"'), "the PR lookup must happen after the push");
  const lookup = pushStep.slice(lookupIndex, pushStep.indexOf("gh_attempt=0"));
  assert.match(lookup, /--head "\$branch"/);
  assert.match(lookup, /isCrossRepository/);
  assert.match(lookup, /author\.login=="app\/github-actions"/);
  assert.doesNotMatch(pushStep, /gh pr edit "\$branch"/);
  assert.match(pushStep, /gh pr edit "\$pr_number"/);
  assert.doesNotMatch(workflow, /gh pr close/, "this workflow never closes a pull request, stale or otherwise");
  assert.doesNotMatch(workflow, /push[^\n]*(--force|-f |\+work)/, "no force-push of any kind");
});

test("a failed PR creation fails the job visibly after bounded retries, and the error message does not promise a pickup the adoption lookup cannot perform (correctness review S3; fresh-final review S4)", () => {
  const pushStep = step(PUSH_STEP);
  assert.match(pushStep, /gh_max_attempts=3/);
  assert.match(pushStep, /::error title=Could not open or update the publication-evidence pull request/);
  assert.doesNotMatch(pushStep, /a later trigger will find this branch/i);
  assert.match(pushStep, /a human must open one from it directly/);
});

// Issue #1468: publication evidence PR #1461 was built by adopting an older
// run's branch whose base predated publisher 0.7.0's qualification record;
// scripts/check-later-publications.mjs rejected it and no merge could repair
// the ancestry. The defect was adopting a branch whose base did NOT contain
// the publish source. These pin the guarded replacement.
function decisionBlock(pushStep) {
  return pushStep.slice(pushStep.indexOf('conflict_pr=""'), pushStep.indexOf('message_file="$RUNNER_TEMP'));
}

test("#1468: every open evidence PR is classified; a conflict or broken PR anywhere fails before a duplicate anywhere is honoured, and all precede any write", () => {
  const pushStep = step(PUSH_STEP);
  const block = decisionBlock(pushStep);
  assert.match(block, /verdict="\$\(classify_open_evidence_branch "origin\/\$\{open_branch\}" "origin\/\$\{GITHUB_BASE_REF_OR_DEFAULT\}" "\$RECORD_PATH" "\$safe_copy" "\$SOURCE_SHA"\)"/);
  const conflictIndex = block.indexOf('if [ -n "$conflict_pr" ]; then');
  const brokenIndex = block.indexOf('if [ -n "$broken_pr" ]; then');
  const duplicateIndex = block.indexOf('if [ -n "$duplicate_pr" ]; then');
  assert.ok(conflictIndex !== -1 && brokenIndex !== -1 && duplicateIndex !== -1 && conflictIndex < duplicateIndex && brokenIndex < duplicateIndex, "fail closed first");
  assert.match(block.slice(conflictIndex, brokenIndex), /::error title=Conflicting open evidence pull request[^\n]*\n\s*exit 1/);
  assert.match(block.slice(brokenIndex, duplicateIndex), /::error title=Open evidence pull request cannot pass the retained-record gate::[^\n]*the #1461 shape[^\n]*\n\s*exit 1/, "the #1461 shape fails closed with its own message");
  assert.match(block.slice(duplicateIndex), /::notice title=Already pending[^\n]*\n\s*exit 0/);
  assert.ok(pushStep.indexOf("git commit -F") > pushStep.indexOf(block));
});

test("#1468: only the NEWEST open PR, and only when classified adoptable, is adopted; a PR that predates this record's source gets a notice saying it stays valid; anything else starts fresh", () => {
  const block = decisionBlock(step(PUSH_STEP));
  assert.match(block, /if \[ "\$newest_verdict" = adoptable \]; then\n\s*branch="\$newest_branch"\n\s*reused=true/);
  const notice = block.match(/predates\) echo "::notice title=([^"]*)"/);
  assert.ok(notice, "a predates PR must get a notice");
  assert.match(notice[1], /remains valid for its own records -- merge it normally/);
  assert.doesNotMatch(notice[1], /close|#1461/i, "a PR that merely predates this record's source is valid; never tell a human to close it");
  const elseBranch = block.slice(block.indexOf("reused=true"));
  assert.match(elseBranch, /else[\s\S]*branch="\$\(evidence_branch_name "\$BRANCH_PREFIX" "\$RUN_ID"\)"\n\s*reused=false/);
});

test("#1468: a fresh branch is cut only from the default branch, which must contain the publish source; an adopted one is re-classified adoptable on EVERY attempt before anything is built on it", () => {
  const pushStep = step(PUSH_STEP);
  assert.match(pushStep, /if ! git merge-base --is-ancestor "\$SOURCE_SHA" "origin\/\$\{GITHUB_BASE_REF_OR_DEFAULT\}"; then/);
  const loop = pushStep.slice(pushStep.indexOf("max_attempts=10"), pushStep.indexOf("record_files="));
  const classify = loop.indexOf('verdict="$(classify_open_evidence_branch "origin/${branch}"');
  const build = loop.indexOf('git checkout -q -B work "$base"');
  assert.ok(classify !== -1 && build !== -1 && classify < build);
  assert.match(loop, /adoptable\) base="origin\/\$\{branch\}" ;;/);
  assert.match(loop, /base="origin\/\$\{GITHUB_BASE_REF_OR_DEFAULT\}"/);
  const bases = [...pushStep.matchAll(/git checkout (?:-q )?-B work "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(bases, ["origin/${GITHUB_BASE_REF_OR_DEFAULT}", "$base"], "no other base is ever checked out");
  const pushes = [...pushStep.matchAll(/git push origin "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pushes, ["work:refs/heads/${branch}"], "exactly one push, a plain (fast-forward-only) one");
});

test("#1468: the default branch's check-later-publications gates every commit before it is pushed; an adopted branch that fails it falls back to a fresh branch, a fresh one fails the run", () => {
  const pushStep = step(PUSH_STEP);
  const loop = pushStep.slice(pushStep.indexOf("max_attempts=10"), pushStep.indexOf("record_files="));
  const commit = loop.indexOf("git commit -F");
  const gate = loop.indexOf('if ! node "$gate_dir/scripts/check-later-publications.mjs"; then');
  const push = loop.indexOf("git push origin");
  assert.ok(commit !== -1 && gate !== -1 && push !== -1 && commit < gate && gate < push);
  const onFail = loop.slice(gate, push);
  assert.match(onFail, /if \[ "\$reused" = true \]; then[\s\S]*branch="\$\(evidence_branch_name "\$BRANCH_PREFIX" "\$RUN_ID"\)"\n\s*reused=false\n\s*continue/);
  assert.match(onFail, /::error title=Publication evidence fails the retained-record gate[^\n]*\n\s*exit 1/);
});

test("#1468: the file header documents the guarded batching policy, that a predating PR stays valid, and the merge-commit dependency", () => {
  assert.match(workflow, /^# BATCHED, BUT ONLY ONTO A BASE THAT CONTAINS THE SOURCE \(#1346, #1468\)$/m);
  const header = workflow.slice(0, workflow.indexOf("\non:"));
  assert.match(header, /never closes a pull request or\n# force-pushes/);
  assert.match(header, /remains\n# valid for its own records and should be merged normally/);
  assert.match(header, /Batching relies on the merge queue creating MERGE commits/);
  assert.doesNotMatch(header, /stale pull request/i);
});

test("#1468: a branch that cannot be fetched is reported as missing, never as a non-bot or out-of-path branch", () => {
  const pushStep = step(PUSH_STEP);
  assert.match(pushStep, /verdict=missing # deleted since the listing/);
  assert.match(pushStep, /missing\) echo "::notice title=Newest evidence branch could not be fetched::/);
  const loop = pushStep.slice(pushStep.indexOf("max_attempts=10"), pushStep.indexOf("record_files="));
  assert.match(loop, /verdict=missing\n\s*if git fetch origin/);
  assert.match(loop, /missing\)\n\s*echo "::notice title=Adopted branch could not be fetched::/);
  assert.match(loop, /broken\)\n\s*echo "::error title=Open evidence pull request cannot pass the retained-record gate::[^\n]*\n\s*exit 1/);
  assert.doesNotMatch(pushStep, /verdict=foreign/, "foreign is reserved for a branch that fetched and failed verify_branch_is_ours");
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
