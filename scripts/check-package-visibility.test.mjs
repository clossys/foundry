import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkAllPackageVisibility,
  checkDeclaredPackages,
  fetchNpmOrgPackages,
  fetchNpmPackageVisibility,
  isBlindCredential,
  isFailureStatus,
  isRetentionExpired,
  reconcileRosterAgainstTarget,
  resolveActiveVisibilityTarget,
  selectRetentionDeclarations,
} from "./check-package-visibility.mjs";
import { PUBLIC_NPM_REGISTRY } from "./lib/public-npm-registry.mjs";

// Two layers of coverage, matching this repo's existing split:
//
//   1. UNIT — imports the real exported functions directly and injects a
//      fake `fetchImpl`/`readFile`, the same dependency-injection shape
//      packages/deployment/src/vercel/inspector.ts already uses for its own
//      provider calls. NEVER makes a real network call.
//   2. CLI — spawns the real script exactly the way CI does, for the paths
//      that exercise real files: the offline --declarations-only mode
//      against this repository's own governance/release-catalog.json and
//      package-scope.json (the exact contract this gate depends on), and
//      error paths that fail before any network call would happen.

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-package-visibility.mjs");
const repoRoot = resolve(dirname(scriptPath), "..");

// -------------------------------------------------------------------- fakes

/** A minimal fetch Response stand-in — no real network object anywhere. */
function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

/** A queue-based fake fetch: each call returns the next entry, by call order. */
function queueFetch(entries) {
  let index = 0;
  return async (url) => {
    if (index >= entries.length) throw new Error(`unexpected extra fetch call: ${url}`);
    const entry = entries[index++];
    if (entry instanceof Error) throw entry;
    return entry;
  };
}

function packumentFound(name) {
  return jsonResponse(200, { name, versions: { "1.0.0": {} } });
}

function target(overrides = {}) {
  return {
    id: "clossys-npmjs",
    status: "active",
    scope: "@clossys",
    registry: PUBLIC_NPM_REGISTRY,
    access: "public",
    packages: ["advisor", "starter"],
    ...overrides,
  };
}

function lifecycleWith(entries) {
  return { schemaVersion: 1, packages: entries };
}

function retentionWith(entries) {
  return { schemaVersion: 1, packages: entries };
}

// ------------------------------------------------------ resolveActiveVisibilityTarget

test("resolveActiveVisibilityTarget: resolves the real repository's own contract files cleanly", () => {
  const { target: resolved, fatal } = resolveActiveVisibilityTarget({
    catalogPath: join(repoRoot, "governance/release-catalog.json"),
    scopeFilePath: join(repoRoot, "package-scope.json"),
  });
  assert.equal(fatal, null);
  assert.equal(resolved.id, "clossys-npmjs");
  assert.equal(resolved.scope, "@clossys");
  assert.equal(resolved.registry, PUBLIC_NPM_REGISTRY);
  assert.equal(resolved.access, "public");
  assert.ok(Array.isArray(resolved.packages) && resolved.packages.length > 0);
});

test("resolveActiveVisibilityTarget: a malformed catalog is a fatal string, never a throw", () => {
  const readFile = (path) => {
    if (String(path).includes("release-catalog")) return JSON.stringify({ nonsense: true });
    return JSON.stringify({ scope: "@clossys", registry: PUBLIC_NPM_REGISTRY, access: "public" });
  };
  const { target: resolved, fatal } = resolveActiveVisibilityTarget({ readFile });
  assert.equal(resolved, null);
  assert.match(fatal, /could not resolve the active release target/);
});

