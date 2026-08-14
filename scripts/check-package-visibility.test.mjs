import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { bareName, checkPackageVisibility, fetchPackageVisibility, selectDeclaredPackages } from "./check-package-visibility.mjs";

// Two layers of coverage, matching this repo's existing split:
//
//   1. UNIT — imports the real exported functions directly and injects a
//      fake `fetchImpl`, the same dependency-injection shape
//      packages/deployment/src/vercel/inspector.ts already uses for its own
//      provider calls. NEVER makes a real network call — every "response"
//      below is a plain object built by this file, never `fetch()`.
//   2. CLI — spawns the real script exactly the way CI does, for the paths
//      that fail before any network call would happen (missing token,
//      missing/malformed files), the same end-to-end pattern
//      check-workspace-links.test.mjs and check-release-readiness.test.mjs
//      use for their own CLIs.

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-package-visibility.mjs");
const OWNER = "gate-fixture-owner";
const TOKEN = "test-token";

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

/** A queue-based fake fetch: each call returns the next entry, by URL match order. */
function queueFetch(entries) {
  let index = 0;
  return async (url) => {
    if (index >= entries.length) throw new Error(`unexpected extra fetch call: ${url}`);
    const entry = entries[index++];
    if (entry instanceof Error) throw entry;
    return entry;
  };
}

function lifecycleWith(entries) {
  return { schemaVersion: 1, packages: entries };
}

function visibilityWith(entries) {
  return { schemaVersion: 1, packages: entries };
}

// -------------------------------------------------------------------- bareName

test("bareName strips the scope, leaving an unscoped name unchanged", () => {
  assert.equal(bareName("@scope/pkg"), "pkg");
  assert.equal(bareName("unscoped"), "unscoped");
});

// -------------------------------------------------------------------- selectDeclaredPackages

test("selectDeclaredPackages: a published entry with a valid declaration is included, nothing else", () => {
  const lifecycle = lifecycleWith([{ name: "@scope/a", status: "published" }, { name: "@scope/b", status: "deprecated" }]);
  const visibility = visibilityWith([{ name: "@scope/a", intendedVisibility: "public" }]);
  const { declared, results } = selectDeclaredPackages(lifecycle, visibility);
  assert.deepEqual(declared, [{ name: "@scope/a", bareName: "a", intendedVisibility: "public" }]);
  assert.equal(results.length, 0);
});

test("selectDeclaredPackages: a published entry with NO visibility declaration is a finding, not a silent pass", () => {
  const lifecycle = lifecycleWith([{ name: "@scope/undeclared", status: "published" }]);
  const visibility = visibilityWith([]);
  const { declared, results } = selectDeclaredPackages(lifecycle, visibility);
  assert.equal(declared.length, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /undeclared/);
});

test("selectDeclaredPackages: an invalid declared value (not public/private) is a finding", () => {
  const lifecycle = lifecycleWith([{ name: "@scope/a", status: "published" }]);
  const visibility = visibilityWith([{ name: "@scope/a", intendedVisibility: "definitely-not-a-real-value" }]);
  const { declared, results } = selectDeclaredPackages(lifecycle, visibility);
  assert.equal(declared.length, 0);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /not "public" or "private"/);
});

test("selectDeclaredPackages: a declaration naming a non-published entry is reported, but does not block the scan", () => {
  const lifecycle = lifecycleWith([{ name: "@scope/gone", status: "retired" }]);
  const visibility = visibilityWith([{ name: "@scope/gone", intendedVisibility: "public" }]);
  const { declared, results, fatal } = selectDeclaredPackages(lifecycle, visibility);
  assert.equal(fatal, null);
  assert.equal(declared.length, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "not-published");
});

test("selectDeclaredPackages: a malformed document shape is fatal (caller must exit 2, not iterate a broken shape)", () => {
  const { fatal } = selectDeclaredPackages({ packages: "not-an-array" }, visibilityWith([]));
  assert.match(fatal, /expected \{ packages: \[\.\.\.\] \} shape/);
});

// -------------------------------------------------------------------- fetchPackageVisibility

test("fetchPackageVisibility: a public package found on the org endpoint", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, { visibility: "public" })]);
  const outcome = await fetchPackageVisibility({ owner: OWNER, name: "a", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { state: "found", visibility: "public" });
});

