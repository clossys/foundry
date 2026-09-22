import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  compareVersions,
  dependencyAuditOutcomes,
  lockedVersionsAt,
  satisfiesRange,
  violatingRanges,
} from "./dependency-audit-outcomes.mjs";

const GATE = "dependency audit";

/** A "push"-event record: the shape a real landing actually has. */
function pushRecord(changeId) {
  return { gate: GATE, changeId, event: "push" };
}

/** A Dependabot alert fixture, shaped like the real API response. */
function npmAlert({ name, range, severity = "high", dismissed_reason = null }) {
  return {
    number: 1,
    dismissed_reason,
    security_vulnerability: { package: { ecosystem: "npm", name }, severity, vulnerable_version_range: range },
  };
}

/** A lockfileVersion-3-shaped `package-lock.json` body, from a flat `{path, version}` list. */
function lockfileV3(entries) {
  const packages = { "": { name: "x" } };
  for (const { path, version } of entries) packages[path] = { version };
  return JSON.stringify({ name: "x", lockfileVersion: 3, requires: true, packages });
}

/** A lockfileVersion-1-shaped `package-lock.json` body, from a flat `{name, version}` list at the top level. */
function lockfileV1(entries) {
  const dependencies = {};
  for (const { name, version } of entries) dependencies[name] = { version };
  return JSON.stringify({ name: "x", lockfileVersion: 1, requires: true, dependencies });
}

/** A fake `git show <changeId>:package-lock.json`, keyed by changeId; an absent key throws, simulating a commit with no readable lockfile. */
function fakeGit(lockfilesByChangeId = {}) {
  return (_bin, args) => {
    if (args[0] === "show" && typeof args[1] === "string" && args[1].endsWith(":package-lock.json")) {
      const changeId = args[1].split(":")[0];
      const content = lockfilesByChangeId[changeId];
      if (content === undefined) throw new Error(`fatal: path 'package-lock.json' does not exist in '${changeId}'`);
      return content;
    }
    throw new Error(`fakeGit: unexpected invocation ${JSON.stringify(args)}`);
  };
}

function fetchJsonFixture(alerts = []) {
  return async (path) => {
    if (path.includes("dependabot/alerts")) return alerts;
    throw new Error(`fetchJsonFixture: unexpected path ${path}`);
  };
}

// ---- compareVersions / satisfiesRange -------------------------------------

