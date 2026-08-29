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
  isFailureStatus,
  isRetentionExpired,
  normalizeRegistryName,
  reconcileRegistryAgainstLifecycle,
  selectDeclaredPackages,
  selectRetentionDeclarations,
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

function writeFixture(root, { lifecycle, visibility, retention = { schemaVersion: 1, packages: [] }, scope = "@fixture" }) {
  mkdirSync(join(root, "docs", "contracts"), { recursive: true });
  writeFileSync(join(root, "docs", "contracts", "package-lifecycle.json"), JSON.stringify(lifecycle, null, 2));
  writeFileSync(join(root, "docs", "contracts", "package-visibility.json"), JSON.stringify(visibility, null, 2));
  writeFileSync(join(root, "docs", "contracts", "package-retention.json"), JSON.stringify(retention, null, 2));
  writeFileSync(join(root, "package-scope.json"), JSON.stringify({ scope, registry: "https://registry.npmjs.org" }, null, 2));
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

test("CLI: a missing retention document exits 2 (credentialed mode only — --declarations-only never needs it)", () => {
  withDir((root) => {
    mkdirSync(join(root, "docs", "contracts"), { recursive: true });
    writeFileSync(join(root, "docs", "contracts", "package-lifecycle.json"), JSON.stringify(lifecycleWith([{ name: "@fixture/a", status: "published" }])));
    writeFileSync(join(root, "docs", "contracts", "package-visibility.json"), JSON.stringify(visibilityWith([{ name: "@fixture/a", intendedVisibility: "public" }])));
    writeFileSync(join(root, "package-scope.json"), JSON.stringify({ scope: "@fixture" }));
    const r = run([], { cwd: root, env: { GH_PACKAGES_TOKEN: "x" } });
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /no retention declaration document/);

    const withFlag = run(["--declarations-only"], { cwd: root, env: { GH_PACKAGES_TOKEN: "" } });
    assert.equal(withFlag.code, 0, `--declarations-only must not require a retention document it never reads, got ${withFlag.code}: ${withFlag.out}`);
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
// `@example/secret-scan` published with no visibility declaration and
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

test("CLI --declarations-only: a benign not-published result is labelled SKIP, and a passing run prints NO FIND line", () => {
  // The gate was always sound here: a deprecated package that still carries a
  // visibility declaration is expected, produces status "not-published", and
  // correctly does not affect the exit code. What was broken was the LABEL --
  // the offline reporter printed everything that was not "error" as "FIND ",
  // so five routine lines rendered as faults immediately above
  // "DECLARATIONS OK". Read literally, that output says the gate found five
  // problems and passed anyway.
  //
  // That is worth a test rather than a tidy-up because a signal that fires
  // when nothing is wrong stops being read, and then is not read on the day
  // something is. The invariant asserted here is the one that cannot be
  // argued with: a run that reports OK must not print a single FIND line.
  withDir((root) => {
    writeFixture(root, {
      lifecycle: lifecycleWith([
        { name: "@fixture/a", status: "published" },
        { name: "@fixture/retiring", status: "deprecated" },
      ]),
      visibility: visibilityWith([
        { name: "@fixture/a", intendedVisibility: "public" },
        { name: "@fixture/retiring", intendedVisibility: "public" },
      ]),
    });
    const r = run(["--declarations-only"], { cwd: root, env: { GH_PACKAGES_TOKEN: "" } });
    assert.equal(r.code, 0, `a not-published declaration must not fail the gate, got ${r.code}: ${r.out}`);
    assert.match(r.out, /DECLARATIONS OK/);
    assert.match(r.out, /\[SKIP \] @fixture\/retiring/, "a benign not-published result must be labelled SKIP");
    assert.doesNotMatch(r.out, /\[FIND \]/, "a passing run must never print a FIND line — that is what made this unreadable");
  });
});

test("an unrecognised status fails closed rather than falling through to a pass", () => {
  // Both classifiers used to enumerate the FAILURE statuses positively, so a
  // status outside {finding, error} fell through to "not a failure" and the
  // gate exited 0. A status added later to mean something bad would have
  // shipped as a PASS -- silently, since the exit code is what CI reads.
  //
  // Asserted here as a property of the classifier rather than through the
  // CLI, because the defect is that an UNKNOWN status is possible at all:
  // no fixture can produce one until someone adds it, which is precisely
  // when this must already be in place.
  assert.equal(isFailureStatus("pass"), false);
  assert.equal(isFailureStatus("not-published"), false, "a deprecated package with a declaration is benign");
  assert.equal(isFailureStatus("finding"), true);
  assert.equal(isFailureStatus("error"), true);
  assert.equal(isFailureStatus("some-status-nobody-has-written-yet"), true, "unknown must fail closed, never pass");
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

test("reconcileRegistryAgainstLifecycle: a retired registry package is a finding, not silently accepted", () => {
  const lifecycle = lifecycleWith([{ name: "@scope/old", status: "retired", replacement: { name: "@scope/new", range: "^1.0.0" }, deprecatedOn: "2026-01-01", retiredOn: "2026-01-01", decision: "x", migration: "x" }]);
  const results = reconcileRegistryAgainstLifecycle(lifecycle, ["@scope/old"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /status is "retired"/);
});

// ---------------------------------------------------------- reconcileRegistryAgainstLifecycle: "deprecated" is a THIRD state
//
// A "deprecated" package remaining live on the registry is not automatically
// wrong — that is the entire point of deprecation — but it is also not
// automatically fine, because this repository's own history has deprecated
// names that were deliberately removed from the registry. These cover the
// three-way split: declared-and-unexpired (satisfied), undeclared
// (violated), and declared-but-expired (violated) — never the
// "declaration is wrong about reality" wording, which does not apply to any
// of them.

const DEPRECATED_ENTRY = { name: "@scope/legacy", status: "deprecated", replacement: { name: "@scope/new", range: "^1.0.0" }, deprecatedOn: "2026-01-01", decision: "x", migration: "x", forwardsToReplacement: false };

test("reconcileRegistryAgainstLifecycle: a deprecated, live package with NO retention entry is a FINDING that says to declare or remove it — never 'the declaration is wrong'", () => {
  const lifecycle = lifecycleWith([DEPRECATED_ENTRY]);
  const results = reconcileRegistryAgainstLifecycle(lifecycle, ["@scope/legacy"], new Map());
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /no entry in .*package-retention\.json/);
  assert.doesNotMatch(results[0].detail, /the declaration is wrong about reality/);
});

test("reconcileRegistryAgainstLifecycle: a deprecated, live package WITH an unexpired retention entry is SATISFIED (pass) — the intended state, not a violation", () => {
  const lifecycle = lifecycleWith([DEPRECATED_ENTRY]);
  const retentionByName = new Map([["@scope/legacy", { reason: "kept for existing consumers", reviewBy: "2099-01-01" }]]);
  const results = reconcileRegistryAgainstLifecycle(lifecycle, ["@scope/legacy"], retentionByName, new Date("2026-06-01T00:00:00Z"));
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "pass");
  assert.match(results[0].detail, /deliberately retains it/);
  assert.match(results[0].detail, /kept for existing consumers/);
});

test("reconcileRegistryAgainstLifecycle: a deprecated, live package whose retention entry has EXPIRED is a FINDING, not an indefinite pass", () => {
  const lifecycle = lifecycleWith([DEPRECATED_ENTRY]);
  const retentionByName = new Map([["@scope/legacy", { reason: "kept for existing consumers", reviewBy: "2026-01-01" }]]);
  const results = reconcileRegistryAgainstLifecycle(lifecycle, ["@scope/legacy"], retentionByName, new Date("2026-06-01T00:00:00Z"));
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "finding");
  assert.match(results[0].detail, /expired on 2026-01-01/);
});

test("reconcileRegistryAgainstLifecycle: a retention entry reviewed on exactly today's calendar date has not yet expired", () => {
  const lifecycle = lifecycleWith([DEPRECATED_ENTRY]);
  const retentionByName = new Map([["@scope/legacy", { reason: "kept for existing consumers", reviewBy: "2026-06-01" }]]);
  const results = reconcileRegistryAgainstLifecycle(lifecycle, ["@scope/legacy"], retentionByName, new Date("2026-06-01T23:59:00Z"));
  assert.equal(results[0].status, "pass");
});

// -------------------------------------------------------------------- selectRetentionDeclarations

test("selectRetentionDeclarations: a well-formed entry is included in the map, no findings", () => {
  const { byName, findings, fatal } = selectRetentionDeclarations({ schemaVersion: 1, packages: [{ name: "@scope/legacy", reason: "kept for migration", reviewBy: "2099-01-01" }] });
  assert.equal(fatal, null);
  assert.equal(findings.length, 0);
  assert.deepEqual(byName.get("@scope/legacy"), { reason: "kept for migration", reviewBy: "2099-01-01" });
});

test("selectRetentionDeclarations: a malformed document shape is fatal", () => {
  const { fatal } = selectRetentionDeclarations({ packages: "not-an-array" });
  assert.match(fatal, /expected \{ packages: \[\.\.\.\] \} shape/);
});

test("selectRetentionDeclarations: a missing reason, a missing reviewBy, and an invalid reviewBy are each reported as an error, not silently dropped", () => {
  const { byName, findings } = selectRetentionDeclarations({
    schemaVersion: 1,
    packages: [
      { name: "@scope/no-reason", reviewBy: "2099-01-01" },
      { name: "@scope/no-review-by", reason: "x" },
      { name: "@scope/bad-date", reason: "x", reviewBy: "not-a-date" },
      { name: "@scope/impossible-date", reason: "x", reviewBy: "2026-02-30" },
    ],
  });
  assert.equal(byName.size, 0);
  assert.equal(findings.length, 4);
  assert.ok(findings.every((f) => f.status === "error"));
});

test("selectRetentionDeclarations: a duplicate name is an error and only the first entry is kept", () => {
  const { byName, findings } = selectRetentionDeclarations({
    schemaVersion: 1,
    packages: [
      { name: "@scope/legacy", reason: "first", reviewBy: "2099-01-01" },
      { name: "@scope/legacy", reason: "second", reviewBy: "2099-01-01" },
    ],
  });
  assert.equal(byName.get("@scope/legacy").reason, "first");
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /more than one entry/);
});

// -------------------------------------------------------------------- isRetentionExpired

test("isRetentionExpired: a future reviewBy has not expired", () => {
  assert.equal(isRetentionExpired("2099-01-01", new Date("2026-06-01T00:00:00Z")), false);
});

test("isRetentionExpired: a past reviewBy has expired", () => {
  assert.equal(isRetentionExpired("2020-01-01", new Date("2026-06-01T00:00:00Z")), true);
});

// -------------------------------------------------------------------- checkAllPackageVisibility (the full two-directional orchestration)
//
// The required proofs, each exercising this one orchestration function
// end-to-end with a different injected fetchImpl, never a real network
// call: a declared-"incubating" package live on the registry (violated); a
// fully reconciled set (satisfied); an unreachable registry (indeterminate);
// and the two cases specific to the three-way "deprecated" distinction this
// file adds — declared-and-unexpired retention (satisfied) and undeclared
// retention (violated) for an otherwise identical deprecated-and-live
// package, which is exactly the separation a weaker "some code path exists"
// test would not catch.

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

test("PROOF 4/5: a deprecated, live package WITH a declared unexpired retention entry is satisfied (code 0) — the deliberate-migration-path case", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/fine", status: "published" }, { ...DEPRECATED_ENTRY }]);
  const visibility = visibilityWith([{ name: "@scope/fine", intendedVisibility: "public" }]);
  const retention = { schemaVersion: 1, packages: [{ name: "@scope/legacy", reason: "kept for existing consumers migrating to @scope/new", reviewBy: "2099-01-01" }] };
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/packages/npm/")) return jsonResponse(200, { visibility: "public" }); // per-package GET for "fine"
    return listResponse(200, [{ name: "fine", visibility: "public" }, { name: "legacy", visibility: "public" }]);
  };
  const outcome = await checkAllPackageVisibility({ lifecycle, visibility, retention, owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl, now: new Date("2026-06-01T00:00:00Z") });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 0, `expected code 0 (satisfied), got ${JSON.stringify(outcome)}`);
  const legacyResult = outcome.results.find((r) => r.package === "@scope/legacy");
  assert.equal(legacyResult.status, "pass");
});

