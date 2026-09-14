import assert from "node:assert/strict";
import test from "node:test";

import { isCouldNotRead, isObserved, computeGateEfficacy } from "@clossys/observer";

import { CHANGE_EVENTS, collectJobs, createGateRunHistoryReader, gatesSeen, toRunRecords, unsourcedOutcomes } from "./gate-run-history.mjs";
import { gradeReport, rateIsUnsourced } from "./check-gate-efficacy.mjs";

function fixtureFetch(pages) {
  return async (path) => {
    for (const [match, body] of pages) if (path.includes(match)) return body;
    throw new Error(`no fixture for ${path}`);
  };
}

const run = (id, sha) => ({ id, head_sha: sha });
const job = (name, conclusion) => ({ name, conclusion });

test("a skipped job is recorded as not-run, never as a verdict", () => {
  // "the gate was skipped" and "the gate ran and passed" are the two states
  // this programme keeps finding collapsed into one another.
  const jobs = [
    { gate: "g", changeId: "s1", conclusion: "success" },
    { gate: "g", changeId: "s2", conclusion: "skipped" },
    { gate: "g", changeId: "s3", conclusion: "cancelled" },
    { gate: "g", changeId: "s4", conclusion: null },
  ];
  assert.deepEqual(toRunRecords(jobs, "g"), [
    { gate: "g", changeId: "s1", ran: true, verdict: "success" },
    { gate: "g", changeId: "s2", ran: false },
    { gate: "g", changeId: "s3", ran: false },
    { gate: "g", changeId: "s4", ran: false },
  ]);
});

test("an unreadable history is could-not-read, never an empty observed set", async () => {
  // A gate whose history cannot be seen is not a gate that ran clean.
  const reader = createGateRunHistoryReader({ ok: false, reason: "no token" });
  const read = reader.readRunHistory("g");
  assert.equal(isCouldNotRead(read), true);
  assert.equal(isObserved(read), false);
  assert.match(read.note, /no token/);

  const report = await computeGateEfficacy("g", reader, []);
  assert.equal(report.state, "could-not-read");
  assert.equal(report.ranCount, 0);
});

test("a real read of a gate that never ran is observed-and-empty, which is a different fact", () => {
  const reader = createGateRunHistoryReader({ ok: true, jobs: [{ gate: "other", changeId: "s1", conclusion: "success" }] });
  const read = reader.readRunHistory("g");
  assert.equal(isObserved(read), true);
  assert.deepEqual(read.records, []);
});

test("only change events are collected, and a run's jobs are keyed to its head sha", async () => {
  // Measured on this repository: 74 of the last 100 runs were conversation
  // traffic attributed to the DEFAULT BRANCH's sha, which collapsed ten runs
  // onto one change id. The event filter is why.
  assert.deepEqual(CHANGE_EVENTS, ["pull_request", "push"]);
  const fetchJson = fixtureFetch([
    ["event=pull_request", { workflow_runs: [run(1, "sha-a")] }],
    ["event=push", { workflow_runs: [run(2, "sha-b")] }],
    ["runs/1/jobs", { jobs: [job("build", "success")] }],
    ["runs/2/jobs", { jobs: [job("build", "failure")] }],
  ]);
  const collected = await collectJobs({ fetchJson, owner: "o", repo: "r" });
  assert.equal(collected.ok, true);
  assert.deepEqual(gatesSeen(collected.jobs), ["build"]);
  assert.deepEqual(
    toRunRecords(collected.jobs, "build"),
    [
      { gate: "build", changeId: "sha-a", ran: true, verdict: "success" },
      { gate: "build", changeId: "sha-b", ran: true, verdict: "failure" },
    ],
  );
});

test("one unreadable run refuses the whole read rather than shrinking the denominator", async () => {
  const fetchJson = fixtureFetch([
    ["event=pull_request", { workflow_runs: [run(1, "sha-a"), run(2, "sha-b")] }],
    ["event=push", { workflow_runs: [] }],
    ["runs/1/jobs", { jobs: [job("build", "success")] }],
    // runs/2/jobs has no fixture, so the fetch throws
  ]);
  const collected = await collectJobs({ fetchJson, owner: "o", repo: "r" });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /run 2/);
});

test("a malformed page is refused, not treated as an empty history", async () => {
  const collected = await collectJobs({ fetchJson: fixtureFetch([["event=pull_request", { message: "Bad credentials" }]]), owner: "o", repo: "r" });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /workflow_runs/);
});

test("every ground-truth outcome is could-not-read, one per distinct change", () => {
  // The escape rate's denominator is real; its numerator is unsourced. Nothing
  // here may feed a gate's own verdict back in as evidence of no violation.
  const records = toRunRecords(
    [
      { gate: "g", changeId: "s1", conclusion: "success" },
      { gate: "g", changeId: "s1", conclusion: "success" },
      { gate: "g", changeId: "s2", conclusion: "failure" },
    ],
    "g",
  );
  const outcomes = unsourcedOutcomes(records, "g");
  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) assert.equal(outcome.violation.state, "could-not-read");
});

test("an unsourced zero is reported as a lower bound, not as a clean record", async () => {
  const jobs = [
    { gate: "g", changeId: "s1", conclusion: "success" },
    { gate: "g", changeId: "s2", conclusion: "success" },
  ];
  const reader = createGateRunHistoryReader({ ok: true, jobs });
  const report = await computeGateEfficacy("g", reader, unsourcedOutcomes(toRunRecords(jobs, "g"), "g"));
  assert.equal(report.escapeRate.rate, 0);
  assert.equal(report.escapeRate.cleanCount, 0);
  assert.equal(report.escapeRate.couldNotReadCount, report.escapeRate.landedCount);
  assert.equal(rateIsUnsourced(report.escapeRate), true);
});

test("a gate that never executed is a note, not a finding", async () => {
  // The false positive this grader produced on its first real run: it flagged
  // `visibility` as dead on the evidence that it was present in 42 runs and
  // executed in none. That job is `if: workflow_dispatch && visibility_only`
  // and is SUPPOSED to be skipped. Run history cannot tell the two apart, so
  // it must not claim to.
  const jobs = [
    { gate: "g", changeId: "s1", conclusion: "skipped" },
    { gate: "g", changeId: "s2", conclusion: "skipped" },
  ];
  const reader = createGateRunHistoryReader({ ok: true, jobs });
  const report = await computeGateEfficacy("g", reader, unsourcedOutcomes(toRunRecords(jobs, "g"), "g"));
  assert.equal(report.ranCount, 0);
  assert.equal(report.didNotRunCount, 2);
  assert.equal(gradeReport(report).level, "note");
});

test("a confirmed escape is the one thing graded as a finding, and unreadable history is an error", async () => {
  const jobs = [{ gate: "g", changeId: "s1", conclusion: "success" }];
  const escaped = await computeGateEfficacy("g", createGateRunHistoryReader({ ok: true, jobs }), [
    { gate: "g", changeId: "s1", violation: { state: "observed" } },
  ]);
  assert.equal(escaped.escapeRate.escapedCount, 1);
  assert.equal(gradeReport(escaped).level, "finding");

  const unreadable = await computeGateEfficacy("g", createGateRunHistoryReader({ ok: false, reason: "rate limited" }), []);
  assert.equal(gradeReport(unreadable).level, "error");
});
