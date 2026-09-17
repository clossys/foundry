#!/usr/bin/env node
// check-bin-reachability — every declared `bin` in packages/*/package.json
// executes through a node_modules/.bin-shaped symlink and produces output.
//
//   node scripts/check-bin-reachability.mjs [--json] [<repoRoot>]
//
// Exit 0 = every declared bin, invoked through a fresh temp node_modules/.bin
//          symlink (never this repository's own node_modules/.bin), produced
//          non-empty stdout or stderr.
// Exit 1 = at least one bin was silent (0-byte stdout and stderr) or failed
//          to launch. Empty-and-exit-0 is the #909 dead-bin shape.
// Exit 2 = the question could not be answered (unreadable manifest, missing
//          compiled target because the package was not built, escaping bin
//          path).
//
// WHY THIS EXISTS
// ---------------
// Issue #909: `architect-check` (and the same guard in other CLIs) shipped
// dead. Author-side tests called `main(argv)` directly, which never touches
// `process.argv[1]`. Staging still spawns `node <real path>`, which is
// exactly where a broken main-module guard still works. Packed-consumer
// and qualification help/case probes now launch the installer-linked
// `.bin` path; this gate is the cheap after-build check that does not
// wait for a pack. A consumer
// running the installed name hits `node_modules/.bin/<bin>` — a symlink —
// and `import.meta.url` always resolves through that symlink while
// `process.argv[1]` is the symlink itself. A guard that compares those
// without `realpathSync` on both sides never fires: exit 0, zero bytes,
// including on `--help` and on invalid input the documented contract says
// must be 1 or 2.
//
// The bin set is derived from each manifest's `bin` field, never a
// hand-written list (#907). Architect's packages/architect/src/bin-entry.test.ts
// is the reference topology: temp dir, copy of the compiled entry (chmod the
// COPY only — `npm pack` preserves mode and qualification hashes the packed
// bytes), `node_modules/.bin/<name>` symlink, invoke so argv[1] is the symlink.
//
// WHAT THIS DOES NOT CLAIM
// ------------------------
// This is not qualification. It does not pack, install, or hash a tarball.
// It does not claim any package is published, adopted, grounded, or closed.
// A reachable bin is a reachable bin; it is not a consumer position.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const SPAWN_TIMEOUT_MS = 8000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isDirectInvocation(moduleUrl, argvPath) {
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}

function targetEscapesPackage(target) {
  return isAbsolute(target) || target.split(/[\\/]/).includes("..");
}

function unscopedName(packageName) {
  const slash = packageName.lastIndexOf("/");
  return slash === -1 ? packageName : packageName.slice(slash + 1);
}

/**
 * Derive the declared bin map from a package.json-shaped manifest.
 * Never accepts a hand-written list — the keys of `bin` are the set.
 */
export function declaredBinsFromManifest({ packageName, packageDir, manifest }) {
  const bins = [];
  const findings = [];
  if (!isRecord(manifest)) {
    findings.push({
      kind: "cannot-answer",
      rule: "unreadable-manifest",
      packageName,
      packageDir,
      message: "package.json is not an object",
    });
    return { bins, findings, skipped: false };
  }
  if (manifest.private === true) return { bins, findings, skipped: true };
  const binField = manifest.bin;
  if (binField === undefined || binField === null) return { bins, findings, skipped: false };

  let entries;
  if (typeof binField === "string") {
    if (!isText(binField)) {
      findings.push({
        kind: "cannot-answer",
        rule: "unreadable-bin-field",
        packageName,
        packageDir,
        message: "bin string is empty",
      });
      return { bins, findings, skipped: false };
    }
    entries = [[unscopedName(packageName), binField]];
  } else if (isRecord(binField)) {
    entries = Object.entries(binField);
  } else {
    findings.push({
      kind: "cannot-answer",
      rule: "unreadable-bin-field",
      packageName,
      packageDir,
      message: "bin must be a string or an object map",
    });
    return { bins, findings, skipped: false };
  }

  for (const [binName, target] of entries) {
    if (!isText(binName) || !isText(target)) {
      findings.push({
        kind: "cannot-answer",
        rule: "unreadable-bin-field",
        packageName,
        packageDir,
        binName: isText(binName) ? binName : undefined,
        message: `bin entry "${binName}" must map to a nonempty relative path`,
      });
      continue;
    }
    if (targetEscapesPackage(target)) {
      findings.push({
        kind: "cannot-answer",
        rule: "escaping-bin-target",
        packageName,
        packageDir,
        binName,
        target,
        message: `bin target "${target}" for "${binName}" must stay inside the package directory`,
      });
      continue;
    }
    bins.push({ packageName, packageDir, binName, target });
  }
  return { bins, findings, skipped: false };
}

/**
 * Invoke a compiled entry through a fresh temp `node_modules/.bin/<binName>`
 * symlink. Copies the directory containing the entry (so relative imports
 * resolve) and chmod's only the copy.
 */
