#!/usr/bin/env node
/**
 * check:studio: one aggregate that runs every Studio, Producer and Designer check and test the
 * package scripts, root `check` and root `test` would otherwise never run. The sub-checks live in
 * ./check-studio.json; scripts/check-orphan-checks.mjs reads the same file, so a check file is
 * either listed there, reached another way, or reported as an orphan.
 *
 * Every sub-check runs, in order, even after one fails, so the summary shows the honest state of
 * every rule. Nothing is skipped: a rendered check whose Studio is not serving fails like any other.
 *
 * Live sub-checks (`kind: "live"`) need a running Studio. When STUDIO_ORIGIN is not set, this runner
 * starts its own: it builds dist/studio from the current source (scripts/build-studio.mjs), starts
 * `produce --root <repository> --port 4503 --no-open` from dist/cli (built by the root `build`) on the
 * single preview port (studio/checks/studio-origin.mjs), waits for /api/health to report the Studio
 * ready, runs the live sub-checks against http://127.0.0.1:4503 and stops the server afterwards. A failed build or start is reported, and
 * the live sub-checks still run (and fail). With STUDIO_ORIGIN set, that Studio is used as is.
 *
 * Each sub-check gets the --timeout bound (default 600 s). A sub-check whose manifest row names
 * `"timeout": "studio-routes"` walks every Studio map entry, so its bound is sized from the route
 * count instead: the check module's own `timeoutSeconds()` (Chrome start plus the worst case per
 * route, shared across its bounded worker pool), never less than the --timeout bound. A sub-check
 * that still runs past its bound is killed and reported red with its timeout; it never passes.
 *
 * Usage: node scripts/check-studio.mjs [--only <id substring>]... [--id <exact id>]... [--json FILE] [--timeout SECONDS]
 * Exit 0 when every sub-check exits 0, otherwise 1.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STUDIO_DEFAULT_ORIGIN, studioPort } from "../studio/checks/studio-origin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
export const MANIFEST = join(here, "check-studio.json");
/** The port a self-started Studio listens on: the single preview port of the default origin. */
export const STUDIO_PORT = studioPort({});
const producer = resolve(here, "..");

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

const delay = ms => new Promise(accept => setTimeout(accept, ms));

/** Sized bounds a manifest row may name in `timeout`: each resolves to seconds from the current tree. */
export const SIZED_TIMEOUTS = {
  "studio-routes": async () => (await import("../studio/checks/check-rendered-provenance.mjs")).timeoutSeconds(),
};

/** The bound for one sub-check: the runner's bound, or for a sized row the larger of that and its sized bound. */
export async function checkTimeoutMs(check, timeoutMs) {
  if (check.timeout === undefined) return timeoutMs;
  const size = SIZED_TIMEOUTS[check.timeout];
  if (!size) throw new Error(`sub-check ${check.id}: unknown timeout ${JSON.stringify(check.timeout)} (known: ${Object.keys(SIZED_TIMEOUTS).join(", ")})`);
  return Math.max(timeoutMs, (await size()) * 1000);
}

/**
 * Build dist/studio from the current source (unless `build: false`) and start `produce` on `port`
 * (STUDIO_PORT by default). Resolves to { origin, stop } once /api/health reports the Studio ready;
 * rejects with the reason otherwise.
 */
export async function startStudio({ log = console.log, port = STUDIO_PORT, readyMs = 300_000, build: rebuild = true } = {}) {
  const cli = join(producer, "dist/cli/index.js");
  if (!existsSync(cli)) throw new Error("dist/cli/index.js is missing: run the root `npm run build` first");
  if (rebuild) {
    log(`check:studio: building dist/studio from the current source for the live sub-checks`);
    const build = spawnSync(process.execPath, [join(here, "build-studio.mjs")], { cwd: producer, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
    if (build.status !== 0) throw new Error(`scripts/build-studio.mjs exited ${build.status}: ${`${build.stdout}\n${build.stderr}`.trim().split("\n").slice(-10).join(" / ")}`);
  }
  const origin = `http://127.0.0.1:${port}`;
  try { await fetch(`${origin}/api/health`); throw new Error(`port ${port} is already serving; stop it or set STUDIO_ORIGIN to use it`); } catch (error) { if (/already serving/.test(error.message)) throw error; }
  const child = spawn(process.execPath, [cli, "produce", "--root", repository, "--port", String(port), "--no-open"], { cwd: producer, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  let output = "", exited;
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-20_000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-20_000); });
  const closed = new Promise(accept => child.on("close", code => { exited = code ?? 1; accept(); }));
  const stop = async () => {
    if (exited === undefined) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 10_000);
    await closed; clearTimeout(timer);
  };
  const deadline = Date.now() + readyMs;
  while (Date.now() < deadline) {
    if (exited !== undefined) throw new Error(`produce exited ${exited} before the Studio was ready: ${output.trim().split("\n").slice(-10).join(" / ")}`);
    try {
      const health = await (await fetch(`${origin}/api/health`)).json();
      if (health?.studio === "ready") { log(`check:studio: Studio ready at ${origin}`); return { origin, stop }; }
    } catch { /* not listening yet */ }
    await delay(500);
  }
  await stop();
  throw new Error(`the Studio was not ready at ${origin} within ${readyMs / 1000}s: ${output.trim().split("\n").slice(-10).join(" / ")}`);
}

