// Regression tests for check-bin-reachability.mjs.
//
// Fixture-driven: nothing here depends on this repository's packages being
// built. The topology under test is the one #909 actually missed — a
// node_modules/.bin-shaped symlink in a temp directory — not `node <real path>`.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  adapterBinParityResult,
  declaredBinsFromManifest,
  evaluateAdapterBinParity,
  evaluateBinReachability,
  packageManifestBinKeys,
  runBinThroughDotBin,
  scanBinReachability,
} from "./check-bin-reachability.mjs";
import { spawnCapture } from "./lib/spawn-capture.mjs";
import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "check-bin-reachability.mjs");

const LIVE_CLI = `#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function run() {
  console.log("Usage: live-check --help");
}

const argvPath = process.argv[1];
if (argvPath !== undefined) {
  try {
    if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(argvPath))) run();
  } catch {
    // Guard failed to resolve; do not run.
  }
}
`;

const DEAD_CLI = `#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function run() {
  console.log("Usage: dead-check --help");
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) run();
`;

// os.tmpdir() on macOS resolves under /var/folders, which is itself a
// symlink to /private/var/folders. A path built from the raw mkdtemp()
// result is therefore not yet canonical: a script loaded from it sees
// import.meta.url resolved to the realpath (Node always realpaths the main
// ESM module) while a naive `resolve(process.argv[1])` guard does not, so
// even a "direct, no .bin symlink" invocation looks like a symlinked one.
// makeTmpDirSync() (scripts/lib/tmp-fixture.mjs) canonicalizes with realpath
// before handing the directory back, for exactly this reason (issue #1294) —
// every fixture directory in this suite is both realpath-safe to compare
// against import.meta.url and registered for cleanup, not a second helper
// that would have to keep those two properties in sync by hand.
function writeCli(dir, fileName, source) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, fileName);
  writeFileSync(path, source);
  return path;
}

function makePackageRepo(t, { name = "@gate-fixture/probe", bins, files, adapterBins }) {
  const root = makeTmpDirSync(t, "bin-reachability-repo-");
  const packageDir = join(root, "packages", "probe");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), `${JSON.stringify({ name, bin: bins }, null, 2)}\n`);
  for (const [relative, source] of Object.entries(files)) {
    const destDir = dirname(relative) === "." ? packageDir : join(packageDir, dirname(relative));
    writeCli(destDir, basename(relative), source);
  }
  if (adapterBins !== undefined) {
    const adapterDir = join(root, "governance", "release-qualification-adapters", "probe");
    mkdirSync(adapterDir, { recursive: true });
    writeFileSync(
      join(adapterDir, "current-direct.json"),
      `${JSON.stringify({ schemaVersion: 1, package: name, archetype: "current-direct", bins: adapterBins }, null, 2)}\n`,
    );
  }
  return { root, packageDir };
}

test("working CLI with realpathSync both sides, invoked through a .bin symlink, --help prints text, exit 0", (t) => {
  const compiledEntryPath = writeCli(makeTmpDirSync(t, "bin-live-"), "cli.js", LIVE_CLI);
  const spawned = runBinThroughDotBin({ binName: "live-check", compiledEntryPath, args: ["--help"] });
  assert.equal(spawned.status, 0);
  assert.ok(spawned.stdout.length > 0, "expected --help text on stdout");
  assert.match(spawned.stdout, /Usage: live-check/);
  const evaluated = evaluateBinReachability([{
    kind: "ok",
    rule: "reachable-bin",
    packageName: "@gate-fixture/live",
    binName: "live-check",
    status: spawned.status,
    producedOutput: spawned.producedOutput,
  }]);
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.findings.length, 0);
  assert.equal(evaluated.cannotAnswer.length, 0);
});

