import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  bareName,
  checkAllPackageVisibility,
  checkPackageVisibility,
  fetchPackageVisibility,
  fetchRegistryPackages,
  isBlindCredential,
  normalizeRegistryName,
  reconcileRegistryAgainstLifecycle,
  selectDeclaredPackages,
} from "./check-package-visibility.mjs";

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

// A blind credential is the sharpest failure mode this gate has, because it
// is the one that produces a CONFIDENT WRONG ANSWER rather than an obvious
// break: GitHub answers 404 (not 403) for a package the caller cannot see,
// so a token that lost read:packages gets exactly the same bytes back as a
// registry that genuinely holds nothing. Per package that is unresolvable.
// In aggregate it is not, and `lookups` is what lets main() tell the
// difference — so these two tests pin the counter's meaning, not just the
// results array.
test("lookups counts only real registry lookups, and counts a blind token as zero found", async () => {
  const names = ["@scope/a", "@scope/b", "@scope/c"];
  const lifecycle = lifecycleWith(names.map((name) => ({ name, status: "published" })));
  const visibility = visibilityWith(names.map((name) => ({ name, intendedVisibility: "public" })));
  // Every lookup 404s on BOTH the org and the user endpoint — what a token
  // without read:packages actually receives.
  const fetchImpl = async () => jsonResponse(404, {});
  const { results, lookups } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(lookups.attempted, 3);
  assert.equal(lookups.found, 0, "a token that sees nothing must report zero found, which is what main() exits 2 on");
  assert.equal(results.filter((r) => r.status === "not-published").length, 3);
});

test("lookups.found counts a finding as well as a pass — the registry answered, and that is what makes the run trustworthy", async () => {
  const lifecycle = lifecycleWith([
    { name: "@scope/seen-private", status: "published" },
    { name: "@scope/absent", status: "published" },
  ]);
  const visibility = visibilityWith([
    { name: "@scope/seen-private", intendedVisibility: "public" },
    { name: "@scope/absent", intendedVisibility: "public" },
  ]);
  const fetchImpl = queueFetch([
    jsonResponse(200, { visibility: "private" }), // seen-private: a real answer
    jsonResponse(404, {}), jsonResponse(404, {}), // absent: genuinely not there
  ]);
  const { lookups } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(lookups.attempted, 2);
  assert.equal(lookups.found, 1, "one package answered, so this run saw the registry and its 404 for the other is believable");
});

test("a stale declaration's not-published result never counts as a lookup — it was never looked up", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/real", status: "published" }]);
  const visibility = visibilityWith([
    { name: "@scope/real", intendedVisibility: "public" },
    { name: "@scope/gone", intendedVisibility: "public" }, // not a published entry
  ]);
  const fetchImpl = queueFetch([jsonResponse(200, { visibility: "public" })]);
  const { results, lookups } = await checkPackageVisibility({ lifecycle, visibility, owner: OWNER, token: TOKEN, fetchImpl });
  assert.equal(lookups.attempted, 1, "only the published entry is a registry lookup");
  assert.equal(lookups.found, 1);
  assert.equal(results.filter((r) => r.status === "not-published").length, 1);
});

test("isBlindCredential: every lookup 404 means could-not-run (exit 2), not a clean pass", () => {
  assert.equal(isBlindCredential({ attempted: 14, found: 0 }), true);
  assert.equal(isBlindCredential({ attempted: 1, found: 0 }), true);
});

test("isBlindCredential: a single real answer is enough to believe the rest of the 404s", () => {
  assert.equal(isBlindCredential({ attempted: 14, found: 1 }), false);
  assert.equal(isBlindCredential({ attempted: 14, found: 14 }), false);
});

