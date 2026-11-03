#!/usr/bin/env node
/**
 * check:studio: one aggregate that runs every Studio, Producer and Designer check and test the
 * package scripts, root `check` and root `test` would otherwise never run. The sub-checks live in
 * ./check-studio.json; scripts/check-orphan-checks.mjs reads the same file, so a check file is
 * either listed there, reached another way, or reported as an orphan.
 *
 * Every sub-check runs, in order, even after one fails, so the summary shows the honest state of
 * every rule. Nothing is skipped: a rendered check whose Studio is not serving at STUDIO_ORIGIN
 * (default http://127.0.0.1:4617) fails like any other.
 *
 * Usage: node scripts/check-studio.mjs [--only <id substring>]... [--json FILE] [--timeout SECONDS]
 * Exit 0 when every sub-check exits 0, otherwise 1.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
export const MANIFEST = join(here, "check-studio.json");

/** Best-effort failure count from a sub-check's output: node:test, vitest, or a JSON findings report. */
export function failureCount(output) {
  const nodeTest = [...output.matchAll(/^(?:# |ℹ )fail (\d+)$/gm)].map(match => Number(match[1]));
  if (nodeTest.length) return nodeTest.reduce((sum, count) => sum + count, 0);
  const vitest = /Tests\s+(\d+) failed/.exec(output);
  if (vitest) return Number(vitest[1]);
  const findings = /(\d+) (?:finding|violation|failure|error)s?\b/i.exec(output);
  return findings ? Number(findings[1]) : undefined;
}

function run(check, env, timeoutMs) {
  return new Promise(accept => {
    const started = Date.now();
    const child = spawn("/bin/sh", ["-c", check.run], { cwd: join(repository, check.cwd), env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let output = "";
    const collect = chunk => { output += chunk; if (output.length > 4_000_000) output = output.slice(-2_000_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => { output += `\ncheck:studio: timed out after ${timeoutMs / 1000}s\n`; try { process.kill(-child.pid, "SIGTERM"); } catch {} }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      accept({ id: check.id, kind: check.kind, cwd: check.cwd, run: check.run, exitCode: code ?? 1, signal, seconds: Math.round((Date.now() - started) / 100) / 10, failures: code ? failureCount(output) : 0, tail: output.trim().split("\n").slice(-25).join("\n") });
    });
  });
}

export async function checkStudio({ only = [], timeoutMs = 600_000, log = console.log } = {}) {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const checks = manifest.checks.filter(check => !only.length || only.some(text => check.id.includes(text)));
  const out = mkdtempSync(join(tmpdir(), "check-studio-"));
  const env = { ...process.env, STUDIO_ORIGIN: process.env.STUDIO_ORIGIN ?? "http://127.0.0.1:4617", STUDIO_CHECK_OUT: out, FORCE_COLOR: "0", NO_COLOR: "1" };
  const results = [];
  for (const check of checks) {
    const result = await run(check, env, timeoutMs);
    results.push(result);
    log(`${result.exitCode === 0 ? "PASS" : "FAIL"}  ${result.id}  (exit ${result.exitCode}${result.failures ? `, ${result.failures} failing` : ""}, ${result.seconds}s)`);
    if (result.exitCode !== 0) log(result.tail.split("\n").map(line => `      ${line}`).join("\n"));
  }
  const red = results.filter(result => result.exitCode !== 0);
  log(`\ncheck:studio: ${results.length - red.length}/${results.length} sub-checks pass, ${red.length} red. Reports: ${out}`);
  for (const result of red) log(`  red  ${result.id}  exit ${result.exitCode}${result.failures !== undefined ? `  count ${result.failures}` : ""}`);
  return { origin: env.STUDIO_ORIGIN, reports: out, total: results.length, red: red.length, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), only = [];
  let json, timeoutMs;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--only" && args[i + 1]) only.push(args[++i]);
    else if (args[i] === "--json" && args[i + 1]) json = args[++i];
    else if (args[i] === "--timeout" && Number(args[i + 1]) > 0) timeoutMs = Number(args[++i]) * 1000;
    else { console.error("Usage: check-studio.mjs [--only <id substring>]... [--json FILE] [--timeout SECONDS]"); process.exit(2); }
  }
  const report = await checkStudio({ only, timeoutMs });
  if (json) writeFileSync(json, JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.red ? 1 : 0;
}