export function runBinThroughDotBin({ binName, compiledEntryPath, args = ["--help"] }) {
  if (!isText(binName)) throw new Error("binName is required");
  if (!isText(compiledEntryPath)) throw new Error("compiledEntryPath is required");
  const workDir = mkdtempSync(join(tmpdir(), "bin-reachability-"));
  try {
    const dotBin = join(workDir, "node_modules", ".bin");
    mkdirSync(dotBin, { recursive: true });
    const sourceDir = dirname(compiledEntryPath);
    const sourceBase = basename(compiledEntryPath);
    const installedDir = join(workDir, "entry");
    cpSync(sourceDir, installedDir, { recursive: true });
    const installedEntry = join(installedDir, sourceBase);
    chmodSync(installedEntry, 0o755);
    const binPath = join(dotBin, binName);
    symlinkSync(installedEntry, binPath);

    const spawnOptions = {
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workDir,
    };
    let spawned = spawnSync(binPath, args, spawnOptions);
    if (spawned.error) {
      spawned = spawnSync(process.execPath, [binPath, ...args], spawnOptions);
    }
    const stdout = spawned.stdout ?? "";
    const stderr = spawned.stderr ?? "";
    return {
      binName,
      binPath,
      compiledEntryPath: installedEntry,
      status: spawned.status,
      stdout,
      stderr,
      error: spawned.error ? spawned.error.message : undefined,
      producedOutput: (stdout + stderr).length > 0,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function classifySpawn(bin, spawned) {
  const base = {
    packageName: bin.packageName,
    packageDir: bin.packageDir,
    binName: bin.binName,
    target: bin.target,
    status: spawned.status,
    producedOutput: spawned.producedOutput,
  };
  if (spawned.error && spawned.status === null) {
    return {
      ...base,
      kind: "finding",
      rule: "launch-error",
      message: `"${bin.binName}" failed to launch through a .bin symlink: ${spawned.error}`,
    };
  }
  if (!Number.isInteger(spawned.status)) {
    return {
      ...base,
      kind: "finding",
      rule: "launch-error",
      message: `"${bin.binName}" did not return an integer exit status through a .bin symlink`,
    };
  }
  if (!spawned.producedOutput) {
    return {
      ...base,
      kind: "finding",
      rule: "silent-bin",
      message: `"${bin.binName}" invoked through a .bin symlink produced no stdout or stderr (exit ${spawned.status})`,
    };
  }
  return {
    ...base,
    kind: "ok",
    rule: "reachable-bin",
    message: `"${bin.binName}" produced output through a .bin symlink (exit ${spawned.status})`,
  };
}

/**
 * Partition already-classified probe results. Pure: tests can hand it
 * fixtures without scanning a repository.
 *
 * Exit 2 wins over exit 1: if the question could not be answered for any
 * declared bin, the gate must not report a clean fail/pass of the rest.
 */
export function evaluateBinReachability(results) {
  const list = Array.isArray(results) ? results : [];
  const passed = [];
  const findings = [];
  const cannotAnswer = [];
  for (const item of list) {
    if (item.kind === "ok") passed.push(item);
    else if (item.kind === "cannot-answer") cannotAnswer.push(item);
    else findings.push(item);
  }
  const exitCode = cannotAnswer.length > 0 ? 2 : findings.length > 0 ? 1 : 0;
  return { passed, findings, cannotAnswer, exitCode };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function scanBinReachability(repoRoot) {
  const packagesDir = join(repoRoot, "packages");
  if (!existsSync(packagesDir) || !statSync(packagesDir).isDirectory()) {
    throw new Error(`packages directory not found at ${packagesDir}`);
  }
  const results = [];
  const entries = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dirName of entries) {
    const packageDir = join(packagesDir, dirName);
    const manifestPath = join(packageDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch (error) {
      results.push({
        kind: "cannot-answer",
        rule: "unreadable-manifest",
        packageName: dirName,
        packageDir,
        message: `cannot parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const packageName = isText(manifest.name) ? manifest.name : dirName;
    const declared = declaredBinsFromManifest({ packageName, packageDir, manifest });
    results.push(...declared.findings);
    for (const bin of declared.bins) {
      const compiledEntryPath = join(packageDir, bin.target);
      if (!existsSync(compiledEntryPath)) {
        results.push({
          kind: "cannot-answer",
          rule: "missing-compiled-target",
          packageName,
          packageDir,
          binName: bin.binName,
          target: bin.target,
          message: `compiled target "${bin.target}" for "${bin.binName}" is not present; build the package before asking`,
        });
        continue;
      }
      try {
        const spawned = runBinThroughDotBin({
          binName: bin.binName,
          compiledEntryPath,
          args: ["--help"],
        });
        results.push(classifySpawn(bin, spawned));
      } catch (error) {
        results.push({
          kind: "finding",
          rule: "launch-error",
          packageName,
          packageDir,
          binName: bin.binName,
          target: bin.target,
          message: `"${bin.binName}" failed to launch through a .bin symlink: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }
  const evaluated = evaluateBinReachability(results);
  return { ...evaluated, results };
}

function printText(evaluated) {
  for (const item of evaluated.passed) {
    console.log(`PASS ${item.packageName} ${item.binName} -> ${item.target} (exit ${item.status})`);
  }
  for (const item of evaluated.findings) {
    console.log(`FAIL ${item.rule} ${item.packageName}${item.binName ? ` ${item.binName}` : ""} — ${item.message}`);
  }
  for (const item of evaluated.cannotAnswer) {
    console.log(`CANNOT-ANSWER ${item.rule} ${item.packageName}${item.binName ? ` ${item.binName}` : ""} — ${item.message}`);
  }
  const declared = evaluated.passed.length + evaluated.findings.length + evaluated.cannotAnswer.length;
  console.log(
    `\n${evaluated.passed.length} of ${declared} declared bin(s) produced output through a node_modules/.bin-shaped symlink.`,
  );
  console.log("This is not qualification and does not claim publication or adoption.");
}

export function main(argv) {
  const json = argv.includes("--json");
  const root = argv.find((value) => !value.startsWith("--")) ?? join(scriptDir, "..");
  let scanned;
  try {
    scanned = scanBinReachability(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-bin-reachability: ${message}`);
    return 2;
  }
  if (json) {
    console.log(JSON.stringify({
      passed: scanned.passed,
      findings: scanned.findings,
      cannotAnswer: scanned.cannotAnswer,
    }, null, 2));
  } else {
    printText(scanned);
  }
  return scanned.exitCode;
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
