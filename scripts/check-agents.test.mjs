// check:agents: the agents' own strict checks are a gate step. These tests pin the step list, the
// wiring into the root `check` after `build`, and the runner's run-every-step, red-is-red contract.
// Pure: node builtins and local scripts only, so check:gates (scripts/lib/gate-test-set.mjs) runs it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { AGENT_CHECKS, CLI, commandLine, FINDINGS, findingCodes, parseArgs, REPOSITORY, runChecks, scoreboard, summarize, topCodes } from "./check-agents.mjs";
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
    "pipeline check",
  ]);
  assert.deepEqual(AGENT_CHECKS.filter(check => check.pending).map(check => check.id), [], "no step is pending: W1b landed pipeline check");
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
  const pendingStep = Object.freeze({ id: "pending-step", agent: "all", args: ["pending", "step"], pending: "lands later" });
  const results = runChecks([...AGENT_CHECKS, pendingStep], { log: () => {}, run: args => { seen.push(args.join(" ")); return { status: statuses.get(args[0]) ?? 0, output: `ran ${args[0]}\n` }; } });
  assert.equal(seen.length, AGENT_CHECKS.length, "every non-pending step runs");
  assert.ok(seen.includes("pipeline check"), "the enabled pipeline step runs");
  assert.ok(!seen.includes("pending step"), "a pending step is not run");
  assert.deepEqual(results.filter(result => !result.pending && result.exit !== 0).map(result => result.id), ["direct-check", "design-check"]);
  const summary = summarize(results);
  assert.equal(summary.exitCode, 1);
  assert.match(summary.lines[0], /10 step\(s\), 7 passed, 2 failed, 1 pending \(not run\)/);
  assert.ok(summary.lines.some(line => /PENDING\s+pending-step/.test(line)), "a pending step is listed, never counted as passed");
});

