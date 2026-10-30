import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createRegistryResolver } from "./lib/surface-source-identity.mjs";

function fixture(source) {
  const file = "/fixture/registry.ts", options = { target: ts.ScriptTarget.ESNext };
  const host = ts.createCompilerHost(options), original = host.getSourceFile;
  host.getSourceFile = (name, ...args) => name === file ? ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true) : original(name, ...args);
  const program = ts.createProgram([file], options, host), resolver = createRegistryResolver(program, "/fixture");
  const declarations = program.getSourceFile(file).statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations);
  return () => resolver.evaluate(declarations.find(node => node.name.getText() === "registry").initializer);
}
const merge = `function merge(...groups) {
  const merged = {};
  for (const group of groups) for (const [leaf, entry] of Object.entries(group)) {
    if (entry.leaf !== leaf) throw new TypeError('wrong key');
    if (Object.hasOwn(merged, leaf)) throw new TypeError(leaf + ' has two renderers');
    merged[leaf] = entry;
  }
  return Object.freeze(merged);
}`.replace("leaf + ' has two renderers'", "`${leaf} has two renderers`");

test("transparent tables keep one resolved function identity across aliases", () => {
  const run = fixture(`const Render = () => null; const alias = Render;
    const group = { 'sections.hero': { leaf: 'sections.hero', render: alias } };
    const registry = Object.freeze({ ...group });`);
  assert.equal(run().entries.length, 1);
});
for (const leaf of ["sections.hero", "frames.document"]) {
  test(`${leaf}: independent competing routes are refused before merge`, () => {
    const run = fixture(`${merge}
      const original = { '${leaf}': { leaf: '${leaf}', render: () => null } };
      const competing = { '${leaf}': { leaf: '${leaf}', render: () => null } };
      const registry = merge(original, competing);`);
    assert.throws(run, error => error.finding?.code === "duplicate-implementation" && error.finding.leaf === leaf);
  });
  test(`${leaf}: a spread cannot hide a shadowed registration`, () => {
    const run = fixture(`const group = { '${leaf}': () => null };
      const registry = { ...group, '${leaf}': () => null };`);
    assert.throws(run, error => error.finding?.code === "shadowed-registration" && error.finding.leaf === leaf);
  });
}
test("fromEntries preserves competing keys before JavaScript can flatten them", () => {
  const run = fixture(`${merge}
    const registry = merge(Object.fromEntries([['sections.hero', {leaf:'sections.hero', render:()=>null}], ['sections.hero', {leaf:'sections.hero', render:()=>null}]]));`);
  assert.throws(run, error => error.finding?.code === "duplicate-implementation" && error.finding.leaf === "sections.hero");
});
test("missing and dynamic unknown registry sources fail closed", () => {
  for (const expression of ["missingProducer()", "JSON.parse('{}')", "{...missingGroup}"]) {
    assert.throws(fixture(`const registry = ${expression};`), error => error.finding?.code === "unresolved-source");
  }
});