test("compareVersions orders by major, then minor, then patch", () => {
  assert.ok(compareVersions("1.2.3", "1.2.4") < 0);
  assert.ok(compareVersions("1.3.0", "1.2.9") > 0);
  assert.ok(compareVersions("2.0.0", "1.9.9") > 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
});

test("compareVersions treats a missing patch as 0", () => {
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
});

test("compareVersions ranks a prerelease BELOW the same release version", () => {
  assert.ok(compareVersions("1.0.0-alpha", "1.0.0") < 0);
  assert.ok(compareVersions("1.0.0", "1.0.0-alpha") > 0);
});

test("compareVersions orders prerelease identifiers per semver precedence (numeric before alphanumeric, fewer fields first)", () => {
  assert.ok(compareVersions("1.0.0-alpha", "1.0.0-alpha.1") < 0);
  assert.ok(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta") < 0);
  assert.ok(compareVersions("1.0.0-1", "1.0.0-2") < 0);
});

test("satisfiesRange matches a single upper-bound constraint", () => {
  assert.ok(satisfiesRange("1.2.2", "< 1.2.3"));
  assert.ok(!satisfiesRange("1.2.3", "< 1.2.3"));
});

test("satisfiesRange ANDs comma-separated constraints", () => {
  const range = ">= 1.0.0, < 2.0.0";
  assert.ok(satisfiesRange("1.5.0", range));
  assert.ok(!satisfiesRange("0.9.0", range));
  assert.ok(!satisfiesRange("2.0.0", range));
});

test('satisfiesRange treats "*" as every version', () => {
  assert.ok(satisfiesRange("0.0.1", "*"));
  assert.ok(satisfiesRange("99.0.0", "*"));
});

test("satisfiesRange never matches a constraint outside the recognized grammar", () => {
  assert.ok(!satisfiesRange("1.0.0", "~1.0.0"));
  assert.ok(!satisfiesRange("1.0.0", "1.x"));
});

// ---- violatingRanges --------------------------------------------------

test("violatingRanges keeps only npm, high/critical, non-dismissed-as-inapplicable alerts", () => {
  const alerts = [
    npmAlert({ name: "vuln-high", range: "< 2.0.0", severity: "high" }),
    npmAlert({ name: "vuln-critical", range: "< 1.0.0", severity: "critical" }),
    npmAlert({ name: "vuln-moderate", range: "< 3.0.0", severity: "moderate" }),
    npmAlert({ name: "vuln-inaccurate", range: "< 1.0.0", severity: "high", dismissed_reason: "inaccurate" }),
    npmAlert({ name: "vuln-not-used", range: "< 1.0.0", severity: "high", dismissed_reason: "not_used" }),
    { number: 9, security_vulnerability: { package: { ecosystem: "pip", name: "vuln-pip" }, severity: "high", vulnerable_version_range: "< 1.0.0" } },
  ];
  const names = violatingRanges(alerts).map((r) => r.name);
  assert.deepEqual(names.sort(), ["vuln-critical", "vuln-high"]);
});

test("violatingRanges counts a fixed or tolerable-risk-dismissed alert as a real, landed violation", () => {
  const alerts = [
    npmAlert({ name: "fixed-later", range: "< 1.0.0", severity: "high" }), // state defaults to "open" in fixture but not read by violatingRanges
    npmAlert({ name: "tolerated", range: "< 1.0.0", severity: "critical", dismissed_reason: "tolerable_risk" }),
  ];
  const names = violatingRanges(alerts).map((r) => r.name);
  assert.deepEqual(names.sort(), ["fixed-later", "tolerated"]);
});

// ---- lockedVersionsAt ---------------------------------------------------

test("lockedVersionsAt reads a lockfileVersion-3 packages map, including scoped and nested-transitive names", () => {
  const execFile = fakeGit({
    c1: lockfileV3([
      { path: "node_modules/left-pad", version: "1.0.0" },
      { path: "node_modules/@scope/thing", version: "2.0.0" },
      { path: "node_modules/foo/node_modules/left-pad", version: "1.3.0" },
    ]),
  });
  const versions = lockedVersionsAt("c1", execFile);
  assert.deepEqual([...versions.get("left-pad")].sort(), ["1.0.0", "1.3.0"]);
  assert.deepEqual([...versions.get("@scope/thing")], ["2.0.0"]);
});

test("lockedVersionsAt falls back to a lockfileVersion-1 nested dependencies tree", () => {
  const execFile = fakeGit({ c1: lockfileV1([{ name: "left-pad", version: "1.0.0" }]) });
  const versions = lockedVersionsAt("c1", execFile);
  assert.deepEqual([...versions.get("left-pad")], ["1.0.0"]);
});

// ---- dependencyAuditOutcomes --------------------------------------------

test("reports could-not-read for every change when the alert list itself is unreadable", async () => {
  const fetchJson = async () => {
    throw new Error("HTTP 403");
  };
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("c1")],
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].violation.state, "could-not-read");
  assert.match(outcomes[0].violation.note, /could not read dependabot alerts/);
});

test("reports could-not-read for a changeId whose lockfile cannot be read, without affecting other changes", async () => {
  const fetchJson = fetchJsonFixture([]);
  const execFile = fakeGit({ c2: lockfileV3([]) }); // c1 deliberately absent
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("c1"), pushRecord("c2")],
    execFile,
  });
  const byChange = Object.fromEntries(outcomes.map((o) => [o.changeId, o.violation.state]));
  assert.equal(byChange.c1, "could-not-read");
  assert.match(outcomes.find((o) => o.changeId === "c1").violation.note, /could not read package-lock\.json at c1/);
  assert.equal(byChange.c2, "unobserved");
});

test("reports unobserved (clean) when no locked version falls inside any alert's vulnerable range", async () => {
  const fetchJson = fetchJsonFixture([npmAlert({ name: "left-pad", range: "< 1.0.0", severity: "high" })]);
  const execFile = fakeGit({ c1: lockfileV3([{ path: "node_modules/left-pad", version: "1.2.0" }]) });
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("c1")],
    execFile,
  });
  assert.deepEqual(outcomes, [
    { gate: GATE, changeId: "c1", violation: { state: "unobserved", source: "github-dependabot" } },
  ]);
});

