// Mutation proofs for check-pipeline.mjs: each case loads mutated step definitions
// (--steps), a tampered graph (--graph) or a writer fixture (--scan, under
// scripts/rules/fixtures/R-PIPELINE-IS-CODE) and must fail with the named rule, or pass.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = join(PKG, "scripts", "check-pipeline.mjs");
const DIST = pathToFileURL(join(PKG, "dist", "pipeline")).href;
const REPO = resolve(PKG, "../..");
const WRITER_FIXTURES = join(REPO, "scripts", "rules", "fixtures", "R-PIPELINE-IS-CODE");
const work = mkdtempSync(join(tmpdir(), "check-pipeline-"));
after(() => rmSync(work, { recursive: true, force: true }));

function run(args, env = process.env) {
  try { return { code: 0, out: JSON.parse(execFileSync(process.execPath, [CHECK, "--json", ...args], { encoding: "utf8", maxBuffer: 64 << 20, env })) }; }
  catch (error) { return { code: error.status, out: JSON.parse(error.stdout) }; }
}
/** A steps module: the real STEPS and CHECKS, changed by `body` (which may use defineStep). */
function stepsModule(name, body) {
  const file = join(work, `${name}.mjs`);
  writeFileSync(file, `import { STEPS as REAL, CHECKS } from "${DIST}/steps/index.js";\nimport { defineStep } from "${DIST}/define.js";\nlet STEPS = [...REAL];\n${body}\nexport { STEPS, CHECKS };\n`);
  return file;
}
const rules = result => new Set(result.out.failures.map(failure => failure.rule));
const foreignWriters = result => result.out.failures.filter(failure => failure.rule === "decide.foreign-writer").map(failure => failure.message);
// A mutant reads nothing, so it sits in the first stage (a later step with no feeding edge is stage.orphan).
const extra = fields => `STEPS.push(defineStep({ id: "mutant", kind: "plumb", actor: "code", stage: "direct.brief", summary: "mutant", inputs: [], outputs: [], checks: [], ${fields} }));`;

