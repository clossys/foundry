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
test("a producer cannot hide an alternate registration in a conditional early return", () => {
  const run = fixture(`function producer() { if (unknownRuntimeCondition) return { 'sections.hero': () => null }; return {}; } const registry = producer();`);
  assert.throws(run, error => error.finding?.code === "unresolved-source" && error.finding.detail.includes("one resolved return"));
});

test("real shipped surface preparation covers every planned adoption and refuses missing/duplicate native bundles", async () => {
  const { sourceModule, checkPreparedDefaultAdoptions } = await import("./lib/surface-source-identity.mjs");
  const { resolve } = await import("node:path");
  const root = resolve(import.meta.dirname, "../../.."), cache = new Map();
  const native = sourceModule(resolve(root, "packages/designer/src/catalog-core/index.ts"), cache);
  const api = sourceModule(resolve(root, "packages/designer/src/catalog-bundles.ts"), cache);
  const surfaces = sourceModule(resolve(root, "packages/designer/src/library-cli/surface-catalog.ts"), cache).foundrySurfaceCatalog();
  const prepared = await api.prepareCatalogSurfaceDefaults({
    catalog: { values: native.loadCatalog(), components: { slots: native.loadComponentRegistry().slots, fills: [] }, surfaces },
    library: { source: { id: "default-test", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-30", values: { fills: [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } },
    surfaceOptions: { packages: [], measurements: [] },
  }, { slots: surfaces.slots.map(slot => slot.id), preference: native.DEFAULT_COMPONENT_PREFERENCE });
  assert.equal(prepared.surfaceBundles.length, 14);
  const good = await checkPreparedDefaultAdoptions(root, prepared);
  assert.deepEqual(good.findings, []);
  assert.equal(good.rows.filter(row => row.matchingBundles === 1).length, 14);
  assert.ok(good.rows.some(row => row.packageCandidates === 1 && row.matchingBundles === 0));
  const first = prepared.surfaceBundles[0];
  for (const [bundles, count] of [[prepared.surfaceBundles.slice(1), 0], [[...prepared.surfaceBundles, first], 2]]) {
    const bad = await checkPreparedDefaultAdoptions(root, { ...prepared, surfaceBundles: bundles });
    assert.deepEqual(bad.findings.map(row => ({ leaf: row.leaf, op: row.op, source: row.source, matchingBundles: row.matchingBundles, packageCandidates: row.packageCandidates, detail: row.detail })), [{ leaf: first.slot, op: "adopt", source: "foundry", matchingBundles: count, packageCandidates: 0, detail: "surfaces: S2 unique bundle required" }]);
  }
  assert.deepEqual((await checkPreparedDefaultAdoptions(root, prepared)).findings, []);
});

test("registration records reject duplicate fields before Object.freeze or spreads flatten them", async () => {
  const { requireUniqueRecord } = await import("./lib/surface-source-identity.mjs");
  for (const source of ["Object.freeze({ fills: [], fills: [] })", "Object.freeze({ ...{ fills: [] }, fills: [] })", "{ input: {}, surfaceBundles: [], ...{ surfaceBundles: [] } }"]) {
    const file = "/fixture/record.ts", host = ts.createCompilerHost({});
    host.getSourceFile = name => name === file ? ts.createSourceFile(file, `const record = ${source};`, ts.ScriptTarget.Latest, true) : undefined;
    const program = ts.createProgram([file], {}, host), resolver = createRegistryResolver(program, "/fixture");
    const expression = program.getSourceFile(file).statements[0].declarationList.declarations[0].initializer;
    assert.throws(() => requireUniqueRecord(resolver, expression), error => error.finding?.code === "shadowed-registration");
  }
});
