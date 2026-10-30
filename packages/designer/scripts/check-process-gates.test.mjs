import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const scratch = path.join(repository, "coverage/tmp/a290-proc1/runner-tests");
fs.mkdirSync(scratch, { recursive: true });
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(statuses) {
  const root = fs.mkdtempSync(path.join(scratch, "integration-")), scripts = path.join(root, "packages/designer/scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(path.join(directory, "check-process-gates.mjs"), path.join(scripts, "check-process-gates.mjs"));
  ["check-one-leaf-source.mjs", "check-fill-source-imports.mjs", "check-rendered-class-rules.mjs"].forEach((name, index) => {
    if (statuses[index] === null) return;
    const report = [{ gate: "PROC-1", inputHead: head, scope: { kind: "components", layers: ["components"] }, violations: [], unverified: [] }, { gate: "fill-source-imports", inputHead: head, scope: { kind: "native-consumer" }, violations: [], unverified: [] }, { gate: "rendered-class-rules", sourceHead: head, scope: { sourceFiles: [], htmlFiles: [], cssFiles: [] }, counts: { checked: 0, markers: 0, missing: 0, unsupported: 0, unverified: 0 }, violations: [], coverageUnverified: [] }][index];
    fs.writeFileSync(path.join(scripts, name), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(root, `gate-${index}-ran`))},'ran');console.log(JSON.stringify(${JSON.stringify(report)}));process.exitCode=${statuses[index]};\n`);
  });
  if (statuses[3] !== null) {
    const status = statuses[3] ?? 0;
    const surface = { gate: "PROC-1", scope: "sections,frames", head, tree, sourceState: "committed", status: status ? "FAIL" : "PASS", counts: { registered: 1, sections: 1, frames: 0, resolved: 1, packageRoutes: 1, nativeRoutes: 0, catalogOffers: 1 }, findings: status ? [{ code: "duplicate-implementation", leaf: "sections.example", detail: "Competing source" }] : [], inventory: [{ leaf: "sections.example", status: status ? "FAIL" : "PASS", offers: [], findings: [] }], sources: [{ file: "fixture.ts", sha256: "a".repeat(64) }], nativeOutputs: [], sourceHash: "b".repeat(64) };
    surface.sourceHash = createHash("sha256").update(JSON.stringify({ sources: surface.sources, nativeOutputs: surface.nativeOutputs })).digest("hex");
    fs.writeFileSync(path.join(scripts, "check-surface-source-identity.mjs"), `import fs from 'node:fs';const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(path.join(root, "gate-3-ran"))},JSON.stringify(args));if(args[0]!=='--source'||args[1]!==${JSON.stringify(head)}||args[2]!=='--report'||args.length!==4)throw new Error('Invalid surface CLI');const report=${JSON.stringify(surface)};report.argv=['node','packages/designer/scripts/check-surface-source-identity.mjs',...args];fs.writeFileSync(args[3],JSON.stringify(report));console.log(JSON.stringify({gate:report.gate,scope:report.scope,head:report.head,status:report.status,counts:report.counts,findings:report.findings,report:args[3]}));process.exitCode=${status};\n`);
  }
  return { root, run: (extra = []) => spawnSync(process.execPath, [path.join(scripts, "check-process-gates.mjs"), ...extra], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
}
test("collects every gate after nonzero results and fails closed", () => {
  const { root, run } = fixture([1, 2, 0]), child = run(), report = JSON.parse(child.stdout);
  assert.equal(child.status, 2); assert.deepEqual(report.gates.map(row => row.exitStatus), [1, 0, 2, 0]);
  for (const index of [0, 1, 2, 3]) assert.equal(fs.existsSync(path.join(root, `gate-${index}-ran`)), true);
});
test("missing gate remains red while subsequent gates run", () => {
  const { root, run } = fixture([0, null, 0]), child = run();
  assert.equal(child.status, 2); assert.equal(JSON.parse(child.stdout).gates[2].exitStatus, 2);
  assert.equal(fs.existsSync(path.join(root, "gate-2-ran")), true);
  assert.equal(fs.existsSync(path.join(root, "gate-3-ran")), true);
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
test("compose collects all gates before refusing library delegation", () => {
  const { root } = fixture([7, 0, 0]), scripts = path.join(root, "packages/designer/scripts"), dist = path.join(root, "packages/designer/dist/library-cli");
  fs.copyFileSync(path.join(directory, "compose-with-process-gates.mjs"), path.join(scripts, "compose-with-process-gates.mjs"));
  fs.mkdirSync(dist, { recursive: true });
  const marker = path.join(root, "library-ran");
  fs.writeFileSync(path.join(dist, "cli.js"), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const child = spawnSync(process.execPath, [path.join(scripts, "compose-with-process-gates.mjs"), "--", "apply"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(child.status, 2); assert.equal(fs.existsSync(marker), false);
  for (const index of [0, 1, 2, 3]) assert.equal(fs.existsSync(path.join(root, `gate-${index}-ran`)), true);
});
test("four native reports pass and retain independent component and surface scope", () => {
  const { root, run } = fixture([0, 0, 0]), child = run(["--report-dir", path.join(root, "reports")]), report = JSON.parse(child.stdout);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.deepEqual(report.gates.map(row => row.id), ["PROC-1-components", "PROC-1-surfaces", "PROC-2", "PROC-3"]);
  assert.equal(report.gates[0].scope.kind, "components"); assert.equal(report.gates[1].scope, "sections,frames");
  const surface = JSON.parse(fs.readFileSync(report.gates[1].reportPath, "utf8"));
  assert.equal(surface.inventory.length, 1); assert.equal(surface.tree, tree);
  assert.ok(report.gates.every(row => fs.existsSync(row.reportPath)));
});
test("missing components and missing surfaces each fail closed while remaining gates run", () => {
  for (const statuses of [[null, 0, 0], [0, 0, 0, null]]) {
    const { root, run } = fixture(statuses), child = run();
    assert.equal(child.status, 2); assert.equal(JSON.parse(child.stdout).gates.length, 4);
    for (const index of statuses[0] === null ? [1, 2, 3] : [0, 1, 2]) assert.equal(fs.existsSync(path.join(root, `gate-${index}-ran`)), true);
  }
});
test("surface violations remain red without short circuiting remaining gates", () => {
  const { root, run } = fixture([0, 0, 0, 1]), child = run(), report = JSON.parse(child.stdout);
  assert.equal(child.status, 1); assert.equal(report.gates[1].violations, 1);
  for (const index of [0, 1, 2, 3]) assert.equal(fs.existsSync(path.join(root, `gate-${index}-ran`)), true);
});
test("surface native parser rejects stale, incomplete, invalid and absent full reports", () => {
  const mutations = ["report.head='0'.repeat(40)", "report.tree='0'.repeat(40)", "report.scope='components'", "report.gate='fixture'", "report.sourceState='worktree'", "report.counts.registered='1'", "delete report.inventory", "delete report.sources", "delete report.nativeOutputs", "delete report.sourceHash", "report.sourceHash='c'.repeat(64)", "report.sources=[{}]", "report.inventory=[{}]", "report.argv=[]", "report.findings=[{}]", "report.status='FAIL'"];
  for (const mutation of [...mutations, "invalid-json", "missing-report"]) {
    const { root, run } = fixture([0, 0, 0]), script = path.join(root, "packages/designer/scripts/check-surface-source-identity.mjs");
    let source = fs.readFileSync(script, "utf8");
    source = mutation === "missing-report" ? source.replace("fs.writeFileSync(args[3],JSON.stringify(report));", "") : mutation === "invalid-json" ? source.replace("JSON.stringify(report));console.log", "'invalid');console.log") : source.replace("fs.writeFileSync(args[3]", `${mutation};fs.writeFileSync(args[3]`);
    fs.writeFileSync(script, source);
    const child = run(); assert.equal(child.status, 2, mutation + child.stdout);
    assert.equal(JSON.parse(child.stdout).gates[1].exitStatus, 2, mutation);
    assert.equal(fs.existsSync(path.join(root, "gate-2-ran")), true, mutation);
  }
});
test("invalid earlier JSON still attempts surfaces and both remaining children", () => {
  const { root, run } = fixture([0, 0, 0]);
  fs.writeFileSync(path.join(root, "packages/designer/scripts/check-one-leaf-source.mjs"), "console.log('null');\n");
  const child = run(); assert.equal(child.status, 2);
  for (const index of [1, 2, 3]) assert.equal(fs.existsSync(path.join(root, `gate-${index}-ran`)), true);
});
