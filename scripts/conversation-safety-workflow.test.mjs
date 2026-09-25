import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// Static shape assertions for the conversation-safety event gate and its
// review relay. The principle they hold in place: no job that holds a write
// token or the denylist secret runs code or workflow definitions from a pull
// request's tree. pull_request_review and pull_request_review_comment load
// the workflow file from the pull request's merge commit, so those events
// may only reach a credential-free relay; the privileged scan runs from the
// default branch via workflow_run and treats the relay's record as data.
const PRIVILEGED = ".github/workflows/conversation-safety.yml";
const RELAY = ".github/workflows/conversation-safety-review-relay.yml";
const privileged = readFileSync(PRIVILEGED, "utf8");
const relay = existsSync(RELAY) ? readFileSync(RELAY, "utf8") : "";

/** The top-level `key:` block of a workflow, up to the next top-level key. */
function topLevel(text, key) {
  const match = text.match(new RegExp(`^${key}:.*\\n(?:(?:[ #].*)?\\n)*`, "m"));
  assert.ok(match, `workflow is missing top-level ${key}:`);
  return match[0];
}

/** One job's block under `jobs:`, up to the next job. */
function job(text, name) {
  const jobs = text.slice(text.indexOf("\njobs:\n"));
  const start = jobs.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `workflow is missing ${name} job`);
  const rest = jobs.slice(start + 1);
  const next = rest.slice(1).search(/^ {2}[a-z][a-z0-9_-]*:\n/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** One step's block within a job, located by its name or uses. */
function step(jobText, marker) {
  const start = jobText.indexOf(marker);
  assert.notEqual(start, -1, `job is missing step ${marker}`);
  const stepStart = jobText.lastIndexOf("\n      - ", start);
  const rest = jobText.slice(stepStart + 1);
  const next = rest.slice(1).search(/^ {6}- /m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Only the non-comment lines, so explanatory prose never satisfies a check. */
function code(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const REVIEW_EVENTS = /^\s{2}(pull_request_review|pull_request_review_comment):/m;

test("the review relay workflow exists", () => {
  assert.ok(existsSync(RELAY), `${RELAY} is missing`);
});

test("the privileged workflow has no review-event triggers", () => {
  const on = code(topLevel(privileged, "on"));
  assert.doesNotMatch(on, REVIEW_EVENTS);
  assert.doesNotMatch(on, /^\s{2}pull_request:/m, "must not trigger on plain pull_request either");
  for (const kept of ["issues", "issue_comment", "pull_request_target"]) {
    assert.match(on, new RegExp(`^ {2}${kept}:`, "m"), `existing trigger ${kept} must stay`);
  }
  assert.match(on, /^ {2}workflow_run:\n {4}workflows: \["Conversation safety review relay"\]\n {4}types: \[completed\]$/m);
  assert.match(relay, /^name: Conversation safety review relay$/m, "workflow_run must name the relay's actual display name");
});

test("the privileged workflow grants nothing at the top level", () => {
  assert.match(privileged, /^permissions: \{\}$/m);
});

test("the relay subscribes to both review events and nothing else", () => {
  const on = code(topLevel(relay, "on"));
  assert.match(on, /^ {2}pull_request_review:\n {4}types: \[submitted, edited\]$/m);
  assert.match(on, /^ {2}pull_request_review_comment:\n {4}types: \[created, edited\]$/m);
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(triggers, ["pull_request_review", "pull_request_review_comment"]);
});

test("the relay holds no token scope, no secret, no checkout, and runs no repository code", () => {
  const body = code(relay);
  assert.match(body, /^permissions: \{\}$/m, "top-level permissions must be empty");
  assert.doesNotMatch(body.slice(body.indexOf("\njobs:\n")), /^\s+permissions:/m, "no job may widen permissions");
  assert.doesNotMatch(body, /secrets\./, "must reference no secret");
  assert.doesNotMatch(body, /github\.token|GITHUB_TOKEN|GH_TOKEN/, "must not hand the token to any step");
  assert.doesNotMatch(body, /actions\/checkout/, "must not check anything out");
  assert.doesNotMatch(body, /\bnode\b|\bnpm\b|\bnpx\b|scripts\/|\.\/|\bbash\s+\S+\.sh|\bsh\s+\S+\.sh/, "no run: may execute repository code");
  assert.doesNotMatch(body, /\.body\b|\.title\b/, "must never carry review or comment text");
  assert.doesNotMatch(body, /^concurrency:/m, "a cancelled relay run is a review never scanned");

  const uses = [...body.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(uses, ["actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"], "the only action is the repository's pinned upload-artifact");
  const upload = step(job(relay, "relay"), "actions/upload-artifact@");
  assert.match(upload, /name: conversation-safety-review-event\n/);
  assert.match(upload, /retention-days: 1\n/);

  const record = step(job(relay, "relay"), "name: Record review event identifiers");
  const run = record.slice(record.indexOf("run: |"));
  assert.doesNotMatch(run, /\$\{\{/, "event values reach the shell only through env:");
});

test("the scan job checks out the default-branch sha explicitly without persisted credentials", () => {
  const scan = job(privileged, "scan");
  const checkout = step(scan, "actions/checkout@");
  assert.match(checkout, /^ {10}ref: \$\{\{ github\.sha \}\}$/m);
  assert.match(checkout, /^ {10}persist-credentials: false$/m);
  assert.doesNotMatch(code(privileged), /refs\/pull|pull_request\.head|pull_request\.merge_commit_sha|workflow_run\.head_sha/, "nothing may check out or reference a pull request's tree");
});

test("the scan job reads only, and gates workflow_run on the relay file and review events", () => {
  const scan = job(privileged, "scan");
  const perms = scan.match(/^ {4}permissions:\n((?: {6}.*\n)+)/m);
  assert.ok(perms, "scan must declare job-level permissions");
  const granted = perms[1].trim().split("\n").map((line) => line.trim()).sort();
  assert.deepEqual(granted, ["actions: read", "contents: read", "pull-requests: read"]);
  const condition = scan.match(/^ {4}if: >-\n((?: {6}.*\n)+)/m)?.[1] ?? "";
  // The first arm keeps issues, issue_comment and pull_request_target
  // scanning; deleting it would silently stop every non-review scan.
  assert.match(condition, /^\s*github\.event_name != 'workflow_run'\n\s*\|\| \(/, "non-workflow_run events must always pass the job condition");
  // A failed or cancelled relay must reach the download and go red, not skip.
  assert.doesNotMatch(condition, /conclusion/, "the relay's conclusion must not gate the scan");
  assert.match(condition, /github\.event\.workflow_run\.path == '\.github\/workflows\/conversation-safety-review-relay\.yml'/);
  assert.match(condition, /github\.event\.workflow_run\.event == 'pull_request_review'/);
  assert.match(condition, /github\.event\.workflow_run\.event == 'pull_request_review_comment'/);
});

test("the workflow_run path validates the relay record as data and fetches text itself via the API", () => {
  const scan = job(privileged, "scan");
  const download = step(scan, "actions/download-artifact@");
  assert.match(download, /uses: actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131/);
  assert.match(download, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(download, /path: \$\{\{ runner\.temp \}\}\//, "the record lands outside the checkout");

  assert.match(download, /^ {8}if: \$\{\{ github\.event_name == 'workflow_run' \}\}$/m, "download stays gated to workflow_run");

  const validate = step(scan, "name: Validate review relay record");
  assert.match(validate, /^ {8}if: \$\{\{ github\.event_name == 'workflow_run' \}\}$/m, "validation stays gated to workflow_run");
  assert.match(validate, /node scripts\/validate-review-relay-event\.mjs "\$RELAY_RECORD" --repo "\$GITHUB_REPOSITORY"/);

  // Ordering: untrusted record handled before the denylist exists on disk.
  assert.ok(scan.indexOf("name: Validate review relay record") < scan.indexOf("name: Materialise denylist"));

  const gate = step(scan, "name: Run conversation safety gate");
  const env = gate.slice(0, gate.indexOf("run: |"));
  assert.match(env, /RELAY_PR_NUMBER: \$\{\{ steps\.relay\.outputs\.pull_request \}\}/);
  assert.doesNotMatch(env, /steps\.relay\.outputs\.(body|text)/);
  const run = gate.slice(gate.indexOf("run: |"));
  assert.doesNotMatch(run, /\$\{\{/, "the gate script body interpolates nothing");
  // The scanner fetches the object by id (and checks it belongs to the
  // relayed pull request) plus its whole edit history; the shell reads no
  // text and pipes nothing in.
  assert.match(run, /node scripts\/check-conversation-safety\.mjs --pr "\$RELAY_PR_NUMBER" --review "\$RELAY_REVIEW_ID" --edit-history --require-denylist < \/dev\/null/);
  assert.match(run, /node scripts\/check-conversation-safety\.mjs --pr "\$RELAY_PR_NUMBER" --review-comment "\$RELAY_COMMENT_ID" --edit-history --require-denylist < \/dev\/null/);
  const workflowRunBranch = run.slice(run.indexOf("workflow_run)"), run.indexOf("\n            *)"));
  assert.doesNotMatch(code(workflowRunBranch), /\bgh api\b|\bjq\b/, "the relayed text is fetched by the scanner, not the shell");
});

test("the job-result step reads the recorded status through env:, never ${{ }} in run:", () => {
  const reflect = step(job(privileged, "scan"), "name: Reflect gate result in job status");
  assert.match(reflect, /GATE_STATUS: \$\{\{ steps\.gate\.outputs\.status \}\}/);
  assert.doesNotMatch(reflect.slice(reflect.indexOf("run: |")), /\$\{\{/);
});

test("the concurrency group keys workflow_run by the relay run, never collapsing review scans", () => {
  const concurrency = code(topLevel(privileged, "concurrency"));
  assert.match(concurrency, /github\.event\.workflow_run\.id/);
  assert.ok(concurrency.indexOf("github.event.workflow_run.id") < concurrency.indexOf("github.ref"));
  assert.match(concurrency, /cancel-in-progress: false/);
});

test("the label job writes but holds no secret, checks nothing out, and consumes only scan outputs", () => {
  const label = job(privileged, "label");
  const body = code(label);
  assert.match(body, /^ {4}needs: scan$/m);
  assert.match(body, /^ {4}if: \$\{\{ always\(\) && needs\.scan\.outputs\.status == '1' \}\}$/m);
  const perms = body.match(/^ {4}permissions:\n((?: {6}.*\n)+)/m);
  assert.ok(perms, "label must declare job-level permissions");
  assert.deepEqual(perms[1].trim().split("\n").map((line) => line.trim()).sort(), ["issues: write", "pull-requests: write"]);
  assert.doesNotMatch(body, /secrets\./);
  assert.doesNotMatch(body, /actions\/checkout|actions\/setup-node|actions\/download-artifact/);
  assert.doesNotMatch(body, /^\s+run:/m, "no shell step");
  assert.doesNotMatch(body, /DENYLIST/);
  const expressions = [...body.matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) => m[1].trim());
  for (const expression of expressions) {
    assert.match(expression, /^(always\(\) && )?needs\.scan\.outputs\.(status|target_number)( == '1')?$/, `unexpected input ${expression}`);
  }
  assert.match(body, /labels: \[label\]/);
  assert.match(body, /const label = "public-safety";/);
});

test("only the scan job holds the denylist, and no job both holds it and can write", () => {
  assert.doesNotMatch(code(topLevel(privileged, "permissions")), /write/, "no write scope may be inherited from the top level");
  const scan = code(job(privileged, "scan"));
  assert.match(scan, /secrets\.PUBLIC_SAFETY_DENYLIST_B64/);
  assert.doesNotMatch(scan, /:\s*write\b/);
  assert.equal((code(privileged).match(/secrets\./g) ?? []).length, 1);
});

test("no comment is ever posted", () => {
  assert.doesNotMatch(code(privileged), /createComment|gh (pr|issue) comment/);
  assert.doesNotMatch(code(relay), /createComment|gh (pr|issue) comment/);
});
