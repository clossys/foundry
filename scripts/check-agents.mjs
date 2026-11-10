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
 * Each step runs with `--json`; its findings are counted from that output (FINDINGS below), so
 * `--json FILE` writes the program scoreboard: one stable row per check (id, agent, command, exit,
 * findings, top codes), with no timings or text, so two runs over the same tree write the same bytes.
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
  // Pending: `pipeline check` exists only on the W1b branch. The integrator removes `pending` when W1b lands;
  // until then the step is reported as pending (never as passed). check-agents.test.mjs pins that this is
  // the only pending step.
  { id: "pipeline-check", agent: "all", args: ["pipeline", "check"], pending: "enable when W1b (pipeline check verb) lands" },
].map(Object.freeze));

const list = value => (Array.isArray(value) ? value : []);
const errors = findings => list(findings).filter(finding => finding?.severity === undefined || finding.severity === "error" || finding.severity === "hard");
const codes = (findings, key = "code") => list(findings).map(finding => String(finding?.[key] ?? finding?.code ?? finding?.rule ?? "unknown"));
/**
 * Finding codes per step, read from the step's `--json` output. A step whose output cannot be read
 * counts as one `unreadable-output` finding, never as zero.
 */
export const FINDINGS = Object.freeze({
  // check --slots: every slot-integrity row is a finding (rule).
  "slots-readiness": value => codes(value.slots?.findings, "rule"),
  // check --suites --strict: slot rows plus every error of every suite; a suite that could not run is a finding.
  "suites-strict": value => [...codes(value.slots?.findings, "rule"),
    ...list(value.suites?.suites).flatMap(suite => suite.status === "error" ? [`${suite.suite}/unavailable`] : codes(errors(suite.findings)).map(code => `${suite.suite}/${code}`))],
  // director check complete: hard cell and coherence findings, plus one row when MVS is not ready.
  "director-complete-mvs": value => [...(value.result?.mvs === false ? ["mvs-not-ready"] : []),
    ...codes(errors(list(value.result?.cells).flatMap(cell => list(cell.findings))), "rule"), ...codes(errors(value.result?.findings), "rule")],
  // director check handoff: one finding per missing or stale required cell.
  "director-handoff-writer-messaging": value => handoffCodes(value),
  "director-handoff-designer-identity": value => handoffCodes(value),
  "direct-check": value => codes(value.findings),
  "design-check": value => codes(value.checks?.findings),
  "write-check": value => codes(value.checks?.findings, "rule"),
});
function handoffCodes(value) {
  return [...list(value.result?.missing).map(() => "handoff-missing"), ...list(value.result?.stale).map(() => "handoff-stale")];
}

/** The codes a step's parsed output reports; a step with no extractor uses `findings` / `checks.findings`. */
export function findingCodes(id, value) {
  if (!value || typeof value !== "object") return ["unreadable-output"];
  const extract = FINDINGS[id] ?? (output => codes(output.findings ?? output.checks?.findings));
  return extract(value);
}

/** The top codes, most frequent first, ties by code. */
export function topCodes(all, limit = 5) {
  const counts = new Map();
  for (const code of all) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, limit).map(([code, count]) => ({ code, count }));
}

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
 * Run every selected step; returns [{ id, agent, command, exit, findings, topCodes, tail }].
 * `run(args)` returns { status, output, value } (value = the parsed `--json` output, if any); the
 * default spawns the producer CLI from the repository root with `--json`.
 */
export function runChecks(checks, { run = defaultRun, log = console.log } = {}) {
  const results = [];
  for (const check of checks) {
    if (check.pending) {
      log(`\ncheck:agents: ${check.id}: PENDING, not run (${check.pending}): ${commandLine(check)}`);
      results.push({ id: check.id, agent: check.agent, command: commandLine(check), exit: null, pending: check.pending, findings: null, topCodes: [], tail: "" });
      continue;
    }
    log(`\ncheck:agents: ${check.id}: ${commandLine(check)}`);
    const { status, output, value } = run(check.args);
    const exit = status ?? 1;
    const tail = String(output ?? "").trim().split("\n").slice(-40).join("\n");
    if (tail) log(tail);
    const all = findingCodes(check.id, value);
    results.push({ id: check.id, agent: check.agent, command: commandLine(check), exit, findings: all.length, topCodes: topCodes(all), tail });
    log(`check:agents: ${check.id} exited ${exit}, ${all.length} finding(s)`);
  }
  return results;
}

/** The summary lines and the exit code for a set of results. */
export function summarize(results) {
  const pending = results.filter(result => result.pending);
  const red = results.filter(result => !result.pending && result.exit !== 0);
  const passed = results.length - pending.length - red.length;
  const lines = [`check:agents: ${results.length} step(s), ${passed} passed, ${red.length} failed${pending.length ? `, ${pending.length} pending (not run)` : ""}`,
    ...red.map(result => `  FAIL  ${result.id}  (${result.agent}; exit ${result.exit}; ${result.findings} finding(s)${result.topCodes.length ? `: ${result.topCodes.map(top => `${top.code} ${top.count}`).join(", ")}` : ""}): ${result.command}`),
    ...pending.map(result => `  PENDING  ${result.id}  (${result.pending}): ${result.command}`)];
  return { lines, exitCode: red.length ? 1 : 0 };
}

/** The scoreboard document: one row per check, stable keys and order, no timings or output text. */
export function scoreboard(results) {
  return {
    schemaVersion: 1,
    exitCode: summarize(results).exitCode,
    rows: results.map(result => ({ id: result.id, agent: result.agent, command: result.command, exit: result.exit, findings: result.findings, topCodes: result.topCodes, ...(result.pending ? { pending: result.pending } : {}) })),
  };
}

function defaultRun(args) {
  const result = spawnSync(process.execPath, [join(REPOSITORY, CLI), ...args, "--json"], { cwd: REPOSITORY, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) return { status: 1, output: String(result.error), value: undefined };
  let value;
  try { value = JSON.parse(result.stdout); } catch { value = undefined; }
  const message = typeof value?.message === "string" ? value.message : `${result.stdout ?? ""}`.slice(0, 2000);
  return { status: result.status, output: `${message}${result.stderr ? `\n${result.stderr}` : ""}`, value };
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
  if (options.json) writeFileSync(options.json, `${JSON.stringify(scoreboard(results), null, 2)}\n`);
  process.exitCode = summary.exitCode;
}
