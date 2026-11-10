#!/usr/bin/env node
/**
 * check:agents: the agents' own strict checks, run as one gate step of the root `check`.
 *
 * Each Director, Designer, Writer and Publisher verb below already decides, deterministically, whether
 * the consumer's records satisfy that agent's contract. Until this step none of them ran in any gate,
 * so `check:gates` stayed green while the agents themselves reported the records not ready. Every
 * step runs the built producer CLI (packages/producer/dist/cli/index.js, built by the root `build`,
 * which the root `check` runs before this step) from the repository root, in order, even after one
 * fails, so the summary is the honest state of every agent. Nothing is skipped, baselined or
 * allow-listed: a step is green only when its own command exits 0.
 *
 * The step list lives in AGENT_CHECKS below; scripts/check-agents.test.mjs (run by check:gates)
 * pins it, so a step cannot be dropped silently.
 *
 * Usage: node scripts/check-agents.mjs [--only <id>]... [--json FILE]
 * Exit 0 when every step exits 0, 1 when any step fails, 2 on a usage error or a missing CLI build.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY = resolve(here, "..");
export const CLI = "packages/producer/dist/cli/index.js";

/** The agents' strict checks, in run order. `args` are passed to the producer CLI as is. */
export const AGENT_CHECKS = Object.freeze([
  { id: "slots-readiness", agent: "all", args: ["check", "--slots", "--readiness"] },
  { id: "suites-strict", agent: "publisher", args: ["check", "--suites", "--strict"] },
  { id: "director-complete-mvs", agent: "director", args: ["director", "check", "complete", "--level", "mvs"] },
  { id: "director-handoff-writer-messaging", agent: "director", args: ["director", "check", "handoff", "writer.messaging"] },
  { id: "director-handoff-designer-identity", agent: "director", args: ["director", "check", "handoff", "designer.identity"] },
  { id: "direct-check", agent: "director", args: ["direct", "--check"] },
  { id: "design-check", agent: "designer", args: ["design", "--check"] },
  { id: "write-check", agent: "writer", args: ["write", "--check"] },
].map(Object.freeze));

/** Parse argv: `--only <id>` (repeatable) and `--json <file>`. Throws on a usage error. */
export function parseArgs(argv) {
  const options = { only: [], json: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--only" || arg === "--json") {
      if (!value || value.startsWith("-")) throw new Error(`${arg} needs a value`);
      index++;
      if (arg === "--only") {
        if (!AGENT_CHECKS.some(check => check.id === value)) throw new Error(`unknown check id ${value} (known: ${AGENT_CHECKS.map(check => check.id).join(", ")})`);
        options.only.push(value);
      } else options.json = value;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

/** The command line one step runs, for the report. */
export function commandLine(check) {
  return ["node", CLI, ...check.args].join(" ");
}

/**
 * Run every selected step; returns [{ id, agent, command, exit, seconds, tail }].
 * `run(args)` returns { status, output }; the default spawns the producer CLI from the repository root.
 */
export function runChecks(checks, { run = defaultRun, log = console.log } = {}) {
  const results = [];
  for (const check of checks) {
    const started = Date.now();
    log(`\ncheck:agents: ${check.id}: ${commandLine(check)}`);
    const { status, output } = run(check.args);
    const exit = status ?? 1;
    const tail = String(output ?? "").trim().split("\n").slice(-40).join("\n");
    if (tail) log(tail);
    results.push({ id: check.id, agent: check.agent, command: commandLine(check), exit, seconds: Math.round((Date.now() - started) / 100) / 10, tail });
    log(`check:agents: ${check.id} exited ${exit}`);
  }
  return results;
}

/** The summary lines and the exit code for a set of results. */
export function summarize(results) {
  const red = results.filter(result => result.exit !== 0);
  const lines = [`check:agents: ${results.length} step(s), ${results.length - red.length} passed, ${red.length} failed`,
    ...red.map(result => `  FAIL  ${result.id}  (${result.agent}; exit ${result.exit}): ${result.command}`)];
  return { lines, exitCode: red.length ? 1 : 0 };
}

function defaultRun(args) {
  const result = spawnSync(process.execPath, [join(REPOSITORY, CLI), ...args], { cwd: REPOSITORY, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) return { status: 1, output: String(result.error) };
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`check:agents: ${error.message}`); process.exit(2); }
  if (!existsSync(join(REPOSITORY, CLI))) {
    console.error(`check:agents: ${CLI} is missing; run \`npm run build\` first (the root check builds before this step).`);
    process.exit(2);
  }
  const checks = options.only.length ? AGENT_CHECKS.filter(check => options.only.includes(check.id)) : AGENT_CHECKS;
  const results = runChecks(checks);
  const summary = summarize(results);
  console.log(`\n${summary.lines.join("\n")}`);
  if (options.json) writeFileSync(options.json, `${JSON.stringify({ schemaVersion: 1, exitCode: summary.exitCode, results }, null, 2)}\n`);
  process.exitCode = summary.exitCode;
}
