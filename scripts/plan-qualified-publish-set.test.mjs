import assert from "node:assert/strict";
import test from "node:test";

import { classifyPackagesForPublish, probePackageIdentities, routeToPublishWorkflowCommand } from "./plan-qualified-publish-set.mjs";
import { PUBLIC_NPM_REGISTRY } from "./lib/public-npm-registry.mjs";

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

test("classifyPackagesForPublish: a missing version whose package identity already exists routes to publish.yml, never local — issue #1286 routing fix", () => {
  const entries = [entry("advisor", "0.2.8")];
  const verdicts = new Map([["@example/advisor", { kind: "missing" }]]);
  const { eligible, report } = classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: () => ({ state: "present", path: "governance/release-qualifications/clossys-advisor-0.2.8.json" }),
    identityCheck: (name) => {
      assert.equal(name, "@example/advisor");
      return { state: "existing" };
    },
  });
  assert.deepEqual(eligible, [], "an already-existing identity must never be published from the owner-present local path");
  assert.equal(report.length, 1);
  assert.equal(report[0].status, "route-publish-workflow");
  assert.equal(report[0].command, "gh workflow run publish.yml --ref main -f package=advisor -f dry_run=false -f verify_only=false");
  assert.match(report[0].reason, /gh workflow run publish\.yml --ref main -f package=advisor -f dry_run=false -f verify_only=false/);
});

test("classifyPackagesForPublish: a genuinely new identity with a present record stays eligible for the owner-present local path", () => {
  const entries = [entry("writer", "0.3.2")];
  const verdicts = new Map([["@example/writer", { kind: "missing" }]]);
  const { eligible, report } = classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: () => ({ state: "present", path: "governance/release-qualifications/clossys-writer-0.3.2.json" }),
    identityCheck: () => ({ state: "new" }),
  });
  assert.deepEqual(eligible, [{ package: "writer" }]);
  assert.equal(report[0].status, "eligible");
  assert.equal(report[0].command, undefined);
});

test("classifyPackagesForPublish: an indeterminate identity check is refused, never guessed open", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "missing" }]]);
  const { eligible, report } = classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: () => ({ state: "present", path: "governance/release-qualifications/clossys-app-1.0.0.json" }),
    identityCheck: () => ({ state: "indeterminate", reason: "anonymous packument request returned HTTP 500" }),
  });
  assert.deepEqual(eligible, []);
  assert.equal(report[0].status, "registry-identity-indeterminate");
  assert.match(report[0].reason, /HTTP 500/);
});

test("classifyPackagesForPublish: identityCheck defaults to \"new\" when omitted, preserving prior callers' behavior", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "missing" }]]);
  const { eligible } = classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: () => ({ state: "present", path: "governance/release-qualifications/clossys-app-1.0.0.json" }),
  });
  assert.deepEqual(eligible, [{ package: "app" }]);
});

test("routeToPublishWorkflowCommand: emits the exact dispatch command for a package", () => {
  assert.equal(
    routeToPublishWorkflowCommand("architect"),
    "gh workflow run publish.yml --ref main -f package=architect -f dry_run=false -f verify_only=false",
  );
});

function packumentResponse(status, body = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test("probePackageIdentities: a package with no anonymous packument (404) is new", async () => {
  const missing = [{ directory: "writer", manifest: { name: "@clossys/writer", version: "0.3.2" } }];
  const fetchImpl = async () => packumentResponse(404);
  const results = await probePackageIdentities({ missing, registry: PUBLIC_NPM_REGISTRY, fetchImpl });
  assert.deepEqual(results.get("@clossys/writer"), { state: "new" });
});

test("probePackageIdentities: a package with an anonymous packument already exists", async () => {
  const missing = [{ directory: "advisor", manifest: { name: "@clossys/advisor", version: "0.2.8" } }];
  const fetchImpl = async () => packumentResponse(200, { name: "@clossys/advisor", versions: { "0.2.7": {} } });
  const results = await probePackageIdentities({ missing, registry: PUBLIC_NPM_REGISTRY, fetchImpl });
  assert.deepEqual(results.get("@clossys/advisor"), { state: "existing" });
});

test("probePackageIdentities: a denied or unreachable packument lookup is indeterminate, never guessed", async () => {
  const missing = [{ directory: "app", manifest: { name: "@clossys/app", version: "1.0.0" } }];
  const fetchImpl = async () => packumentResponse(500);
  const results = await probePackageIdentities({ missing, registry: PUBLIC_NPM_REGISTRY, fetchImpl });
  assert.equal(results.get("@clossys/app").state, "indeterminate");
});

test("probePackageIdentities: the historical, inactive GitHub Packages lane is left untouched (empty map)", async () => {
  const missing = [{ directory: "app", manifest: { name: "@clossys/app", version: "1.0.0" } }];
  const results = await probePackageIdentities({
    missing,
    registry: "https://npm.pkg.github.com",
    fetchImpl: async () => assert.fail("must not query a registry other than public npm"),
  });
  assert.equal(results.size, 0);
});