test("resolveActiveVisibilityTarget: an identity that does not match the catalog's default target is fatal", () => {
  // The historical target's scope/registry must exactly match
  // governance/package-identity-transition.json's own "current" tuple for
  // loadReleaseCatalog's own validation to accept this fixture at all — read
  // it at runtime from the real file rather than duplicating that retired
  // identity as a literal in this repository's source (see AGENTS.md: never
  // hardcode the retired producer scope).
  const retiredIdentity = JSON.parse(readFileSync(join(repoRoot, "governance/package-identity-transition.json"), "utf8")).current;
  const readFile = (path) => {
    if (String(path).includes("release-catalog")) {
      return JSON.stringify({
        schemaVersion: 2,
        defaultTarget: "clossys-npmjs",
        targets: [
          { id: "current-github-packages", status: "historical", scope: retiredIdentity.scope, registry: retiredIdentity.registry, packages: "all" },
          {
            id: "clossys-npmjs",
            status: "active",
            scope: "@clossys",
            registry: PUBLIC_NPM_REGISTRY,
            access: "public",
            packages: [
              "advisor", "starter", "controller", "strategist", "writer", "designer",
              "architect", "bouncer", "butler", "giver", "influencer", "integrator",
              "keeper", "locksmith", "messenger", "observer", "builder", "inspector",
              "publisher",
            ],
          },
        ],
      });
    }
    // A mismatched scope: package-scope.json disagrees with the target.
    return JSON.stringify({ scope: "@someone-else", registry: PUBLIC_NPM_REGISTRY, access: "public" });
  };
  const { target: resolved, fatal } = resolveActiveVisibilityTarget({ readFile });
  assert.equal(resolved, null);
  assert.match(fatal, /expects @clossys/);
});

// ------------------------------------------------------ fetchNpmPackageVisibility

test("fetchNpmPackageVisibility: an anonymous 200 read is found/public", async () => {
  const fetchImpl = queueFetch([packumentFound("@clossys/advisor")]);
  const outcome = await fetchNpmPackageVisibility({ registry: PUBLIC_NPM_REGISTRY, name: "@clossys/advisor", fetchImpl });
  assert.deepEqual(outcome, { state: "found", visibility: "public" });
});

test("fetchNpmPackageVisibility: 404 is not-found, not an error", async () => {
  const fetchImpl = queueFetch([jsonResponse(404, {})]);
  const outcome = await fetchNpmPackageVisibility({ registry: PUBLIC_NPM_REGISTRY, name: "@clossys/ghost", fetchImpl });
  assert.deepEqual(outcome, { state: "not-found" });
});

test("fetchNpmPackageVisibility: a denied anonymous request is an error, never a silent not-found", async () => {
  const fetchImpl = queueFetch([jsonResponse(403, {})]);
  const outcome = await fetchNpmPackageVisibility({ registry: PUBLIC_NPM_REGISTRY, name: "@clossys/advisor", fetchImpl });
  assert.equal(outcome.state, "error");
  assert.ok(outcome.detail);
});

test("fetchNpmPackageVisibility: a network failure is an error", async () => {
  const fetchImpl = queueFetch([new Error("boom")]);
  const outcome = await fetchNpmPackageVisibility({ registry: PUBLIC_NPM_REGISTRY, name: "@clossys/advisor", fetchImpl });
  assert.equal(outcome.state, "error");
});

// ------------------------------------------------------ fetchNpmOrgPackages

test("fetchNpmOrgPackages: a successful org lookup returns every package name as the roster", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, { "@clossys/advisor": "read-write", "@clossys/starter": "read-write" })]);
  const outcome = await fetchNpmOrgPackages({ scope: "@clossys", token: "t", fetchImpl });
  assert.equal(outcome.state, "found");
  assert.deepEqual(new Set(outcome.packages), new Set(["@clossys/advisor", "@clossys/starter"]));
});

test("fetchNpmOrgPackages: an org 404 falls back to the user endpoint, same as the org-then-user GitHub pattern", async () => {
  const fetchImpl = queueFetch([jsonResponse(404, {}), jsonResponse(200, { "@clossys/advisor": "read-write" })]);
  const outcome = await fetchNpmOrgPackages({ scope: "@clossys", token: "t", fetchImpl });
  assert.equal(outcome.state, "found");
  assert.deepEqual(outcome.packages, ["@clossys/advisor"]);
});