test("dead CLI without realpathSync prints nothing through a .bin symlink and is a finding", (t) => {
  const compiledEntryPath = writeCli(makeTmpDirSync(t, "bin-dead-"), "cli.js", DEAD_CLI);
  const spawned = runBinThroughDotBin({ binName: "dead-check", compiledEntryPath, args: ["--help"] });
  assert.equal(spawned.status, 0);
  assert.equal(spawned.stdout, "");
  assert.equal(spawned.stderr, "");
  assert.equal(spawned.producedOutput, false);
  const evaluated = evaluateBinReachability([{
    kind: "finding",
    rule: "silent-bin",
    packageName: "@gate-fixture/dead",
    binName: "dead-check",
    status: spawned.status,
    producedOutput: spawned.producedOutput,
    message: "silent",
  }]);
  assert.equal(evaluated.exitCode, 1);
  assert.deepEqual(evaluated.findings.map((item) => item.rule), ["silent-bin"]);
});

test("control: the same dead CLI invoked by real path still prints; the gate uses the symlink and still fails it", async (t) => {
  const compiledEntryPath = writeCli(makeTmpDirSync(t, "bin-dead-control-"), "cli.js", DEAD_CLI);
  const byRealPath = await spawnCapture(process.execPath, [compiledEntryPath, "--help"]);
  assert.equal(byRealPath.status, 0);
  assert.match(byRealPath.stdout, /Usage: dead-check/, "real-path launch still reaches run(); we are measuring launch shape");

  const throughDotBin = runBinThroughDotBin({ binName: "dead-check", compiledEntryPath, args: ["--help"] });
  assert.equal(throughDotBin.producedOutput, false, "symlink launch is the #909 dead shape");
  assert.equal(throughDotBin.status, 0);

  const evaluated = evaluateBinReachability([{
    kind: "finding",
    rule: "silent-bin",
    packageName: "@gate-fixture/dead",
    binName: "dead-check",
    status: throughDotBin.status,
    producedOutput: throughDotBin.producedOutput,
    message: "silent through symlink",
  }]);
  assert.equal(evaluated.exitCode, 1);
});

test("a manifest bin target that escapes the package is cannot-answer, not a spawn", () => {
  const relative = declaredBinsFromManifest({
    packageName: "@gate-fixture/escape",
    packageDir: "/tmp/gate-fixture-escape",
    manifest: { bin: { "escape-check": "../other/cli.js" } },
  });
  assert.equal(relative.bins.length, 0);
  assert.deepEqual(relative.findings.map((item) => item.rule), ["escaping-bin-target"]);
  assert.equal(relative.findings[0].kind, "cannot-answer");

  const absolute = declaredBinsFromManifest({
    packageName: "@gate-fixture/escape",
    packageDir: "/tmp/gate-fixture-escape",
    manifest: { bin: { "escape-check": "/usr/local/bin/escape" } },
  });
  assert.deepEqual(absolute.findings.map((item) => item.rule), ["escaping-bin-target"]);

  const evaluated = evaluateBinReachability(relative.findings);
  assert.equal(evaluated.exitCode, 2);
  assert.equal(evaluated.cannotAnswer.length, 1);
  assert.equal(evaluated.findings.length, 0);
});

test("a missing compiled target is cannot-answer, not a pass", (t) => {
  const { root } = makePackageRepo(t, {
    bins: { "probe-check": "dist/cli.js" },
    files: {},
  });
  const scanned = scanBinReachability(root);
  assert.equal(scanned.exitCode, 2);
  assert.deepEqual(scanned.cannotAnswer.map((item) => item.rule), ["missing-compiled-target"]);
  assert.equal(scanned.passed.length, 0);
});

test("bin set comes from the fixture manifest: every key is probed, a name not in bin is not", (t) => {
  const declared = declaredBinsFromManifest({
    packageName: "@gate-fixture/probe",
    packageDir: "/tmp/gate-fixture-probe",
    manifest: {
      bin: {
        "probe-check": "dist/cli.js",
        "probe-other": "dist/other.js",
      },
    },
  });
  assert.deepEqual(declared.findings, []);
  assert.deepEqual(declared.bins.map((item) => item.binName).sort(), ["probe-check", "probe-other"]);
  assert.ok(!declared.bins.some((item) => item.binName === "unlisted-check"));

  const { root } = makePackageRepo(t, {
    bins: {
      "probe-check": "dist/cli.js",
      "probe-other": "dist/other.js",
    },
    files: {
      "dist/cli.js": LIVE_CLI,
      "dist/other.js": LIVE_CLI,
      "dist/unlisted.js": LIVE_CLI,
    },
  });
  const scanned = scanBinReachability(root);
  assert.equal(scanned.exitCode, 0);
  const probed = [...scanned.passed, ...scanned.findings, ...scanned.cannotAnswer].map((item) => item.binName).sort();
  assert.deepEqual(probed, ["probe-check", "probe-other"]);
  assert.ok(!probed.includes("unlisted"));
  assert.ok(!probed.includes("unlisted-check"));
});

