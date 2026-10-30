import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const scratch = path.join(repository, "tmp/p0-gate-process/runner-tests");
fs.mkdirSync(scratch, { recursive: true });
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(statuses, candidateStatus = 0) {
  const root = fs.mkdtempSync(path.join(scratch, "integration-")), scripts = path.join(root, "packages/designer/scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(path.join(directory, "check-process-gates.mjs"), path.join(scripts, "check-process-gates.mjs"));
  ["check-one-leaf-source.mjs", "check-fill-source-imports.mjs", "check-rendered-class-rules.mjs"].forEach((name, index) => {
    if (statuses[index] === null) return;
    fs.writeFileSync(path.join(scripts, name), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(root, `gate-${index}-ran`))},'ran');console.log(JSON.stringify({gate:'fixture-${index}',inputHead:${JSON.stringify(head)},violations:[],unverified:[]}));process.exitCode=${statuses[index]};\n`);
  });
  fs.writeFileSync(path.join(scripts, "check-default-candidates.mjs"), `import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(path.join(root, "default-runs"))},'ran\\n');console.log(JSON.stringify({schemaVersion:1,sourceHead:${JSON.stringify(head)},status:${JSON.stringify(["complete", "missing-candidates", "invalid-input"][candidateStatus])},missing:${JSON.stringify(candidateStatus === 1 ? [{slot:"tokens.spacing",reasons:["no implementation candidate in the default source"]}] : [])},invalid:${JSON.stringify(candidateStatus === 2 ? ["Invalid native policy"] : [])}}));process.exitCode=${candidateStatus};\n`);
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
  assert.equal(defaults.missing[0].slot, "tokens.spacing");
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
  fs.writeFileSync(script, `console.log(JSON.stringify({schemaVersion:1,sourceHead:${JSON.stringify(head)},status:'complete',missing:[{slot:'tokens.spacing'}],invalid:[]}));\n`);
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

test('Studio reports retain all strict PROC and DF failures without blocking render composition', () => {
  const { run } = fixture([1, 2, 1], 1), strict = run(), rendered = run(['--studio']);
  assert.equal(strict.status, 2);
  assert.equal(rendered.status, 0, rendered.stderr);
  const report = JSON.parse(rendered.stdout);
  assert.equal(report.mode, 'studio-report-only');
  assert.equal(report.ok, false);
  assert.equal(report.exitStatus, 2);
  assert.deepEqual(report.gates.map(row => row.exitStatus), [1, 2, 1, 1]);
  assert.ok(report.gates.every(row => row.blocking === false && row.report));
  assert.equal(report.gates[3].report.missing[0].slot, 'tokens.spacing');
});

test('Studio preserves missing legacy check diagnostics without a fabricated pass', () => {
  const { run } = fixture([null, 0, 0]), child = run(['--studio']);
  assert.equal(child.status, 0);
  const report = JSON.parse(child.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.gates[0].exitStatus, 2);
  assert.equal(report.gates[0].blocking, false);
  assert.deepEqual(report.gates[0].unverified, ['Missing process gate script']);
});
