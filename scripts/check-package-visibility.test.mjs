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
  fetchNpmPackageVisibility,
  fetchNpmScopePackages,
  findUndeclaredPackages,
  isFailureStatus,
  isRetentionExpired,
  resolveActiveVisibilityTarget,
  selectRetentionDeclarations,
} from "./check-package-visibility.mjs";
import { PUBLIC_NPM_REGISTRY } from "./lib/public-npm-registry.mjs";

// Two layers of coverage, matching this repo's existing split:
//
//   1. UNIT — imports the real exported functions directly and injects a
//      fake `fetchImpl`/`readFile`, the same dependency-injection shape
//      packages/deployment/src/vercel/inspector.ts already uses for its own
//      provider calls. NEVER makes a real network call. This is where the
//      live registry paths (both directions: declared-package packument
//      reads AND the roster enumeration) are actually exercised, including
//      with no credential of any kind — there is none to inject.
//   2. CLI — spawns the real script exactly the way CI does, for the paths
//      that exercise real files: the offline --declarations-only mode
//      against this repository's own governance/release-catalog.json and
//      package-scope.json (the exact contract this gate depends on), and
//      error paths that fail before any network call would happen. The
//      live network path is deliberately NOT exercised through a spawned
//      CLI process here — that would make this suite's pass/fail depend on
//      the real registry being reachable, which is exactly what the UNIT
//      layer above exists to avoid needing.

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
    return JSON.stringify({ scope: "@other-scope", registry: PUBLIC_NPM_REGISTRY, access: "public" });
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

// ------------------------------------------------------ fetchNpmScopePackages (anonymous roster)

test("fetchNpmScopePackages: a successful org lookup returns every package name as the roster, no credential sent", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, { "@clossys/advisor": "write", "@clossys/starter": "write" })]);
  const outcome = await fetchNpmScopePackages({ scope: "@clossys", fetchImpl });
  assert.equal(outcome.state, "found");
  assert.deepEqual(new Set(outcome.packages), new Set(["@clossys/advisor", "@clossys/starter"]));
});

test("fetchNpmScopePackages: an org 404 falls back to the user endpoint, same as the org-then-user npm pattern", async () => {
  const fetchImpl = queueFetch([jsonResponse(404, {}), jsonResponse(200, { "@clossys/advisor": "write" })]);
  const outcome = await fetchNpmScopePackages({ scope: "@clossys", fetchImpl });
  assert.equal(outcome.state, "found");
  assert.deepEqual(outcome.packages, ["@clossys/advisor"]);
});

test("fetchNpmScopePackages: both endpoints 404 is an enumeration error, never found:empty", async () => {
  const fetchImpl = queueFetch([jsonResponse(404, {}), jsonResponse(404, {})]);
  const outcome = await fetchNpmScopePackages({ scope: "@clossys", fetchImpl });
  assert.equal(outcome.state, "error");
});

test("fetchNpmScopePackages: a genuinely empty but well-formed roster is a legitimate found:[], not an error", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, {})]);
  const outcome = await fetchNpmScopePackages({ scope: "@clossys", fetchImpl });
  assert.deepEqual(outcome, { state: "found", packages: [] });
});

test("fetchNpmScopePackages: a non-200/404 status is an error, never treated as an empty-but-valid roster", async () => {
  const fetchImpl = queueFetch([jsonResponse(500, {})]);
  const outcome = await fetchNpmScopePackages({ scope: "@clossys", fetchImpl });
  assert.equal(outcome.state, "error");
});

test("fetchNpmScopePackages: a non-object roster body is an error", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, ["not", "an", "object"])]);
  const outcome = await fetchNpmScopePackages({ scope: "@clossys", fetchImpl });
  assert.equal(outcome.state, "error");
});

test("fetchNpmScopePackages: an unparseable JSON body is an error", async () => {
  const fetchImpl = queueFetch([{ status: 200, ok: true, async json() { throw new Error("bad json"); } }]);
  const outcome = await fetchNpmScopePackages({ scope: "@clossys", fetchImpl });
  assert.equal(outcome.state, "error");
});

test("fetchNpmScopePackages: a network error is reported, never treated as a pass", async () => {
  const fetchImpl = queueFetch([new Error("dns failure")]);
  const outcome = await fetchNpmScopePackages({ scope: "@clossys", fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /dns failure/);
});

// ------------------------------------------------------ findUndeclaredPackages

test("findUndeclaredPackages: a roster package the target authorizes is skipped (already reconciled by the declared direction)", () => {
  const t = target({ packages: ["advisor"] });
  const results = findUndeclaredPackages(new Set(["@clossys/advisor"]), t);
  assert.deepEqual(results, []);
});

test("findUndeclaredPackages: a roster package not in the declared set is a finding, tagged direction 'undeclared'", () => {
  const t = target({ packages: ["advisor"] });
  const results = findUndeclaredPackages(new Set(["@clossys/rogue"]), t);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.equal(results[0].direction, "undeclared");
  assert.match(results[0].detail, /does not declare it/);
});

test("findUndeclaredPackages: every undeclared package is reported, not just the first", () => {
  const t = target({ packages: ["advisor"] });
  const results = findUndeclaredPackages(new Set(["@clossys/rogue-one", "@clossys/rogue-two"]), t);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.status === "finding" && r.direction === "undeclared"));
});

// ------------------------------------------------------ retention (unchanged shape, offline-only now)

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

function retentionWith(entries) {
  return { schemaVersion: 1, packages: entries };
}

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

test("checkDeclaredPackages: an anonymously-public package is a pass, tagged direction 'declared'", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([packumentFound("@clossys/advisor")]);
  const { results, lookups } = await checkDeclaredPackages({ target: t, fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "pass");
  assert.equal(results[0].direction, "declared");
  assert.equal(lookups.found, 1);
  assert.equal(lookups.attempted, 1);
});