export async function checkStudio({ only = [], ids = [], timeoutMs = 600_000, log = console.log } = {}) {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const checks = manifest.checks.filter(check => (!only.length && !ids.length) || only.some(text => check.id.includes(text)) || ids.includes(check.id));
  const unknown = ids.filter(id => !manifest.checks.some(check => check.id === id));
  if (unknown.length) throw new Error(`no such sub-check id: ${unknown.join(", ")}`);
  const bounds = new Map();
  for (const check of checks) bounds.set(check, await checkTimeoutMs(check, timeoutMs));
  const out = mkdtempSync(join(tmpdir(), "check-studio-"));
  const external = process.env.STUDIO_ORIGIN;
  const env = { ...process.env, STUDIO_ORIGIN: external || STUDIO_DEFAULT_ORIGIN, STUDIO_CHECK_OUT: out, FORCE_COLOR: "0", NO_COLOR: "1" };
  let studio, studioError;
  if (!external && checks.some(check => check.kind === "live")) {
    try { studio = await startStudio({ log }); } catch (error) { studioError = error.message; log(`check:studio: could not start the Studio; the live sub-checks run and fail: ${studioError}`); }
  }
  const results = [];
  try {
    for (const check of checks) {
      const result = await run(check, env, bounds.get(check));
      if (check.kind === "live" && studioError) result.tail = `check:studio: Studio not started: ${studioError}\n${result.tail}`;
      results.push(result);
      log(`${result.exitCode === 0 ? "PASS" : "FAIL"}  ${result.id}  (exit ${result.exitCode}${result.failures ? `, ${result.failures} failing` : ""}, ${result.seconds}s)`);
      if (result.exitCode !== 0) log(result.tail.split("\n").map(line => `      ${line}`).join("\n"));
    }
  } finally {
    if (studio) { await studio.stop(); log(`check:studio: stopped the Studio at ${studio.origin}`); }
  }
  const red = results.filter(result => result.exitCode !== 0);
  log(`\ncheck:studio: ${results.length - red.length}/${results.length} sub-checks pass, ${red.length} red. Reports: ${out}`);
  for (const result of red) log(`  red  ${result.id}  exit ${result.exitCode}${result.failures !== undefined ? `  count ${result.failures}` : ""}`);
  return { origin: env.STUDIO_ORIGIN, studio: external ? "external" : studio ? "self-started" : studioError ? `not started: ${studioError}` : "not needed", reports: out, total: results.length, red: red.length, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), only = [], ids = [];
  let json, timeoutMs;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--only" && args[i + 1]) only.push(args[++i]);
    else if (args[i] === "--id" && args[i + 1]) ids.push(args[++i]);
    else if (args[i] === "--json" && args[i + 1]) json = args[++i];
    else if (args[i] === "--timeout" && Number(args[i + 1]) > 0) timeoutMs = Number(args[++i]) * 1000;
    else { console.error("Usage: check-studio.mjs [--only <id substring>]... [--id <exact id>]... [--json FILE] [--timeout SECONDS]"); process.exit(2); }
  }
  let report;
  try { report = await checkStudio({ only, ids, timeoutMs }); } catch (error) { console.error(`check:studio: ${error.message}`); process.exit(2); }
  if (json) writeFileSync(json, JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.red ? 1 : 0;
}