test("mutation: one red step alone is enough, a null status is red, and all-green is the only exit 0", () => {
  const green = runChecks(AGENT_CHECKS, { log: () => {}, run: () => ({ status: 0, output: "" }) });
  assert.equal(summarize(green).exitCode, 0);
  for (const failing of AGENT_CHECKS.filter(check => !check.pending)) {
    const results = runChecks(AGENT_CHECKS, { log: () => {}, run: args => ({ status: args.join(" ") === failing.args.join(" ") ? 1 : 0, output: "" }) });
    assert.equal(summarize(results).exitCode, 1, `${failing.id} red must turn the gate red`);
  }
  const redPipeline = runChecks(AGENT_CHECKS, { log: () => {}, run: args => ({ status: args[0] === "pipeline" ? 1 : 0, output: "" }) });
  assert.equal(summarize(redPipeline).exitCode, 1, "a red pipeline check turns the gate red");
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

test("findings are counted from each step's --json output, per output shape", () => {
  assert.deepEqual(Object.keys(FINDINGS).sort(), AGENT_CHECKS.filter(check => !check.pending).map(check => check.id).sort(), "every enabled step has a finding extractor");
  assert.deepEqual(findingCodes("slots-readiness", { slots: { findings: [{ rule: "schema" }, { rule: "source-ref-unknown" }] } }), ["schema", "source-ref-unknown"]);
  assert.deepEqual(findingCodes("suites-strict", { slots: { findings: [{ rule: "schema" }] }, suites: { suites: [
    { suite: "archetypes", status: "ran", findings: [{ severity: "error", code: "meta/meta-title-missing" }, { severity: "warning", code: "format/format-section-unknown" }, { severity: "info", code: "copy-fit/copy-fit-not-measured" }] },
    { suite: "writer-slots", status: "error", findings: [] },
  ] } }), ["schema", "archetypes/meta/meta-title-missing", "writer-slots/unavailable"]);
  assert.deepEqual(findingCodes("director-complete-mvs", { result: { mvs: false, cells: [{ findings: [{ rule: "Q4", severity: "hard" }, { rule: "Q2", severity: "judge" }] }], findings: [{ rule: "C1", severity: "hard" }, { rule: "C3", severity: "warning" }] } }), ["mvs-not-ready", "Q4", "C1"]);
  assert.deepEqual(findingCodes("director-handoff-writer-messaging", { result: { state: "stale", missing: [], stale: [{ cell: "a" }, { cell: "b" }] } }), ["handoff-stale", "handoff-stale"]);
  assert.deepEqual(findingCodes("direct-check", { findings: [{ code: "mvs-not-ready" }] }), ["mvs-not-ready"]);
  assert.deepEqual(findingCodes("design-check", { checks: { findings: [{ code: "slots/schema" }] } }), ["slots/schema"]);
  assert.deepEqual(findingCodes("write-check", { checks: { findings: [{ rule: "suites/copy/copy-unbound" }] } }), ["suites/copy/copy-unbound"]);
});

test("mutation: unreadable output is a finding, never zero; a clean output is zero", () => {
  for (const check of AGENT_CHECKS) assert.deepEqual(findingCodes(check.id, undefined), ["unreadable-output"]);
  assert.deepEqual(findingCodes("direct-check", { findings: [] }), []);
  assert.deepEqual(findingCodes("director-complete-mvs", { result: { mvs: true, cells: [], findings: [] } }), []);
  assert.deepEqual(findingCodes("director-handoff-designer-identity", { result: { state: "ready", missing: [], stale: [] } }), []);
  assert.deepEqual(findingCodes("pipeline-check", { page: [], contracts: [] }), []);
  assert.deepEqual(findingCodes("pipeline-check", { page: ["a"], contracts: ["b", "c"] }), ["page-status-uncited", "contract-status-uncited", "contract-status-uncited"]);
  assert.deepEqual(findingCodes("pipeline-check", { findings: [] }), ["unreadable-output"], "a pipeline output without page/contracts is unreadable, never zero");
});

test("the scoreboard is one stable row per check: no timings, no output text, top codes by count then code", () => {
  assert.deepEqual(topCodes(["b", "a", "b", "c", "a", "b", "d", "e", "f"]), [{ code: "b", count: 3 }, { code: "a", count: 2 }, { code: "c", count: 1 }, { code: "d", count: 1 }, { code: "e", count: 1 }]);
  const run = args => ({ status: args[0] === "write" ? 1 : 0, output: `noise ${Math.random()}`, value: args[0] === "write" ? { checks: { findings: [{ rule: "suites/meta/meta-title-missing" }, { rule: "suites/meta/meta-title-missing" }] } } : { findings: [], page: [], contracts: [], checks: { findings: [] }, slots: { findings: [] }, suites: { suites: [] }, result: { mvs: true, cells: [], findings: [], missing: [], stale: [] } } });
  const first = JSON.stringify(scoreboard(runChecks(AGENT_CHECKS, { log: () => {}, run })));
  const second = JSON.stringify(scoreboard(runChecks(AGENT_CHECKS, { log: () => {}, run })));
  assert.equal(first, second, "two runs over the same outputs write the same bytes");
  const board = JSON.parse(first);
  assert.equal(board.schemaVersion, 1);
  assert.equal(board.exitCode, 1);
  assert.equal(board.rows.length, AGENT_CHECKS.length);
  for (const row of board.rows) assert.deepEqual(Object.keys(row).filter(key => key !== "pending"), ["id", "agent", "command", "exit", "findings", "topCodes"]);
  assert.deepEqual(board.rows.find(row => row.id === "write-check"), { id: "write-check", agent: "writer", command: `node ${CLI} write --check`, exit: 1, findings: 2, topCodes: [{ code: "suites/meta/meta-title-missing", count: 2 }] });
  assert.deepEqual(board.rows.find(row => row.id === "pipeline-check"), { id: "pipeline-check", agent: "all", command: `node ${CLI} pipeline check`, exit: 0, findings: 0, topCodes: [] });
});
