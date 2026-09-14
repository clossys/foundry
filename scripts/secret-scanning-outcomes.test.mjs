import { strict as assert } from "node:assert";
import { test } from "node:test";
import { commitsIntroducedBy, secretScanningOutcomes } from "./secret-scanning-outcomes.mjs";

const GATE = "publish safety";

function fakeGit(commits) {
  // `commits[changeId]` is the list `git rev-list <changeId>^1..<changeId>`
  // would print for a resolvable change; an absent key simulates a `changeId`
  // this checkout cannot resolve (a shallow boundary, or a pre-merge PR head
  // SHA that was never part of `main`'s own history).
  return (_bin, args) => {
    const changeId = args[1].split("^1..")[1];
    const list = commits[changeId];
    if (list === undefined) {
      throw new Error(`fatal: ambiguous argument '${changeId}^1': unknown revision`);
    }
    return list.length === 0 ? "" : `${list.join("\n")}\n`;
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

test("commitsIntroducedBy parses git rev-list output into a SHA list", () => {
  const shas = commitsIntroducedBy("merge1", (_bin, args) => {
    assert.deepEqual(args, ["rev-list", "merge1^1..merge1"]);
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
    records: [{ gate: GATE, changeId: "merge1" }],
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].violation.state, "could-not-read");
  assert.match(outcomes[0].violation.note, /could not read secret-scanning alerts/);
});

test("reports unobserved (clean) when no alert location matches anything the change introduced", async () => {
  const fetchJson = fetchJsonFixture({
    alerts: { open: [{ number: 1, resolution: null }], resolved: [] },
    locations: { 1: [{ details: { commit_sha: "unrelated-sha" } }] },
  });
  const execFile = fakeGit({ merge1: ["merge1", "feature-commit-a"] });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: GATE, changeId: "merge1" }],
    execFile,
  });
  assert.deepEqual(outcomes, [{ gate: GATE, changeId: "merge1", violation: { state: "unobserved", source: "github-secret-scanning" } }]);
});

test("reports observed (escaped) when an alert location matches a commit the merge introduced, not just the merge commit itself", async () => {
  const fetchJson = fetchJsonFixture({
    alerts: { open: [{ number: 7, resolution: null }], resolved: [] },
    locations: { 7: [{ details: { commit_sha: "feature-commit-a" } }] },
  });
  // The alert sits on the PR's OWN commit, never the merge commit `merge1`
  // itself — exactly the topology this module exists to handle correctly.
  const execFile = fakeGit({ merge1: ["merge1", "feature-commit-a"] });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: GATE, changeId: "merge1" }],
    execFile,
  });
  assert.deepEqual(outcomes, [{ gate: GATE, changeId: "merge1", violation: { state: "observed", source: "github-secret-scanning" } }]);
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
  const execFile = fakeGit({ merge1: ["merge1", "feature-commit-a"] });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: GATE, changeId: "merge1" }],
    execFile,
  });
  assert.equal(outcomes[0].violation.state, "unobserved");
});

test("counts a revoked (but not dismissed) alert as a real escape", async () => {
  const fetchJson = fetchJsonFixture({
    alerts: { open: [], resolved: [{ number: 4, resolution: "revoked" }] },
    locations: { 4: [{ details: { commit_sha: "feature-commit-a" } }] },
  });
  const execFile = fakeGit({ merge1: ["merge1", "feature-commit-a"] });
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: GATE, changeId: "merge1" }],
    execFile,
  });
  assert.equal(outcomes[0].violation.state, "observed");
});

test("reports could-not-read only for a changeId this checkout cannot resolve, not for every change", async () => {
  const fetchJson = fetchJsonFixture();
  const execFile = fakeGit({ merge1: ["merge1"] }); // "pr-head-sha" deliberately absent
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [
      { gate: GATE, changeId: "merge1" },
      { gate: GATE, changeId: "pr-head-sha" },
    ],
    execFile,
  });
  const byChange = Object.fromEntries(outcomes.map((o) => [o.changeId, o.violation.state]));
  assert.equal(byChange["merge1"], "unobserved");
  assert.equal(byChange["pr-head-sha"], "could-not-read");
});

test("ignores records for a different gate", async () => {
  const fetchJson = fetchJsonFixture();
  const outcomes = await secretScanningOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: "some other gate", changeId: "merge1" }],
  });
  assert.deepEqual(outcomes, []);
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
    records: [{ gate: GATE, changeId: "merge1" }],
  });
  assert.equal(outcomes[0].violation.state, "could-not-read");
  assert.match(outcomes[0].violation.note, /could not read secret-scanning alert locations/);
});