describe("check:pipeline", { concurrency: 3 }, () => {
  it("passes on the committed definitions and graph", () => {
    const result = run([]);
    assert.equal(result.code, 0, JSON.stringify(result.out.failures, null, 2));
    assert.ok(result.out.open.length > 0, "unassigned seats are listed as open");
  });
  it("lists a step that lands on another branch as pending, never as passing", () => {
    const result = run(["--steps", stepsModule("pending", extra(`command: { module: "src/not-landed-yet.ts#run" }, pending: { branch: "claude/not-landed-yet", change: "adds" }`))]);
    // The added step is not in the committed graph (graph.stale) and has no committed layout, which also
    // re-ranks the code lane (layout.stale, naming it); nothing else may fail, and its absent entry is not entry.missing.
    assert.deepEqual([...rules(result)].sort(), ["graph.stale", "layout.stale"], JSON.stringify(result.out.failures, null, 2));
    assert.ok(result.out.failures.some(failure => failure.rule === "layout.stale" && failure.message.startsWith("mutant: committed layout (none)")), JSON.stringify(result.out.failures, null, 2));
    assert.deepEqual(result.out.pendingSteps, ["mutant"]);
  });
  it("fails a hand-listed edge", () => {
    const result = run(["--steps", stepsModule("edge", extra(`command: { npm: "check:pipeline" }, edges: ["pin.director"]`))]);
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
    graph.edges.push({ from: "pin.director", to: "ia", via: [] });
    writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
    const result = run(["--graph", file]);
    assert.equal(result.code, 1);
    assert.deepEqual([...rules(result)].sort(), ["edges.stale", "graph.stale"]);
    assert.ok(result.out.failures.some(failure => failure.rule === "edges.stale" && failure.message.includes("not derived pin.director->ia")));
  });
  it("commits a layout per node: lanes by holder, columns by stage, ranks over the derived edges", () => {
    const graph = JSON.parse(readFileSync(join(PKG, "pipeline", "graph.json"), "utf8"));
    const lanes = graph.layout.lanes.map(lane => lane.id);
    assert.ok(graph.nodes.length > 0 && graph.nodes.every(node => node.layout && node.layout.lane === node.holder.id && node.layout.stage === node.stage && Number.isInteger(node.layout.rank) && Number.isInteger(node.layout.x) && Number.isInteger(node.layout.y)), "every node carries {lane, stage, rank, x, y}");
    assert.deepEqual(lanes, graph.roster.map(entry => entry.id), "the lanes are the roster");
    assert.deepEqual(graph.layout.stages.map(stage => stage.id), ["direct.brief", "direct.make", "direct.pin", "design.brief", "design.make", "design.pin", "design.select", "publish.make", "publish.pin", "publish.assemble", "publish.check", "publish.publish"]);
    for (const node of graph.nodes) {
      const stage = graph.layout.stages.find(each => each.id === node.stage), lane = graph.layout.lanes.find(each => each.id === node.layout.lane);
      assert.ok(node.layout.x >= stage.x && node.layout.x + graph.layout.constants.nodeWidth <= stage.x + stage.width, `${node.id} sits inside its stage column`);
      assert.ok(node.layout.y >= lane.y && node.layout.y + graph.layout.constants.nodeHeight <= lane.y + lane.height, `${node.id} sits inside its lane band`);
    }
    const rank = Object.fromEntries(graph.nodes.map(node => [node.id, node.layout.rank]));
    const broken = new Set(graph.layout.cycleBreaks.map(edge => `${edge.from}->${edge.to}`));
    for (const edge of graph.edges) if (!broken.has(`${edge.from}->${edge.to}`)) assert.ok(rank[edge.to] > rank[edge.from], `${edge.from}->${edge.to} ranks forward`);
    assert.ok(graph.edges.every(edge => edge.via.every(via => typeof via.schema === "string")), "every edge names its schema");
  });
  it("fails a step with no stage (fixture)", () => {
    const result = run(["--steps", join(WRITER_FIXTURES, "stage-missing", "steps.mjs")]);
    assert.equal(result.code, 1);
    assert.ok(result.out.failures.some(failure => failure.rule === "stage.missing" && failure.message.startsWith('step "ia"')), JSON.stringify(result.out.failures));
  });
  it("fails a later-stage step that no derived edge feeds (fixture)", () => {
    const result = run(["--steps", join(WRITER_FIXTURES, "stage-orphan", "steps.mjs")]);
    assert.equal(result.code, 1);
    assert.ok(result.out.failures.some(failure => failure.rule === "stage.orphan" && failure.message.startsWith('step "capture"')), JSON.stringify(result.out.failures));
  });
  it("fails a step whose holder is not a roster entry (fixture)", () => {
    const result = run(["--steps", join(WRITER_FIXTURES, "lane-unrostered", "steps.mjs")]);
    assert.equal(result.code, 1);
    assert.ok(result.out.failures.some(failure => failure.rule === "lane.unrostered" && failure.message.startsWith('step "auditor.candidates"')), JSON.stringify(result.out.failures));
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
    // The step standard types every committed port (check:step-standard port.untyped); a mutant's untyped port is still listed.
    assert.deepEqual(run([]).out.untyped, []);
    const result = run(["--steps", stepsModule("untyped", extra(`command: { npm: "check:pipeline" }, outputs: [{ glob: "pkg:studio/generated/mutant.json" }, { glob: "arg:--out" }]`))]);
    assert.ok(result.out.untyped.some(port => port.step === "mutant" && port.port === "output"), JSON.stringify(result.out.untyped));
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
  it("fails code that writes a decision file inside the repository", () => {
    const result = run(["--scan", join(WRITER_FIXTURES, "repo-write")]);
    assert.equal(result.code, 1);
    assert.ok(foreignWriters(result).some(message => message.startsWith("workspace.config (decide) owns clossys/clossys.config.ts") && message.includes("R-PIPELINE-IS-CODE/repo-write/write-workspace-config.mjs")), JSON.stringify(result.out.failures, null, 2));
  });
  it("passes the same relative path written under os.tmpdir(): not a repository write", () => {
    const result = run(["--scan", join(WRITER_FIXTURES, "temp-write")]);
    assert.equal(result.code, 0, JSON.stringify(result.out.failures, null, 2));
  });
  it("judges a temp write by its real path: os.tmpdir() linked into the repository is a repository write", () => {
    const link = join(work, "tmp-into-repo");
    symlinkSync(REPO, link, "dir");
    const result = run(["--scan", join(WRITER_FIXTURES, "temp-write")], { ...process.env, TMPDIR: link, TMP: link, TEMP: link });
    assert.equal(result.code, 1);
    assert.ok(foreignWriters(result).some(message => message.includes("R-PIPELINE-IS-CODE/temp-write/write-workspace-config.mjs")), JSON.stringify(result.out.failures, null, 2));
  });
  const flagged = (result, dir, files) => {
    const messages = foreignWriters(result);
    for (const file of files) assert.ok(messages.some(message => message.includes(`R-PIPELINE-IS-CODE/${dir}/${file}`)), `${dir}/${file} is not flagged: ${JSON.stringify(result.out.failures, null, 2)}`);
  };
  it("fails a decision write through an impostor path: a local join, a local tmpdir, a rewritten TMPDIR", () => {
    flagged(run(["--scan", join(WRITER_FIXTURES, "path-impostor")]), "path-impostor", ["shadowed-join.mjs", "local-tmpdir.mjs", "env-tmpdir.mjs"]);
  });
  it("fails a copy or rename from outside the repository onto a decision file, or of a staged tree into it", () => {
    flagged(run(["--scan", join(WRITER_FIXTURES, "copy-in")]), "copy-in", ["copy-file.mjs", "rename-file.mjs", "stage-tree.mjs"]);
  });
  it("passes a copy that stays under os.tmpdir()", () => {
    const result = run(["--scan", join(WRITER_FIXTURES, "copy-temp")]);
    assert.deepEqual(foreignWriters(result), [], JSON.stringify(result.out.failures, null, 2));
  });
  it("fails a temp base reassigned by destructuring or as a loop target", () => {
    flagged(run(["--scan", join(WRITER_FIXTURES, "reassigned")]), "reassigned", ["destructured.mjs", "loop-target.mjs"]);
  });
  it("judges the repository path without regard to case", () => {
    const dir = join(work, "case-write");
    mkdirSync(dir);
    writeFileSync(join(dir, "upper.mjs"), `// Generated by check-pipeline.test.mjs. Never run.\nimport { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nexport const write = text => writeFileSync(join(${JSON.stringify(REPO.toUpperCase())}, "clossys/clossys.config.ts"), text);\n`);
    const result = run(["--scan", dir]);
    assert.ok(foreignWriters(result).some(message => message.includes("upper.mjs")), JSON.stringify(result.out.failures, null, 2));
  });
  it("fails a pending marker on a step that already landed", () => {
    const body = `STEPS = STEPS.map(step => step.id === "director.check" ? { ...step, pending: { branch: "claude/x", change: "adds" } } : step);`;
    const result = run(["--steps", stepsModule("stale", body)]);
    assert.ok(rules(result).has("entry.stale"), [...rules(result)].join(","));
  });
});

// Separate from the concurrent suite: this one makes a source file newer than its build.
describe("check:pipeline dist freshness", () => {
  it("fails when a records/ module the loaded dist imports is newer than its build", () => {
    const source = join(PKG, "src", "records", "slots.ts");
    const { atime, mtime } = statSync(source);
    const later = new Date(Date.now() + 60 * 60_000);
    utimesSync(source, later, later);
    try {
      const result = run([]);
      assert.equal(result.code, 1);
      assert.ok(result.out.failures.some(failure => failure.rule === "dist.missing" && failure.message.includes("src/records/slots.ts")), JSON.stringify(result.out.failures.filter(f => f.rule === "dist.missing"), null, 2));
    } finally { utimesSync(source, atime, mtime); }
  });
});