test("PROOF 5/5: a deprecated, live package with NO retention entry is a violation (code 1) — the exact class-B defect this file fixes", async () => {
  const lifecycle = lifecycleWith([{ name: "@scope/fine", status: "published" }, { ...DEPRECATED_ENTRY }]);
  const visibility = visibilityWith([{ name: "@scope/fine", intendedVisibility: "public" }]);
  const retention = { schemaVersion: 1, packages: [] }; // nothing declares why @scope/legacy is still live
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/packages/npm/")) return jsonResponse(200, { visibility: "public" }); // per-package GET for "fine"
    return listResponse(200, [{ name: "fine", visibility: "public" }, { name: "legacy", visibility: "public" }]);
  };
  const outcome = await checkAllPackageVisibility({ lifecycle, visibility, retention, owner: OWNER, scope: "@scope", token: TOKEN, fetchImpl, now: new Date("2026-06-01T00:00:00Z") });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 1, `expected code 1 (violated), got ${JSON.stringify(outcome)}`);
  const legacyResult = outcome.results.find((r) => r.package === "@scope/legacy");
  assert.equal(legacyResult.status, "finding");
  assert.match(legacyResult.detail, /no entry in .*package-retention\.json/);
  assert.doesNotMatch(legacyResult.detail, /the declaration is wrong about reality/);
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
