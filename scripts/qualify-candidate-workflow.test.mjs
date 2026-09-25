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

/**
 * The steps of a job (comment lines removed), each as { name, text, run }:
 * `run` is the step's shell body, block (`run: |`) or single-line.
 */
function stepsOf(selected) {
  const body = code(selected);
  const starts = [...body.matchAll(/^ {6}- /gm)].map((match) => match.index);
  return starts.map((start, index) => {
    const text = body.slice(start, starts[index + 1] ?? body.length);
    const name = text.match(/^ {6}- name: ([^\n]+)$/m)?.[1] ?? text.match(/^ {8}name: ([^\n]+)$/m)?.[1] ?? text.match(/^ {6}- uses: ([^\n]+)$/m)?.[1];
    const block = text.match(/^ {8}run: [|>][-+]?\n((?: {10}[^\n]*\n|\n)*)/m);
    const single = text.match(/^ {8}run: (?![|>])([^\n]+)$/m);
    return { name, text, run: block ? block[1] : single ? single[1] : "" };
  });
}

/** The part of a job before its first step: needs, permissions, env, runs-on and the like. */
function jobHeader(selected) {
  const body = code(selected);
  const first = body.search(/^ {4}steps:$/m);
  assert.notEqual(first, -1, "job must declare steps");
  return body.slice(0, first);
}

const PUSH_STEP = "Push branch and open pull request";
const TOKEN_REFERENCE = /\bsecrets\b|\bgithub\s*(?:\.|\[\s*['"])token\b/g;
const HANDOFF_PATH = /(?:\$RUNNER_TEMP|\$\{RUNNER_TEMP\}|\$\{\{\s*runner\.temp\s*\}\})\/handoff/g;
// The only first arguments `node` may take anywhere in the write job: the
// two trusted scripts it needs, and inline reads of the fresh checkout.
const WRITER_NODE_ARGUMENTS = new Set(["-p", "--version", "scripts/accept-qualification-handoff.mjs", "scripts/remove-qualification-deferral.mjs"]);
const WRITER_ACTIONS = [
  "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131",
];

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
  assert.doesNotMatch(job(QUALIFY), /^ {4}outputs:/m, "the qualify job declares no outputs at all: they would be untrusted, and the write job recomputes everything from its fresh checkout");
  assert.doesNotMatch(stepsOf(job(WRITER)).map((s) => s.text).join(""), /\bneeds\b/, "no write-job step may read needs.* in any form");
  assert.doesNotMatch(code(workflow), /toJSON\(\s*needs/);
});

test("only the push step sees the write token, in any spelling", () => {
  assert.doesNotMatch(code(workflow), /^env:/m, "no workflow-level env");
  assert.doesNotMatch(code(job(QUALIFY)), TOKEN_REFERENCE, "the qualify job references no secret and no github.token");
  const header = jobHeader(job(WRITER));
  assert.doesNotMatch(header, TOKEN_REFERENCE, "no token in the write job's job-level keys");
  assert.doesNotMatch(header, /^ {4}(?:env|defaults|container|services):/m, "no job-level env, defaults, container or services in the write job");

  const steps = stepsOf(job(WRITER));
  const push = steps.filter((s) => s.name === PUSH_STEP);
  assert.equal(push.length, 1);
  assert.match(push[0].text, /^ {10}GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}$/m);
  assert.equal((push[0].text.match(TOKEN_REFERENCE) ?? []).length, 1, "the push step names the token exactly once");
  for (const other of steps.filter((s) => s.name !== PUSH_STEP)) {
    assert.doesNotMatch(other.text, TOKEN_REFERENCE, `${other.name} must not reference secrets.* or github.token`);
    assert.doesNotMatch(other.text, /^ {10}(?:github-)?token:/m, `${other.name} must not pass a token input to an action`);
  }
});

test("the write job runs only allowlisted actions and commands, and never executes anything from the hand-off", () => {
  const writer = job(WRITER);
  const steps = stepsOf(writer);
  const uses = steps.map((s) => s.text.match(/^ {6}- uses: (\S+)|^ {8}uses: (\S+)/m)).filter(Boolean).map((m) => m[1] ?? m[2]);
  assert.deepEqual(uses, WRITER_ACTIONS, "the write job uses exactly checkout, setup-node and download-artifact, pinned");
  for (const s of steps) {
    assert.doesNotMatch(s.text, /^ {8}(?:shell|working-directory):/m, `${s.name} must not override its shell or working directory`);
    assert.doesNotMatch(s.text, /^ {10}cache(?:-dependency-path)?:/m, `${s.name} must not restore a cache`);
    for (const [, argument] of s.run.matchAll(/(?:^|[\s;&|("'`])node\s+(\S+)/g)) {
      const normalized = argument.replace(/[)"'`;]+$/, "");
      assert.ok(WRITER_NODE_ARGUMENTS.has(normalized), `${s.name} runs node ${argument}; the write job may only run ${[...WRITER_NODE_ARGUMENTS].join(", ")}`);
    }
    // Command position: start of a line, after a separator or `$(`, or
    // after then/do/else. Prose inside printf strings is not at one.
    const commandPosition = String.raw`(?:^[ \t]*|[;&|(\x60][ \t]*|\$\([ \t]*|\b(?:then|do|else)[ \t]+)`;
    assert.doesNotMatch(s.run, new RegExp(`${commandPosition}(?:bash|sh|zsh|dash|source|eval|exec|python3?|perl|ruby|deno|bun|npx|npm|yarn|pnpm|chmod|install|env)\\b`, "m"), `${s.name} must not invoke another interpreter, npm, or make anything executable`);
    assert.doesNotMatch(s.run, new RegExp(`${commandPosition}\\.[ \t]`, "m"), `${s.name} must not source a file`);
    assert.doesNotMatch(s.run, new RegExp(`${commandPosition}"?(?:\\$\\{?RUNNER_TEMP|\\$\\{\\{\\s*runner\\.temp|/|~)`, "m"), `${s.name} must not execute a path, least of all one under the runner temp directory`);
    assert.doesNotMatch(s.text, /GITHUB_ENV|GITHUB_PATH/, `${s.name} must not alter later steps' environment or PATH`);
  }

  // The hand-off location appears exactly twice: where it is downloaded, and
  // where the trusted acceptor is pointed at it. Nothing else names it.
  const handoff = steps.flatMap((s) => (s.text.match(HANDOFF_PATH) ?? []).map(() => s.name));
  assert.deepEqual(handoff, ["Download qualification record", "Accept qualification record hand-off"]);
  assert.match(steps.find((s) => s.name === "Download qualification record").text, /^ {10}path: \$\{\{ runner\.temp \}\}\/handoff$/m);
  assert.match(steps.find((s) => s.name === "Accept qualification record hand-off").run, /node scripts\/accept-qualification-handoff\.mjs [^\n]*--handoff-dir "\$RUNNER_TEMP\/handoff" /);
  assert.doesNotMatch(code(writer), /qualification-record\.json/, "the write job never names the hand-off file itself; only the acceptor opens it");
});

test("the workflow_dispatch interface auto-qualify.yml dispatches against is unchanged", () => {
  assert.match(
    workflow,
    /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}package:\n {8}description: [^\n]+\n {8}required: true\n {8}type: string\n {6}version:\n {8}description: >-\n(?: {10}[^\n]+\n)+ {8}required: false\n {8}default: ""\n {8}type: string\n\n/m,
  );
  const autoQualify = readFileSync(".github/workflows/auto-qualify.yml", "utf8");
  assert.match(autoQualify, /gh workflow run qualify-candidate\.yml -f "package=\$pkg"/);
});
