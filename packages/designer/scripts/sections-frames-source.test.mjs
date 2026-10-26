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
