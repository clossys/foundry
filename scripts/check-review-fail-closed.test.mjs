import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FAIL_CLOSED_TEXT, parseArgs, QUEUE_TEXT, queueFindings, recordFindings, skillFindings } from "./check-review-fail-closed.mjs";

const SCRIPT = fileURLToPath(new URL("./check-review-fail-closed.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./rules/fixtures/", import.meta.url));
const HEAD = "a".repeat(40);
const review = (extra = {}) => ({ schema: "clossys.review/1", verdict: "PASS", line: `MECHANICAL: PASS ${HEAD} ${"b".repeat(40)}`, ran: { commands: 3, missing: [] }, ...extra });
const entry = (id, unit, head, state) => ({ id, unit, head, state, kind: "review", heavy: true });
const queue = (...entries) => ({ schema: "clossys.run-queue/1", seq: entries.length, entries });
const cli = (...argv) => spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: "utf8" });

test("the repository's Reviewer skill states both rules verbatim", () => {
  assert.deepEqual(skillFindings(ROOT), []);
  assert.match(FAIL_CLOSED_TEXT, /exit 127/);
  assert.match(QUEUE_TEXT, /never gives up/);
});

test("a PASS record holds only when it has a verdict line, ran something and met no 127", () => {
  assert.deepEqual(recordFindings(review()), []);
  assert.deepEqual(recordFindings(review({ verdict: "FAIL", line: `MECHANICAL: FAIL ${HEAD} x`, ran: { commands: 0, missing: [] } })), []);
  assert.equal(recordFindings(review({ ran: { commands: 0, missing: [] } }))[0].rule, "pass-on-nothing");
  assert.equal(recordFindings(review({ ran: { commands: 4, missing: ["npm ci"] } }))[0].rule, "pass-on-missing");
  assert.equal(recordFindings({ verdict: "PASS", line: `RECEIPT: PASS ${HEAD}`, commands: [] })[0].rule, "pass-on-nothing");
  assert.equal(recordFindings({ verdict: "PASS", line: `RECEIPT: PASS ${HEAD}`, commands: [{ id: "c1", run: "x y", exit: 127 }] })[0].rule, "pass-on-missing");
  for (const broken of [{}, review({ verdict: undefined }), review({ line: undefined }), review({ line: `MECHANICAL: FAIL ${HEAD} x` }), null]) assert.equal(recordFindings(broken)[0].rule, "no-verdict");
});

test("a queue holds only when a superseded head is not live, running fits the slots and no run gave up", () => {
  assert.deepEqual(queueFindings(queue(entry("run-1", "U", "a", "cancelled"), entry("run-2", "U", "b", "running")), 1), []);
  assert.equal(queueFindings(queue(entry("run-1", "U", "a", "queued"), entry("run-2", "U", "b", "running")), 2)[0].rule, "superseded-live");
  assert.equal(queueFindings(queue(entry("run-1", "U", "a", "running"), entry("run-2", "V", "b", "running")), 1)[0].rule, "over-capacity");
  assert.equal(queueFindings(queue(entry("run-1", "U", "a", "failed")), 1)[0].rule, "gave-up");
});

test("the fixtures fail as their rules say", () => {
  const skill = cli("--root", `${FIXTURES}R-REVIEW-FAIL-CLOSED/skill`);
  assert.equal(skill.status, 1);
  assert.match(skill.stdout, /^missing-rule\tpackages\/reviewer\/skill\/SKILL\.md/m);
  const record = `${FIXTURES}R-REVIEW-FAIL-CLOSED/record`;
  for (const [file, rule] of [["review-pass-zero.json", "pass-on-nothing"], ["receipt-pass-127.json", "pass-on-missing"], ["review-no-verdict.json", "no-verdict"]]) {
    const run = cli("--root", record, "--record", `${record}/${file}`);
    assert.equal(run.status, 1, file);
    assert.match(run.stdout, new RegExp(`^${rule}\\t`, "m"));
  }
  const queued = `${FIXTURES}R-REVIEW-RUN-QUEUE/queue`;
  for (const [file, rule] of [["queue-superseded.json", "superseded-live"], ["queue-gave-up.json", "gave-up"]]) {
    const run = cli("--root", queued, "--queue", `${queued}/${file}`, "--capacity", "3");
    assert.equal(run.status, 1, file);
    assert.match(run.stdout, new RegExp(`^${rule}\\t`, "m"));
  }
  assert.equal(cli("--root", queued).status, 0);
});

test("usage errors exit 2", () => {
  assert.throws(() => parseArgs(["--queue", "q.json"]), /go together/);
  assert.throws(() => parseArgs(["--queue", "q.json", "--capacity", "0"]), /at least 1/);
  assert.equal(cli("--bogus").status, 2);
  assert.equal(cli("--record", `${FIXTURES}no-such-record.json`).status, 2);
});
