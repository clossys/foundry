import { test } from "node:test";
import assert from "node:assert/strict";
import { createSurfaceSourceScanner } from "./lib/surface-source-scan.mjs";

const sources = {
  "packages/ui/src/blocks/index.ts": 'export { Panel } from "./Panel.js";',
  "packages/ui/src/blocks/Panel.tsx": 'import { Button as Action } from "../components/index.js"; import * as UI from "../components/index.js"; import { Button as Fake } from "foreign-ui"; import type { Options } from "./types.js"; const classes="text-ink"; function helper(){ return <Action/>; } export const Unused = () => <span className="text-unrelated"/>; export function Panel(){ return <section className={classes}>{helper()}<UI.Button/><Fake/>{import("./dynamic.js")}</section>; }',
  "packages/ui/src/components/index.ts": 'export { Button } from "./Button.js";',
  "packages/ui/src/components/Button.tsx": 'export function Button(){ return <button className="text-button-internals"/>; }',
};
const scanner = () => {
  const graph = createSurfaceSourceScanner({ read: path => sources[path], packages: { "@example/ui": "packages/ui/src" } });
  graph.addOwner(graph.pointer("@example/ui", "./components#Button"), "components.button");
  return graph;
};
test("resolves aliased and namespace imports to exact descriptor source identities at primitive boundaries", () => {
  const result = scanner().scan({ fill: "foundry/sections.panel", packageName: "@example/ui", pointer: "./blocks#Panel" });
  assert.equal(result.resolvedImports["packages/ui/src/blocks/Panel.tsx:../components/index.js#Button"], "components.button");
  assert.deepEqual(result.files.map(file => file.path), ["packages/ui/src/blocks/Panel.tsx"]);
  assert.match(result.files[0].content, /text-ink/);
  assert.doesNotMatch(result.files[0].content, /text-unrelated|text-button-internals/);
  assert.match(result.files[0].content, /Button as Action/);
  assert.ok(result.unresolved.some(row => row.evidence.includes("dynamic import")));
});
test("never binds a familiar name from a foreign module and reports missing source roots explicitly", () => {
  const graph = scanner(), result = graph.scan({ fill: "foundry/sections.panel", packageName: "@example/ui", pointer: "./blocks#Panel" });
  assert.equal(result.resolvedImports["packages/ui/src/blocks/Panel.tsx:foreign-ui#Button"], undefined);
  const missing = graph.scan({ fill: "foreign/frames.panel", packageName: "@example/missing", pointer: "./shell#Panel" });
  assert.deepEqual(missing.files, []);
  assert.ok(missing.unresolved.some(row => row.evidence.includes("unresolved source")));
});

const leafSources = {
  "packages/ui/src/blocks/index.ts": 'export { Banner } from "./Banner.js"; export { Risky } from "./Risky.js";',
  "packages/ui/src/runtime/index.ts": 'export { componentLeaf } from "./component-leaf.js";',
  "packages/ui/src/runtime/component-leaf.tsx": 'export function componentLeaf(leaf, part){ return leaf; }',
  "packages/ui/src/runtime/lookalike.ts": 'export function componentLeaf(leaf){ return leaf; }',
  "packages/ui/src/blocks/Banner.tsx": 'import { componentLeaf as leaf } from "../runtime/index.js"; import * as Runtime from "../runtime/component-leaf.js"; import { componentLeaf as fake } from "../runtime/lookalike.js";'
    + ' const Content = leaf<typeof import("../components/Content.js").Content>("components.content"); const Item = Runtime.componentLeaf(`components.menu`, "Item"); const Fake = fake("components.badge");'
    + ' export function Banner(){ return <section><Content/><Item/><Fake/></section>; }',
  "packages/ui/src/blocks/Risky.tsx": 'import { componentLeaf } from "../runtime/component-leaf.js"; const id = "components.content"; const Dynamic = componentLeaf(id); const Unknown = componentLeaf("components.nope");'
    + ' const Shadowed = componentLeaf("components.menu"); const pass = componentLeaf; function Inner({ Shadowed }){ return <Shadowed/>; }'
    + ' export function Risky(){ const Local = componentLeaf("components.content"); return <div><Dynamic/><Unknown/><Inner/><Local/>{pass}</div>; }',
};
const leafScanner = (register = true) => {
  const graph = createSurfaceSourceScanner({ read: path => leafSources[path], packages: { "@example/ui": "packages/ui/src" } });
  if (register) graph.addLeafFactory(graph.pointer("@example/ui", "./runtime/component-leaf#componentLeaf"), ["components.content", "components.menu", "components.badge"]);
  return graph;
};
test("resolves a literal component leaf from the exact factory export through aliased and namespace calls", () => {
  const result = leafScanner().scan({ fill: "foundry/sections.banner", packageName: "@example/ui", pointer: "./blocks#Banner" });
  assert.deepEqual(result.resolvedLeaves, { "packages/ui/src/blocks/Banner.tsx:Content": "components.content", "packages/ui/src/blocks/Banner.tsx:Item": "components.menu" });
  assert.deepEqual(result.unresolved, []);
  // A same-named function from another module is not the registered factory.
  assert.equal(result.resolvedLeaves["packages/ui/src/blocks/Banner.tsx:Fake"], undefined);
  // Detection is opt-in by exact identity; an unregistered scanner infers nothing.
  assert.deepEqual(leafScanner(false).scan({ fill: "foundry/sections.banner", packageName: "@example/ui", pointer: "./blocks#Banner" }).resolvedLeaves, {});
});
test("reports dynamic, unregistered, shadowed, local and indirect leaf factory uses instead of inferring them", () => {
  const result = leafScanner().scan({ fill: "foundry/sections.risky", packageName: "@example/ui", pointer: "./blocks#Risky" });
  assert.deepEqual(result.resolvedLeaves, {});
  const evidence = result.unresolved.map(row => `${row.code}:${row.evidence}`);
  for (const expected of ["DF2:unresolved component leaf call; leaf id or part is not a literal", "DF5:unregistered component leaf components.nope", "DF2:shadowed component leaf binding Shadowed (components.menu)",
    "DF2:unresolved component leaf components.content; not a module-level const binding", "DF2:unresolved component leaf factory reference; only a direct call resolves a leaf"]) assert.ok(evidence.includes(expected), expected);
  assert.throws(() => leafScanner(false).addLeafFactory(undefined, []), /factory source unavailable/);
});