test("reports observed (escaped) when a locked version falls inside a high-severity alert's vulnerable range", async () => {
  const fetchJson = fetchJsonFixture([npmAlert({ name: "left-pad", range: ">= 1.0.0, < 1.3.0", severity: "high" })]);
  const execFile = fakeGit({ c1: lockfileV3([{ path: "node_modules/left-pad", version: "1.2.0" }]) });
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("c1")],
    execFile,
  });
  assert.deepEqual(outcomes, [
    { gate: GATE, changeId: "c1", violation: { state: "observed", source: "github-dependabot" } },
  ]);
});

test("reports observed for a nested transitive copy of the vulnerable package, not only a top-level one", async () => {
  const fetchJson = fetchJsonFixture([npmAlert({ name: "left-pad", range: "< 1.3.0", severity: "critical" })]);
  const execFile = fakeGit({
    c1: lockfileV3([
      { path: "node_modules/left-pad", version: "9.9.9" }, // top-level copy is safe
      { path: "node_modules/foo/node_modules/left-pad", version: "1.0.0" }, // transitive copy is not
    ]),
  });
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("c1")],
    execFile,
  });
  assert.equal(outcomes[0].violation.state, "observed");
});

test("does not count a moderate-severity alert as an escape, matching --audit-level=high", async () => {
  const fetchJson = fetchJsonFixture([npmAlert({ name: "left-pad", range: "< 2.0.0", severity: "moderate" })]);
  const execFile = fakeGit({ c1: lockfileV3([{ path: "node_modules/left-pad", version: "1.0.0" }]) });
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("c1")],
    execFile,
  });
  assert.equal(outcomes[0].violation.state, "unobserved");
});

test("does not count an inaccurate or not_used dismissal as a violation", async () => {
  const fetchJson = fetchJsonFixture([
    npmAlert({ name: "left-pad", range: "< 2.0.0", severity: "high", dismissed_reason: "inaccurate" }),
  ]);
  const execFile = fakeGit({ c1: lockfileV3([{ path: "node_modules/left-pad", version: "1.0.0" }]) });
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("c1")],
    execFile,
  });
  assert.equal(outcomes[0].violation.state, "unobserved");
});

test("counts a fixed (not dismissed) alert as a real escape for the change that had it locked", async () => {
  const fetchJson = fetchJsonFixture([npmAlert({ name: "left-pad", range: "< 2.0.0", severity: "critical" })]);
  const execFile = fakeGit({ c1: lockfileV3([{ path: "node_modules/left-pad", version: "1.0.0" }]) });
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("c1")],
    execFile,
  });
  assert.equal(outcomes[0].violation.state, "observed");
});

test("ignores records for a different gate", async () => {
  const fetchJson = fetchJsonFixture([]);
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: "some other gate", changeId: "c1", event: "push" }],
  });
  assert.deepEqual(outcomes, []);
});

test("excludes a pull_request-event record entirely, even when it is the ONLY record", async () => {
  const fetchJson = fetchJsonFixture([]);
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: GATE, changeId: "pr-head-sha", event: "pull_request" }],
  });
  assert.deepEqual(outcomes, []);
});

test("counts a merged PR's landing exactly once, keyed by the push SHA, not the pull_request SHA", async () => {
  const fetchJson = fetchJsonFixture([npmAlert({ name: "left-pad", range: "< 2.0.0", severity: "high" })]);
  const execFile = fakeGit({ "merge-sha": lockfileV3([{ path: "node_modules/left-pad", version: "1.0.0" }]) });
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [
      { gate: GATE, changeId: "pr-head-sha", event: "pull_request" },
      { gate: GATE, changeId: "merge-sha", event: "push" },
    ],
    execFile,
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].changeId, "merge-sha");
});

test("excludes a record with no event field at all, rather than guessing it is a landing", async () => {
  const fetchJson = fetchJsonFixture([]);
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [{ gate: GATE, changeId: "c1" }],
  });
  assert.deepEqual(outcomes, []);
});

test("dedupes repeated push records for the same changeId into one outcome", async () => {
  const fetchJson = fetchJsonFixture([]);
  const execFile = fakeGit({ c1: lockfileV3([]) });
  const outcomes = await dependencyAuditOutcomes({
    fetchJson,
    owner: "clossys",
    repo: "foundry",
    gate: GATE,
    records: [pushRecord("c1"), pushRecord("c1")],
    execFile,
  });
  assert.equal(outcomes.length, 1);
});
