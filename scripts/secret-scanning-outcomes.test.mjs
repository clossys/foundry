import { strict as assert } from "node:assert";
import { test } from "node:test";
import { commitsIntroducedSince, orderLandedChangesChronologically, secretScanningOutcomes } from "./secret-scanning-outcomes.mjs";

const GATE = "publish safety";

/**
 * A fake `git` binary backing both `rev-list --first-parent HEAD` (returns
 * `firstParentHistory`, newest-first, exactly as the real command would) and
 * `rev-list <a>..<b>` (looked up in `ranges`, keyed `"a..b"`; an absent key
 * throws, simulating an unresolvable range).
 */
function fakeGit({ firstParentHistory = [], ranges = {} } = {}) {
  return (_bin, args) => {
    if (args[0] === "rev-list" && args[1] === "--first-parent" && args[2] === "HEAD") {
      return firstParentHistory.length === 0 ? "" : `${firstParentHistory.join("\n")}\n`;
    }
    if (args[0] === "rev-list" && args.length === 2 && args[1].includes("..")) {
      const key = args[1];
      const list = ranges[key];
      if (list === undefined) throw new Error(`fatal: could not resolve range '${key}'`);
      return list.length === 0 ? "" : `${list.join("\n")}\n`;
    }
    throw new Error(`fakeGit: unexpected invocation ${JSON.stringify(args)}`);
  };
}

function fetchJsonFixture({ alerts = { open: [], resolved: [] }, locations = {} } = {}) {
  return async (path) => {
    if (path.includes("state=open")) return alerts.open;
    if (path.includes("state=resolved")) return alerts.resolved;
    const match = /alerts\/(\d+)\/locations/.exec(path);
    if (match) return locations[match[1]] ?? [];
    throw new Error(`fetchJsonFixture: unexpected path ${path}`);
  };
}

/** A "push"-event record: the shape a real landing actually has. */
function pushRecord(changeId) {
  return { gate: GATE, changeId, event: "push" };
}

test("orderLandedChangesChronologically returns oldest-first, using rev-list's newest-first order", () => {
  const execFile = fakeGit({ firstParentHistory: ["c3", "c2", "c1", "c0"] });
  const { ordered, unplaced } = orderLandedChangesChronologically(["c1", "c3"], execFile);
  assert.deepEqual(ordered, ["c1", "c3"]);
  assert.deepEqual(unplaced, []);
});

test("orderLandedChangesChronologically reports a changeId absent from first-parent history as unplaced", () => {
  const execFile = fakeGit({ firstParentHistory: ["c1", "c0"] });
  const { ordered, unplaced } = orderLandedChangesChronologically(["c1", "not-in-history"], execFile);
  assert.deepEqual(ordered, ["c1"]);
  assert.deepEqual(unplaced, ["not-in-history"]);
});

test("commitsIntroducedSince parses git rev-list output into a SHA list", () => {
  const shas = commitsIntroducedSince("prev", "curr", (_bin, args) => {
    assert.deepEqual(args, ["rev-list", "prev..curr"]);
    return "aaa\nbbb\n";
  });
  assert.deepEqual(shas, ["aaa", "bbb"]);
});

test("reports could-not-read for every change when the alert list itself is unreadable", async () => {
  const fetchJson = async () => {
    throw new Error("HTTP 403");
  };
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("merge1")],
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].violation.state, "could-not-read");
  assert.match(outcomes[0].violation.note, /could not read secret-scanning alerts/);
});

test("reports could-not-read for every change when alert locations cannot be read", async () => {
  const fetchJson = async (path) => {
    if (path.includes("state=open")) return [{ number: 9, resolution: null }];
    if (path.includes("state=resolved")) return [];
    throw new Error("HTTP 500");
  };
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("merge1")],
  });
  assert.equal(outcomes[0].violation.state, "could-not-read");
  assert.match(outcomes[0].violation.note, /could not read secret-scanning alert locations/);
});