test("fetchNpmOrgPackages: both endpoints 404 is an enumeration error, never found:empty", async () => {
  const fetchImpl = queueFetch([jsonResponse(404, {}), jsonResponse(404, {})]);
  const outcome = await fetchNpmOrgPackages({ scope: "@clossys", token: "t", fetchImpl });
  assert.equal(outcome.state, "error");
});

test("fetchNpmOrgPackages: a 401 is a loud, direct credential-loss signal, not a silent empty roster", async () => {
  const fetchImpl = queueFetch([jsonResponse(401, {})]);
  const outcome = await fetchNpmOrgPackages({ scope: "@clossys", token: "bad-token", fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /HTTP 401/);
  assert.match(outcome.detail, /cannot list/);
});

test("fetchNpmOrgPackages: a 403 is also an error, never treated as an empty-but-valid roster", async () => {
  const fetchImpl = queueFetch([jsonResponse(403, {})]);
  const outcome = await fetchNpmOrgPackages({ scope: "@clossys", token: "t", fetchImpl });
  assert.equal(outcome.state, "error");
});

test("fetchNpmOrgPackages: a non-object roster body is an error", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, ["not", "an", "object"])]);
  const outcome = await fetchNpmOrgPackages({ scope: "@clossys", token: "t", fetchImpl });
  assert.equal(outcome.state, "error");
});

test("fetchNpmOrgPackages: a network error is reported, never treated as a pass", async () => {
  const fetchImpl = queueFetch([new Error("dns failure")]);
  const outcome = await fetchNpmOrgPackages({ scope: "@clossys", token: "t", fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /dns failure/);
});

// ------------------------------------------------------ retention (unchanged shape)

test("isRetentionExpired: strictly before today is expired, today and after are not", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  assert.equal(isRetentionExpired("2026-06-14", now), true);
  assert.equal(isRetentionExpired("2026-06-15", now), false);
  assert.equal(isRetentionExpired("2026-06-16", now), false);
});

test("isRetentionExpired: a shape that does not even match YYYY-MM-DD is always treated as expired", () => {
  assert.equal(isRetentionExpired("not-a-date"), true);
  assert.equal(isRetentionExpired("2026-1-1"), true);
});

test("selectRetentionDeclarations: a well-formed entry is retained by name", () => {
  const { byName, findings, fatal } = selectRetentionDeclarations(retentionWith([{ name: "@clossys/copy", reason: "migration path", reviewBy: "2027-01-01" }]));
  assert.equal(fatal, null);
  assert.deepEqual(findings, []);
  assert.deepEqual(byName.get("@clossys/copy"), { reason: "migration path", reviewBy: "2027-01-01" });
});

test("selectRetentionDeclarations: a malformed entry is an error finding, excluded from the map", () => {
  const { byName, findings } = selectRetentionDeclarations(retentionWith([{ name: "@clossys/copy", reason: "", reviewBy: "2027-01-01" }]));
  assert.equal(byName.size, 0);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, "error");
});

test("selectRetentionDeclarations: a duplicate name is an error finding, keeping only the first", () => {
  const { byName, findings } = selectRetentionDeclarations(
    retentionWith([
      { name: "@clossys/copy", reason: "first", reviewBy: "2027-01-01" },
      { name: "@clossys/copy", reason: "second", reviewBy: "2027-02-01" },
    ]),
  );
  assert.equal(byName.get("@clossys/copy").reason, "first");
  assert.equal(findings.length, 1);
});

test("selectRetentionDeclarations: a malformed document shape is fatal", () => {
  const { fatal } = selectRetentionDeclarations({ notPackages: [] });
  assert.match(fatal, /does not have the expected/);
});

// ------------------------------------------------------ checkDeclaredPackages

test("checkDeclaredPackages: an anonymously-public package matching declared access is a pass", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([packumentFound("@clossys/advisor")]);
  const { results, lookups } = await checkDeclaredPackages({ target: t, roster: new Set(), fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "pass");
  assert.equal(lookups.found, 1);
});

test("checkDeclaredPackages: not-found but present in the authenticated roster is CONFIRMED PRIVATE — the exact incident this gate exists to catch", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([jsonResponse(404, {})]);
  const { results } = await checkDeclaredPackages({ target: t, roster: new Set(["@clossys/advisor"]), fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /is NOT anonymously readable — it is private/);
});

