import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkRegistryParity, discoverManifests, selectSinglePackage } from "./check-registry-parity.mjs";
import { GITHUB_PACKAGES_REGISTRY } from "./registry-version-lookup.mjs";

// Two layers of coverage, matching scripts/check-package-visibility.test.mjs:
//
//   1. UNIT — imports the real exported functions directly and injects a
//      fake `fetchImpl`. NEVER makes a real network call.
//   2. CLI — spawns the real script exactly the way CI does, for the paths
//      that fail before any network call would happen (missing token,
//      missing/malformed package-scope.json).

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-registry-parity.mjs");
const OWNER = "gate-fixture-owner";
const TOKEN = "test-token";

// -------------------------------------------------------------------- fakes

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    async json() {
      return body;
    },
  };
}

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

function discovery(entries) {
  return { entries, fatal: null };
}

function entry(directory, name, version) {
  return { directory, manifest: { name, version } };
}

// -------------------------------------------------------------------- discoverManifests

test("discoverManifests: skips a private:true package", () => {
  const { entries } = discoverManifests({
    packagesRoot: "packages",
    listDirectories: () => ["incubating"],
    manifestExists: () => true,
    currentManifest: () => ({ name: "@example/incubating", version: "0.0.1", private: true }),
  });
  assert.deepEqual(entries, []);
});

test("discoverManifests: an unparseable manifest is fatal", () => {
  const { entries, fatal } = discoverManifests({
    packagesRoot: "packages",
    listDirectories: () => ["broken"],
    manifestExists: () => true,
    currentManifest: () => {
      throw new SyntaxError("boom");
    },
  });
  assert.deepEqual(entries, []);
  assert.match(fatal, /does not parse as JSON/);
});

// -------------------------------------------------------------------- checkRegistryParity

test("a version present on the registry is a pass", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, versionsPage(["0.2.4", "0.2.3"]))]);
  const outcome = await checkRegistryParity({
    owner: OWNER,
    token: TOKEN,
    fetchImpl,
    discovery: discovery([entry("auth", "@example/auth", "0.2.4")]),
  });
  assert.equal(outcome.fatal, null);
  assert.equal(outcome.code, 0);
  assert.equal(outcome.results[0].status, "pass");
});

test("a version absent from the registry is a finding — the real gap issue #416 exists to catch", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, versionsPage(["0.2.3", "0.2.2"]))]);
  const outcome = await checkRegistryParity({
    owner: OWNER,
    token: TOKEN,
    fetchImpl,
    discovery: discovery([entry("auth", "@example/auth", "0.2.4")]),
  });
  assert.equal(outcome.code, 1);
  assert.equal(outcome.results[0].status, "finding");
  assert.match(outcome.results[0].detail, /dispatch publish\.yml manually/);
});

test("a denied lookup is an error, never a pass and never a finding", async () => {
  const fetchImpl = queueFetch([jsonResponse(401, { message: "Bad credentials" })]);
  const outcome = await checkRegistryParity({
    owner: OWNER,
    token: TOKEN,
    fetchImpl,
    discovery: discovery([entry("auth", "@example/auth", "0.2.4")]),
  });
  assert.equal(outcome.code, 2);
  assert.equal(outcome.results[0].status, "error");
});

test("an unreachable lookup is an error", async () => {
  const fetchImpl = queueFetch([jsonResponse(503, {})]);
  const outcome = await checkRegistryParity({
    owner: OWNER,
    token: TOKEN,
    fetchImpl,
    discovery: discovery([entry("auth", "@example/auth", "0.2.4")]),
  });
  assert.equal(outcome.code, 2);
  assert.equal(outcome.results[0].status, "error");
});

test("the batch-ambiguity case: one confirmed package plus one lone not-found package — the confirmed one passes, the ambiguous one is an error, and the run's worst code is 2, never a clean pass", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("known")) return jsonResponse(200, versionsPage(["1.0.0"]));
    return jsonResponse(404, {});
  };
  const outcome = await checkRegistryParity({
    owner: OWNER,
    token: TOKEN,
    fetchImpl,
    discovery: discovery([entry("known", "@example/known", "1.0.0"), entry("ambiguous", "@example/ambiguous", "1.0.0")]),
  });
  assert.equal(outcome.code, 2);
  const known = outcome.results.find((r) => r.package === "@example/known");
  const ambiguous = outcome.results.find((r) => r.package === "@example/ambiguous");
  assert.equal(known.status, "pass");
  assert.equal(ambiguous.status, "error");
});

