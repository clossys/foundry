// Regression tests for check-bin-reachability.mjs.
//
// Fixture-driven: nothing here depends on this repository's packages being
// built. The topology under test is the one #909 actually missed — a
// node_modules/.bin-shaped symlink in a temp directory — not `node <real path>`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  declaredBinsFromManifest,
  evaluateBinReachability,
  runBinThroughDotBin,
  scanBinReachability,
} from "./check-bin-reachability.mjs";

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
// symlink to /private/var/folders. A path built from the raw mkdtempSync()
// result is therefore not yet canonical: a script loaded from it sees
// import.meta.url resolved to the realpath (Node always realpaths the main
// ESM module) while a naive `resolve(process.argv[1])` guard does not, so
// even a "direct, no .bin symlink" invocation looks like a symlinked one.
// Canonicalizing right after mkdtemp keeps that distinction meaningful for
// what this suite actually tests: the node_modules/.bin symlink, not an
// incidental ancestor symlink in $TMPDIR.
function mkdtempRealSync(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function writeCli(dir, fileName, source) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, fileName);
  writeFileSync(path, source);
  return path;
}

function makePackageRepo({ name = "@gate-fixture/probe", bins, files }) {
  const root = mkdtempRealSync("bin-reachability-repo-");
  const packageDir = join(root, "packages", "probe");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), `${JSON.stringify({ name, bin: bins }, null, 2)}\n`);
  for (const [relative, source] of Object.entries(files)) {
    const destDir = dirname(relative) === "." ? packageDir : join(packageDir, dirname(relative));
    writeCli(destDir, basename(relative), source);
  }
  return { root, packageDir };
}

test("working CLI with realpathSync both sides, invoked through a .bin symlink, --help prints text, exit 0", () => {
  const compiledEntryPath = writeCli(mkdtempRealSync("bin-live-"), "cli.js", LIVE_CLI);
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

test("dead CLI without realpathSync prints nothing through a .bin symlink and is a finding", () => {
  const compiledEntryPath = writeCli(mkdtempRealSync("bin-dead-"), "cli.js", DEAD_CLI);
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

test("control: the same dead CLI invoked by real path still prints; the gate uses the symlink and still fails it", () => {
  const compiledEntryPath = writeCli(mkdtempRealSync("bin-dead-control-"), "cli.js", DEAD_CLI);
  const byRealPath = spawnSync(process.execPath, [compiledEntryPath, "--help"], { encoding: "utf8" });
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

test("a missing compiled target is cannot-answer, not a pass", () => {
  const { root } = makePackageRepo({
    bins: { "probe-check": "dist/cli.js" },
    files: {},
  });
  const scanned = scanBinReachability(root);
  assert.equal(scanned.exitCode, 2);
  assert.deepEqual(scanned.cannotAnswer.map((item) => item.rule), ["missing-compiled-target"]);
  assert.equal(scanned.passed.length, 0);
});

test("bin set comes from the fixture manifest: every key is probed, a name not in bin is not", () => {
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

  const { root } = makePackageRepo({
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

test("CLI: a tiny repo with one working bin exits 0", () => {
  const { root } = makePackageRepo({
    bins: { "probe-check": "dist/cli.js" },
    files: { "dist/cli.js": LIVE_CLI },
  });
  const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /probe-check/);
});

test("CLI: a tiny repo with a dead bin exits 1", () => {
  const { root } = makePackageRepo({
    bins: { "probe-check": "dist/cli.js" },
    files: { "dist/cli.js": DEAD_CLI },
  });
  const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /silent-bin/);
});

test("CLI: --json on a missing compiled target exits 2 and names cannot-answer", () => {
  const { root } = makePackageRepo({
    bins: { "probe-check": "dist/cli.js" },
    files: {},
  });
  const result = spawnSync(process.execPath, [scriptPath, "--json", root], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.cannotAnswer[0].rule, "missing-compiled-target");
  assert.equal(body.cannotAnswer[0].kind, "cannot-answer");
});
