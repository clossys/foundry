import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
// Fixtures run git in the checkout, so they stay inside it, under the ignored coverage/tmp/ like
// the sibling gate tests: an unignored write dirties the tree emit-studio-check-inputs requires clean.
const scratch = path.join(repository, "coverage/tmp/p0-gate-process/runner-tests");
fs.mkdirSync(scratch, { recursive: true });
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const shipped = JSON.parse(fs.readFileSync(path.join(directory, "process-gates.json"), "utf8"));
// Aggregation fixtures block on every gate unless a test passes its own modes.
const blocking = { ...shipped, gates: shipped.gates.map(({ requires, whenAbsent, ...row }) => ({ ...row, mode: "block" })) };
function fixture(statuses, candidateStatus = 0, config = blocking) {
  const root = fs.mkdtempSync(path.join(scratch, "integration-")), scripts = path.join(root, "packages/designer/scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(path.join(directory, "check-process-gates.mjs"), path.join(scripts, "check-process-gates.mjs"));
  if (config) fs.writeFileSync(path.join(scripts, "process-gates.json"), JSON.stringify(config));
  ["check-one-leaf-source.mjs", "check-fill-source-imports.mjs", "check-rendered-class-rules.mjs"].forEach((name, index) => {
    if (statuses[index] === null) return;
    fs.writeFileSync(path.join(scripts, name), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(root, `gate-${index}-ran`))},'ran');console.log(JSON.stringify({gate:'fixture-${index}',inputHead:${JSON.stringify(head)},violations:[],unverified:[]}));process.exitCode=${statuses[index]};\n`);
  });
  fs.writeFileSync(path.join(scripts, "check-default-candidates.mjs"), `import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(path.join(root, "default-runs"))},'ran\\n');console.log(JSON.stringify({schemaVersion:1,sourceHead:${JSON.stringify(head)},status:${JSON.stringify(["complete", "missing-candidates", "invalid-input"][candidateStatus])},missing:${JSON.stringify(candidateStatus === 1 ? [{slot:"themes.spacing",reasons:["no implementation candidate in the default source"]}] : [])},invalid:${JSON.stringify(candidateStatus === 2 ? ["Invalid native policy"] : [])}}));process.exitCode=${candidateStatus};\n`);
  return { root, run: (extra = []) => spawnSync(process.execPath, [path.join(scripts, "check-process-gates.mjs"), ...extra], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
}
test("collects every gate after nonzero results and fails closed", () => {
  const { root, run } = fixture([1, 2, 0]), child = run(), report = JSON.parse(child.stdout);
  assert.equal(child.status, 2); assert.deepEqual(report.gates.map(row => row.exitStatus), [1, 2, 0, 0]);
  for (const index of [0, 1, 2]) assert.equal(fs.existsSync(path.join(root, `gate-${index}-ran`)), true);
});
test("missing gate remains red while subsequent gates run", () => {
  const { root, run } = fixture([0, null, 0]), child = run();
  assert.equal(child.status, 2); assert.equal(JSON.parse(child.stdout).gates[1].exitStatus, 2);
  assert.equal(fs.existsSync(path.join(root, "gate-2-ran")), true);
});
test("stale source head refuses all execution", () => {
  const { root, run } = fixture([0, 0, 0]), child = run(["--source-head", "0".repeat(40)]);
  assert.equal(child.status, 2); assert.match(JSON.parse(child.stdout).unverified[0], /Stale/);
  assert.equal(fs.existsSync(path.join(root, "gate-0-ran")), false);
});
test("aggregate forwards render manifest to the HTML child without adding source mode", () => {
  const { root, run } = fixture([0, 0, 0]);
  const script = path.join(root, "packages/designer/scripts/check-rendered-class-rules.mjs");
  fs.appendFileSync(script, `fs.writeFileSync(${JSON.stringify(path.join(root, "render-args.json"))}, JSON.stringify(process.argv.slice(2)));\n`);
  const child = run(["--html", "native.html", "--css", "native.css", "--render-manifest", "native-manifest.json"]);
  assert.equal(child.status, 0, child.stderr);
  const args = JSON.parse(fs.readFileSync(path.join(root, "render-args.json"), "utf8"));
  assert.deepEqual(args.slice(0, 6), ["--html", "native.html", "--css", "native.css", "--render-manifest", "native-manifest.json"]);
  assert.equal(args.includes("--source"), false);
});
test("compose refuses to invoke the library when a process gate fails", () => {
  const { root } = fixture([0, 0, 0]), scripts = path.join(root, "packages/designer/scripts"), dist = path.join(root, "packages/designer/dist/library-cli");
  fs.copyFileSync(path.join(directory, "compose-with-process-gates.mjs"), path.join(scripts, "compose-with-process-gates.mjs"));
  fs.writeFileSync(path.join(scripts, "check-process-gates.mjs"), "process.exitCode=2;\n");
  fs.mkdirSync(dist, { recursive: true });
  const marker = path.join(root, "library-ran");
  fs.writeFileSync(path.join(dist, "cli.js"), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const child = spawnSync(process.execPath, [path.join(scripts, "compose-with-process-gates.mjs"), "--", "apply"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(child.status, 2); assert.equal(fs.existsSync(marker), false);
});

test("default completeness failures retain slot evidence and run after every PROC gate", () => {
  const { root, run } = fixture([1, 2, 0], 1), child = run(), report = JSON.parse(child.stdout);
  assert.equal(child.status, 2);
  const defaults = report.gates.find(row => row.gate === "default-candidates");
  assert.equal(defaults.exitStatus, 1);
  assert.equal(defaults.missing[0].slot, "themes.spacing");
  assert.deepEqual(defaults.invalid, []);
  assert.equal(fs.readFileSync(path.join(root, "default-runs"), "utf8"), "ran\n");
});
test("invalid default policy fails process even when the other gates pass", () => {
  const { run } = fixture([0, 0, 0], 2), child = run(), report = JSON.parse(child.stdout);
  assert.equal(child.status, 2);
  assert.deepEqual(report.gates[3].invalid, ["Invalid native policy"]);
});
test("missing default gate fails process", () => {
  const { root, run } = fixture([0, 0, 0]);
  fs.renameSync(path.join(root, "packages/designer/scripts/check-default-candidates.mjs"), path.join(root, "saved-default-gate.mjs"));
  const child = run();
  assert.equal(child.status, 2);
  assert.equal(JSON.parse(child.stdout).gates[3].exitStatus, 2);
});
test("compose checks default completeness exactly once through process before invoking the library", () => {
  const { root } = fixture([0, 0, 0]), scripts = path.join(root, "packages/designer/scripts"), dist = path.join(root, "packages/designer/dist/library-cli");
  fs.copyFileSync(path.join(directory, "compose-with-process-gates.mjs"), path.join(scripts, "compose-with-process-gates.mjs"));
  fs.mkdirSync(dist, { recursive: true });
  const marker = path.join(root, "library-ran");
  fs.writeFileSync(path.join(dist, "cli.js"), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const child = spawnSync(process.execPath, [path.join(scripts, "compose-with-process-gates.mjs"), "--", "apply"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(fs.existsSync(marker), true);
  assert.equal(fs.readFileSync(path.join(root, "default-runs"), "utf8"), "ran\n");
});

test("default child cannot report complete with unresolved candidates", () => {
  const { root, run } = fixture([0, 0, 0]);
  const script = path.join(root, "packages/designer/scripts/check-default-candidates.mjs");
  fs.writeFileSync(script, `console.log(JSON.stringify({schemaVersion:1,sourceHead:${JSON.stringify(head)},status:'complete',missing:[{slot:'themes.spacing'}],invalid:[]}));\n`);
  const child = run();
  assert.equal(child.status, 2);
  assert.equal(JSON.parse(child.stdout).gates[3].exitStatus, 2);
});
test("default child with a stale source head fails closed", () => {
  const { root, run } = fixture([0, 0, 0]);
  const script = path.join(root, "packages/designer/scripts/check-default-candidates.mjs");
  fs.writeFileSync(script, `console.log(JSON.stringify({schemaVersion:1,sourceHead:'${"0".repeat(40)}',status:'complete',missing:[],invalid:[]}));\n`);
  const child = run();
  assert.equal(child.status, 2);
  assert.equal(JSON.parse(child.stdout).gates[3].exitStatus, 2);
});

// Fake-gates audit row 12: `--studio` returned 0 on any red gate, so Studio composition never stopped on one.
test('Studio mode keeps full child reports and exits with the strict status: a red gate blocks composition', () => {
  const { run } = fixture([1, 2, 1], 1), strict = run(), rendered = run(['--studio']);
  assert.equal(strict.status, 2);
  assert.equal(rendered.status, 2, rendered.stderr);
  const report = JSON.parse(rendered.stdout);
  assert.equal(report.mode, undefined);
  assert.equal(report.blocking, undefined);
  assert.equal(report.ok, false);
  assert.equal(report.exitStatus, 2);
  assert.deepEqual(report.gates.map(row => row.exitStatus), [1, 2, 1, 1]);
  assert.ok(report.gates.every(row => row.blocking === undefined && row.report));
  assert.equal(report.gates[3].report.missing[0].slot, 'themes.spacing');
});

test('Studio mode exits 1 on violations alone and 0 only when every gate is verified', () => {
  assert.equal(fixture([1, 0, 0]).run(['--studio']).status, 1);
  assert.equal(fixture([0, 0, 0]).run(['--studio']).status, 0);
});

test('Studio preserves missing legacy check diagnostics and fails closed', () => {
  const { run } = fixture([null, 0, 0]), child = run(['--studio']);
  assert.equal(child.status, 2);
  const report = JSON.parse(child.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.gates[0].exitStatus, 2);
  assert.equal(report.gates[0].blocking, undefined);
  assert.deepEqual(report.gates[0].unverified, ['Missing process gate script']);
});

const withModes = modes => ({ ...blocking, gates: blocking.gates.map(row => ({ ...row, ...(modes[row.gate] ?? {}) })) });
test("a report-mode gate's violations are listed under reports and do not fail the run", () => {
  const { run } = fixture([1, 0, 1], 0, withModes({ "PROC-1": { mode: "report" }, "PROC-3": { mode: "report" } })), child = run(), report = JSON.parse(child.stdout);
  assert.equal(child.status, 0, child.stdout);
  assert.deepEqual(report.reports.map(row => row.gate), ["PROC-1", "PROC-3"]);
  assert.ok(report.reports.every(row => row.reason));
});
test("a block-mode gate's violations still fail beside report-mode gates", () => {
  const { run } = fixture([1, 1, 0], 0, withModes({ "PROC-1": { mode: "report" } }));
  assert.equal(run().status, 1);
});
test("a broken report-mode gate fails in every mode", () => {
  assert.equal(fixture([2, 0, 0], 0, withModes({ "PROC-1": { mode: "report" } })).run().status, 2);
  assert.equal(fixture([null, 0, 0], 0, withModes({ "PROC-1": { mode: "report" } })).run().status, 2);
});
test("a gate whose native inputs are all absent is not applicable and does not run; any input runs it", () => {
  const modes = withModes({ "PROC-2": { requires: ["site", "library", "contract"], whenAbsent: "No emitted library at this caller." } });
  const absent = fixture([0, 2, 0], 0, modes), child = absent.run(), report = JSON.parse(child.stdout);
  assert.equal(child.status, 0, child.stdout);
  assert.equal(report.gates[1].state, "not-applicable");
  assert.equal(report.gates[1].reason, "No emitted library at this caller.");
  assert.equal(fs.existsSync(path.join(absent.root, "gate-1-ran")), false);
  const partial = fixture([0, 2, 0], 0, modes);
  assert.equal(partial.run(["--site", "site"]).status, 2);
  assert.equal(fs.existsSync(path.join(partial.root, "gate-1-ran")), true);
});
test("a missing or malformed gate config fails closed before any gate runs", () => {
  const missing = fixture([0, 0, 0], 0, null);
  assert.equal(missing.run().status, 2);
  assert.equal(fs.existsSync(path.join(missing.root, "gate-0-ran")), false);
  assert.equal(fixture([0, 0, 0], 0, withModes({ "PROC-1": { reason: "" } })).run().status, 2);
  assert.equal(fixture([0, 0, 0], 0, withModes({ "PROC-1": { mode: "warn" } })).run().status, 2);
  assert.equal(fixture([0, 0, 0], 0, { ...blocking, gates: blocking.gates.slice(1) }).run().status, 2);
});
test("the shipped config gives every report-mode gate a reason and blocks on the wiring gates", () => {
  const modes = Object.fromEntries(shipped.gates.map(row => [row.gate, row.mode]));
  assert.deepEqual(modes, { "PROC-1": "report", "PROC-2": "block", "PROC-3": "report", "default-candidates": "block" });
  assert.ok(shipped.gates.every(row => row.reason.length > 40));
});