test("the oldest landing in the window reports could-not-read — it has no recorded predecessor", async () => {
  const fetchJson = fetchJsonFixture();
  const execFile = fakeGit({ firstParentHistory: ["merge1", "before-window"] });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("merge1")],
    execFile,
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].violation.state, "could-not-read");
  assert.match(outcomes[0].violation.note, /oldest landing/);
});

test("reports unobserved (clean) for a non-boundary landing when nothing introduced since the previous one matches an alert", async () => {
  const fetchJson = fetchJsonFixture({
    alerts: { open: [{ number: 1, resolution: null }], resolved: [] },
    locations: { 1: [{ details: { commit_sha: "unrelated-sha" } }] },
  });
  const execFile = fakeGit({
    firstParentHistory: ["merge2", "merge1", "before-window"],
    ranges: { "merge1..merge2": ["merge2", "feature-commit-a"] },
  });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("merge1"), pushRecord("merge2")],
    execFile,
  });
  const merge2 = outcomes.find((o) => o.changeId === "merge2");
  assert.deepEqual(merge2, { gate: GATE, changeId: "merge2", violation: { state: "unobserved", source: "github-secret-scanning" } });
});

test("reports observed (escaped) when an alert location matches a commit introduced since the previous landing, not just the landing commit itself", async () => {
  const fetchJson = fetchJsonFixture({
    alerts: { open: [{ number: 7, resolution: null }], resolved: [] },
    locations: { 7: [{ details: { commit_sha: "feature-commit-a" } }] },
  });
  const execFile = fakeGit({
    firstParentHistory: ["merge2", "merge1", "before-window"],
    ranges: { "merge1..merge2": ["merge2", "feature-commit-a"] },
  });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("merge1"), pushRecord("merge2")],
    execFile,
  });
  const merge2 = outcomes.find((o) => o.changeId === "merge2");
  assert.deepEqual(merge2, { gate: GATE, changeId: "merge2", violation: { state: "observed", source: "github-secret-scanning" } });
});

// ---- THE REBASE-TOPOLOGY PROOF -------------------------------------------
// governance/merge-policy.json permits BOTH "merge" and "rebase". A rebase
// landing replays every commit in the pull request as a run of ordinary
// single-parent commits, so the landed push's own `^1` parent is only the
// SECOND-TO-LAST replayed commit — a secret in an EARLIER replayed commit
// would be invisible to a same-commit's-own-parent diff. This module never
// computes such a diff: it always compares against the PREVIOUS LANDED
// push, which correctly spans every replayed commit regardless of how many
// there were.
test("finds a secret in the FIRST of three rebase-replayed commits, which a same-commit^1 diff would have missed", async () => {
  const fetchJson = fetchJsonFixture({
    alerts: { open: [{ number: 3, resolution: null }], resolved: [] },
    // The secret is in the FIRST replayed commit of the rebase landing —
    // three hops back from the landed push's own head SHA.
    locations: { 3: [{ details: { commit_sha: "rebased-1" } }] },
  });
  // A pure rebase landing: three new single-parent commits appended in one
  // push. "rebased-3" is the recorded changeId (the push's head SHA); its
  // own `^1` is "rebased-2", not "merge1" (the tip before the whole pull
  // request landed) — a same-commit diff would only ever see "rebased-3".
  const execFile = fakeGit({
    firstParentHistory: ["rebased-3", "rebased-2", "rebased-1", "merge1", "before-window"],
    ranges: { "merge1..rebased-3": ["rebased-3", "rebased-2", "rebased-1"] },
  });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("merge1"), pushRecord("rebased-3")],
    execFile,
  });
  const rebased = outcomes.find((o) => o.changeId === "rebased-3");
  assert.deepEqual(rebased, { gate: GATE, changeId: "rebased-3", violation: { state: "observed", source: "github-secret-scanning" } });
});

