import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// Runs the ACTUAL "Run conversation safety gate" step body from
// .github/workflows/conversation-safety.yml, for the relayed-review
// (workflow_run) branch, against a stubbed `gh` and a synthetic denylist.
// The case this exists for: review text posted with a finding and edited
// clean before the scan runs. The scan fetches the current text by id, so
// only the edit history (GraphQL userContentEdits) still carries the finding;
// it must be labelled (status 1), and an unreadable history must be "could
// not run" (status 2), never a pass.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "example-owner/example-repo";
const TERM = "acme-corp";

function gateStepScript() {
  const workflow = readFileSync(join(repoRoot, ".github/workflows/conversation-safety.yml"), "utf8");
  const stepStart = workflow.indexOf("- name: Run conversation safety gate");
  assert.notEqual(stepStart, -1);
  const runStart = workflow.indexOf("        run: |\n", stepStart);
  assert.notEqual(runStart, -1);
  const lines = workflow.slice(runStart + "        run: |\n".length).split("\n");
  const body = [];
  for (const line of lines) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

// A `gh` stand-in. REST paths map to fixed JSON; `api graphql` serves
// userContentEdits pages per node id, or fails for a node marked "fail".
const FAKE_GH = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const fixture = JSON.parse(readFileSync(process.env.FAKE_GH_FIXTURE, "utf8"));
const args = process.argv.slice(2);
if (args[0] !== "api") process.exit(1);
if (args[1] === "graphql") {
  const fields = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "-f") { const [k, ...v] = args[++i].split("="); fields[k] = v.join("="); }
  }
  if (!/userContentEdits/.test(fields.query || "")) process.exit(1);
  const pages = fixture.graphql[fields.id];
  if (pages === undefined || pages === "fail") { process.stderr.write("GraphQL: Resource not accessible by integration\\n"); process.exit(1); }
  if (pages === "null-node") { process.stdout.write(JSON.stringify({ data: { node: null } })); process.exit(0); }
  const index = fields.cursor ? Number(fields.cursor.slice(1)) : 0;
  process.stdout.write(JSON.stringify({ data: { node: { userContentEdits: {
    pageInfo: { hasNextPage: index < pages.length - 1, endCursor: "c" + (index + 1) },
    nodes: pages[index],
  } } } }));
  process.exit(0);
}
const data = fixture.rest[args[1]];
if (data === undefined) { process.stderr.write("HTTP 404: Not Found\\n"); process.exit(1); }
process.stdout.write(JSON.stringify(args.includes("--slurp") ? [data] : data));
`;

let work;
let ghDir;
let denylist;

before(() => {
  work = mkdtempSync(join(tmpdir(), "conversation-review-scan-"));
  ghDir = join(work, "bin");
  mkdirSync(ghDir);
  writeFileSync(join(ghDir, "gh"), FAKE_GH);
  chmodSync(join(ghDir, "gh"), 0o755);
  denylist = join(work, "denylist.json");
  writeFileSync(
    denylist,
    JSON.stringify({ version: "synthetic-test", terms: [{ pattern: TERM, why: "synthetic", severity: "high" }] }),
  );
});

after(() => rmSync(work, { recursive: true, force: true }));

const API = `https://api.github.com/repos/${REPO}`;
const edit = (editedAt, diff, deletedAt = null) => ({ editedAt, deletedAt, diff });

function reviewRest(id, body, comments = []) {
  return {
    [`repos/${REPO}/pulls/44/reviews/${id}`]: { id, node_id: `PRR_${id}`, body, html_url: `https://example.invalid/r${id}` },
    [`repos/${REPO}/pulls/44/reviews/${id}/comments`]: comments,
  };
}

function commentRest(id, body, pr = 44) {
  return {
    [`repos/${REPO}/pulls/comments/${id}`]: {
      id,
      node_id: `PRRC_${id}`,
      body,
      html_url: `https://example.invalid/c${id}`,
      pull_request_url: `${API}/pulls/${pr}`,
    },
  };
}

