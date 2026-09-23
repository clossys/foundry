import assert from "node:assert/strict";
import test from "node:test";

import { classifyPackagesForPublish } from "./plan-qualified-publish-set.mjs";

function entry(directory, version, extra = {}) {
  return { directory, manifest: { name: `@example/${directory}`, version, ...extra } };
}

test("classifyPackagesForPublish: a published package is reported on-npm-already and excluded from eligible", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "published" }]]);
  const { eligible, report } = classifyPackagesForPublish({ entries, verdicts, qualificationCheck: () => assert.fail("must not check a published package's record") });
  assert.deepEqual(eligible, []);
  assert.deepEqual(report, [
    { package: "app", name: "@example/app", version: "1.0.0", status: "on-npm-already", reason: "@example/app@1.0.0 is already on the registry — nothing to publish.", path: undefined },
  ]);
});

test("classifyPackagesForPublish: a missing package with a present record is eligible", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "missing" }]]);
  const { eligible, report } = classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: (key) => {
      assert.equal(key, "app");
      return { state: "present", path: "governance/release-qualifications/clossys-app-1.0.0.json" };
    },
  });
  assert.deepEqual(eligible, [{ package: "app" }]);
  assert.equal(report.length, 1);
  assert.equal(report[0].status, "eligible");
  assert.match(report[0].reason, /retained qualification record matches/);
});

test("classifyPackagesForPublish: a missing package with no record is qualification-record-missing, never eligible", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "missing" }]]);
  const { eligible, report } = classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: () => ({ state: "missing", path: "governance/release-qualifications/clossys-app-1.0.0.json" }),
  });
  assert.deepEqual(eligible, []);
  assert.equal(report[0].status, "qualification-record-missing");
  assert.match(report[0].reason, /no retained qualification record/);
});

test("classifyPackagesForPublish: a stale record is reported distinctly from a missing one", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "missing" }]]);
  const { eligible, report } = classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: () => ({ state: "stale", path: "governance/release-qualifications/clossys-app-1.0.0.json", staleFields: ["packageTreeSha1"] }),
  });
  assert.deepEqual(eligible, []);
  assert.equal(report[0].status, "qualification-record-stale");
  assert.match(report[0].reason, /no longer matches the current candidate \(packageTreeSha1 changed\)/);
});

test("classifyPackagesForPublish: an indeterminate record check is reported, not silently dropped", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "missing" }]]);
  const { eligible, report } = classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: () => ({ state: "indeterminate", reason: "packages/app/package.json could not be read" }),
  });
  assert.deepEqual(eligible, []);
  assert.equal(report[0].status, "qualification-record-indeterminate");
  assert.match(report[0].reason, /could not be read/);
});

test("classifyPackagesForPublish: an inconclusive registry lookup is reported and excluded, never guessed", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "unreachable" }]]);
  const { eligible, report } = classifyPackagesForPublish({ entries, verdicts, qualificationCheck: () => assert.fail("must not check an inconclusive package's record") });
  assert.deepEqual(eligible, []);
  assert.equal(report[0].status, "registry-lookup-inconclusive");
  assert.equal(report[0].package, undefined);
  assert.equal(report[0].name, "@example/app");
});

test("classifyPackagesForPublish: eligible packages are dependency-ordered, distinct reasons never collapse", () => {
  const entries = [
    entry("dependent", "1.0.0", { dependencies: { "@example/base": "^1.0.0" } }),
    entry("base", "1.0.0"),
    entry("published", "2.0.0"),
  ];
  const verdicts = new Map([
    ["@example/dependent", { kind: "missing" }],
    ["@example/base", { kind: "missing" }],
    ["@example/published", { kind: "published" }],
  ]);
  const { eligible, report } = classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: () => ({ state: "present", path: "governance/release-qualifications/clossys-x-1.0.0.json" }),
  });
  assert.deepEqual(eligible, [{ package: "base" }, { package: "dependent" }]);
  const statuses = new Set(report.map((row) => row.status));
  assert.deepEqual(statuses, new Set(["eligible", "on-npm-already"]));
});
