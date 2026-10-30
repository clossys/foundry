import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const scratch = path.join(repository, "coverage/tmp/a290-proc1/runner-tests");
fs.mkdirSync(scratch, { recursive: true });
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(statuses) {
  const root = fs.mkdtempSync(path.join(scratch, "integration-")), scripts = path.join(root, "packages/designer/scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(path.join(directory, "check-process-gates.mjs"), path.join(scripts, "check-process-gates.mjs"));
  ["check-one-leaf-source.mjs", "check-fill-source-imports.mjs", "check-rendered-class-rules.mjs"].forEach((name, index) => {
    if (statuses[index] === null) return;
    fs.writeFileSync(path.join(scripts, name), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(root, `gate-${index}-ran`))},'ran');console.log(JSON.stringify({gate:'fixture-${index}',inputHead:${JSON.stringify(head)},violations:[],unverified:[]}));process.exitCode=${statuses[index]};\n`);
  });
  return { root, run: (extra = []) => spawnSync(process.execPath, [path.join(scripts, "check-process-gates.mjs"), ...extra], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
}
test("collects every gate after nonzero results and fails closed", () => {
  const { root, run } = fixture([1, 2, 0]), child = run(), report = JSON.parse(child.stdout);
  assert.equal(child.status, 2); assert.deepEqual(report.gates.map(row => row.exitStatus), [1, 2, 0]);
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
  fs.writeFileSync(path.join(dist, "cli.js"), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const child = spawnSync(process.execPath, [path.join(scripts, "compose-with-process-gates.mjs"), "--", "apply"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(child.status, 2); assert.equal(fs.existsSync(marker), false);
});
