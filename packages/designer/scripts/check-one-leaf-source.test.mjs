import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkOneLeafSource } from "./check-one-leaf-source.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = path.join(repository, "coverage/tmp/a290-proc1/tests");
fs.mkdirSync(scratch, { recursive: true });
function fixture() {
  const root = fs.mkdtempSync(path.join(scratch, "inventory-"));
  const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof text === "string" ? text : JSON.stringify(text)); };
  write("packages/publisher/package.json", { name: "@example/publisher", exports: {} });
  write("packages/publisher/src/index.ts", "export {};\n");
  write("packages/designer/package.json", { name: "@example/designer", exports: { "./components": "./dist/components.js", "./sections": "./dist/sections.js", "./frames": "./dist/frames.js" } });
  const roster = { never: [], custom: { id: "custom" } };
  for (const [layer, name] of [["components", "Control"], ["sections", "Section"], ["frames", "Frame"]]) {
    const leaf = `${layer}.example`;
    write(`packages/designer/src/catalog/slots/${layer}.json`, [{ id: leaf, layer }]);
    roster[layer] = [{ leaves: [leaf], offers: [{ source: "foundry", leaves: [leaf] }] }];
    write(`packages/designer/src/${layer}.tsx`, `export function ${name}(props: any) { return <div className="example">{props.children}</div>; }\n`);
    write(`packages/designer/src/catalog/fills/foundry/${leaf}.json`, { $extensions: { "com.clossys.fill": { id: `foundry/${leaf}`, slot: leaf, source: "foundry", mode: "implementation" } }, [layer]: { example: { slot: leaf, source: "foundry", impl: { kind: "package", module: `@example/designer/${layer}`, export: name } } } });
  }
  write("packages/designer/src/catalog/rules/source-roster.json", roster);
  return { root, write };
}

test("one real native implementation per declared leaf is verified", () => {
  const { root } = fixture(), report = checkOneLeafSource(root);
  assert.equal(report.ok, true); assert.equal(report.coverage.leaves, 3);
  assert.equal(report.inventory.every(row => row.implementations.length === 1), true);
  assert.equal(report.inputHashes.every(row => /^[a-f0-9]{64}$/.test(row.sha256)), true);
});
test("mutation: adding one copied implementation produces exactly one duplicate violation", () => {
  const { root, write } = fixture();
  write("packages/designer/src/copied-control.tsx", 'export function Control() { return <button className="copy" />; }\n');
  const report = checkOneLeafSource(root);
  assert.equal(report.exitStatus, 1);
  assert.deepEqual(report.violations.map(row => [row.rule, row.leaf]), [["duplicate-leaf-source", "components.example"]]);
  assert.equal(report.inventory.find(row => row.leaf === "components.example").implementations.length, 2);
  const child = spawnSync(process.execPath, [path.join(repository, "packages/designer/scripts/check-one-leaf-source.mjs"), "--root", root, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(child.status, 1); assert.equal(JSON.parse(child.stdout).violations.length, 1);
});
test("CLI refuses a stale source head before inspecting source", () => {
  const child = spawnSync(process.execPath, [path.join(repository, "packages/designer/scripts/check-one-leaf-source.mjs"), "--source-head", "0".repeat(40), "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(child.status, 2); assert.match(JSON.parse(child.stdout).unverified[0], /current exact repository HEAD/);
});
test("public reexports, direct aliases and forwarding shims retain one identity", () => {
  const { root, write } = fixture();
  write("packages/designer/src/barrel.ts", 'export { Control } from "./components.js";\n');
  write("packages/designer/src/alias.ts", 'import { Control as Original } from "./components.js"; export const Control = Original;\n');
  write("packages/designer/src/shim.tsx", 'import { Control as Original } from "./components.js"; export function Control(props: any) { return <Original {...props} />; }\n');
  assert.equal(checkOneLeafSource(root).ok, true);
});
test("mutation: a separately registered runtime body is an additional implementation", () => {
  const { root, write } = fixture();
  write("packages/designer/src/runtime/registry.tsx", 'export const sections = { "sections.example": { render: () => <section className="duplicate" /> } };\n');
  const report = checkOneLeafSource(root);
  assert.deepEqual(report.violations.map(row => [row.rule, row.leaf]), [["duplicate-leaf-source", "sections.example"]]);
});
test("mutation: missing catalog, empty catalog and missing source input fail closed", () => {
  const missing = fixture();
  fs.renameSync(path.join(missing.root, "packages/designer/src/catalog/slots/frames.json"), path.join(missing.root, "held-frames.json"));
  assert.throws(() => checkOneLeafSource(missing.root));
  const empty = fixture(); empty.write("packages/designer/src/catalog/slots/frames.json", []);
  assert.throws(() => checkOneLeafSource(empty.root), /empty frames/);
  const source = fixture(); fs.renameSync(path.join(source.root, "packages/designer/src/components.tsx"), path.join(source.root, "held-components.tsx"));
  const report = checkOneLeafSource(source.root);
  assert.equal(report.exitStatus, 1); assert.equal(report.violations.some(row => row.rule === "unresolved-fill-source"), true);
});
test("metadata-only ports and removed descriptors remain explicit failures", () => {
  const { root, write } = fixture();
  write("packages/designer/src/sections.tsx", 'export const Section = { source: "metadata-only" };\n');
  fs.renameSync(path.join(root, "packages/designer/src/catalog/fills/foundry/frames.example.json"), path.join(root, "held-descriptor.json"));
  const report = checkOneLeafSource(root);
  assert.equal(report.ok, false);
  assert.equal(report.violations.some(row => row.rule === "unresolved-fill-source" && row.leaf === "sections.example"), true);
  assert.equal(report.violations.some(row => row.rule === "missing-offered-fill" && row.leaf === "frames.example"), true);
});
test("mutation: a removed source-roster row cannot yield a clean catalog", () => {
  const { root, write } = fixture();
  const rosterFile = path.join(root, "packages/designer/src/catalog/rules/source-roster.json"), roster = JSON.parse(fs.readFileSync(rosterFile));
  roster.components[0].leaves = [];
  write("packages/designer/src/catalog/rules/source-roster.json", roster);
  assert.equal(checkOneLeafSource(root).violations.some(row => row.rule === "missing-roster-leaf" && row.leaf === "components.example"), true);
});

test("H3 component scope ignores surface duplicates and rejects a surface CLI scope", () => {
  const { root, write } = fixture();
  write("packages/designer/src/copied-section.tsx", 'export function Section() { return <section className="copy" />; }');
  const report = checkOneLeafSource(root, ["components"]);
  assert.equal(report.ok, true); assert.equal(report.scope.kind, "components");
  assert.deepEqual(report.scope.leaves, ["components.example"]);
  const script = path.join(repository, "packages/designer/scripts/check-one-leaf-source.mjs");
  const invalid = spawnSync(process.execPath, [script, "--scope", "sections", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(invalid.status, 2); assert.match(JSON.parse(invalid.stdout).unverified[0], /H1 owns sections and frames/);
  const valid = spawnSync(process.execPath, [script, "--root", root, "--scope", "components", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(valid.status, 0, valid.stderr); assert.equal(JSON.parse(valid.stdout).scope.kind, "components");
  write("packages/designer/src/copied-control.tsx", 'export function Control() { return <button className="copy" />; }');
  const duplicate = checkOneLeafSource(root, ["components"]);
  assert.equal(duplicate.exitStatus, 1); assert.deepEqual(duplicate.violations.map(row => row.leaf), ["components.example"]);
});
