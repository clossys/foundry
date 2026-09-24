import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Static assertions against .github/workflows/qualify-candidate.yml itself —
// the same shape scripts/publish-workflow.test.mjs and
// scripts/record-publication-evidence-workflow.test.mjs use for their own
// workflows. The rule pinned here is the one that workflow's header states:
// no job that executes candidate code holds a write-scoped token. The
// qualify job runs the candidate and its dependency closure read-only; a
// separate job, which needs it, holds contents/pull-requests write and runs
// only this repository's own scripts from a fresh checkout, treating the
// qualify job's uploaded record as untrusted data.
const workflow = readFileSync(".github/workflows/qualify-candidate.yml", "utf8");

const QUALIFY = "qualify";
const WRITER = "open-pull-request";
const UPLOAD_ARTIFACT = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";
const DOWNLOAD_ARTIFACT = "actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131";

function jobNames() {
  const body = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
  return [...body.matchAll(/^ {2}([a-z][a-z0-9-]*):\n/gm)].map((match) => match[1]);
}

function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `workflow is missing ${name} job`);
  const from = start + 1;
  const next = workflow.slice(from + 1).search(/^ {2}[a-z][a-z0-9-]*:\n/m);
  return workflow.slice(from, next === -1 ? workflow.length : from + 1 + next);
}

function step(selected, name) {
  const start = selected.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `workflow is missing ${name} step`);
  const rest = selected.slice(start + 1);
  const next = rest.search(/^ {6}- /m);
  return selected.slice(start, next === -1 ? selected.length : start + 1 + next);
}

/** Job text with YAML comment lines removed, so prose about what a job must NOT do cannot satisfy or trip a check. */
function code(text) {
  return text.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
}

/** A job's own permissions block as { scope: level }, or null when it declares none. */
function permissionsOf(selected) {
  const match = selected.match(/^ {4}permissions:(.*)\n((?: {6}[a-z-]+: [a-z]+\n)*)/m);
  if (!match) return null;
  if (match[1].trim() === "{}") return {};
  assert.equal(match[1].trim(), "", "job permissions must be a block mapping or {}");
  return Object.fromEntries([...match[2].matchAll(/^ {6}([a-z-]+): ([a-z]+)$/gm)].map((line) => [line[1], line[2]]));
}

/** The workflow's top-level permissions, parsed the same way; a job with no block of its own inherits these. */
function workflowPermissions() {
  const match = workflow.match(/^permissions:(.*)\n((?: {2}[a-z-]+: [a-z-]+\n)*)/m);
  if (!match) return null;
  if (match[1].trim() === "{}") return {};
  if (match[1].trim() !== "") return { "*": match[1].trim() };
  return Object.fromEntries([...match[2].matchAll(/^ {2}([a-z-]+): ([a-z]+)$/gm)].map((line) => [line[1], line[2]]));
}

const effectivePermissions = (name) => permissionsOf(job(name)) ?? workflowPermissions() ?? { "*": "default" };
const holdsWrite = (permissions) => Object.values(permissions).some((level) => ["write", "write-all", "default"].includes(level));

// What "executes candidate or third-party package code" looks like in a job:
// installing or running packages, invoking the qualification and generation
// scripts that deliberately import or rebuild the candidate (by invocation --
// the push step's commit message still names them as prose), and restoring
// a cache another run may have written.
const EXECUTES_PACKAGE_CODE = [
  /\bnode\s+\S*run-candidate-qualification\.mjs/,
  /\bnode\s+\S*generate-qualification-record\.mjs/,
  /\bnpm\s+(?:ci|install|i|add|run|run-script|test|start|exec|pack|rebuild|publish|x)\b/,
  /\bnpx\b/,
  /\byarn\b|\bpnpm\b/,
  /actions\/cache@/,
  /^\s+cache:/m,
];

test("qualify-candidate.yml grants nothing workflow-wide; every job declares its own permissions", () => {
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.equal((workflow.match(/^permissions:/gm) ?? []).length, 1, "exactly one top-level permissions key");
  assert.deepEqual(jobNames(), [QUALIFY, WRITER]);
  for (const name of jobNames()) assert.notEqual(permissionsOf(job(name)), null, `${name} must declare its own permissions`);
});

test("the qualify job runs the candidate with contents: read only, no secrets, no persisted credentials", () => {
  const qualify = job(QUALIFY);
  assert.deepEqual(permissionsOf(qualify), { contents: "read" });
  assert.match(code(qualify), /node scripts\/run-candidate-qualification\.mjs/, "qualification must run in the qualify job");
  assert.doesNotMatch(code(qualify), /secrets\./, "the qualify job must reference no secret");
  assert.doesNotMatch(code(qualify), /GH_TOKEN|GITHUB_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN/, "the qualify job must set no token");
  assert.doesNotMatch(code(qualify), /^ {4}environment:/m, "the qualify job must use no deployment environment");
  assert.doesNotMatch(code(qualify), /gh pr create|git push/, "the qualify job must not push or open a pull request");
});