test("CLI: a tiny repo with one working bin exits 0", async (t) => {
  const { root } = makePackageRepo(t, {
    bins: { "probe-check": "dist/cli.js" },
    files: { "dist/cli.js": LIVE_CLI },
  });
  const result = await spawnCapture(process.execPath, [scriptPath, root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /probe-check/);
});

test("CLI: a tiny repo with a dead bin exits 1", async (t) => {
  const { root } = makePackageRepo(t, {
    bins: { "probe-check": "dist/cli.js" },
    files: { "dist/cli.js": DEAD_CLI },
  });
  const result = await spawnCapture(process.execPath, [scriptPath, root]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /silent-bin/);
});

test("CLI: --json on a missing compiled target exits 2 and names cannot-answer", async (t) => {
  const { root } = makePackageRepo(t, {
    bins: { "probe-check": "dist/cli.js" },
    files: {},
  });
  const result = await spawnCapture(process.execPath, [scriptPath, "--json", root]);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.cannotAnswer[0].rule, "missing-compiled-target");
  assert.equal(body.cannotAnswer[0].kind, "cannot-answer");
});

// --- adapter bin parity (#1187 follow-up: controller/launcher shipped a bin
// without updating their qualification adapter fixture; candidate-runner.mjs
// only caught it when qualification actually ran) ---

test("packageManifestBinKeys mirrors candidate-runner.mjs's normalizedBins for an object bin map", () => {
  assert.deepEqual(
    packageManifestBinKeys({ name: "@gate-fixture/probe", bin: { "probe-a": "dist/a.js", "probe-b": "dist/b.js" } }),
    ["probe-a", "probe-b"],
  );
  assert.deepEqual(packageManifestBinKeys({ name: "@gate-fixture/probe", bin: "dist/cli.js" }), ["@gate-fixture/probe"]);
  assert.deepEqual(packageManifestBinKeys({ name: "@gate-fixture/probe" }), []);
});

test("evaluateAdapterBinParity: matching keys is ok regardless of order", () => {
  const result = evaluateAdapterBinParity({
    packageName: "@gate-fixture/probe",
    packageDir: "/tmp/gate-fixture-probe",
    adapterPath: "governance/release-qualification-adapters/probe/current-direct.json",
    manifestBinKeys: ["probe-a", "probe-b"],
    adapterManifest: { bins: { "probe-b": 0, "probe-a": 0 } },
  });
  assert.equal(result.kind, "ok");
  assert.equal(result.rule, "adapter-bin-parity");
});

test("evaluateAdapterBinParity: a bin added to package.json but not the adapter is a finding naming what's missing", () => {
  const result = evaluateAdapterBinParity({
    packageName: "@gate-fixture/probe",
    packageDir: "/tmp/gate-fixture-probe",
    adapterPath: "governance/release-qualification-adapters/probe/current-direct.json",
    manifestBinKeys: ["probe-a", "probe-b", "probe-new"],
    adapterManifest: { bins: { "probe-a": 0, "probe-b": 0 } },
  });
  assert.equal(result.kind, "finding");
  assert.equal(result.rule, "adapter-bin-parity");
  assert.match(result.message, /missing from adapter: probe-new/);
});

test("evaluateAdapterBinParity: an adapter bin no longer in package.json is a finding naming the stale entry", () => {
  const result = evaluateAdapterBinParity({
    packageName: "@gate-fixture/probe",
    packageDir: "/tmp/gate-fixture-probe",
    adapterPath: "governance/release-qualification-adapters/probe/current-direct.json",
    manifestBinKeys: ["probe-a"],
    adapterManifest: { bins: { "probe-a": 0, "probe-removed": 0 } },
  });
  assert.equal(result.kind, "finding");
  assert.match(result.message, /in adapter but not in package\.json bin: probe-removed/);
});