test("checkDeclaredPackages: a 404 is ALWAYS a finding now -- no roster cross-check, no benign not-published skip", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([jsonResponse(404, {})]);
  const { results } = await checkDeclaredPackages({ target: t, fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.equal(results[0].direction, "declared");
  assert.match(results[0].detail, /NOT publicly installable right now/);
  assert.match(results[0].detail, /cannot tell, and does not try to tell/);
});

test("checkDeclaredPackages: an anonymous error is reported as error, never conflated with pass or finding", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([jsonResponse(500, {})]);
  const { results } = await checkDeclaredPackages({ target: t, fetchImpl });
  assert.equal(results[0].status, "error");
});

test("checkDeclaredPackages: every package is checked, one failure never stops the rest", async () => {
  const t = target({ packages: ["advisor", "starter"] });
  const fetchImpl = queueFetch([jsonResponse(500, {}), packumentFound("@clossys/starter")]);
  const { results } = await checkDeclaredPackages({ target: t, fetchImpl });
  assert.equal(results.length, 2);
  assert.equal(results[0].status, "error");
  assert.equal(results[1].status, "pass");
});

// ------------------------------------------------------ isFailureStatus

test("isFailureStatus: only pass is benign; everything else, including an unrecognised status, fails closed", () => {
  assert.equal(isFailureStatus("pass"), false);
  assert.equal(isFailureStatus("finding"), true);
  assert.equal(isFailureStatus("error"), true);
  assert.equal(isFailureStatus("not-published"), true); // the old benign skip state no longer exists
  assert.equal(isFailureStatus("something-new-nobody-added-a-case-for"), true);
});

// ------------------------------------------------------ checkAllPackageVisibility (no credential, ever, both directions)

test("checkAllPackageVisibility: a registry other than public npm is refused, never silently skipped", async () => {
  // A fictional non-public-npm registry -- this guard only cares that the
  // value is not PUBLIC_NPM_REGISTRY, so a placeholder keeps this fixture
  // decoupled from any real registry identity, historical or otherwise.
  const t = target({ registry: "https://registry.example.invalid" });
  const outcome = await checkAllPackageVisibility({ target: t, fetchImpl: queueFetch([]) });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /only knows how to verify visibility on public npm/);
});

test("checkAllPackageVisibility: a target whose access is not public is refused, never silently checked as if it were", async () => {
  const t = target({ access: "restricted" });
  const outcome = await checkAllPackageVisibility({ target: t, fetchImpl: queueFetch([]) });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /declares access "restricted"/);
});

test("checkAllPackageVisibility: a target authorizing no packages is a fatal empty scan", async () => {
  const t = target({ packages: [] });
  const outcome = await checkAllPackageVisibility({ target: t, fetchImpl: queueFetch([]) });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /authorizes no packages/);
});

test("checkAllPackageVisibility: a roster enumeration error is fatal -- never silently read as 'nothing undeclared'", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([
    packumentFound("@clossys/advisor"), // declared direction: fine
    jsonResponse(404, {}), // roster: org 404
    jsonResponse(404, {}), // roster: user 404 too -> enumeration error
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, fetchImpl });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /could not enumerate public npm packages/);
});

test("checkAllPackageVisibility: a fully reconciled two-directional set is a clean pass, with no credential involved anywhere", async () => {
  const t = target({ packages: ["advisor", "starter"] });
  const fetchImpl = queueFetch([
    packumentFound("@clossys/advisor"),
    packumentFound("@clossys/starter"),
    jsonResponse(200, { "@clossys/advisor": "write", "@clossys/starter": "write" }), // roster: exactly the declared set
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, fetchImpl });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 0);
  assert.equal(outcome.registryPackagesEnumerated, 2);
  assert.ok(outcome.results.every((r) => r.status === "pass"));
  assert.ok(outcome.results.every((r) => r.direction === "declared")); // nothing undeclared to report
});

test("checkAllPackageVisibility: one declared package 404ing is a 'declared' finding (exit 1), not an error", async () => {
  const t = target({ packages: ["advisor", "starter"] });
  const fetchImpl = queueFetch([
    packumentFound("@clossys/advisor"),
    jsonResponse(404, {}),
    jsonResponse(200, { "@clossys/advisor": "write" }), // roster: starter genuinely never published
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, fetchImpl });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 1);
  assert.ok(outcome.results.some((r) => r.status === "finding" && r.direction === "declared"));
});

test("checkAllPackageVisibility: a live-but-undeclared roster package is an 'undeclared' finding, distinct from a declared finding", async () => {
  const t = target({ packages: ["advisor"] });
  const fetchImpl = queueFetch([
    packumentFound("@clossys/advisor"),
    jsonResponse(200, { "@clossys/advisor": "write", "@clossys/rogue": "write" }), // roster: rogue is undeclared
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, fetchImpl });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 1);
  const undeclared = outcome.results.filter((r) => r.direction === "undeclared");
  assert.equal(undeclared.length, 1);
  assert.equal(undeclared[0].package, "@clossys/rogue");
  assert.equal(undeclared[0].status, "finding");
});

test("checkAllPackageVisibility: an error anywhere dominates a finding -- exit 2, not 1", async () => {
  const t = target({ packages: ["advisor", "starter"] });
  const fetchImpl = queueFetch([
    jsonResponse(404, {}), // advisor: declared finding
    jsonResponse(500, {}), // starter: error
    jsonResponse(200, {}), // roster: empty, fine on its own
  ]);
  const outcome = await checkAllPackageVisibility({ target: t, fetchImpl });
  assert.equal(outcome.code, 2);
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