test("checkDeclaredPackages: not-found and absent from the roster is benign not-published, not a finding", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([jsonResponse(404, {})]);
  const { results } = await checkDeclaredPackages({ target: t, roster: new Set(), fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "not-published");
});

test("checkDeclaredPackages: an anonymous error is reported as error, never conflated with pass or finding", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([jsonResponse(500, {})]);
  const { results } = await checkDeclaredPackages({ target: t, roster: new Set(), fetchImpl });
  assert.equal(results[0].status, "error");
});

test("checkDeclaredPackages: every package is checked, one failure never stops the rest", async () => {
  const t = target({ packages: ["advisor", "starter"] });
  const fetchImpl = queueFetch([jsonResponse(500, {}), packumentFound("@clossys/starter")]);
  const { results } = await checkDeclaredPackages({ target: t, roster: new Set(), fetchImpl });
  assert.equal(results.length, 2);
  assert.equal(results[0].status, "error");
  assert.equal(results[1].status, "pass");
});

// ------------------------------------------------------ reconcileRosterAgainstTarget

test("reconcileRosterAgainstTarget: a roster package the target authorizes is skipped (already reconciled forward)", () => {
  const t = target({ packages: ["advisor"] });
  const results = reconcileRosterAgainstTarget(new Set(["@clossys/advisor"]), t, lifecycleWith([]));
  assert.deepEqual(results, []);
});

test("reconcileRosterAgainstTarget: an unauthorized package with no lifecycle entry is a finding", () => {
  const t = target({ packages: ["advisor"] });
  const results = reconcileRosterAgainstTarget(new Set(["@clossys/rogue"]), t, lifecycleWith([]));
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /no entry at all/);
});

test("reconcileRosterAgainstTarget: deprecated with a valid unexpired retention entry is a pass", () => {
  const t = target({ packages: ["advisor"] });
  const lifecycle = lifecycleWith([{ name: "@clossys/copy", status: "deprecated" }]);
  const now = new Date("2026-06-01T00:00:00Z");
  const retentionByName = new Map([["@clossys/copy", { reason: "migration", reviewBy: "2027-01-01" }]]);
  const results = reconcileRosterAgainstTarget(new Set(["@clossys/copy"]), t, lifecycle, retentionByName, now);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "pass");
});

test("reconcileRosterAgainstTarget: deprecated with no retention entry is a finding", () => {
  const t = target({ packages: ["advisor"] });
  const lifecycle = lifecycleWith([{ name: "@clossys/copy", status: "deprecated" }]);
  const results = reconcileRosterAgainstTarget(new Set(["@clossys/copy"]), t, lifecycle, new Map());
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /no entry in/);
});

test("reconcileRosterAgainstTarget: deprecated with an EXPIRED retention entry is a finding, not an indefinite pass", () => {
  const t = target({ packages: ["advisor"] });
  const lifecycle = lifecycleWith([{ name: "@clossys/copy", status: "deprecated" }]);
  const now = new Date("2026-06-01T00:00:00Z");
  const retentionByName = new Map([["@clossys/copy", { reason: "migration", reviewBy: "2026-01-01" }]]);
  const results = reconcileRosterAgainstTarget(new Set(["@clossys/copy"]), t, lifecycle, retentionByName, now);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /expired on/);
});

test("reconcileRosterAgainstTarget: live with a stale non-deprecated lifecycle status is a finding, naming the status", () => {
  const t = target({ packages: ["advisor"] });
  const lifecycle = lifecycleWith([{ name: "@clossys/oddball", status: "active" }]);
  const results = reconcileRosterAgainstTarget(new Set(["@clossys/oddball"]), t, lifecycle, new Map());
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /"active", not "deprecated"/);
});

// ------------------------------------------------------ isBlindCredential