test("does not count a false_positive or used_in_tests dismissal as a violation", async () => {
  const fetchJson = fetchJsonFixture({
    alerts: {
      open: [],
      resolved: [
        { number: 2, resolution: "false_positive" },
        { number: 3, resolution: "used_in_tests" },
      ],
    },
    locations: {
      2: [{ details: { commit_sha: "feature-commit-a" } }],
      3: [{ details: { commit_sha: "feature-commit-a" } }],
    },
  });
  const execFile = fakeGit({
    firstParentHistory: ["merge2", "merge1", "before-window"],
    ranges: { "merge1..merge2": ["merge2", "feature-commit-a"] },
  });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("merge1"), pushRecord("merge2")],
    execFile,
  });
  assert.equal(outcomes.find((o) => o.changeId === "merge2").violation.state, "unobserved");
});

test("counts a revoked (but not dismissed) alert as a real escape", async () => {
  const fetchJson = fetchJsonFixture({
    alerts: { open: [], resolved: [{ number: 4, resolution: "revoked" }] },
    locations: { 4: [{ details: { commit_sha: "feature-commit-a" } }] },
  });
  const execFile = fakeGit({
    firstParentHistory: ["merge2", "merge1", "before-window"],
    ranges: { "merge1..merge2": ["merge2", "feature-commit-a"] },
  });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("merge1"), pushRecord("merge2")],
    execFile,
  });
  assert.equal(outcomes.find((o) => o.changeId === "merge2").violation.state, "observed");
});

test("reports could-not-read only for a changeId this checkout cannot place in history, not for every change", async () => {
  const fetchJson = fetchJsonFixture();
  const execFile = fakeGit({ firstParentHistory: ["merge1", "before-window"] });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("merge1"), pushRecord("not-in-history")],
    execFile,
  });
  const byChange = Object.fromEntries(outcomes.map((o) => [o.changeId, o.violation.state]));
  assert.equal(byChange["merge1"], "could-not-read"); // the sole placed entry — it is the oldest, so still could-not-read
  assert.equal(byChange["not-in-history"], "could-not-read");
});

test("ignores records for a different gate", async () => {
  const fetchJson = fetchJsonFixture();
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: "some other gate", changeId: "merge1", event: "push" }],
  });
  assert.deepEqual(outcomes, []);
});

// ---- Double-counting: a merged PR produces TWO run-history rows for the
// SAME real landed change (a `pull_request`-event row keyed by the PR
// branch's own pre-merge head SHA, and a `push`-event row keyed by whatever
// actually landed) — see this module's own header and `gate-run-history.mjs`'s
// `collectJobs` comment on `event`. These tests are the proof that only the
// `push` row is ever counted.

test("excludes a pull_request-event record entirely, even when it is the ONLY record", async () => {
  const fetchJson = fetchJsonFixture();
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: GATE, changeId: "pr-head-sha", event: "pull_request" }],
  });
  assert.deepEqual(outcomes, []);
});

test("counts a merged PR's landing exactly once, not twice, even though the PR head SHA is independently placeable and carries the same real secret", async () => {
  const fetchJson = fetchJsonFixture({
    alerts: { open: [{ number: 1, resolution: null }], resolved: [] },
    locations: { 1: [{ details: { commit_sha: "feature-commit-a" } }] },
  });
  // "pr-head-sha" (the PR branch tip, second parent of the merge) IS part of
  // this checkout's first-parent history in this fixture only because a
  // fast-forward or single-commit PR can coincide with it; the point under
  // test is that its `pull_request`-event row is excluded regardless.
  const execFile = fakeGit({
    firstParentHistory: ["merge1", "before-window"],
    ranges: { "before-window..merge1": ["merge1", "feature-commit-a"] },
  });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [
      { gate: GATE, changeId: "pr-head-sha", event: "pull_request" },
      { gate: GATE, changeId: "merge1", event: "push" },
    ],
    execFile,
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].changeId, "merge1");
});

test("excludes a record with no event field at all, rather than guessing it is a landing", async () => {
  const fetchJson = fetchJsonFixture();
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: GATE, changeId: "merge1" }],
  });
  assert.deepEqual(outcomes, []);
});