test("fetchPackageVisibility: falls back to the user endpoint on an org 404, and still finds it", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return urls.length === 1 ? jsonResponse(404, {}) : jsonResponse(200, { visibility: "private" });
  };
  const outcome = await fetchPackageVisibility({ owner: OWNER, name: "a", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { state: "found", visibility: "private" });
  assert.match(urls[0], /\/orgs\//);
  assert.match(urls[1], /\/users\//);
});

test("fetchPackageVisibility: both endpoints 404 is not-found, never an error and never a finding", async () => {
  const fetchImpl = queueFetch([jsonResponse(404, {}), jsonResponse(404, {})]);
  const outcome = await fetchPackageVisibility({ owner: OWNER, name: "never-published", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { state: "not-found" });
});

test("fetchPackageVisibility: a 401 is an error, not a not-found — auth failure must never look like an unpublished package", async () => {
  const fetchImpl = queueFetch([jsonResponse(401, { message: "Bad credentials" })]);
  const outcome = await fetchPackageVisibility({ owner: OWNER, name: "a", token: TOKEN, fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /HTTP 401/);
});

test("fetchPackageVisibility: a rate limit (429) is an error", async () => {
  const fetchImpl = queueFetch([jsonResponse(429, { message: "rate limited" })]);
  const outcome = await fetchPackageVisibility({ owner: OWNER, name: "a", token: TOKEN, fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /HTTP 429/);
});

test("fetchPackageVisibility: a thrown network error (unreachable endpoint) is an error", async () => {
  const fetchImpl = queueFetch([new TypeError("fetch failed")]);
  const outcome = await fetchPackageVisibility({ owner: OWNER, name: "a", token: TOKEN, fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /network error/);
});

test("fetchPackageVisibility: a 200 with an unparseable/missing visibility field is an error, never assumed public", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, { name: "a" })]);
  const outcome = await fetchPackageVisibility({ owner: OWNER, name: "a", token: TOKEN, fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /no recognisable "visibility" field/);
});

test("fetchPackageVisibility: a 200 body that throws on .json() is an error", async () => {
  const fetchImpl = queueFetch([
    { status: 200, ok: true, async json() { throw new SyntaxError("Unexpected token"); } },
  ]);
  const outcome = await fetchPackageVisibility({ owner: OWNER, name: "a", token: TOKEN, fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /could not parse/);
});

// -------------------------------------------------------------------- checkPackageVisibility (the full join + lookup)

test("a public package (matching declared intent) passes", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/pub", status: "published" }]);
  const visibility = visibilityWith([{ name: "@scope/pub", intendedVisibility: "public" }]);
  const fetchImpl = queueFetch([jsonResponse(200, { visibility: "public" })]);
  const { results } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "pass");
});

test("a private package (declared public) is a finding — the real incident this gate exists to catch", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/oops", status: "published" }]);
  const visibility = visibilityWith([{ name: "@scope/oops", intendedVisibility: "public" }]);
  const fetchImpl = queueFetch([jsonResponse(404, {}), jsonResponse(200, { visibility: "private" })]);
  const { results } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /registry-private but declares intendedVisibility "public"/);
  assert.match(results[0].detail, /defaults every new package to private/);
});

test("an undeclared-visibility published entry is a finding, joined without ever calling fetch", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/undeclared", status: "published" }]);
  const visibility = visibilityWith([]);
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return jsonResponse(200, { visibility: "public" });
  };
  const { results } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.equal(fetchCalls, 0, "an undeclared package must never reach the network — there is nothing to compare against");
});

test("an API error surfaces as an error result, distinct from a finding", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/flaky", status: "published" }]);
  const visibility = visibilityWith([{ name: "@scope/flaky", intendedVisibility: "public" }]);
  const fetchImpl = queueFetch([jsonResponse(500, {}), jsonResponse(500, {})]);
  const { results } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "error");
});

test("a not-yet-published package is reported but is not a violation", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/new", status: "published" }]);
  const visibility = visibilityWith([{ name: "@scope/new", intendedVisibility: "public" }]);
  const fetchImpl = queueFetch([jsonResponse(404, {}), jsonResponse(404, {})]);
  const { results } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "not-published");
});

test("every package is checked and reported — one private package never hides a second one (no fail-fast)", async () => {
  const lifecycle = lifecycleWith([
    { name: "@scope/first-bad", status: "published" },
    { name: "@scope/second-bad", status: "published" },
    { name: "@scope/fine", status: "published" },
  ]);
  const visibility = visibilityWith([
    { name: "@scope/first-bad", intendedVisibility: "public" },
    { name: "@scope/second-bad", intendedVisibility: "public" },
    { name: "@scope/fine", intendedVisibility: "public" },
  ]);
  const fetchImpl = queueFetch([
    jsonResponse(404, {}), jsonResponse(200, { visibility: "private" }), // first-bad
    jsonResponse(404, {}), jsonResponse(200, { visibility: "private" }), // second-bad
    jsonResponse(200, { visibility: "public" }), // fine
  ]);
  const { results } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(results.length, 3);
  assert.equal(results.filter((r) => r.status === "finding").length, 2);
  assert.equal(results.filter((r) => r.status === "pass").length, 1);
});