test("isBlindCredential: true only when every attempted lookup found nothing", () => {
  assert.equal(isBlindCredential({ attempted: 3, found: 0 }), true);
  assert.equal(isBlindCredential({ attempted: 3, found: 1 }), false);
  assert.equal(isBlindCredential({ attempted: 0, found: 0 }), false);
  assert.equal(isBlindCredential(undefined), false);
});

// ------------------------------------------------------ checkAllPackageVisibility

test("checkAllPackageVisibility: a registry other than public npm is refused, never silently skipped", async () => {
  const t = target({ registry: "https://npm.pkg.github.com" });
  const outcome = await checkAllPackageVisibility({ target: t, lifecycle: lifecycleWith([]), retention: retentionWith([]), token: "t", fetchImpl: queueFetch([]) });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /only knows how to verify visibility on public npm/);
});

test("checkAllPackageVisibility: a target authorizing no packages is a fatal empty scan", async () => {
  const t = target({ packages: [] });
  const outcome = await checkAllPackageVisibility({ target: t, lifecycle: lifecycleWith([]), retention: retentionWith([]), token: "t", fetchImpl: queueFetch([]) });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /authorizes no packages/);
});

test("checkAllPackageVisibility: a roster enumeration error is fatal", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([jsonResponse(401, {})]);
  const outcome = await checkAllPackageVisibility({ target: t, lifecycle: lifecycleWith([]), retention: retentionWith([]), token: "bad", fetchImpl });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /could not enumerate/);
});

test("checkAllPackageVisibility: every declared lookup coming back unresolved is a fatal blind-credential guard", async () => {
  const t = target({ packages: ["advisor", "starter"] });
  const fetchImpl = queueFetch([
    jsonResponse(200, {}), // roster: empty but valid (org exists, holds nothing)
    jsonResponse(404, {}), // advisor: not found
    jsonResponse(404, {}), // starter: not found
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, lifecycle: lifecycleWith([]), retention: retentionWith([]), token: "t", fetchImpl });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /cannot distinguish/);
});

test("checkAllPackageVisibility: a fully reconciled set is a clean pass — declared, and registry-vs-declaration both agree", async () => {
  const t = target({ packages: ["advisor", "starter"] });
  const fetchImpl = queueFetch([
    jsonResponse(200, { "@clossys/advisor": "read-write", "@clossys/starter": "read-write" }), // roster
    packumentFound("@clossys/advisor"),
    packumentFound("@clossys/starter"),
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, lifecycle: lifecycleWith([]), retention: retentionWith([]), token: "t", fetchImpl });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 0);
  assert.equal(outcome.registryPackagesEnumerated, 2);
  assert.ok(outcome.results.every((r) => r.status === "pass"));
});

test("checkAllPackageVisibility: a private declared package is a finding (exit 1), not an error", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([
    jsonResponse(200, { "@clossys/advisor": "read-write" }), // roster: it exists
    jsonResponse(404, {}), // anonymous: cannot see it — private
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, lifecycle: lifecycleWith([]), retention: retentionWith([]), token: "t", fetchImpl });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 1);
  assert.ok(outcome.results.some((r) => r.status === "finding"));
});

test("checkAllPackageVisibility: an unauthorized roster package with an undeclared status is also a finding", async () => {
  const t = target({ packages: ["advisor"] });
  const lifecycle = lifecycleWith([{ name: "@clossys/rogue", status: "retired" }]);
  const fetchImpl = queueFetch([
    jsonResponse(200, { "@clossys/advisor": "read-write", "@clossys/rogue": "read-write" }),
    packumentFound("@clossys/advisor"),
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, lifecycle, retention: retentionWith([]), token: "t", fetchImpl });
  assert.equal(outcome.code, 1);
  assert.ok(outcome.results.some((r) => r.package === "@clossys/rogue" && r.status === "finding"));
});

test("checkAllPackageVisibility: an error anywhere dominates a finding — exit 2, not 1", async () => {
  const t = target({ packages: ["advisor", "starter"] });
  const fetchImpl = queueFetch([
    jsonResponse(200, { "@clossys/advisor": "read-write", "@clossys/starter": "read-write" }),
    jsonResponse(404, {}), // advisor: private -> finding
    jsonResponse(500, {}), // starter: error
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, lifecycle: lifecycleWith([]), retention: retentionWith([]), token: "t", fetchImpl });
  assert.equal(outcome.code, 2);
});