test("evaluateAdapterBinParity: an adapter file without a readable bins object is cannot-answer", () => {
  const result = evaluateAdapterBinParity({
    packageName: "@gate-fixture/probe",
    packageDir: "/tmp/gate-fixture-probe",
    adapterPath: "governance/release-qualification-adapters/probe/current-direct.json",
    manifestBinKeys: ["probe-a"],
    adapterManifest: { schemaVersion: 1 },
  });
  assert.equal(result.kind, "cannot-answer");
  assert.equal(result.rule, "unreadable-adapter-bins");
});

test("adapterBinParityResult: a package with no adapter directory is skipped entirely, not a finding", (t) => {
  const { root, packageDir } = makePackageRepo(t, {
    bins: { "probe-check": "dist/cli.js" },
    files: { "dist/cli.js": LIVE_CLI },
  });
  const result = adapterBinParityResult({
    repoRoot: root,
    dirName: "probe",
    packageName: "@gate-fixture/probe",
    packageDir,
    manifest: { name: "@gate-fixture/probe", bin: { "probe-check": "dist/cli.js" } },
  });
  assert.equal(result, null);
});

test("adapterBinParityResult: an adapter directory with no current-direct.json is cannot-answer", (t) => {
  const { root, packageDir } = makePackageRepo(t, {
    bins: { "probe-check": "dist/cli.js" },
    files: { "dist/cli.js": LIVE_CLI },
  });
  mkdirSync(join(root, "governance", "release-qualification-adapters", "probe"), { recursive: true });
  const result = adapterBinParityResult({
    repoRoot: root,
    dirName: "probe",
    packageName: "@gate-fixture/probe",
    packageDir,
    manifest: { name: "@gate-fixture/probe", bin: { "probe-check": "dist/cli.js" } },
  });
  assert.equal(result.kind, "cannot-answer");
  assert.equal(result.rule, "missing-adapter-file");
});

test("scanBinReachability: an adapter drifted from package.json's bin map fails the scan even though every bin is reachable", (t) => {
  const { root } = makePackageRepo(t, {
    bins: { "probe-check": "dist/cli.js", "probe-new": "dist/new.js" },
    files: { "dist/cli.js": LIVE_CLI, "dist/new.js": LIVE_CLI.replace("live-check", "probe-new") },
    // Drifted: the adapter was never updated when "probe-new" was added to package.json bin.
    adapterBins: { "probe-check": 0 },
  });
  const scanned = scanBinReachability(root);
  assert.equal(scanned.exitCode, 1, JSON.stringify(scanned.results));
  const parity = scanned.findings.find((item) => item.rule === "adapter-bin-parity");
  assert.ok(parity, "expected an adapter-bin-parity finding");
  assert.match(parity.message, /missing from adapter: probe-new/);
  // The bins themselves are all reachable — only the adapter fixture is stale.
  assert.ok(scanned.passed.some((item) => item.rule === "reachable-bin" && item.binName === "probe-check"));
});

test("scanBinReachability: an adapter that matches package.json's bin map exactly passes alongside reachable bins", (t) => {
  const { root } = makePackageRepo(t, {
    bins: { "probe-check": "dist/cli.js" },
    files: { "dist/cli.js": LIVE_CLI },
    adapterBins: { "probe-check": 0 },
  });
  const scanned = scanBinReachability(root);
  assert.equal(scanned.exitCode, 0, JSON.stringify(scanned.results));
  assert.ok(scanned.passed.some((item) => item.rule === "adapter-bin-parity"));
});

test("CLI: a repo whose adapter fixture drifted from package.json's bin map exits 1 and names adapter-bin-parity", async (t) => {
  const { root } = makePackageRepo(t, {
    bins: { "probe-check": "dist/cli.js", "probe-new": "dist/new.js" },
    files: { "dist/cli.js": LIVE_CLI, "dist/new.js": LIVE_CLI.replace("live-check", "probe-new") },
    adapterBins: { "probe-check": 0 },
  });
  const result = await spawnCapture(process.execPath, [scriptPath, root]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /adapter-bin-parity/);
});
