import assert from "node:assert/strict";
import test from "node:test";

import { bareName, probeOneVersion, probeVersions, resolveVersionLookups } from "./registry-version-lookup.mjs";

const OWNER = "gate-fixture-owner";
const TOKEN = "test-token";

// -------------------------------------------------------------------- fakes

/** A minimal fetch Response stand-in — no real network object anywhere, same shape scripts/check-package-visibility.test.mjs already uses. */
function jsonResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async json() {
      return body;
    },
  };
}

/** A queue-based fake fetch: each call returns the next entry, in order. */
function queueFetch(entries) {
  let index = 0;
  return async (url) => {
    if (index >= entries.length) throw new Error(`unexpected extra fetch call: ${url}`);
    const entry = entries[index++];
    if (entry instanceof Error) throw entry;
    return entry;
  };
}

function versionsPage(names) {
  return names.map((name) => ({ name }));
}

// -------------------------------------------------------------------- bareName

test("bareName strips the scope, leaving an unscoped name unchanged", () => {
  assert.equal(bareName("@scope/pkg"), "pkg");
  assert.equal(bareName("unscoped"), "unscoped");
});

// -------------------------------------------------------------------- probeOneVersion

test("probeOneVersion: the exact version is present on the registry", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, versionsPage(["0.2.4", "0.2.3", "0.2.2"]))]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "@vespeneventures/auth", version: "0.2.4", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "known", hasVersion: true });
});

test("probeOneVersion: the package exists but the exact version is absent — definitively publishable", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, versionsPage(["0.2.3", "0.2.2"]))]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "@vespeneventures/auth", version: "0.2.4", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "known", hasVersion: false });
});

test("probeOneVersion: requests the org endpoint first, falling back to the user endpoint only on a 404", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return urls.length === 1 ? jsonResponse(404, {}) : jsonResponse(200, versionsPage(["1.0.0"]));
  };
  const outcome = await probeOneVersion({ owner: OWNER, name: "pkg", version: "1.0.0", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "known", hasVersion: true });
  assert.match(urls[0], /\/orgs\//);
  assert.match(urls[1], /\/users\//);
});

test("probeOneVersion: both endpoints 404 is not-found, never denied and never known", async () => {
  const fetchImpl = queueFetch([jsonResponse(404, {}), jsonResponse(404, {})]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "never-published", version: "1.0.0", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "not-found" });
});

test("probeOneVersion: a 401 is denied, never a not-found — auth failure must never look like an unpublished package", async () => {
  const fetchImpl = queueFetch([jsonResponse(401, { message: "Bad credentials" })]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "pkg", version: "1.0.0", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "denied" });
});

test("probeOneVersion: a 403 is denied", async () => {
  const fetchImpl = queueFetch([jsonResponse(403, { message: "insufficient scope" })]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "pkg", version: "1.0.0", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "denied" });
});

test("probeOneVersion: a server error is unreachable, not denied and not not-found", async () => {
  const fetchImpl = queueFetch([jsonResponse(503, {})]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "pkg", version: "1.0.0", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "unreachable" });
});

test("probeOneVersion: a 200 body that is not an array is unreachable, never assumed empty", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, { not: "an array" })]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "pkg", version: "1.0.0", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "unreachable" });
});

test("probeOneVersion: a 200 body that throws on .json() is unreachable", async () => {
  const fetchImpl = queueFetch([{ status: 200, ok: true, headers: { get: () => null }, async json() { throw new SyntaxError("bad json"); } }]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "pkg", version: "1.0.0", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "unreachable" });
});

test("probeOneVersion: a thrown network error is unreachable", async () => {
  const fetchImpl = queueFetch([new TypeError("fetch failed")]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "pkg", version: "1.0.0", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "unreachable" });
});

test("probeOneVersion: follows Link-header pagination to find a version on a later page", async () => {
  const fetchImpl = queueFetch([
    jsonResponse(200, versionsPage(["0.3.0", "0.2.0"]), { link: `<https://api.github.com/orgs/${OWNER}/packages/npm/pkg/versions?page=2>; rel="next"` }),
    jsonResponse(200, versionsPage(["0.1.0"])),
  ]);
  const outcome = await probeOneVersion({ owner: OWNER, name: "pkg", version: "0.1.0", token: TOKEN, fetchImpl });
  assert.deepEqual(outcome, { kind: "known", hasVersion: true });
});

// -------------------------------------------------------------------- probeVersions

test("probeVersions: probes every package independently, even when one throws", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("bad")) throw new Error("boom");
    return jsonResponse(200, versionsPage(["1.0.0"]));
  };
  const outcomes = await probeVersions(
    [
      { name: "good", version: "1.0.0" },
      { name: "bad", version: "1.0.0" },
    ],
    { owner: OWNER, token: TOKEN, fetchImpl },
  );
  assert.deepEqual(outcomes.get("good"), { kind: "known", hasVersion: true });
  assert.deepEqual(outcomes.get("bad"), { kind: "unreachable" });
});

// -------------------------------------------------------------------- resolveVersionLookups

test("resolveVersionLookups: a known outcome with the version present resolves to published", () => {
  const resolved = resolveVersionLookups(new Map([["a", { kind: "known", hasVersion: true }]]));
  assert.deepEqual(resolved.get("a"), { kind: "published" });
});

test("resolveVersionLookups: a known outcome with the version absent resolves to missing — unambiguous, no batch reasoning needed", () => {
  const resolved = resolveVersionLookups(
    new Map([
      ["a", { kind: "known", hasVersion: false }],
      ["b", { kind: "not-found" }],
    ]),
  );
  assert.deepEqual(resolved.get("a"), { kind: "missing" });
  // "b" alongside a proven-good "a" lookup stays undecidable, never missing.
  assert.deepEqual(resolved.get("b"), { kind: "unreachable" });
});

test("resolveVersionLookups: denied passes straight through as unauthenticated, never reclassified", () => {
  const resolved = resolveVersionLookups(new Map([["a", { kind: "denied" }]]));
  assert.deepEqual(resolved.get("a"), { kind: "unauthenticated" });
});

test("resolveVersionLookups: unreachable never gets reclassified into an auth problem", () => {
  const resolved = resolveVersionLookups(
    new Map([
      ["a", { kind: "unreachable" }],
      ["b", { kind: "known", hasVersion: true }],
    ]),
  );
  assert.deepEqual(resolved.get("a"), { kind: "unreachable" });
});

test("resolveVersionLookups: the batch-ambiguity case — every lookup not-found resolves to unauthenticated, since nothing proved the credential works", () => {
  const resolved = resolveVersionLookups(
    new Map([
      ["a", { kind: "not-found" }],
      ["b", { kind: "not-found" }],
    ]),
  );
  assert.deepEqual(resolved.get("a"), { kind: "unauthenticated" });
  assert.deepEqual(resolved.get("b"), { kind: "unauthenticated" });
});

test("resolveVersionLookups: a lone not-found alongside a proven known lookup stays undecidable (unreachable), never guessed either way", () => {
  const resolved = resolveVersionLookups(
    new Map([
      ["a", { kind: "not-found" }],
      ["b", { kind: "known", hasVersion: true }],
    ]),
  );
  assert.deepEqual(resolved.get("a"), { kind: "unreachable" });
  assert.deepEqual(resolved.get("b"), { kind: "published" });
});