test("a package declared intentionally private that really is private passes (symmetric, not just the public case)", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/kept-private", status: "published" }]);
  const visibility = visibilityWith([{ name: "@scope/kept-private", intendedVisibility: "private" }]);
  const fetchImpl = queueFetch([jsonResponse(200, { visibility: "private" })]);
  const { results } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(results[0].status, "pass");
});

// -------------------------------------------------------------------- CLI (paths that never touch the network)

function run(args, { cwd, env } = {}) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function withDir(build) {
  const root = mkdtempSync(join(tmpdir(), "package-visibility-test-"));
  try {
    build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFixture(root, { lifecycle, visibility, scope = "@fixture" }) {
  mkdirSync(join(root, "docs", "contracts"), { recursive: true });
  writeFileSync(join(root, "docs", "contracts", "package-lifecycle.json"), JSON.stringify(lifecycle, null, 2));
  writeFileSync(join(root, "docs", "contracts", "package-visibility.json"), JSON.stringify(visibility, null, 2));
  writeFileSync(join(root, "package-scope.json"), JSON.stringify({ scope, registry: "https://npm.pkg.github.com" }, null, 2));
}

test("CLI: a missing GH_PACKAGES_TOKEN exits 2, never 0 — and never attempts a network call", () => {
  withDir((root) => {
    writeFixture(root, {
      lifecycle: lifecycleWith([{ name: "@fixture/a", status: "published" }]),
      visibility: visibilityWith([{ name: "@fixture/a", intendedVisibility: "public" }]),
    });
    const r = run([], { cwd: root, env: { GH_PACKAGES_TOKEN: "" } });
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /GH_PACKAGES_TOKEN is not set/);
  });
});

test("CLI: a missing lifecycle document exits 2", () => {
  withDir((root) => {
    mkdirSync(join(root, "docs", "contracts"), { recursive: true });
    writeFileSync(join(root, "docs", "contracts", "package-visibility.json"), JSON.stringify(visibilityWith([])));
    writeFileSync(join(root, "package-scope.json"), JSON.stringify({ scope: "@fixture" }));
    const r = run([], { cwd: root, env: { GH_PACKAGES_TOKEN: "x" } });
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /no lifecycle document/);
  });
});

test("CLI: an unparseable lifecycle document exits 2", () => {
  withDir((root) => {
    mkdirSync(join(root, "docs", "contracts"), { recursive: true });
    writeFileSync(join(root, "docs", "contracts", "package-lifecycle.json"), "{ not valid json");
    writeFileSync(join(root, "docs", "contracts", "package-visibility.json"), JSON.stringify(visibilityWith([])));
    writeFileSync(join(root, "package-scope.json"), JSON.stringify({ scope: "@fixture" }));
    const r = run([], { cwd: root, env: { GH_PACKAGES_TOKEN: "x" } });
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /does not parse as JSON/);
  });
});

test("CLI: zero \"published\" entries is an empty scan — exit 2, never a clean pass", () => {
  withDir((root) => {
    writeFixture(root, {
      lifecycle: lifecycleWith([{ name: "@fixture/a", status: "deprecated", noReplacementReason: "x", deprecatedOn: "2026-01-01", decision: "x", migration: "x", forwardsToReplacement: false }]),
      visibility: visibilityWith([]),
    });
    const r = run([], { cwd: root, env: { GH_PACKAGES_TOKEN: "x" } });
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /refusing to report a clean pass on an empty scan/);
  });
});

test("this repository's own real contract files join cleanly (structure only — no network call happens before the token check)", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const r = run([], { cwd: repoRoot, env: { GH_PACKAGES_TOKEN: "" } });
  // No token in this sandboxed test run -> exits 2 before any fetch, but
  // getting THIS FAR (past file reads and JSON parsing) already proves the
  // real docs/contracts/*.json files in this repository parse and are not
  // an empty scan.
  assert.equal(r.code, 2, `expected exit 2 (no token), got ${r.code}: ${r.out}`);
  assert.match(r.out, /GH_PACKAGES_TOKEN is not set/);
});