test("no job that holds a write permission executes candidate or package code", () => {
  // Effective permissions: a job without its own block inherits the
  // workflow's, and a workflow with none gets the repository default, which
  // is treated as write here because this file cannot see that setting.
  const writers = jobNames().filter((name) => holdsWrite(effectivePermissions(name)));
  for (const name of writers) {
    const body = code(job(name));
    for (const pattern of EXECUTES_PACKAGE_CODE) assert.doesNotMatch(body, pattern, `${name} holds a write token and must not match ${pattern}`);
  }
  assert.deepEqual(writers, [WRITER]);
});

test("the write job needs qualify and holds exactly contents and pull-requests write", () => {
  const writer = job(WRITER);
  assert.match(writer, /^ {4}needs: (?:qualify|\[qualify\])$/m);
  assert.deepEqual(permissionsOf(writer), { contents: "write", "pull-requests": "write" });
});

test("the write job does a fresh checkout of the dispatched commit with no persisted credentials", () => {
  const writer = code(job(WRITER));
  const checkout = writer.match(/- uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n((?: {8}[^\n]*\n)*)/);
  assert.ok(checkout, "the write job must check out the repository itself");
  assert.match(checkout[1], /ref: \$\{\{ github\.sha \}\}/);
  assert.match(checkout[1], /persist-credentials: false/);
});

test("every checkout in the workflow sets persist-credentials: false", () => {
  const checkouts = [...workflow.matchAll(/uses: actions\/checkout@[^\n]+\n((?: {8}[^\n]*\n)*)/g)];
  assert.equal(checkouts.length, 2);
  for (const [, body] of checkouts) assert.match(body, /persist-credentials: false/);
});

test("the hand-off is one uploaded record file, downloaded outside the workspace and accepted by trusted code before any push", () => {
  const qualify = code(job(QUALIFY));
  const writer = code(job(WRITER));
  assert.ok(qualify.includes(`uses: ${UPLOAD_ARTIFACT}`), "upload-artifact must be pinned by the SHA used elsewhere in this repository");
  assert.match(qualify, /path: \$\{\{ runner\.temp \}\}\/handoff\/qualification-record\.json\n/);
  assert.match(qualify, /retention-days: \d+/);
  assert.ok(writer.includes(`uses: ${DOWNLOAD_ARTIFACT}`), "download-artifact must be pinned by the SHA used elsewhere in this repository");
  assert.match(writer, /path: \$\{\{ runner\.temp \}\}\/handoff\n/);
  assert.match(qualify, /name: qualification-record-\$\{\{ github\.run_attempt \}\}/);
  assert.match(writer, /name: qualification-record-\$\{\{ github\.run_attempt \}\}/);

  const acceptIndex = writer.indexOf("node scripts/accept-qualification-handoff.mjs");
  const deferralIndex = writer.indexOf("node scripts/remove-qualification-deferral.mjs");
  const changeSetIndex = writer.indexOf("- name: Verify the change set is exactly the record and its deferral");
  const pushIndex = writer.indexOf("- name: Push branch and open pull request");
  assert.ok(acceptIndex !== -1 && deferralIndex !== -1 && changeSetIndex !== -1 && pushIndex !== -1);
  assert.ok(acceptIndex < deferralIndex && deferralIndex < changeSetIndex && changeSetIndex < pushIndex, "accept, then remove the deferral, then verify the change set, then push");
  assert.match(writer, /--reviewed-commit "\$REVIEWED_COMMIT"/);
  assert.match(writer, /REVIEWED_COMMIT: \$\{\{ github\.sha \}\}/);
});

test("the write job reads nothing from the qualify job but its artifact", () => {
  assert.doesNotMatch(code(job(WRITER)), /needs\.qualify\.outputs/, "the qualify job's outputs are untrusted; recompute them from the fresh checkout");
});

test("only the push step sees the write token", () => {
  const writer = job(WRITER);
  const push = step(writer, "Push branch and open pull request");
  assert.match(push, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.equal((code(workflow).match(/secrets\./g) ?? []).length, 1, "secrets.GITHUB_TOKEN appears exactly once, in the push step");
  assert.equal((code(workflow).match(/GH_TOKEN:/g) ?? []).length, 1);
});

test("the workflow_dispatch interface auto-qualify.yml dispatches against is unchanged", () => {
  assert.match(
    workflow,
    /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}package:\n {8}description: [^\n]+\n {8}required: true\n {8}type: string\n {6}version:\n {8}description: >-\n(?: {10}[^\n]+\n)+ {8}required: false\n {8}default: ""\n {8}type: string\n\n/m,
  );
  const autoQualify = readFileSync(".github/workflows/auto-qualify.yml", "utf8");
  assert.match(autoQualify, /gh workflow run qualify-candidate\.yml -f "package=\$pkg"/);
});
