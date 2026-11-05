#!/usr/bin/env node
/**
 * The root `check` aggregate: run every listed npm script in order, even after one fails, and exit
 * non-zero when any failed. An `&&` chain stops at the first red step, so a step that always fails
 * (check:rules reports unenforced rows as findings) would silently skip every step after it.
 *
 * Usage: node scripts/run-check-steps.mjs <script> [--workspace=<dir>] <script> ...
 *   Each bare argument is an npm script run from the current directory (`npm run <script>`); a
 *   `--workspace=<dir>` argument applies to the step before it.
 * Exit 0 when every step exits 0, 1 when any step fails, 2 on a usage error.
 *
 * scripts/check-orphan-checks.mjs expands this runner's arguments, so every step stays traced.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Parse the argument list into steps: [{ script, workspace? }]. Throws on a usage error. */
export function parseSteps(args) {
  const steps = [];
  for (const arg of args) {
    if (arg.startsWith("--workspace=")) {
      if (!steps.length || steps.at(-1).workspace) throw new Error(`${arg} must follow the step it applies to`);
      steps.at(-1).workspace = arg.slice("--workspace=".length);
    } else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    else steps.push({ script: arg });
  }
  if (!steps.length) throw new Error("no steps given");
  return steps;
}

/** The npm arguments one step runs. */
export function stepArgs(step) {
  return ["run", step.script, ...(step.workspace ? [`--workspace=${step.workspace}`] : [])];
}

/** Run every step; returns [{ step, label, exit, seconds }]. `run(args)` returns an exit code. */
export function runSteps(steps, { run = args => spawnSync("npm", args, { stdio: "inherit" }).status ?? 1, log = console.log } = {}) {
  const results = [];
  for (const step of steps) {
    const label = stepArgs(step).slice(1).join(" ");
    const started = Date.now();
    const exit = run(stepArgs(step));
    results.push({ step, label, exit, seconds: Math.round((Date.now() - started) / 100) / 10 });
    if (exit !== 0) log(`check: step ${label} exited ${exit}; continuing`);
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let steps;
  try { steps = parseSteps(process.argv.slice(2)); }
  catch (error) { console.error(`run-check-steps: ${error.message}`); process.exit(2); }
  const results = runSteps(steps);
  const red = results.filter(result => result.exit !== 0);
  console.log(`\ncheck: ${results.length} step(s), ${results.length - red.length} passed, ${red.length} failed`);
  for (const result of red) console.log(`  FAIL  ${result.label}  (exit ${result.exit}, ${result.seconds}s)`);
  process.exitCode = red.length ? 1 : 0;
}