test("isBlindCredential: nothing looked up at all is not a blind credential — the empty-scan guard owns that case", () => {
  assert.equal(isBlindCredential({ attempted: 0, found: 0 }), false);
  assert.equal(isBlindCredential(undefined), false);
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

// ------------------------------------------- CLI: --declarations-only (offline half)
//
// The credentialed half of this gate can only run after publish.yml has
// already uploaded a tarball, which makes it a detector rather than a gate.
// `@vespeneventures/secret-scan` published with no visibility declaration and
// every subsequent publish run went red on a data omission that was fully
// knowable offline, at review time. These cover the split that fixes that,
// including the one property the split must NOT weaken: no flag, no token,
// still exit 2.

test("CLI --declarations-only: runs with NO token and passes when every published entry is declared", () => {
  withDir((root) => {
    writeFixture(root, {
      lifecycle: lifecycleWith([
        { name: "@fixture/a", status: "published" },
        { name: "@fixture/b", status: "incubating" },
      ]),
      visibility: visibilityWith([{ name: "@fixture/a", intendedVisibility: "public" }]),
    });
    const r = run(["--declarations-only"], { cwd: root, env: { GH_PACKAGES_TOKEN: "" } });
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.match(r.out, /DECLARATIONS OK/);
    // An incubating entry is not in scope for this join and must not be
    // counted into it — verify-standards sat at "incubating" while
    // secret-scan was the actual omission, and a join that swept both in
    // would have reported a second, false finding.
    assert.match(r.out, /all 1 "published" packages/);
    // Must say plainly what it did NOT check. A pass that reads as the whole
    // answer is the failure mode this repo keeps rediscovering.
    assert.match(r.out, /Live registry visibility is NOT checked here/);
  });
});

test("CLI --declarations-only: an undeclared published entry exits 1 — the secret-scan omission, caught offline", () => {
  withDir((root) => {
    writeFixture(root, {
      lifecycle: lifecycleWith([{ name: "@fixture/undeclared", status: "published" }]),
      visibility: visibilityWith([]),
    });
    const r = run(["--declarations-only"], { cwd: root, env: { GH_PACKAGES_TOKEN: "" } });
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.match(r.out, /has no entry in/);
    assert.match(r.out, /DECLARATIONS FAIL/);
  });
});

test("CLI --declarations-only: the flag does not weaken fail-closed — no flag and no token is still exit 2", () => {
  withDir((root) => {
    writeFixture(root, {
      lifecycle: lifecycleWith([{ name: "@fixture/a", status: "published" }]),
      visibility: visibilityWith([{ name: "@fixture/a", intendedVisibility: "public" }]),
    });
    const withFlag = run(["--declarations-only"], { cwd: root, env: { GH_PACKAGES_TOKEN: "" } });
    const withoutFlag = run([], { cwd: root, env: { GH_PACKAGES_TOKEN: "" } });
    assert.equal(withFlag.code, 0);
    assert.equal(withoutFlag.code, 2, "the credentialed mode must still refuse to report a pass it never earned");
  });
});

test("CLI --declarations-only: a malformed document is still fatal (exit 2), never iterated as if empty", () => {
  withDir((root) => {
    writeFixture(root, {
      lifecycle: { schemaVersion: 1 },
      visibility: visibilityWith([]),
    });
    const r = run(["--declarations-only"], { cwd: root, env: { GH_PACKAGES_TOKEN: "" } });
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
  });
});

// =====================================================================
// REGISTRY-DRIVEN RECONCILIATION (issue: the post-publish visibility check
// reported OK over the package it had just published)
//
// Everything above tests the DECLARATION-driven half: it asks the registry
// about names the declaration already handed it. These tests cover the
// other direction — enumerating the registry's OWN package list and
// reconciling it against the declaration — which is what catches a package
// that is live and public on the registry while its lifecycle entry still
// reads "incubating" (or is missing altogether). Same hermetic discipline:
// every "response" is a plain object this file builds, never a real
// network call.
// =====================================================================

/** A minimal paginated-list Response stand-in, with an optional Link header. */
function listResponse(status, body, { link } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
    headers: { get: (name) => (name.toLowerCase() === "link" && link ? link : undefined) },
  };
}

// -------------------------------------------------------------------- normalizeRegistryName

test("normalizeRegistryName: a name already scoped is trusted as-is", () => {
  assert.equal(normalizeRegistryName("@scope/pkg", "@other"), "@scope/pkg");
});

test("normalizeRegistryName: a bare name is prefixed with the supplied scope", () => {
  assert.equal(normalizeRegistryName("pkg", "@scope"), "@scope/pkg");
});

// -------------------------------------------------------------------- fetchRegistryPackages

test("fetchRegistryPackages: a single page from the org endpoint", async () => {
  const fetchImpl = queueFetch([listResponse(200, [{ name: "a", visibility: "public" }, { name: "b", visibility: "private" }])]);
  const outcome = await fetchRegistryPackages({ owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { state: "found", packages: ["@scope/a", "@scope/b"] });
});

test("fetchRegistryPackages: follows Link header pagination across multiple pages", async () => {
  const fetchImpl = queueFetch([
    listResponse(200, [{ name: "a" }], { link: `<https://api.github.com/orgs/${OWNER}/packages?page=2>; rel="next"` }),
    listResponse(200, [{ name: "b" }]),
  ]);
  const outcome = await fetchRegistryPackages({ owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { state: "found", packages: ["@scope/a", "@scope/b"] });
});

test("fetchRegistryPackages: falls back to the user endpoint on an org 404", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return urls.length === 1 ? listResponse(404, {}) : listResponse(200, [{ name: "a" }]);
  };
  const outcome = await fetchRegistryPackages({ owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { state: "found", packages: ["@scope/a"] });
  assert.match(urls[0], /\/orgs\//);
  assert.match(urls[1], /\/users\//);
});

test("fetchRegistryPackages: both the org and user list endpoints 404 is an ERROR, never an empty found — an enumeration miss must not read as a clean, empty registry", async () => {
  const fetchImpl = queueFetch([listResponse(404, {}), listResponse(404, {})]);
  const outcome = await fetchRegistryPackages({ owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /Refusing to report a reconciled set it never verified/);
});

test("fetchRegistryPackages: a non-404 HTTP error is an error", async () => {
  const fetchImpl = queueFetch([listResponse(500, {})]);
  const outcome = await fetchRegistryPackages({ owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /HTTP 500/);
});

test("fetchRegistryPackages: a non-array response body is an error, never iterated as if it were a package list", async () => {
  const fetchImpl = queueFetch([listResponse(200, { message: "not a list" })]);
  const outcome = await fetchRegistryPackages({ owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /non-array response/);
});

test("fetchRegistryPackages: a thrown network error is an error", async () => {
  const fetchImpl = queueFetch([new TypeError("fetch failed")]);
  const outcome = await fetchRegistryPackages({ owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.equal(outcome.state, "error");
  assert.match(outcome.detail, /network error/);
});

// -------------------------------------------------------------------- reconcileRegistryAgainstLifecycle

test("reconcileRegistryAgainstLifecycle: a registry package declared \"published\" reconciles cleanly — no finding", () => {
  const lifecycle = lifecycleWith([{ name: "@scope/a", status: "published" }]);
  const results = reconcileRegistryAgainstLifecycle(lifecycle, ["@scope/a"]);
  assert.deepEqual(results, []);
});

test("reconcileRegistryAgainstLifecycle: a registry package declared \"incubating\" is a FINDING — the exact issue #343 shape", () => {
  const lifecycle = lifecycleWith([{ name: "@scope/integrator", status: "incubating" }]);
  const results = reconcileRegistryAgainstLifecycle(lifecycle, ["@scope/integrator"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /status is "incubating", not "published"/);
});

test("reconcileRegistryAgainstLifecycle: a registry package with NO lifecycle entry at all is a FINDING", () => {
  const results = reconcileRegistryAgainstLifecycle(lifecycleWith([]), ["@scope/undeclared"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /has no entry at all/);
});

test("reconcileRegistryAgainstLifecycle: a deprecated/retired registry package is also a finding, not silently accepted", () => {
  const lifecycle = lifecycleWith([{ name: "@scope/old", status: "deprecated", noReplacementReason: "x", deprecatedOn: "2026-01-01", decision: "x", migration: "x", forwardsToReplacement: false }]);
  const results = reconcileRegistryAgainstLifecycle(lifecycle, ["@scope/old"]);
  assert.equal(results.length, 1);
  assert.match(results[0].detail, /status is "deprecated"/);
});

// -------------------------------------------------------------------- checkAllPackageVisibility (the full two-directional orchestration)
//
// These three are the required proofs: a declared-"incubating" package live
// on the registry goes red with a real exit code; a fully reconciled set
// goes green; an unreachable registry is indeterminate (exit 2). Every
// fetch here is an injected fake — nothing calls the network.

test("PROOF 1/3: a declared-\"incubating\" package live on the registry is a violation (code 1) — the exact bug this gate missed", async () => {
  const lifecycle = lifecycleWith([
    { name: "@scope/fine", status: "published" },
    { name: "@scope/integrator", status: "incubating" }, // never reaches package-visibility.json's join at all
  ]);
  const visibility = visibilityWith([{ name: "@scope/fine", intendedVisibility: "public" }]);
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/packages/npm/")) return jsonResponse(200, { visibility: "public" }); // per-package GET for "fine"
    // the packages LIST endpoint used for registry enumeration — includes the
    // just-published "integrator", which has no matching "published" entry
    return listResponse(200, [{ name: "fine", visibility: "public" }, { name: "integrator", visibility: "public" }]);
  };
  const outcome = await checkAllPackageVisibility({ lifecycle, visibility, owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 1, `expected code 1 (violated), got ${JSON.stringify(outcome)}`);
  const integratorFinding = outcome.results.find((r) => r.package === "@scope/integrator");
  assert.ok(integratorFinding, "the live-but-undeclared package must appear in results, not be silently absent");
  assert.equal(integratorFinding.status, "finding");
  assert.match(integratorFinding.detail, /status is "incubating", not "published"/);
});

test("PROOF 2/3: a fully reconciled set — every declared package's visibility matches, every registry package is declared published — is code 0", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/a", status: "published" }]);
  const visibility = visibilityWith([{ name: "@scope/a", intendedVisibility: "public" }]);
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/packages/npm/")) return jsonResponse(200, { visibility: "public" });
    return listResponse(200, [{ name: "a", visibility: "public" }]);
  };
  const outcome = await checkAllPackageVisibility({ lifecycle, visibility, owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 0, `expected code 0 (satisfied), got ${JSON.stringify(outcome)}`);
  assert.equal(outcome.registryPackagesEnumerated, 1);
  assert.ok(outcome.results.every((r) => r.status === "pass" || r.status === "not-published"));
});

test("PROOF 3/3: the registry is unreachable for enumeration — indeterminate (fatal, code 2), never an empty set read as clean", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/a", status: "published" }]);
  const visibility = visibilityWith([{ name: "@scope/a", intendedVisibility: "public" }]);
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/packages/npm/")) return jsonResponse(200, { visibility: "public" }); // declared-side lookup succeeds
    return listResponse(500, {}); // but registry enumeration for reconciliation fails
  };
  const outcome = await checkAllPackageVisibility({ lifecycle, visibility, owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.equal(outcome.code, 2, `expected code 2 (indeterminate), got ${JSON.stringify(outcome)}`);
  assert.match(outcome.fatal, /could not enumerate registry packages/);
});

test("checkAllPackageVisibility: a registry enumeration that returns zero while a declared lookup found a real answer is indeterminate, not a clean reconciled set", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/a", status: "published" }]);
  const visibility = visibilityWith([{ name: "@scope/a", intendedVisibility: "public" }]);
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/packages/npm/")) return jsonResponse(200, { visibility: "public" });
    return listResponse(200, []); // list enumeration implausibly empty despite a confirmed real package
  };
  const outcome = await checkAllPackageVisibility({ lifecycle, visibility, owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /cannot be trusted/);
});

test("checkAllPackageVisibility: a blind declared-side credential is still indeterminate even though registry enumeration is never reached", async () => {
  const names = ["@scope/a", "@scope/b", "@scope/c"];
  const lifecycle = lifecycleWith(names.map((name) => ({ name, status: "published" })));
  const visibility = visibilityWith(names.map((name) => ({ name, intendedVisibility: "public" })));
  let listCalls = 0;
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/packages/npm/")) return jsonResponse(404, {});
    listCalls += 1;
    return listResponse(200, []);
  };
  const outcome = await checkAllPackageVisibility({ lifecycle, visibility, owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl });
  assert.equal(outcome.code, 2);
  assert.match(outcome.fatal, /GH_PACKAGES_TOKEN that has lost read:packages access/);
  assert.equal(listCalls, 0, "a blind declared-side credential must short-circuit before registry enumeration is ever attempted");
});

// -------------------------------------------------------------------- CLI: the real contract files, with the registry-enumeration step also present

test("CLI: this repository's own real contract files still exit 2 before any network call, with the registry step wired in", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const r = run([], { cwd: repoRoot, env: { GH_PACKAGES_TOKEN: "" } });
  assert.equal(r.code, 2, `expected exit 2 (no token), got ${r.code}: ${r.out}`);
  assert.match(r.out, /GH_PACKAGES_TOKEN is not set/);
});