test("an error anywhere dominates a finding elsewhere — worst-of-all, never averaged away", async () => {
  const fetchImpl = queueFetch([jsonResponse(200, versionsPage(["0.9.0"])), jsonResponse(401, {})]);
  const outcome = await checkRegistryParity({
    owner: OWNER,
    token: TOKEN,
    fetchImpl,
    discovery: discovery([entry("missing-one", "@example/missing", "1.0.0"), entry("denied-one", "@example/denied", "1.0.0")]),
  });
  assert.equal(outcome.code, 2);
});

test("a malformed manifest discovery is fatal before any network call", async () => {
  const fetchImpl = async () => {
    throw new Error("must not be called");
  };
  const outcome = await checkRegistryParity({ owner: OWNER, token: TOKEN, fetchImpl, discovery: { entries: [], fatal: "boom" } });
  assert.equal(outcome.fatal, "boom");
  assert.equal(outcome.code, 2);
});

test("zero packages discovered is a fatal empty scan, never a silent clean pass", async () => {
  const outcome = await checkRegistryParity({ owner: OWNER, token: TOKEN, fetchImpl: async () => jsonResponse(200, []), discovery: discovery([]) });
  assert.match(outcome.fatal, /empty scan/);
  assert.equal(outcome.code, 2);
});

test("public npmjs parity proves served bytes and exact manifest identity through the anonymous verifier", async () => {
  let received;
  const outcome = await checkRegistryParity({
    owner: "clossys",
    registry: "https://registry.npmjs.org",
    fetchImpl: async () => {
      throw new Error("verification is injected");
    },
    verifyArtifactImpl: async (input) => {
      received = input;
      return { kind: "verified", evidence: { integrity: "sha512-fixture", shasum: "a".repeat(40), sha256: "b".repeat(64) } };
    },
    discovery: discovery([entry("advisor", "@clossys/advisor", "0.1.3")]),
  });
  assert.equal(received.name, "@clossys/advisor");
  assert.equal(received.version, "0.1.3");
  assert.equal(received.registry, "https://registry.npmjs.org");
  assert.equal(outcome.code, 0);
  assert.equal(outcome.results[0].status, "pass");
  assert.equal(outcome.results[0].evidence.sha256, "b".repeat(64));
});

test("public npmjs parity keeps missing, mismatch, and unreadable outcomes distinct", async () => {
  for (const [verified, status, code] of [
    [{ kind: "known", hasVersion: false }, "finding", 1],
    [{ kind: "mismatch", detail: "served bytes changed" }, "finding", 1],
    [{ kind: "unreachable", detail: "timeout" }, "error", 2],
  ]) {
    const outcome = await checkRegistryParity({
      owner: "clossys",
      registry: "https://registry.npmjs.org",
      fetchImpl: async () => {},
      verifyArtifactImpl: async () => verified,
      discovery: discovery([entry("advisor", "@clossys/advisor", "0.1.3")]),
    });
    assert.equal(outcome.code, code);
    assert.equal(outcome.results[0].status, status);
  }
});

test("selectSinglePackage admits exactly one simple package directory", () => {
  const entries = [entry("advisor", "@clossys/advisor", "0.1.3"), entry("starter", "@clossys/starter", "0.1.2")];
  assert.deepEqual(selectSinglePackage(entries, "advisor"), { entries: [entries[0]], fatal: null });
  assert.match(selectSinglePackage(entries, "../advisor").fatal, /simple package directory/);
  assert.match(selectSinglePackage(entries, "missing").fatal, /exactly one/);
});

// -------------------------------------------------------------------- CLI (paths that never touch the network)

function runCli(args, options = {}) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], {
      encoding: "utf8",
      env: { ...process.env, GH_PACKAGES_TOKEN: "", ...options.env },
      cwd: options.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (error) {
    return { code: error.status, stdout: error.stdout?.toString() ?? "", stderr: error.stderr?.toString() ?? "" };
  }
}

test("CLI: a missing package-scope.json exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "registry-parity-"));
  try {
    const result = runCli([], { cwd: dir, env: { GH_PACKAGES_TOKEN: "x" } });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /no package-scope\.json found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: a malformed package-scope.json exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "registry-parity-"));
  try {
    writeFileSync(join(dir, "package-scope.json"), "not json");
    const result = runCli([], { cwd: dir, env: { GH_PACKAGES_TOKEN: "x" } });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /does not parse as JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: historical GitHub Packages still requires GH_PACKAGES_TOKEN", () => {
  const dir = mkdtempSync(join(tmpdir(), "registry-parity-"));
  try {
    writeFileSync(join(dir, "package-scope.json"), JSON.stringify({ scope: "@example", registry: GITHUB_PACKAGES_REGISTRY }));
    mkdirSync(join(dir, "packages"));
    const result = runCli([], { cwd: dir });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /GH_PACKAGES_TOKEN is not set/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
