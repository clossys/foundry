// Regression tests for check-launcher-catalogue-currency.mjs — see that
// file's own header for what modes (a) and (b) prove and the three-state
// exit code contract (0 pass / warn, 1 fail, 2 indeterminate).
//
// Dependency-free (node builtins + local scripts only) so this suite can
// run in check:gates's dependency-free `safety` job — see
// scripts/check-workflow-references.test.mjs's "every suite in check:gates
// imports only node builtins and local scripts" test. NO LIVE NETWORK: mode
// (b)'s registry calls are always exercised through an injected fake
// `fetchImpl`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkLauncherCatalogueLag,
  checkLauncherGate,
  discoverSkillSources,
  evaluateLagReport,
  evaluateLauncherGate,
  parseArgs,
  readLauncherPackageName,
} from "./check-launcher-catalogue-currency.mjs";
import { spawnCapture } from "./lib/spawn-capture.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "check-launcher-catalogue-currency.mjs");

// ------------------------------------------------------------------ fixtures

function withTempDir(fn) {
  const root = mkdtempSync(join(tmpdir(), "launcher-catalogue-currency-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Builds packages/<name>/skill/SKILL.md for each entry of `skills` under `root`. */
function writeSkillSources(root, skills) {
  for (const [packageDir, content] of Object.entries(skills)) {
    const dir = join(root, "packages", packageDir, "skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content);
  }
}

/**
 * Builds a real .tgz whose top-level `package/` directory contains
 * `skill-catalogue/<name>/SKILL.md` for each entry of `catalogue` — the
 * exact shape packages/launcher/scripts/pack-skills.mjs produces inside the
 * packed launcher tarball.
 */
function buildTarball(catalogue) {
  return withTempDir((work) => {
    const packageDir = join(work, "package");
    for (const [name, content] of Object.entries(catalogue)) {
      const dir = join(packageDir, "skill-catalogue", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), content);
    }
    if (Object.keys(catalogue).length === 0) mkdirSync(packageDir, { recursive: true });
    const path = join(work, "candidate.tgz");
    execFileSync("tar", ["-czf", path, "-C", work, "package"]);
    // Read the bytes into memory before withTempDir's `finally` deletes `work`.
    return readFileSync(path);
  });
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

function tarballResponse(bytes) {
  return {
    status: 200,
    ok: true,
    async arrayBuffer() {
      return bytes;
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

function packumentFor(version, tarballUrl, shasum) {
  return {
    name: "@clossys/launcher",
    "dist-tags": { latest: version },
    versions: {
      [version]: { name: "@clossys/launcher", version, dist: { tarball: tarballUrl, shasum } },
    },
  };
}

function sha1Hex(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

// ------------------------------------------------------------- discovery

test("discoverSkillSources scans packages/*/skill/SKILL.md sorted by directory", () => {
  withTempDir((root) => {
    writeSkillSources(root, { zeta: "z-body\n", alpha: "a-body\n" });
    mkdirSync(join(root, "packages", "no-skill"), { recursive: true });
    const entries = discoverSkillSources(root);
    assert.deepEqual(entries.map((e) => e.packageDir), ["alpha", "zeta"]);
    assert.equal(entries[0].content, "a-body\n");
  });
});

test("discoverSkillSources returns empty for a repo with no packages directory", () => {
  withTempDir((root) => {
    assert.deepEqual(discoverSkillSources(root), []);
  });
});

test("readLauncherPackageName reads packages/launcher/package.json's name", () => {
  withTempDir((root) => {
    mkdirSync(join(root, "packages", "launcher"), { recursive: true });
    writeFileSync(join(root, "packages", "launcher", "package.json"), JSON.stringify({ name: "@clossys/launcher" }));
    assert.equal(readLauncherPackageName(root), "@clossys/launcher");
  });
});

// -------------------------------------------------------------- mode (a)

test("mode (a): CURRENT — passes when the candidate tarball catalogue matches current sources", () => {
  const sourceEntries = [
    { packageDir: "alpha", content: "alpha skill v2\n" },
    { packageDir: "beta", content: "beta skill v1\n" },
  ];
  const tarballBytes = buildTarball({ alpha: "alpha skill v2\n", beta: "beta skill v1\n" });
  const result = evaluateLauncherGate({ sourceEntries, tarballBytes });
  assert.equal(result.status, "pass");
  assert.equal(result.exitCode, 0);
});

test("mode (a): STALE — fails when a source skill changed since the candidate was packed", () => {
  const sourceEntries = [{ packageDir: "alpha", content: "alpha skill v2\n" }];
  const tarballBytes = buildTarball({ alpha: "alpha skill v1\n" });
  const result = evaluateLauncherGate({ sourceEntries, tarballBytes });
  assert.equal(result.status, "fail");
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /stale in the packed catalogue.*alpha/);
});

test("mode (a): MISMATCH — fails when the candidate catalogue is missing a package entirely", () => {
  const sourceEntries = [
    { packageDir: "alpha", content: "alpha skill\n" },
    { packageDir: "beta", content: "beta skill\n" },
  ];
  const tarballBytes = buildTarball({ alpha: "alpha skill\n" });
  const result = evaluateLauncherGate({ sourceEntries, tarballBytes });
  assert.equal(result.status, "fail");
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /missing from the packed catalogue.*beta/);
});

test("mode (a): ZERO SKILLS — indeterminate, never a vacuous pass, when no sources are found", () => {
  const result = evaluateLauncherGate({ sourceEntries: [], tarballBytes: buildTarball({}) });
  assert.equal(result.status, "indeterminate");
  assert.equal(result.exitCode, 2);
});

test("mode (a): checkLauncherGate is indeterminate when the candidate tarball cannot be read", () => {
  withTempDir((root) => {
    writeSkillSources(root, { alpha: "alpha skill\n" });
    const result = checkLauncherGate({ root, tarballPath: join(root, "does-not-exist.tgz") });
    assert.equal(result.status, "indeterminate");
    assert.equal(result.exitCode, 2);
    assert.match(result.message, /could not read candidate tarball/);
  });
});

test("mode (a): checkLauncherGate passes end to end against a real tarball and real sources", () => {
  withTempDir((root) => {
    writeSkillSources(root, { alpha: "alpha skill\n", beta: "beta skill\n" });
    const tarballBytes = buildTarball({ alpha: "alpha skill\n", beta: "beta skill\n" });
    const tarballPath = join(root, "candidate.tgz");
    writeFileSync(tarballPath, tarballBytes);
    const result = checkLauncherGate({ root, tarballPath });
    assert.equal(result.status, "pass");
    assert.equal(result.exitCode, 0);
  });
});

// -------------------------------------------------------------- mode (b)

test("mode (b): CURRENT — passes when the package's own skill matches the published launcher catalogue", async () => {
  const bytes = buildTarball({ alpha: "alpha skill\n" });
  const fetchImpl = queueFetch([
    jsonResponse(200, packumentFor("0.2.0", "https://registry.npmjs.org/@clossys/launcher/-/launcher-0.2.0.tgz", sha1Hex(bytes))),
    tarballResponse(bytes),
  ]);
  const result = await checkLauncherCatalogueLag({
    root: undefined,
    packageDir: "alpha",
    launcherName: "@clossys/launcher",
    fetchImpl,
    readSources: () => [{ packageDir: "alpha", content: "alpha skill\n" }],
  });
  assert.equal(result.status, "pass");
  assert.equal(result.exitCode, 0);
});

test("mode (b): STALE — warns, never fails, when the package's skill changed since the last launcher publish", async () => {
  const bytes = buildTarball({ alpha: "alpha skill OLD\n" });
  const fetchImpl = queueFetch([
    jsonResponse(200, packumentFor("0.2.0", "https://registry.npmjs.org/@clossys/launcher/-/launcher-0.2.0.tgz", sha1Hex(bytes))),
    tarballResponse(bytes),
  ]);
  const result = await checkLauncherCatalogueLag({
    root: undefined,
    packageDir: "alpha",
    launcherName: "@clossys/launcher",
    fetchImpl,
    readSources: () => [{ packageDir: "alpha", content: "alpha skill NEW\n" }],
  });
  assert.equal(result.status, "warn");
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /launcher release built from current skill sources is needed/);
});

test("mode (b): warns when the published launcher catalogue has no entry for this package at all", async () => {
  const bytes = buildTarball({});
  const fetchImpl = queueFetch([
    jsonResponse(200, packumentFor("0.2.0", "https://registry.npmjs.org/@clossys/launcher/-/launcher-0.2.0.tgz", sha1Hex(bytes))),
    tarballResponse(bytes),
  ]);
  const result = await checkLauncherCatalogueLag({
    root: undefined,
    packageDir: "alpha",
    launcherName: "@clossys/launcher",
    fetchImpl,
    readSources: () => [{ packageDir: "alpha", content: "alpha skill\n" }],
  });
  assert.equal(result.status, "warn");
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /no counterpart/);
});

test("mode (b): UNREACHABLE REGISTRY — indeterminate (exit 2), never a pass, on a network failure", async () => {
  const fetchImpl = queueFetch([new Error("getaddrinfo ENOTFOUND registry.npmjs.org")]);
  const result = await checkLauncherCatalogueLag({
    root: undefined,
    packageDir: "alpha",
    launcherName: "@clossys/launcher",
    fetchImpl,
    readSources: () => [{ packageDir: "alpha", content: "alpha skill\n" }],
  });
  assert.equal(result.status, "indeterminate");
  assert.equal(result.exitCode, 2);
});

test("mode (b): UNREACHABLE REGISTRY — indeterminate on a non-2xx packument response", async () => {
  const fetchImpl = queueFetch([jsonResponse(503, {})]);
  const result = await checkLauncherCatalogueLag({
    root: undefined,
    packageDir: "alpha",
    launcherName: "@clossys/launcher",
    fetchImpl,
    readSources: () => [{ packageDir: "alpha", content: "alpha skill\n" }],
  });
  assert.equal(result.status, "indeterminate");
  assert.equal(result.exitCode, 2);
});

test("mode (b): indeterminate when the served tarball bytes do not match the packument shasum", async () => {
  const bytes = buildTarball({ alpha: "alpha skill\n" });
  const fetchImpl = queueFetch([
    jsonResponse(200, packumentFor("0.2.0", "https://registry.npmjs.org/@clossys/launcher/-/launcher-0.2.0.tgz", "0".repeat(40))),
    tarballResponse(bytes),
  ]);
  const result = await checkLauncherCatalogueLag({
    root: undefined,
    packageDir: "alpha",
    launcherName: "@clossys/launcher",
    fetchImpl,
    readSources: () => [{ packageDir: "alpha", content: "alpha skill\n" }],
  });
  assert.equal(result.status, "indeterminate");
  assert.equal(result.exitCode, 2);
});

test("mode (b): ZERO SKILLS — indeterminate without ever calling the network", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch must not be called when the source scan is empty");
  };
  const result = await checkLauncherCatalogueLag({
    root: undefined,
    packageDir: "alpha",
    launcherName: "@clossys/launcher",
    fetchImpl,
    readSources: () => [],
  });
  assert.equal(result.status, "indeterminate");
  assert.equal(result.exitCode, 2);
});

test("mode (b): passes trivially, without calling the network, when the target package ships no skill", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch must not be called when the target package has no skill/SKILL.md");
  };
  const result = await checkLauncherCatalogueLag({
    root: undefined,
    packageDir: "no-skill-package",
    launcherName: "@clossys/launcher",
    fetchImpl,
    readSources: () => [{ packageDir: "alpha", content: "alpha skill\n" }],
  });
  assert.equal(result.status, "pass");
  assert.equal(result.exitCode, 0);
});

test("evaluateLagReport is indeterminate when the resolved launcher fetch failed", () => {
  const result = evaluateLagReport({
    entry: { packageDir: "alpha", content: "x\n" },
    packageDir: "alpha",
    launcherResult: { kind: "unreachable", detail: "boom" },
  });
  assert.equal(result.status, "indeterminate");
  assert.equal(result.exitCode, 2);
});

// ----------------------------------------------------------------- CLI

test("CLI: --package is required", async () => {
  const result = await spawnCapture(process.execPath, [scriptPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test("CLI: --package launcher requires --tarball", async () => {
  const result = await spawnCapture(process.execPath, [scriptPath, "--package", "launcher"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--tarball is required/);
});

test("parseArgs rejects an uppercase or malformed --package value", () => {
  assert.throws(() => parseArgs(["--package", "Launcher"]), /Usage:/);
  assert.throws(() => parseArgs(["--package"]), /Usage:/);
});

test("parseArgs accepts --json and a valid --package/--tarball", () => {
  const args = parseArgs(["--package", "writer", "--tarball", "/tmp/x.tgz", "--json"]);
  assert.deepEqual(args, { json: true, package: "writer", tarball: "/tmp/x.tgz" });
});
