#!/usr/bin/env node
// check-client-boundary-cached — the build's client-boundary gate, skipped only when its exact inputs
// are byte-identical to the inputs of its last passing run.
//
//   node ../../scripts/check-client-boundary-cached.mjs <package-directory> --report <report.json> [--force]
//   CLOSSYS_BUILD_FORCE=1 npm run build      force the full check (as does `npm run build:clean`)
//
// The full check (scripts/check-client-boundary.mjs, unchanged and still what `check:client-boundary`
// runs) bundles every browser entry and records each graph's inputs with their sha256 in its report.
// After a PASS this wrapper stores a stamp: the digest of those inputs plus everything else that can
// change the verdict without touching an input file — the check script itself, this wrapper, the
// lockfile, every first-party package.json (exports and conditions), the file listings of every
// directory holding an input (a new sibling can change how a specifier resolves) and the top-level
// node_modules listings. The next run recomputes that digest; only an exact match with a PASS report
// still on disk skips the bundle. Any difference, a missing input, a FAIL, or --force runs the full
// check, and a FAIL deletes the stamp.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptsDir, "..");
const checkScript = join(scriptsDir, "check-client-boundary.mjs");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// The gate's own report and stamp are outputs, not inputs, even when they sit beside one.
const listing = (dir, own = new Set()) =>
  existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).filter((name) => !own.has(join(dir, name))).sort().join("\n") : "<absent>";

/** Absolute paths of every input any graph of a passing report bundled. */
export function reportInputs(report, packageRoot) {
  const inputs = new Set();
  for (const graph of report.graphs ?? []) for (const input of graph.inputs ?? []) inputs.add(resolve(packageRoot, input.file));
  return [...inputs].sort();
}

/** One digest over everything the check's verdict depends on; null when an input is gone. */
export function inputDigest(packageRoot, inputs, own = new Set()) {
  const hash = createHash("sha256");
  const add = (label, value) => hash.update(`${label}\0${value}\0`);
  add("check", sha256(readFileSync(checkScript)));
  add("wrapper", sha256(readFileSync(fileURLToPath(import.meta.url))));
  const lock = join(repositoryRoot, "package-lock.json");
  add("lock", existsSync(lock) ? sha256(readFileSync(lock)) : "<absent>");
  add("package", sha256(readFileSync(join(packageRoot, "package.json"))));
  const workspace = join(repositoryRoot, "packages");
  for (const dir of readdirSync(workspace).sort()) {
    const manifest = join(workspace, dir, "package.json");
    if (existsSync(manifest)) add(`manifest:${dir}`, sha256(readFileSync(manifest)));
  }
  const modules = [join(repositoryRoot, "node_modules"), join(packageRoot, "node_modules")];
  for (const dir of modules) {
    add(`modules:${dir}`, listing(dir));
    if (existsSync(dir)) for (const entry of readdirSync(dir).sort()) if (entry.startsWith("@")) add(`modules:${dir}/${entry}`, listing(join(dir, entry)));
  }
  const dirs = new Set();
  for (const file of inputs) {
    if (!existsSync(file)) return null;
    add(`input:${file}`, sha256(readFileSync(file)));
    dirs.add(dirname(file));
  }
  for (const dir of [...dirs].sort()) add(`dir:${dir}`, listing(dir, own));
  return hash.digest("hex");
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force") || process.env.CLOSSYS_BUILD_FORCE === "1";
  const rest = args.filter((arg) => arg !== "--force");
  if (rest.length !== 3 || rest[1] !== "--report" || !rest[2]) {
    console.error("Usage: node scripts/check-client-boundary-cached.mjs <package-directory> --report <report.json> [--force]");
    return 2;
  }
  const packageRoot = resolve(rest[0]);
  const reportFile = resolve(rest[2]);
  const stampFile = join(dirname(reportFile), `${basename(reportFile, ".json")}.stamp.json`);
  const own = new Set([reportFile, stampFile, `${stampFile}.tmp`]);

  if (!force && existsSync(stampFile) && existsSync(reportFile)) {
    try {
      const stamp = JSON.parse(readFileSync(stampFile, "utf8"));
      const report = JSON.parse(readFileSync(reportFile, "utf8"));
      const inputs = reportInputs(report, packageRoot);
      if (report.ok === true && report.exitCode === 0 && stamp.schemaVersion === 1 && inputs.length && stamp.digest === inputDigest(packageRoot, inputs, own)) {
        console.log(`client-boundary: PASS (all ${inputs.length} inputs unchanged since the passing run at ${report.source?.head ?? "unknown"}; check not re-run); report ${reportFile}`);
        return 0;
      }
    } catch {
      // An unreadable stamp or report is a cache miss; the full check below decides.
    }
  }
  rmSync(stampFile, { force: true });
  const result = spawnSync(process.execPath, [checkScript, packageRoot, "--report", reportFile], { stdio: "inherit" });
  if (result.status !== 0) return result.status || 1;
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const inputs = reportInputs(report, packageRoot);
  const digest = report.ok === true && inputs.length ? inputDigest(packageRoot, inputs, own) : null;
  if (digest) {
    writeFileSync(`${stampFile}.tmp`, JSON.stringify({ schemaVersion: 1, digest }) + "\n");
    renameSync(`${stampFile}.tmp`, stampFile);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
