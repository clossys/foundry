// check:agents: the agents' own strict checks are a gate step. These tests pin the step list, the
// wiring into the root `check` after `build`, and the runner's run-every-step, red-is-red contract.
// Pure: node builtins and local scripts only, so check:gates (scripts/lib/gate-test-set.mjs) runs it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { AGENT_CHECKS, CLI, commandLine, parseArgs, REPOSITORY, runChecks, summarize } from "./check-agents.mjs";
import { parseSteps } from "./run-check-steps.mjs";

test("the step list is every agent's strict check, in order, with no flag that softens it", () => {
  assert.deepEqual(AGENT_CHECKS.map(check => check.args.join(" ")), [
    "check --slots --readiness",
    "check --suites --strict",
    "director check complete --level mvs",
    "director check handoff writer.messaging",
    "director check handoff designer.identity",
    "direct --check",
    "design --check",
    "write --check",
  ]);
  assert.equal(new Set(AGENT_CHECKS.map(check => check.id)).size, AGENT_CHECKS.length);
  for (const check of AGENT_CHECKS) {
    assert.ok(Object.isFrozen(check));
    for (const arg of check.args) assert.doesNotMatch(arg, /^--(?:no-|skip|allow|baseline|warn|lenient|loose)/, `${check.id} passes a softening flag ${arg}`);
  }
  assert.equal(commandLine(AGENT_CHECKS[2]), `node ${CLI} director check complete --level mvs`);
});

test("root check runs check:agents after build, and check:agents runs this runner", () => {
  const { scripts } = JSON.parse(readFileSync(join(REPOSITORY, "package.json"), "utf8"));
  assert.equal(scripts["check:agents"], "node scripts/check-agents.mjs");
  const labels = parseSteps(scripts.check.split(/\s+/).slice(2)).map(step => step.workspace ? `${step.script}@${step.workspace}` : step.script);
  assert.ok(labels.includes("check:agents"), "root check runs check:agents");
  assert.ok(labels.indexOf("build") < labels.indexOf("check:agents"), "build runs before check:agents, which needs dist");
});

test("every step runs even after one fails, and any red step makes the gate red", () => {
  const seen = [];
  const statuses = new Map([["direct", 1], ["design", 2]]);
  const results = runChecks(AGENT_CHECKS, { log: () => {}, run: args => { seen.push(args.join(" ")); return { status: statuses.get(args[0]) ?? 0, output: `ran ${args[0]}\n` }; } });
  assert.equal(seen.length, AGENT_CHECKS.length);
  assert.deepEqual(results.filter(result => result.exit !== 0).map(result => result.id), ["direct-check", "design-check"]);
  const summary = summarize(results);
  assert.equal(summary.exitCode, 1);
  assert.match(summary.lines[0], /8 step\(s\), 6 passed, 2 failed/);
});

test("mutation: one red step alone is enough, a null status is red, and all-green is the only exit 0", () => {
  const green = runChecks(AGENT_CHECKS, { log: () => {}, run: () => ({ status: 0, output: "" }) });
  assert.equal(summarize(green).exitCode, 0);
  for (const failing of AGENT_CHECKS) {
    const results = runChecks(AGENT_CHECKS, { log: () => {}, run: args => ({ status: args.join(" ") === failing.args.join(" ") ? 1 : 0, output: "" }) });
    assert.equal(summarize(results).exitCode, 1, `${failing.id} red must turn the gate red`);
  }
  const killed = runChecks([AGENT_CHECKS[0]], { log: () => {}, run: () => ({ status: null, output: "" }) });
  assert.equal(killed[0].exit, 1);
  assert.equal(summarize(killed).exitCode, 1);
});

test("argument parsing: --only names a known step, --json takes a file, anything else is a usage error", () => {
  assert.deepEqual(parseArgs(["--only", "write-check", "--json", "out.json"]), { only: ["write-check"], json: "out.json" });
  assert.throws(() => parseArgs(["--only", "nope"]), /unknown check id/);
  assert.throws(() => parseArgs(["--only"]), /needs a value/);
  assert.throws(() => parseArgs(["--skip", "x"]), /unknown argument/);
});