test("checkAllPackageVisibility: a malformed retention document is fatal", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([jsonResponse(200, { "@clossys/advisor": "read-write" }), packumentFound("@clossys/advisor")]);
  const outcome = await checkAllPackageVisibility({ target: t, lifecycle: lifecycleWith([]), retention: { notPackages: [] }, token: "t", fetchImpl });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /does not have the expected/);
});

// ------------------------------------------------------ isFailureStatus

test("isFailureStatus: pass and not-published are benign; everything else, including an unrecognised status, fails closed", () => {
  assert.equal(isFailureStatus("pass"), false);
  assert.equal(isFailureStatus("not-published"), false);
  assert.equal(isFailureStatus("finding"), true);
  assert.equal(isFailureStatus("error"), true);
  assert.equal(isFailureStatus("something-new-nobody-added-a-case-for"), true);
});

// -------------------------------------------------------------------- CLI

function run(args, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...options.env },
    });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status, stdout: error.stdout?.toString() ?? "", stderr: error.stderr?.toString() ?? "" };
  }
}

test("CLI: --declarations-only against this repository's own real contract files passes cleanly, no network", () => {
  const result = run(["--declarations-only"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /PACKAGE VISIBILITY DECLARATIONS OK/);
});

test("CLI: --declarations-only --json emits parseable structured output", () => {
  const result = run(["--declarations-only", "--json"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, "declarations-only");
  assert.equal(parsed.target, "clossys-npmjs");
});

test("CLI: live mode with no NPM_PACKAGES_TOKEN is exit 2, never attempted against the network", () => {
  const result = run([], { env: { NPM_PACKAGES_TOKEN: undefined } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /NPM_PACKAGES_TOKEN is not set/);
});

test("CLI: a deprecated package under the active scope with no retention entry fails --declarations-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "visibility-cli-"));
  try {
    const lifecyclePath = join(dir, "lifecycle.json");
    const retentionPath = join(dir, "retention.json");
    writeFileSync(lifecyclePath, JSON.stringify({ schemaVersion: 1, packages: [{ name: "@clossys/copy", status: "deprecated" }] }));
    writeFileSync(retentionPath, JSON.stringify({ schemaVersion: 1, packages: [] }));
    const result = run(["--declarations-only", "--lifecycle", lifecyclePath, "--retention", retentionPath]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FIND.*@clossys\/copy/s);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: a deprecated package with a valid unexpired retention entry passes --declarations-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "visibility-cli-"));
  try {
    const lifecyclePath = join(dir, "lifecycle.json");
    const retentionPath = join(dir, "retention.json");
    writeFileSync(lifecyclePath, JSON.stringify({ schemaVersion: 1, packages: [{ name: "@clossys/copy", status: "deprecated" }] }));
    writeFileSync(retentionPath, JSON.stringify({ schemaVersion: 1, packages: [{ name: "@clossys/copy", reason: "migration path", reviewBy: "2099-01-01" }] }));
    const result = run(["--declarations-only", "--lifecycle", lifecyclePath, "--retention", retentionPath]);
    assert.equal(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: a malformed release catalog is exit 2 with a gate-specific message, never a silent pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "visibility-cli-"));
  try {
    const catalogPath = join(dir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify({ nonsense: true }));
    const result = run(["--declarations-only", "--catalog", catalogPath]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /could not resolve the active release target/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: an unparseable retention document is exit 2, never treated as an empty declaration", () => {
  const dir = mkdtempSync(join(tmpdir(), "visibility-cli-"));
  try {
    const retentionPath = join(dir, "retention.json");
    writeFileSync(retentionPath, "{not json");
    const result = run(["--declarations-only", "--retention", retentionPath]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /does not parse as JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: an unrecognised flag is refused rather than silently ignored", () => {
  const result = run(["--not-a-real-flag"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:/);
});
