// Mutation proofs for check-pipeline.mjs: each case loads mutated step definitions
// (--steps) or a tampered graph (--graph) and must fail with the named rule.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = join(PKG, "scripts", "check-pipeline.mjs");
const DIST = pathToFileURL(join(PKG, "dist", "pipeline")).href;
const work = mkdtempSync(join(tmpdir(), "check-pipeline-"));
after(() => rmSync(work, { recursive: true, force: true }));

function run(args) {
  try { return { code: 0, out: JSON.parse(execFileSync(process.execPath, [CHECK, "--json", ...args], { encoding: "utf8", maxBuffer: 64 << 20 })) }; }
  catch (error) { return { code: error.status, out: JSON.parse(error.stdout) }; }
}
/** A steps module: the real STEPS and CHECKS, changed by `body` (which may use defineStep). */
function stepsModule(name, body) {
  const file = join(work, `${name}.mjs`);
  writeFileSync(file, `import { STEPS as REAL, CHECKS } from "${DIST}/steps/index.js";\nimport { defineStep } from "${DIST}/define.js";\nlet STEPS = [...REAL];\n${body}\nexport { STEPS, CHECKS };\n`);
  return file;
}
const rules = result => new Set(result.out.failures.map(failure => failure.rule));
const extra = fields => `STEPS.push(defineStep({ id: "mutant", kind: "plumb", actor: "code", stage: "check", summary: "mutant", inputs: [], outputs: [], checks: [], ${fields} }));`;

describe("check:pipeline", { concurrency: 3 }, () => {
  it("passes on the committed definitions and graph", () => {
    const result = run([]);
    assert.equal(result.code, 0, JSON.stringify(result.out.failures, null, 2));
    assert.ok(result.out.open.length > 0, "unassigned seats are listed as open");
    assert.ok(result.out.pendingSteps.includes("pin"));
  });
  it("fails a hand-listed edge", () => {
    const result = run(["--steps", stepsModule("edge", extra(`command: { npm: "check:pipeline" }, edges: ["pin"]`))]);
    assert.equal(result.code, 1);
    assert.ok(rules(result).has("edge.declared"), [...rules(result)].join(","));
  });
  it("fails an option the verb's parser does not define", () => {
    const body = `STEPS = STEPS.map(step => step.id === "workspace.check" ? { ...step, command: { ...step.command, cli: { ...step.command.cli, flags: ["--bogus"] } } } : step);`;
    const result = run(["--steps", stepsModule("option", body)]);
    assert.ok(rules(result).has("option.unknown"), [...rules(result)].join(","));
  });
  it("fails a stale committed graph", () => {
    const file = join(work, "graph.json");
    const graph = JSON.parse(readFileSync(join(PKG, "pipeline", "graph.json"), "utf8"));
    graph.edges.push({ from: "pin", to: "ia", via: [] });
    writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
    const result = run(["--graph", file]);
    assert.equal(result.code, 1);
    assert.deepEqual([...rules(result)].sort(), ["edges.stale", "graph.stale"]);
    assert.ok(result.out.failures.some(failure => failure.rule === "edges.stale" && failure.message.includes("not derived pin->ia")));
  });
  it("commits a layout per node: lanes by actor, ranks over the derived edges", () => {
    const graph = JSON.parse(readFileSync(join(PKG, "pipeline", "graph.json"), "utf8"));
    assert.ok(graph.nodes.length > 0 && graph.nodes.every(node => node.layout && node.layout.lane === node.actor && Number.isInteger(node.layout.rank) && Number.isInteger(node.layout.x) && Number.isInteger(node.layout.y)), "every node carries {lane, rank, x, y}");
    assert.deepEqual(graph.layout.lanes.map(lane => lane.id).slice(0, 1), ["owner"]);
    assert.equal(graph.layout.lanes.at(-1).id, "code");
    const rank = Object.fromEntries(graph.nodes.map(node => [node.id, node.layout.rank]));
    const broken = new Set(graph.layout.cycleBreaks.map(edge => `${edge.from}->${edge.to}`));
    for (const edge of graph.edges) if (!broken.has(`${edge.from}->${edge.to}`)) assert.ok(rank[edge.to] > rank[edge.from], `${edge.from}->${edge.to} ranks forward`);
    assert.ok(graph.edges.every(edge => edge.via.every(via => typeof via.schema === "string")), "every edge names its schema");
  });
  it("fails a hand-edited node position (fixture), naming the node", () => {
    const file = join(work, "graph-moved.json");
    const graph = JSON.parse(readFileSync(join(PKG, "pipeline", "graph.json"), "utf8"));
    const node = graph.nodes.find(each => each.id === "compile");
    node.layout = { ...node.layout, x: node.layout.x + 1 };
    writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
    const result = run(["--graph", file]);
    assert.equal(result.code, 1);
    assert.ok(result.out.failures.some(failure => failure.rule === "layout.stale" && failure.message.startsWith("compile: ")), JSON.stringify(result.out.failures));
  });
  it("lists untyped ports instead of dropping them", () => {
    const result = run([]);
    assert.ok(result.out.untyped.some(port => port.step === "studio.map" && port.port === "output"));
    assert.ok(result.out.untyped.every(port => !port.glob.startsWith("arg:")));
  });
  it("fails an output and input that overlap with different schemas", () => {
    const result = run(["--steps", stepsModule("mismatch", extra(`command: { npm: "check:pipeline" }, inputs: [{ glob: "clossys/agents/designer/*/pin.json", schema: "slot" }]`))]);
    assert.ok(rules(result).has("edge.schema-mismatch"), [...rules(result)].join(","));
  });
  it("fails committed files that do not match their port schema, by step id", () => {
    const result = run(["--steps", stepsModule("schema", extra(`command: { npm: "check:pipeline" }, outputs: [{ glob: "clossys/agents/director/*/pin.json", schema: "slot" }]`))]);
    assert.ok(rules(result).has("schema.invalid"), [...rules(result)].join(","));
    assert.ok(result.out.failures.some(failure => failure.rule === "schema.invalid" && failure.message.startsWith("mutant: ")));
  });
  it("fails a CLI verb that no step declares", () => {
    const result = run(["--steps", stepsModule("verb", `STEPS = STEPS.filter(step => step.id !== "workspace.check");`)]);
    assert.ok(rules(result).has("verb.undeclared"), [...rules(result)].join(","));
  });
  it("fails a pending marker on a step that already landed", () => {
    const body = `STEPS = STEPS.map(step => step.id === "director.check" ? { ...step, pending: { branch: "claude/x", change: "adds" } } : step);`;
    const result = run(["--steps", stepsModule("stale", body)]);
    assert.ok(rules(result).has("entry.stale"), [...rules(result)].join(","));
  });
});