function runGate(relay, fixture) {
  const dir = mkdtempSync(join(work, "run-"));
  const fixturePath = join(dir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(fixture));
  const script = join(dir, "gate.sh");
  writeFileSync(script, gateStepScript());
  const output = join(dir, "github-output");
  writeFileSync(output, "");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      PATH: `${ghDir}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: dir,
      GH_EVENT_NAME: "workflow_run",
      GH_TOKEN: "stub",
      GITHUB_REPOSITORY: REPO,
      GITHUB_API_URL: "https://api.github.com",
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: dir,
      PUBLIC_SAFETY_DENYLIST: denylist,
      FAKE_GH_FIXTURE: fixturePath,
      RELAY_EVENT: relay.event,
      RELAY_PR_NUMBER: "44",
      RELAY_REVIEW_ID: relay.reviewId ?? "",
      RELAY_COMMENT_ID: relay.commentId ?? "",
    },
  });
  assert.equal(result.status, 0, `gate step itself must always exit 0: ${result.stderr}`);
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("=")),
  );
  assert.ok(!result.stdout.includes(TERM) && !result.stderr.includes(TERM), "a matched term must never be echoed");
  return { status: outputs.status, target: outputs.target_number, log: result.stdout };
}

test("review summary posted with a finding, edited clean before the scan: status 1, labelled on the PR", () => {
  const r = runGate(
    { event: "pull_request_review", reviewId: "501" },
    {
      rest: reviewRest(501, "Looks good."),
      graphql: { PRR_501: [[edit("2026-01-01T00:01:00Z", "Looks good."), edit("2026-01-01T00:00:00Z", `Checked against ${TERM} setup.`)]] },
    },
  );
  assert.equal(r.status, "1");
  assert.equal(r.target, "44");
  assert.match(r.log, /review 501 \(earlier revision from 2026-01-01T00:00:00Z\)/);
});

test("inline comment inside a review, edited clean before the scan: status 1", () => {
  const r = runGate(
    { event: "pull_request_review", reviewId: "502" },
    {
      rest: reviewRest(502, "", [{ id: 50201, node_id: "PRRC_50201", body: "Fine now.", html_url: "https://example.invalid/c50201" }]),
      graphql: {
        PRR_502: [[]],
        PRRC_50201: [[edit("2026-01-01T00:01:00Z", "Fine now."), edit("2026-01-01T00:00:00Z", `Mentions ${TERM}.`)]],
      },
    },
  );
  assert.equal(r.status, "1");
  assert.match(r.log, /review comment 50201 \(earlier revision/);
});

test("standalone review comment posted with a finding, edited clean before the scan: status 1", () => {
  const r = runGate(
    { event: "pull_request_review_comment", commentId: "601" },
    {
      rest: commentRest(601, "Nothing to see."),
      graphql: { PRRC_601: [[edit("2026-01-01T00:01:00Z", "Nothing to see."), edit("2026-01-01T00:00:00Z", `See ${TERM}.`)]] },
    },
  );
  assert.equal(r.status, "1");
  assert.equal(r.target, "44");
});

test("a finding only on a later page of the edit history is still found: status 1", () => {
  const r = runGate(
    { event: "pull_request_review_comment", commentId: "602" },
    {
      rest: commentRest(602, "Clean."),
      graphql: {
        PRRC_602: [[edit("2026-01-01T00:02:00Z", "Clean."), edit("2026-01-01T00:01:00Z", "Still clean.")], [edit("2026-01-01T00:00:00Z", `Original ${TERM}.`)]],
      },
    },
  );
  assert.equal(r.status, "1");
});

test("edit history cannot be read: status 2, never 0", () => {
  for (const history of ["fail", "null-node"]) {
    const review = runGate(
      { event: "pull_request_review", reviewId: "503" },
      { rest: reviewRest(503, "Clean summary."), graphql: { PRR_503: history } },
    );
    assert.equal(review.status, "2", `review, history ${history}`);
    const comment = runGate(
      { event: "pull_request_review_comment", commentId: "603" },
      { rest: commentRest(603, "Clean comment."), graphql: { PRRC_603: history } },
    );
    assert.equal(comment.status, "2", `comment, history ${history}`);
  }
  const inline = runGate(
    { event: "pull_request_review", reviewId: "504" },
    {
      rest: reviewRest(504, "Clean.", [{ id: 50401, node_id: "PRRC_50401", body: "Clean.", html_url: "https://example.invalid/c50401" }]),
      graphql: { PRR_504: [[]], PRRC_50401: "fail" },
    },
  );
  assert.equal(inline.status, "2", "an inline comment's unreadable history also fails the run");
});

test("clean current text and clean history: status 0", () => {
  const review = runGate(
    { event: "pull_request_review", reviewId: "505" },
    {
      rest: reviewRest(505, "All good.", [{ id: 50501, node_id: "PRRC_50501", body: "Nit.", html_url: "https://example.invalid/c50501" }]),
      graphql: {
        PRR_505: [[edit("2026-01-01T00:01:00Z", "All good."), edit("2026-01-01T00:00:00Z", "All good?")]],
        PRRC_50501: [[]],
      },
    },
  );
  assert.equal(review.status, "0");
  const comment = runGate(
    { event: "pull_request_review_comment", commentId: "604" },
    { rest: commentRest(604, "Tidy."), graphql: { PRRC_604: [[edit("2026-01-01T00:00:00Z", "Tidy.")]] } },
  );
  assert.equal(comment.status, "0");
});

test("a revision a maintainer deleted from the public history has no text to scan: status 0", () => {
  const r = runGate(
    { event: "pull_request_review_comment", commentId: "605" },
    {
      rest: commentRest(605, "Tidy."),
      graphql: { PRRC_605: [[edit("2026-01-01T00:01:00Z", "Tidy."), edit("2026-01-01T00:00:00Z", null, "2026-01-02T00:00:00Z")]] },
    },
  );
  assert.equal(r.status, "0");
});

test("a relayed comment that belongs to another pull request is refused: status 2", () => {
  const r = runGate(
    { event: "pull_request_review_comment", commentId: "606" },
    { rest: commentRest(606, `Has ${TERM}.`, 45), graphql: { PRRC_606: [[]] } },
  );
  assert.equal(r.status, "2");
});

test("a relayed review that does not exist under the relayed pull request: status 2", () => {
  const r = runGate({ event: "pull_request_review", reviewId: "599" }, { rest: {}, graphql: {} });
  assert.equal(r.status, "2");
});
